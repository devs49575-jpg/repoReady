import { describe, expect, it } from 'vitest';
import type { AnalyzerContext } from '../src/analyzers/context';
import { SKIPPED_MESSAGE, analyzeDeps, resolvePackages } from '../src/analyzers/deps';
import { registryPath } from '../src/services/npmRegistry';
import { osvFixedIn, osvSeverity } from '../src/services/osv';
import { fixtureContext, mockExternalApis } from './helpers';

// Shape copied from the real OSV response for GHSA-29mw-wpgm-hmr9 (trimmed).
const LODASH_REDOS = {
  id: 'GHSA-29mw-wpgm-hmr9',
  summary: 'Regular Expression Denial of Service (ReDoS) in lodash',
  aliases: ['CVE-2020-28500'],
  database_specific: { severity: 'MODERATE' },
  affected: [
    {
      package: { name: 'lodash-es', ecosystem: 'npm' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '4.0.0' }, { fixed: '4.17.99' }] }],
    },
    {
      package: { name: 'lodash', ecosystem: 'npm' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '4.0.0' }, { fixed: '4.17.21' }] }],
    },
  ],
};
const LODASH_PROTO = {
  id: 'GHSA-p6mc-m468-83gw',
  summary: 'Prototype Pollution in lodash',
  database_specific: { severity: 'HIGH' },
  affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ fixed: '4.17.19' }] }] }],
};

/** Context over in-memory files, for lockfile edge cases. */
async function memoryContext(files: Record<string, string>): Promise<AnalyzerContext> {
  const base = await fixtureContext('vulnerable-deps');
  const pkg = JSON.parse(files['package.json'] ?? 'null') as Record<string, unknown> | null;
  return {
    ...base,
    files: Object.keys(files),
    fileSet: new Set(Object.keys(files)),
    pkg,
    readText: async (p) => files[p] ?? null,
  };
}

