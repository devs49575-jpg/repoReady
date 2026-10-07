import { describe, expect, it } from 'vitest';
import { analyzeChecklist } from '../src/analyzers/checklist';
import { analyzeEnv, findEnvVars, parseEnvExample } from '../src/analyzers/env';
import { analyzeHowToRun, extractHeadings } from '../src/analyzers/howToRun';
import { analyzeStack, languagePercents } from '../src/analyzers/stack';
import { fixtureContext } from './helpers';

describe('stack analyzer', () => {
  it('detects technologies, package manager and evidence (simple-express)', async () => {
    const stack = await analyzeStack(await fixtureContext('simple-express'));
    expect(stack.hasPackageJson).toBe(true);
    expect(stack.packageManager).toBe('npm');
    expect(stack.technologies).toEqual(
      expect.arrayContaining([
        { name: 'Express', category: 'framework', evidence: 'dependency: express' },
        { name: 'Mongoose', category: 'database', evidence: 'dependency: mongoose' },
      ]),
    );
    expect(stack.workspaces).toEqual([]);
  });

  it('uses yarn.lock and finds TypeScript once (ts-react)', async () => {
    const stack = await analyzeStack(await fixtureContext('ts-react'));
    expect(stack.packageManager).toBe('yarn');
    expect(stack.technologies.filter((t) => t.name === 'TypeScript')).toHaveLength(1);
    expect(stack.technologies.map((t) => t.name)).toEqual(
      expect.arrayContaining(['React', 'Vite', 'Vitest', 'ESLint', 'Prettier']),
    );
  });

  it('reads workspaces in object form and the packageManager field (monorepo)', async () => {
    const stack = await analyzeStack(await fixtureContext('monorepo'));
    expect(stack.workspaces).toEqual(['packages/*']);
    expect(stack.packageManager).toBe('pnpm');
  });

  it('returns languages only without package.json', async () => {
    const stack = await analyzeStack(
      await fixtureContext('no-package-json', { languages: { Python: 900, Shell: 100 } }),
    );
    expect(stack.hasPackageJson).toBe(false);
    expect(stack.packageManager).toBe('unknown');
    expect(stack.languages).toEqual([
      { name: 'Python', percent: 90 },
      { name: 'Shell', percent: 10 },
    ]);
  });

  it('keeps the top 6 languages and groups the rest as Other', () => {
    const langs = languagePercents({ A: 50, B: 20, C: 10, D: 8, E: 5, F: 4, G: 2, H: 1 });
    expect(langs).toHaveLength(7);
    expect(langs[6]).toEqual({ name: 'Other', percent: 3 });
    expect(languagePercents({})).toEqual([]);
  });
});

