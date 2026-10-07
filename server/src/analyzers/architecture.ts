import type { ArchitectureInfo } from '@repoready/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { AppError } from '../utils/errors';
import type {
  ArchitectureWorkerInput,
  ArchitectureWorkerOutput,
} from '../workers/architecture.worker';
import type { AnalyzerContext } from './context';

export const ARCHITECTURE_LIMITS = {
  timeoutMs: 45_000,
  maxOldGenerationSizeMb: 512,
  maxNodes: 400,
  /** Folder-level graphs aim for at most this many boxes so they stay readable. */
  folderTarget: 120,
};

const MAX_FOLDER_DEPTH = 4;

const ENTRY_LIKE_RE = /^(index|main|app|server)\.[^/]+$|\.config\.[^/]+$|\.d\.ts$/i;

/**
 * Locates the worker: next to the bundle in production (dist/architecture.worker.js), or the
 * TypeScript source in dev/tests, which needs the tsx loader inside the worker.
 */
function resolveWorker(): { url: URL; needsTsx: boolean } {
  const built = new URL('./architecture.worker.js', import.meta.url);
  if (existsSync(fileURLToPath(built))) return { url: built, needsTsx: false };
  return { url: new URL('../workers/architecture.worker.ts', import.meta.url), needsTsx: true };
}

/** Runs madge in a worker thread with a hard timeout and memory cap; terminates it on abort. */
export function runArchitectureWorker(
  input: ArchitectureWorkerInput,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ graph: Record<string, string[]>; circular: string[][] }> {
  const { url, needsTsx } = resolveWorker();
  const timeoutMs = options.timeoutMs ?? ARCHITECTURE_LIMITS.timeoutMs;

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    // Only plain data crosses into the worker: the repo path and an optional tsconfig path.
    const workerData: ArchitectureWorkerInput = {
      rootDir: input.rootDir,
      tsConfigPath: input.tsConfigPath,
    };
    const worker = new Worker(url, {
      workerData,
      resourceLimits: { maxOldGenerationSizeMb: ARCHITECTURE_LIMITS.maxOldGenerationSizeMb },
      execArgv: needsTsx ? ['--import', 'tsx'] : [],
      env: {}, // the worker needs no environment, so it gets none (no GITHUB_TOKEN etc.)
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() => reject(new AppError('ANALYSIS_FAILED', 'Architecture analysis timed out'))),
      timeoutMs,
    );
    const onAbort = () => finish(() => reject(options.signal?.reason));
    options.signal?.addEventListener('abort', onAbort, { once: true });

    worker.once('message', (msg: ArchitectureWorkerOutput) =>
      finish(() =>
        msg.ok
          ? resolve({ graph: msg.graph, circular: msg.circular })
          : reject(new AppError('ANALYSIS_FAILED', 'Could not build the dependency graph')),
      ),
    );
    worker.once('error', (err: Error & { code?: string }) =>
      finish(() =>
        reject(
          new AppError(
            'ANALYSIS_FAILED',
            err.code === 'ERR_WORKER_OUT_OF_MEMORY'
              ? 'Architecture analysis ran out of memory'
              : 'Architecture analysis crashed',
          ),
        ),
      ),
    );
    worker.once('exit', (code) =>
      finish(() =>
        reject(new AppError('ANALYSIS_FAILED', `Architecture analysis stopped (exit ${code})`)),
      ),
    );
  });
}

function folderOfDepth(file: string, depth = 2): string {
  const dirs = file.split('/').slice(0, -1);
  return dirs.length === 0 ? '(root)' : dirs.slice(0, depth).join('/');
}

/**
 * Folder depth for the folder-level graph. The plan says "first two path segments", but in a
 * monorepo that collapses e.g. packages/typeorm (500 files) into one box. Use the deepest depth
 * (up to 4) that keeps the graph readable, falling back to shallower ones.
 */
function chooseFolderDepth(files: string[], maxGroups: number): number {
  for (let depth = MAX_FOLDER_DEPTH; depth > 1; depth--) {
    if (new Set(files.map((f) => folderOfDepth(f, depth))).size <= maxGroups) return depth;
  }
  return 1;
}

function basename(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}