describe('deps analyzer', () => {
  it('reports known vulnerabilities and outdated packages from the lockfile (vulnerable-deps)', async () => {
    const { fetchImpl } = mockExternalApis({
      osvVulns: { 'lodash@4.17.15': [LODASH_REDOS.id, LODASH_PROTO.id] },
      osvDetails: { [LODASH_REDOS.id]: LODASH_REDOS, [LODASH_PROTO.id]: LODASH_PROTO },
      npmLatest: { lodash: '4.18.1' },
    });
    const deps = await analyzeDeps(await fixtureContext('vulnerable-deps'), { fetchImpl });

    expect(deps.lockfileUsed).toBe(true);
    expect(deps.approximate).toBe(false);
    expect(deps.totalPackages).toBe(1);
    expect(deps.directPackages).toBe(1);
    expect(deps.vulnerabilities).toEqual([
      {
        id: 'GHSA-p6mc-m468-83gw',
        aliases: [],
        package: 'lodash',
        version: '4.17.15',
        severity: 'high',
        summary: 'Prototype Pollution in lodash',
        fixedIn: '4.17.19',
        url: 'https://osv.dev/vulnerability/GHSA-p6mc-m468-83gw',
      },
      expect.objectContaining({
        id: 'GHSA-29mw-wpgm-hmr9',
        severity: 'medium',
        fixedIn: '4.17.21', // from lodash's own entry, not lodash-es
        aliases: ['CVE-2020-28500'],
      }),
    ]);
    expect(deps.counts).toEqual({ critical: 0, high: 1, medium: 1, low: 0, unknown: 0 });
    expect(deps.outdated).toEqual([
      { name: 'lodash', current: '4.17.15', latest: '4.18.1', type: 'minor' },
    ]);
    expect(deps.notes).toEqual([]);
  });

  it('approximates versions from ranges without an npm lockfile (ts-react)', async () => {
    const { fetchImpl, calls } = mockExternalApis({
      npmLatest: { react: '19.0.0', vite: '5.4.9' },
    });
    const deps = await analyzeDeps(await fixtureContext('ts-react'), { fetchImpl });
    expect(deps.lockfileUsed).toBe(false);
    expect(deps.approximate).toBe(true);
    expect(deps.directPackages).toBe(7);
    const batch = JSON.parse(calls.find((c) => c.url.includes('querybatch'))!.body);
    expect(batch.queries).toContainEqual({
      package: { name: 'react', ecosystem: 'npm' },
      version: '18.3.1',
    });
    expect(deps.outdated).toEqual([
      { name: 'react', current: '18.3.1', latest: '19.0.0', type: 'major' },
      { name: 'vite', current: '5.4.0', latest: '5.4.9', type: 'patch' },
    ]);
  });

  it('skips non-semver ranges (git, workspace, file)', async () => {
    const ctx = await memoryContext({
      'package.json': JSON.stringify({
        dependencies: {
          a: 'workspace:*',
          b: 'file:../b',
          c: 'github:user/c',
          d: 'git+https://x/y.git',
          e: '^1.2.3',
          f: 'latest',
        },
      }),
    });
    const resolved = await resolvePackages(ctx);
    expect(resolved.packages).toEqual([{ name: 'e', version: '1.2.3' }]);
  });

  it('reads nested lockfile v3 entries and lockfile v1 trees', async () => {
    const v3 = await memoryContext({
      'package.json': JSON.stringify({ dependencies: { a: '^1.0.0' } }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'root' },
          'node_modules/a': { version: '1.0.0' },
          'node_modules/a/node_modules/@s/b': { version: '2.0.0' },
          'packages/local': { version: '0.0.1' },
        },
      }),
    });
    expect((await resolvePackages(v3)).packages).toEqual([
      { name: 'a', version: '1.0.0' },
      { name: '@s/b', version: '2.0.0' },
    ]);

    const v1 = await memoryContext({
      'package.json': JSON.stringify({ dependencies: { a: '^1.0.0' } }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 1,
        dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '3.0.0' } } } },
      }),
    });
    const r1 = await resolvePackages(v1);
    expect(r1.packages).toEqual([
      { name: 'a', version: '1.0.0' },
      { name: 'b', version: '3.0.0' },
    ]);
    expect(r1.direct.get('a')).toBe('1.0.0');
  });

  it('fails the section (not the pipeline) when OSV is down', async () => {
    const { fetchImpl } = mockExternalApis({ osvDown: true });
    await expect(
      analyzeDeps(await fixtureContext('vulnerable-deps'), { fetchImpl }),
    ).rejects.toThrow(/OSV\.dev did not respond/);
  });

  it('skips registry 404s silently', async () => {
    const { fetchImpl } = mockExternalApis({}); // registry returns 404 for everything
    const deps = await analyzeDeps(await fixtureContext('vulnerable-deps'), { fetchImpl });
    expect(deps.outdated).toEqual([]);
    expect(deps.notes).toEqual([]);
  });

  it('retries a timed-out registry lookup once', async () => {
    const mock = mockExternalApis({ npmLatest: { lodash: '4.18.1' } });
    let registryCalls = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith('https://registry.npmjs.org/') && ++registryCalls === 1) {
        throw Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        });
      }
      return mock.fetchImpl(url, init);
    }) as typeof fetch;
    const deps = await analyzeDeps(await fixtureContext('vulnerable-deps'), { fetchImpl });
    expect(registryCalls).toBe(2);
    expect(deps.outdated).toHaveLength(1);
  });

  it('notes when the npm registry is unreachable instead of hiding it', async () => {
    const mock = mockExternalApis();
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith('https://registry.npmjs.org/'))
        throw new TypeError('fetch failed');
      return mock.fetchImpl(url, init);
    }) as typeof fetch;
    const deps = await analyzeDeps(await fixtureContext('vulnerable-deps'), { fetchImpl });
    expect(deps.notes).toContain(
      'Could not reach the npm registry, so outdated packages were not checked',
    );
  });

  it('returns what it collected plus a note when the budget runs out', async () => {
    const { fetchImpl } = mockExternalApis({ hangRegistry: true });
    const deps = await analyzeDeps(await fixtureContext('vulnerable-deps'), {
      fetchImpl,
      budgetMs: 100,
    });
    expect(deps.notes.join(' ')).toMatch(/time limit/);
    expect(deps.vulnerabilities).toEqual([]);
  });

  it('notes when vulnerability details are capped', async () => {
    const ids = Array.from({ length: 155 }, (_, i) => `GHSA-${i}`);
    const { fetchImpl, calls } = mockExternalApis({ osvVulns: { 'lodash@4.17.15': ids } });
    const deps = await analyzeDeps(await fixtureContext('vulnerable-deps'), { fetchImpl });
    expect(calls.filter((c) => c.url.includes('/v1/vulns/'))).toHaveLength(150);
    expect(deps.vulnerabilities).toHaveLength(155);
    expect(deps.counts.unknown).toBe(155);
    expect(deps.notes.join(' ')).toMatch(/150 of 155/);
  });

  describe('private mode (Addendum 01, 5.7)', () => {
    it('makes no external calls at all when lookups are skipped', async () => {
      const { fetchImpl, calls } = mockExternalApis();
      await expect(
        analyzeDeps(await fixtureContext('vulnerable-deps'), {
          fetchImpl,
          skipExternalLookups: true,
        }),
      ).rejects.toThrow(SKIPPED_MESSAGE);
      expect(calls).toEqual([]);
    });

    it('only sends packages resolved from registry.npmjs.org and counts the rest', async () => {
      const ctx = await memoryContext({
        'package.json': JSON.stringify({
          dependencies: { 'public-pkg': '^1.0.0', '@corp/secret-sdk': '^2.0.0', local: '*' },
        }),
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            '': {},
            'node_modules/public-pkg': {
              version: '1.0.0',
              resolved: 'https://registry.npmjs.org/public-pkg/-/public-pkg-1.0.0.tgz',
            },
            'node_modules/@corp/secret-sdk': {
              version: '2.0.0',
              resolved: 'https://npm.corp.example.com/@corp/secret-sdk/-/secret-sdk-2.0.0.tgz',
            },
            'node_modules/gitdep': {
              version: '1.0.0',
              resolved: 'git+ssh://git@github.com/x/y.git',
            },
            'node_modules/local': { link: true, resolved: 'packages/local' },
          },
        }),
      });
      const { fetchImpl, calls } = mockExternalApis({ npmLatest: { 'public-pkg': '1.0.0' } });
      const deps = await analyzeDeps(ctx, { fetchImpl, privateMode: true });
      expect(deps.totalPackages).toBe(1);
      expect(deps.skippedPackages).toBe(3);
      expect(deps.notes.join(' ')).toMatch(/3 package\(s\) not from registry\.npmjs\.org/);
      const sent = calls.map((c) => c.url + c.body).join('\n');
      expect(sent).toContain('public-pkg');
      expect(sent).not.toContain('secret-sdk');
      expect(sent).not.toContain('gitdep');
    });

    it('warns that names were sent when there is no lockfile', async () => {
      const { fetchImpl } = mockExternalApis();
      const deps = await analyzeDeps(await fixtureContext('ts-react'), {
        fetchImpl,
        privateMode: true,
      });
      expect(deps.notes.join(' ')).toMatch(/Package names were sent to public registries/);
    });
  });
});

describe('OSV and registry helpers', () => {
  it('maps OSV severities', () => {
    expect(osvSeverity({ id: 'x', database_specific: { severity: 'CRITICAL' } })).toBe('critical');
    expect(osvSeverity({ id: 'x', database_specific: { severity: 'MODERATE' } })).toBe('medium');
    expect(osvSeverity({ id: 'x' })).toBe('unknown');
    expect(osvSeverity(undefined)).toBe('unknown');
  });

  it('falls back to any fixed event when the package has no own entry', () => {
    expect(osvFixedIn(LODASH_REDOS, 'lodash.trim')).toBe('4.17.99');
    expect(osvFixedIn({ id: 'x' }, 'a')).toBeNull();
  });

  it('builds registry paths for scoped packages', () => {
    expect(registryPath('lodash')).toBe('lodash');
    expect(registryPath('@types/node')).toBe('@types%2Fnode');
  });
});
