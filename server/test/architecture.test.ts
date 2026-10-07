import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeArchitecture,
  buildArchitecture,
  runArchitectureWorker,
} from '../src/analyzers/architecture';
import { fixtureContext, fixtureDir } from './helpers';

describe('buildArchitecture', () => {
  it('builds nodes and edges, marks circular edges and filters entry-like orphans', () => {
    const info = buildArchitecture(
      {
        'src/index.js': ['src/a.js'],
        'src/a.js': ['src/b.js'],
        'src/b.js': ['src/c.js'],
        'src/c.js': ['src/a.js'],
        'src/unused.js': [],
        'vite.config.ts': [],
        'src/vite-env.d.ts': [],
      },
      [['src/a.js', 'src/b.js', 'src/c.js']],
    );
    expect(info.level).toBe('file');
    expect(info.analyzedFiles).toBe(7);
    expect(info.truncated).toBe(false);
    expect(info.orphans).toEqual(['src/unused.js']);
    const circularEdges = info.edges
      .filter((e) => e.circular)
      .map((e) => `${e.source}>${e.target}`);
    expect(circularEdges.sort()).toEqual([
      'src/a.js>src/b.js',
      'src/b.js>src/c.js',
      'src/c.js>src/a.js',
    ]);
    expect(info.edges.find((e) => e.source === 'src/index.js')?.circular).toBe(false);
    expect(info.nodes.find((n) => n.id === 'src/a.js')).toEqual({
      id: 'src/a.js',
      label: 'a.js',
      folder: 'src',
      imports: 1,
      importedBy: 2,
    });
  });

  it('aggregates to folders above the node limit, with weighted edges', () => {
    const graph: Record<string, string[]> = {};
    for (let i = 0; i < 5; i++) graph[`src/ui/c${i}.ts`] = ['src/lib/util.ts', 'src/lib/http.ts'];
    graph['src/lib/util.ts'] = [];
    graph['src/lib/http.ts'] = ['src/lib/util.ts'];
    graph['main.ts'] = ['src/ui/c0.ts'];
    const info = buildArchitecture(graph, [], 4);
    expect(info.level).toBe('folder');
    expect(info.analyzedFiles).toBe(8);
    expect(info.nodes.map((n) => [n.id, n.fileCount])).toEqual([
      ['(root)', 1],
      ['src/lib', 2],
      ['src/ui', 5],
    ]);
    expect(info.edges).toEqual(
      expect.arrayContaining([
        { source: 'src/ui', target: 'src/lib', weight: 10, circular: false },
        { source: '(root)', target: 'src/ui', weight: 1, circular: false },
      ]),
    );
    expect(info.edges.some((e) => e.source === e.target)).toBe(false);
  });

  it('groups monorepo folders deeper than two segments so one package is not a single box', () => {
    const graph: Record<string, string[]> = {};
    for (const area of ['driver', 'query', 'entity']) {
      for (let i = 0; i < 3; i++) {
        graph[`packages/orm/src/${area}/f${i}.ts`] =
          area === 'driver' ? [] : [`packages/orm/src/driver/f${i}.ts`];
      }
    }
    const info = buildArchitecture(graph, [], 5);
    expect(info.level).toBe('folder');
    expect(info.nodes.map((n) => n.id)).toEqual([
      'packages/orm/src/driver',
      'packages/orm/src/entity',
      'packages/orm/src/query',
    ]);
    expect(info.edges).toHaveLength(2);
  });

  it('keeps the most connected nodes and flags truncation if folders still exceed the limit', () => {
    const graph: Record<string, string[]> = {};
    for (let i = 0; i < 6; i++) graph[`f${i}/x.ts`] = i === 0 ? [] : ['f0/x.ts'];
    const info = buildArchitecture(graph, [], 3);
    expect(info.level).toBe('folder');
    expect(info.truncated).toBe(true);
    expect(info.nodes).toHaveLength(3);
    expect(info.nodes.map((n) => n.id)).toContain('f0');
    const ids = new Set(info.nodes.map((n) => n.id));
    expect(info.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});

describe('analyzeArchitecture (real madge in a worker)', () => {
  it('finds exactly the known cycle in the circular fixture', async () => {
    const info = await analyzeArchitecture(await fixtureContext('circular'));
    expect(info.circular).toEqual([['src/a.js', 'src/b.js', 'src/c.js']]);
    expect(info.orphans).toEqual([]); // src/index.js is entry-like
    expect(info.edges.filter((e) => e.circular)).toHaveLength(3);
  });

  it('follows TypeScript imports and skips test files (ts-react)', async () => {
    const info = await analyzeArchitecture(await fixtureContext('ts-react'));
    const ids = info.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining(['src/main.tsx', 'src/App.tsx', 'src/components/Button.tsx']),
    );
    expect(ids).not.toContain('src/App.test.tsx');
    expect(info.circular).toEqual([]);
  });

  it('fails cleanly for a repo without JS/TS', async () => {
    await expect(analyzeArchitecture(await fixtureContext('no-package-json'))).rejects.toThrow(
      /No JavaScript or TypeScript/,
    );
  });

  it('falls back to folder level for a repo with more than 400 files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repoready-big-'));
    try {
      for (let f = 0; f < 9; f++) {
        mkdirSync(join(dir, 'src', `mod${f}`), { recursive: true });
        for (let i = 0; i < 50; i++) {
          const next = f < 8 ? `../mod${f + 1}/file0.js` : './file0.js';
          writeFileSync(
            join(dir, 'src', `mod${f}`, `file${i}.js`),
            i === 0 ? 'module.exports = 1;\n' : `require('${next}');\n`,
          );
        }
      }
      const info = await analyzeArchitecture({
        ...(await fixtureContext('circular')),
        rootDir: dir,
        files: ['src/mod0/file1.js'],
        fileSet: new Set(),
      });
      expect(info.analyzedFiles).toBe(450);
      expect(info.level).toBe('folder');
      expect(info.nodes).toHaveLength(9);
      expect(
        info.edges.find((e) => e.source === 'src/mod0' && e.target === 'src/mod1')?.weight,
      ).toBe(49);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('times out cleanly and terminates the worker', async () => {
    const started = Date.now();
    await expect(
      runArchitectureWorker(
        { rootDir: fixtureDir('ts-react'), tsConfigPath: null },
        { timeoutMs: 1 },
      ),
    ).rejects.toThrow('Architecture analysis timed out');
    expect(Date.now() - started).toBeLessThan(2000);
    // The process is still healthy: a normal run right after works.
    const ok = await runArchitectureWorker({ rootDir: fixtureDir('circular'), tsConfigPath: null });
    expect(ok.circular).toHaveLength(1);
  });

  it('stops when the job is cancelled', async () => {
    const controller = new AbortController();
    const run = runArchitectureWorker(
      { rootDir: fixtureDir('ts-react'), tsConfigPath: null },
      { signal: controller.signal },
    );
    controller.abort(new Error('cancelled'));
    await expect(run).rejects.toThrow('cancelled');
  });

  it('ignores type-only import cycles and test/example folders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repoready-types-'));
    try {
      mkdirSync(join(dir, 'src'));
      mkdirSync(join(dir, 'test'));
      mkdirSync(join(dir, 'examples'));
      writeFileSync(
        join(dir, 'src', 'a.ts'),
        "import { b } from './b';\nexport const a = () => b;\nexport type A = 1;\n",
      );
      writeFileSync(
        join(dir, 'src', 'b.ts'),
        "import type { A } from './a';\nexport const b: A = 1;\n",
      );
      writeFileSync(join(dir, 'test', 'a.js'), "require('../src/a');\n");
      writeFileSync(join(dir, 'examples', 'demo.js'), "require('../src/a');\n");
      const out = await runArchitectureWorker({ rootDir: dir, tsConfigPath: null });
      expect(out.circular).toEqual([]);
      expect(Object.keys(out.graph).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives imports of Vue/Svelte components (regression: vitejs/vite)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repoready-vue-'));
    try {
      mkdirSync(join(dir, 'src'));
      writeFileSync(
        join(dir, 'src', 'main.ts'),
        "import App from './App.vue';\nimport Card from './Card.svelte';\nimport { util } from './util';\nexport default [App, Card, util];\n",
      );
      writeFileSync(join(dir, 'src', 'util.ts'), 'export const util = 1;\n');
      // Valid components that are NOT valid JavaScript.
      writeFileSync(
        join(dir, 'src', 'App.vue'),
        '<template>\n  <div :class="{ a: b }">{{ msg }}</div>\n</template>\n<script setup lang="ts">\nimport { util } from \'./util\';\nconst msg = util;\n</script>\n',
      );
      writeFileSync(
        join(dir, 'src', 'Card.svelte'),
        '<script>\n  export let x;\n</script>\n<p>{x}</p>\n',
      );
      const out = await runArchitectureWorker({ rootDir: dir, tsConfigPath: null });
      expect(out.graph['src/main.ts']).toEqual(['src/util.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives a broken tsconfig', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repoready-tsc-'));
    try {
      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'tsconfig.json'), '{ "extends": "@not-installed/tsconfig", oops');
      writeFileSync(join(dir, 'src', 'a.ts'), "import { b } from './b';\nexport const a = b;\n");
      writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 1;\n');
      const out = await runArchitectureWorker({
        rootDir: dir,
        tsConfigPath: join(dir, 'tsconfig.json'),
      });
      expect(out.graph['src/a.ts']).toEqual(['src/b.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('built worker', () => {
  const dist = join(import.meta.dirname, '..', 'dist');
  beforeAll(() => {
    execFileSync('npx', ['tsup'], {
      cwd: join(import.meta.dirname, '..'),
      shell: true,
      stdio: 'ignore',
    });
  }, 120_000);
  afterAll(() => undefined);

  it('is emitted next to index.js by the build', () => {
    expect(existsSync(join(dist, 'index.js'))).toBe(true);
    expect(existsSync(join(dist, 'architecture.worker.js'))).toBe(true);
  });
});