/** Pairs (a -> b) that are consecutive in some cycle, including the wrap-around. */
function circularPairs(cycles: string[][]): Set<string> {
  const pairs = new Set<string>();
  for (const cycle of cycles) {
    cycle.forEach((from, i) => pairs.add(`${from}\0${cycle[(i + 1) % cycle.length]}`));
  }
  return pairs;
}

/** Turns madge output into report data, aggregating to folders and truncating large graphs. */
export function buildArchitecture(
  graph: Record<string, string[]>,
  circular: string[][],
  maxNodes = ARCHITECTURE_LIMITS.maxNodes,
): ArchitectureInfo {
  const files = Object.keys(graph).sort();
  const importedBy = new Map<string, number>(files.map((f) => [f, 0]));
  for (const deps of Object.values(graph)) {
    for (const dep of deps) importedBy.set(dep, (importedBy.get(dep) ?? 0) + 1);
  }
  const orphans = files.filter((f) => importedBy.get(f) === 0 && !ENTRY_LIKE_RE.test(basename(f)));
  const cyclePairs = circularPairs(circular);

  let level: ArchitectureInfo['level'] = 'file';
  let nodes: ArchitectureInfo['nodes'];
  let edges: ArchitectureInfo['edges'];

  if (files.length <= maxNodes) {
    nodes = files.map((f) => ({
      id: f,
      label: basename(f),
      folder: folderOfDepth(f),
      imports: graph[f]!.length,
      importedBy: importedBy.get(f) ?? 0,
    }));
    edges = files.flatMap((source) =>
      graph[source]!.map((target) => ({
        source,
        target,
        circular: cyclePairs.has(`${source}\0${target}`),
      })),
    );
  } else {
    level = 'folder';
    const depth = chooseFolderDepth(files, Math.min(ARCHITECTURE_LIMITS.folderTarget, maxNodes));
    const folderOf = (file: string) => folderOfDepth(file, depth);
    const fileCount = new Map<string, number>();
    for (const f of files) fileCount.set(folderOf(f), (fileCount.get(folderOf(f)) ?? 0) + 1);
    const edgeMap = new Map<
      string,
      { source: string; target: string; weight: number; circular: boolean }
    >();
    for (const source of files) {
      for (const target of graph[source]!) {
        const from = folderOf(source);
        const to = folderOf(target);
        if (from === to) continue;
        const key = `${from}\0${to}`;
        const edge = edgeMap.get(key) ?? { source: from, target: to, weight: 0, circular: false };
        edge.weight += 1;
        edge.circular ||= cyclePairs.has(`${source}\0${target}`);
        edgeMap.set(key, edge);
      }
    }
    edges = [...edgeMap.values()];
    nodes = [...fileCount.keys()].sort().map((folder) => ({
      id: folder,
      label: folder,
      folder: folder.split('/')[0]!,
      imports: edges.filter((e) => e.source === folder).length,
      importedBy: edges.filter((e) => e.target === folder).length,
      fileCount: fileCount.get(folder),
    }));
  }

  let truncated = false;
  if (nodes.length > maxNodes) {
    truncated = true;
    const keep = new Set(
      [...nodes]
        .sort(
          (a, b) =>
            b.imports + b.importedBy - (a.imports + a.importedBy) || a.id.localeCompare(b.id),
        )
        .slice(0, maxNodes)
        .map((n) => n.id),
    );
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }

  return { level, analyzedFiles: files.length, nodes, edges, circular, orphans, truncated };
}

export async function analyzeArchitecture(
  ctx: AnalyzerContext,
  options: { timeoutMs?: number } = {},
): Promise<ArchitectureInfo> {
  const hasJs = ctx.files.some((f) => /\.(m|c)?[jt]sx?$/.test(f));
  if (!hasJs) throw new AppError('ANALYSIS_FAILED', 'No JavaScript or TypeScript files to map');
  const tsConfigPath = ctx.fileSet.has('tsconfig.json') ? join(ctx.rootDir, 'tsconfig.json') : null;
  const { graph, circular } = await runArchitectureWorker(
    { rootDir: ctx.rootDir, tsConfigPath },
    { timeoutMs: options.timeoutMs, signal: ctx.signal },
  );
  return buildArchitecture(graph, circular);
}
