/**
 * Runs madge off the main thread. Receives ONLY the extracted repo path and an optional tsconfig
 * path (Addendum 01, 5.6: never tokens, clients or report data). madge parses files statically;
 * nothing from the analyzed repo is executed.
 */
import madge from 'madge';
import { parentPort, workerData } from 'node:worker_threads';

export interface ArchitectureWorkerInput {
  rootDir: string;
  tsConfigPath: string | null;
}

export type ArchitectureWorkerOutput =
  | { ok: true; graph: Record<string, string[]>; circular: string[][] }
  | { ok: false; error: string };

const EXCLUDE = [
  /node_modules/,
  /(^|\/)(dist|build|coverage|\.next|out)(\/|$)/,
  /\.(test|spec)\.[jt]sx?$/,
  /__tests__/,
  // Beyond the spec: test suites, examples and fixtures are not app architecture, and counting
  // them inflated "files nobody imports" (e.g. expressjs/express: 77 of 141 files).
  /(^|\/)(tests?|e2e|examples?|benchmarks?|fixtures?|__mocks__)\//,
];

async function analyze({ rootDir, tsConfigPath }: ArchitectureWorkerInput) {
  const config = {
    baseDir: rootDir,
    fileExtensions: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'],
    excludeRegExp: EXCLUDE,
    includeNpm: false,
    // Only follow imports into JS/TS files. madge would otherwise traverse into imported .vue /
    // .svelte components, where filing-cabinet parses the component as plain JS outside any
    // try/catch and one throw aborts the whole graph (found on vitejs/vite). The import edge
    // itself is dropped; the graph covers JS/TS modules.
    dependencyFilter: (dependencyPath: string) => /\.(m|c)?[jt]sx?$/.test(dependencyPath),
    // `import type` has no runtime effect; counting it reported 251 "cycles" in vuejs/core.
    detectiveOptions: {
      es6: { skipTypeImports: true },
      ts: { skipTypeImports: true },
      tsx: { skipTypeImports: true },
    },
  };
  let result;
  try {
    result = await madge(rootDir, tsConfigPath ? { ...config, tsConfig: tsConfigPath } : config);
  } catch {
    // A broken or unresolvable tsconfig (e.g. `extends` a package that is not installed) should
    // not lose the whole graph; retry without it.
    result = await madge(rootDir, config);
  }
  return { graph: result.obj(), circular: result.circular() };
}

const input = workerData as ArchitectureWorkerInput;
analyze(input).then(
  ({ graph, circular }) => parentPort?.postMessage({ ok: true, graph, circular }),
  (err: unknown) =>
    parentPort?.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : 'madge failed',
    }),
);