describe('env analyzer', () => {
  it('finds documented and undocumented vars, ignoring built-ins (simple-express)', async () => {
    const env = await analyzeEnv(await fixtureContext('simple-express'));
    expect(env.exampleFile).toBe('.env.example');
    expect(env.variables).toEqual([
      { name: 'SECRET', usedIn: ['src/index.js'], documented: false, status: 'undocumented' },
      { name: 'DB_URL', usedIn: ['src/db.js'], documented: true, status: 'ok' },
    ]);
    expect(env.summary).toEqual({ used: 2, documented: 1, undocumented: 1, unused: 0 });
  });

  it('scans import.meta.env, skips test files and Vite built-ins (ts-react)', async () => {
    const env = await analyzeEnv(await fixtureContext('ts-react'));
    expect(env.exampleFile).toBeNull();
    expect(env.variables.map((v) => v.name)).toEqual(['VITE_API_URL']);
  });

  it('handles destructuring, bracket access, nested example files and skips dist (monorepo)', async () => {
    const env = await analyzeEnv(await fixtureContext('monorepo'));
    expect(env.exampleFile).toBe('packages/app/.env.example');
    const byName = Object.fromEntries(env.variables.map((v) => [v.name, v.status]));
    expect(byName).toEqual({
      APP_PORT: 'undocumented',
      OTHER_KEY: 'undocumented',
      APP_KEY: 'ok',
      UNUSED_VAR: 'unused',
    });
    expect(byName).not.toHaveProperty('FROM_DIST');
  });

  it('parses example files with comments and export prefixes', () => {
    expect(parseEnvExample('# c\n\nexport A=1\nB = 2\nnot a var\nA=dup\n')).toEqual(['A', 'B']);
  });

  it('reads variable names from validated-config schemas (zod, envalid)', () => {
    const zod = [
      'const schema = z.object({',
      '  PORT: z.coerce.number().default(4000),',
      '  MONGODB_URI: z.string(),',
      "  NODE_ENV: z.enum(['development']),",
      '});',
      'export const config = schema.parse(process.env);',
    ].join('\n');
    expect([...findEnvVars(zod)].sort()).toEqual(['MONGODB_URI', 'PORT']);

    const envalid =
      'export const env = cleanEnv(process.env, {\n  API_KEY: str(),\n  DEBUG_MODE: bool(),\n});';
    expect([...findEnvVars(envalid)].sort()).toEqual(['API_KEY', 'DEBUG_MODE']);
  });

  it('does not treat uppercase object keys as env vars without whole-env usage', () => {
    const src =
      "const COLORS = {\n  RED: '#f00',\n  DARK_BLUE: '#009',\n};\nconsole.log(process.env.HOME_DIR);";
    expect([...findEnvVars(src)]).toEqual(['HOME_DIR']);
  });

  it('ignores example env files inside test fixtures', async () => {
    const ctx = await fixtureContext('simple-express');
    ctx.files = [...ctx.files, 'test/fixtures/app/.env.example'];
    ctx.fileSet = new Set(ctx.files);
    const original = ctx.readText;
    ctx.readText = async (p) =>
      p === 'test/fixtures/app/.env.example' ? 'SECRET=x\n' : original(p);
    const env = await analyzeEnv(ctx);
    expect(env.variables.find((v) => v.name === 'SECRET')?.status).toBe('undocumented');
  });

  it('extracts names from all supported patterns', () => {
    const src = `process.env.A; process.env["B"]; import.meta.env.C; const { D, E: e, F = 1, ...rest } = process.env; process.env.NODE_ENV;`;
    expect([...findEnvVars(src)].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});

describe('howToRun analyzer', () => {
  it('builds ordered steps for an npm project (simple-express)', async () => {
    const ctx = await fixtureContext('simple-express');
    const run = await analyzeHowToRun(ctx, await analyzeEnv(ctx));
    expect(run.nodeVersion).toEqual({ value: '>=18', source: 'package.json engines.node' });
    expect(run.scripts).toEqual({
      install: 'npm ci',
      dev: 'npm run dev',
      start: 'npm run start',
      build: null,
      test: 'npm run test',
      lint: null,
    });
    expect(run.stepItems.map((s) => s.command)).toEqual([
      'git clone https://github.com/acme/widget.git && cd widget',
      null, // engines.node is a range, so no `nvm use`
      'cp .env.example .env',
      'npm ci',
      'npm run dev',
      // the default "no test specified" script is not offered as a step
    ]);
    expect(run.stepItems[2]!.label).toBe('Create your .env file and fill in: SECRET, DB_URL');
    expect(run.steps[0]).toBe(
      'Clone the repository: git clone https://github.com/acme/widget.git && cd widget',
    );
    expect(run.readme).toEqual({
      exists: true,
      hasSetupSection: true,
      headings: ['simple-express', 'Installation'],
    });
  });

  it('prefers .nvmrc, uses yarn, and ignores headings inside code fences (ts-react)', async () => {
    const ctx = await fixtureContext('ts-react');
    const run = await analyzeHowToRun(ctx, await analyzeEnv(ctx));
    expect(run.nodeVersion).toEqual({ value: '20.11.1', source: '.nvmrc' });
    expect(run.scripts.install).toBe('yarn install');
    expect(run.scripts.dev).toBe('yarn dev');
    expect(run.readme.headings).toEqual(['ts-react', 'Getting started', 'Usage']);
    expect(run.stepItems.map((s) => s.label)).toContain('Create a .env file with: VITE_API_URL');
    expect(run.stepItems.at(-1)).toEqual({ label: 'Run the tests', command: 'yarn test' });
  });

  it('finds the start:dev script and nested example file target (monorepo)', async () => {
    const ctx = await fixtureContext('monorepo');
    const run = await analyzeHowToRun(ctx, await analyzeEnv(ctx));
    expect(run.scripts.dev).toBe('pnpm run start:dev');
    expect(run.stepItems.map((s) => s.command)).toContain(
      'cp packages/app/.env.example packages/app/.env',
    );
  });

  it('only offers clone without package.json', async () => {
    const ctx = await fixtureContext('no-package-json');
    const run = await analyzeHowToRun(ctx, await analyzeEnv(ctx));
    expect(run.scripts.install).toBeNull();
    expect(run.stepItems).toHaveLength(1);
    expect(run.readme.hasSetupSection).toBe(false);
  });

  it('extracts ATX headings and strips closing hashes', () => {
    expect(extractHeadings('# A #\n```\n# not\n```\n  ## B\n#nope\n')).toEqual(['A', 'B']);
  });
});

describe('checklist analyzer', () => {
  async function checklistFor(name: string, license: string | null = null) {
    const ctx = await fixtureContext(name, { license });
    const env = await analyzeEnv(ctx);
    const items = await analyzeChecklist(ctx, env, await analyzeHowToRun(ctx, env));
    return Object.fromEntries(items.map((i) => [i.id, i.passed]));
  }

  it('has every item from the spec with hints', async () => {
    const ctx = await fixtureContext('simple-express');
    const items = await analyzeChecklist(ctx, null, null);
    expect(items.map((i) => i.id)).toEqual([
      'readme',
      'readme_setup',
      'license',
      'contributing',
      'gitignore',
      'env_example',
      'lockfile',
      'node_version_pinned',
      'ci',
      'tests',
      'linter',
      'formatter',
      'typescript',
      'dockerfile',
    ]);
    expect(items.every((i) => i.hint.length > 10)).toBe(true);
  });

  it('scores a well-kept project (ts-react)', async () => {
    expect(await checklistFor('ts-react')).toEqual({
      readme: true,
      readme_setup: true,
      license: true,
      contributing: true,
      gitignore: true,
      env_example: false, // VITE_API_URL is used but there is no example file
      lockfile: true,
      node_version_pinned: true,
      ci: true,
      tests: true,
      linter: true,
      formatter: true,
      typescript: true,
      dockerfile: false,
    });
  });

  it('flags gaps in a bare project (simple-express)', async () => {
    const result = await checklistFor('simple-express');
    expect(result.readme).toBe(false); // under 300 chars
    expect(result.readme_setup).toBe(true);
    expect(result.tests).toBe(false); // default npm test script only
    expect(result.env_example).toBe(true);
    expect(result.lockfile).toBe(true);
    expect(result.license).toBe(false);
  });

  it('accepts a license from GitHub metadata and Biome as linter and formatter', async () => {
    const result = await checklistFor('monorepo', 'MIT');
    expect(result.license).toBe(true);
    expect(result.linter).toBe(true);
    expect(result.formatter).toBe(true);
  });

  it('recognizes xo as a linter', async () => {
    const ctx = await fixtureContext('circular');
    ctx.pkg = { devDependencies: { xo: '^0.59.0' } };
    const items = await analyzeChecklist(ctx, null, null);
    expect(items.find((i) => i.id === 'linter')?.passed).toBe(true);
  });

  it('passes env_example when no env vars are used (circular)', async () => {
    expect((await checklistFor('circular')).env_example).toBe(true);
  });
});
