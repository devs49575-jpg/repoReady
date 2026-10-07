import type { EnvInfo } from '@repoready/shared';
import { type AnalyzerContext, basename, isIgnoredPath, isTestPath } from './context';

const SOURCE_EXT_RE = /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte)$/;
const MAX_SOURCE_FILES = 5_000;
const MAX_USED_IN = 3;

/** Example env files, in priority order. */
export const EXAMPLE_FILE_NAMES = [
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
  '.env.local.example',
];

const BUILT_INS = new Set([
  'NODE_ENV',
  'CI',
  'HOME',
  'PATH',
  'PWD',
  'MODE',
  'DEV',
  'PROD',
  'SSR',
  'BASE_URL',
]);

const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const PATTERNS = [
  new RegExp(`process\\.env\\.(${NAME})`, 'g'),
  new RegExp(`process\\.env\\[['"](${NAME})['"]\\]`, 'g'),
  new RegExp(`import\\.meta\\.env\\.(${NAME})`, 'g'),
];
const DESTRUCTURE_RE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env\b/g;
const NAME_ONLY_RE = new RegExp(`^${NAME}$`);
// `process.env` used as a whole object, e.g. `schema.parse(process.env)`, `cleanEnv(process.env, …)`.
const WHOLE_ENV_RE = /process\.env(?!\s*(?:\.|\[|\?\.))/;
// UPPER_SNAKE object keys at the start of a line: the variables of an env schema.
const SCHEMA_KEY_RE = /^\s*([A-Z][A-Z0-9_]*[A-Z0-9])\s*:/gm;

/** Extracts env var names referenced in one source file. */
export function findEnvVars(source: string): Set<string> {
  const found = new Set<string>();
  for (const re of PATTERNS) {
    for (const m of source.matchAll(re)) found.add(m[1]!);
  }
  // Validated-config files (zod, envalid, t3-env…) read every variable through a schema whose
  // keys are the variable names. Only applies when the file hands over the whole process.env.
  if (WHOLE_ENV_RE.test(source)) {
    for (const m of source.matchAll(SCHEMA_KEY_RE)) found.add(m[1]!);
  }
  for (const m of source.matchAll(DESTRUCTURE_RE)) {
    for (const part of m[1]!.split(',')) {
      // `A`, `B: alias`, `C = 'default'`; skip `...rest`
      const name = part.split(/[:=]/)[0]!.trim();
      if (NAME_ONLY_RE.test(name)) found.add(name);
    }
  }
  for (const name of BUILT_INS) found.delete(name);
  return found;
}

/** Parses `KEY=value` lines (allowing `export KEY=`), ignoring comments and blank lines. */
export function parseEnvExample(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && !names.includes(m[1]!)) names.push(m[1]!);
  }
  return names;
}

export async function analyzeEnv(ctx: AnalyzerContext): Promise<EnvInfo> {
  // Example files: the root one is "the" example file, but monorepos often keep one per package
  // (e.g. client/.env.example), so variables documented in any of them count as documented.
  const exampleFiles = ctx.files
    // Test fixtures often ship their own example files; they document the fixture, not the app.
    .filter((f) => EXAMPLE_FILE_NAMES.includes(basename(f)) && !isIgnoredPath(f) && !isTestPath(f))
    .sort(
      (a, b) =>
        a.split('/').length - b.split('/').length ||
        EXAMPLE_FILE_NAMES.indexOf(basename(a)) - EXAMPLE_FILE_NAMES.indexOf(basename(b)) ||
        a.localeCompare(b),
    );
  const documented = new Set<string>();
  for (const file of exampleFiles) {
    const text = await ctx.readText(file);
    // Built-ins (NODE_ENV…) are not tracked in code, so documenting them is fine, not "unused".
    if (text)
      for (const name of parseEnvExample(text)) if (!BUILT_INS.has(name)) documented.add(name);
  }

  const usedIn = new Map<string, string[]>();
  const sources = ctx.files
    .filter((f) => SOURCE_EXT_RE.test(f) && !isIgnoredPath(f) && !isTestPath(f))
    .slice(0, MAX_SOURCE_FILES);
  for (const file of sources) {
    const text = await ctx.readText(file);
    if (!text || (!text.includes('process.env') && !text.includes('import.meta.env'))) continue;
    for (const name of findEnvVars(text)) {
      const list = usedIn.get(name) ?? [];
      if (list.length < MAX_USED_IN) list.push(file);
      usedIn.set(name, list);
    }
  }

  const names = new Set([...usedIn.keys(), ...documented]);
  const order = { undocumented: 0, ok: 1, unused: 2 } as const;
  const variables: EnvInfo['variables'] = [...names]
    .map((name) => {
      const used = usedIn.has(name);
      const isDocumented = documented.has(name);
      const status: EnvInfo['variables'][number]['status'] = !used
        ? 'unused'
        : isDocumented
          ? 'ok'
          : 'undocumented';
      return { name, usedIn: usedIn.get(name) ?? [], documented: isDocumented, status };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

  return {
    exampleFile: exampleFiles[0] ?? null,
    variables,
    summary: {
      used: usedIn.size,
      documented: documented.size,
      undocumented: variables.filter((v) => v.status === 'undocumented').length,
      unused: variables.filter((v) => v.status === 'unused').length,
    },
  };
}
