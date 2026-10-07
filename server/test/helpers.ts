import type { RecentAnalysis, RepoMeta } from '@repoready/shared';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { c as createTar } from 'tar';
import { type AnalyzerContext, createContext } from '../src/analyzers/context';
import type { GitHubClient, GitHubRepo } from '../src/services/github';
import { TEMP_ROOT } from '../src/services/repoFetcher';
import type {
  AnalysisPatch,
  NewAnalysis,
  PublicAnalysisStore,
  StoredAnalysis,
} from '../src/stores';

export const FIXTURES = join(import.meta.dirname, 'fixtures');

export function fixtureDir(name: string): string {
  return join(FIXTURES, name);
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(relative(dir, abs).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function makeMeta(overrides: Partial<RepoMeta> = {}): RepoMeta {
  return {
    isPrivate: false,
    owner: 'acme',
    repo: 'widget',
    fullName: 'acme/widget',
    description: 'A widget',
    htmlUrl: 'https://github.com/acme/widget',
    defaultBranch: 'main',
    commitSha: 'abc123',
    stars: 1,
    forks: 0,
    openIssues: 0,
    sizeKb: 10,
    pushedAt: '2026-10-01T00:00:00Z',
    license: null,
    languages: { JavaScript: 1000 },
    ...overrides,
  };
}

export function makeRepoInfo(overrides: Partial<GitHubRepo> = {}): GitHubRepo {
  const m = makeMeta();
  return {
    owner: m.owner,
    repo: m.repo,
    fullName: m.fullName,
    isPrivate: false,
    description: m.description,
    htmlUrl: m.htmlUrl,
    defaultBranch: 'main',
    stars: 1,
    forks: 0,
    openIssues: 0,
    sizeKb: 10,
    pushedAt: m.pushedAt,
    license: null,
    ...overrides,
  };
}

/** Builds an analyzer context directly over a fixture folder (no tarball involved). */
export async function fixtureContext(
  name: string,
  metaOverrides: Partial<RepoMeta> = {},
): Promise<AnalyzerContext> {
  const rootDir = fixtureDir(name);
  return createContext({
    rootDir,
    files: listFiles(rootDir),
    meta: makeMeta(metaOverrides),
    github: fakeGitHub(),
  });
}

/** A gzipped tarball shaped like GitHub's: every path under a single top-level folder. */
export function tarballOf(dir: string, files = listFiles(dir)): ReadableStream<Uint8Array> {
  const stream = createTar(
    { gzip: true, cwd: dir, prefix: 'acme-widget-abc123', portable: true },
    files,
  );
  return Readable.toWeb(Readable.from(stream)) as unknown as ReadableStream<Uint8Array>;
}

export function fakeGitHub(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getRepo: async () => makeRepoInfo(),
    getHeadCommit: async () => ({ sha: 'abc123', date: '2026-10-01T00:00:00Z' }),
    getLanguages: async () => ({ JavaScript: 1000 }),
    getContributors: async () => [],
    getCommits: async () => [],
    streamTarball: async () => {
      throw new Error('no tarball configured');
    },
    ...overrides,
  };
}

/** In-memory stand-in for the public (Mongo) store, so API tests need no database. */
export class TestStore implements PublicAnalysisStore {
  readonly visibility = 'public' as const;
  readonly docs = new Map<string, StoredAnalysis>();
  readonly updates: { id: string; patch: AnalysisPatch }[] = [];
  private seq = 0;

  async create(doc: NewAnalysis): Promise<StoredAnalysis> {
    const id = (++this.seq).toString(16).padStart(24, '0');
    const stored: StoredAnalysis = {
      ...doc,
      id,
      visibility: 'public',
      status: 'queued',
      error: null,
      report: null,
      scoreTotal: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    };
    this.docs.set(id, stored);
    return stored;
  }

  async get(id: string): Promise<StoredAnalysis | null> {
    return this.docs.get(id) ?? null;
  }

  async update(id: string, patch: AnalysisPatch): Promise<void> {
    this.updates.push({ id, patch });
    const doc = this.docs.get(id);
    if (doc) this.docs.set(id, { ...doc, ...patch });
  }

  private done(): StoredAnalysis[] {
    return [...this.docs.values()]
      .filter((d) => d.status === 'done' && d.report?.meta.isPrivate !== true)
      .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
  }

  async findReusable(fullName: string, commitSha: string, finishedSince: Date) {
    const same = [...this.docs.values()].filter(
      (d) => d.fullName.toLowerCase() === fullName.toLowerCase() && d.commitSha === commitSha,
    );
    return (
      same.find(
        (d) => d.status === 'done' && (d.finishedAt?.getTime() ?? 0) >= finishedSince.getTime(),
      ) ??
      same.find((d) => d.status === 'queued' || d.status === 'running') ??
      null
    );
  }

  async recent(limit: number): Promise<RecentAnalysis[]> {
    const seen = new Set<string>();
    return this.done()
      .filter((d) => !seen.has(d.fullName.toLowerCase()) && seen.add(d.fullName.toLowerCase()))
      .slice(0, limit)
      .map((d) => ({
        id: d.id,
        fullName: d.fullName,
        score: d.scoreTotal,
        createdAt: d.createdAt.toISOString(),
      }));
  }

  async latestScore(fullName: string): Promise<number | null> {
    return (
      this.done().find((d) => d.fullName.toLowerCase() === fullName.toLowerCase())?.scoreTotal ??
      null
    );
  }
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

export interface ExternalApiMock {
  osvVulns?: Record<string, string[]>; // "name@version" -> vulnerability ids
  osvDetails?: Record<string, unknown>; // id -> OSV vuln JSON
  npmLatest?: Record<string, string>; // name -> latest version
  osvDown?: boolean;
  hangRegistry?: boolean;
}

/**
 * A fetch stand-in for OSV.dev and the npm registry, so tests never touch the network.
 * Records every request (url + body) for assertions about what leaves the server.
 */
export function mockExternalApis(mock: ExternalApiMock = {}) {
  const calls: { url: string; body: string }[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, body });
    if (url.startsWith('https://api.osv.dev/v1/querybatch')) {
      if (mock.osvDown) return json({ error: 'down' }, 503);
      const { queries } = JSON.parse(body) as {
        queries: { package: { name: string }; version: string }[];
      };
      return json({
        results: queries.map((q) => {
          const ids = mock.osvVulns?.[`${q.package.name}@${q.version}`] ?? [];
          return ids.length ? { vulns: ids.map((id) => ({ id })) } : {};
        }),
      });
    }
    if (url.startsWith('https://api.osv.dev/v1/vulns/')) {
      const id = decodeURIComponent(url.slice('https://api.osv.dev/v1/vulns/'.length));
      const detail = mock.osvDetails?.[id];
      return detail ? json(detail) : json({ message: 'not found' }, 404);
    }
    if (url.startsWith('https://registry.npmjs.org/')) {
      if (mock.hangRegistry) {
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) return reject(init.signal.reason);
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }
      const name = decodeURIComponent(
        url.slice('https://registry.npmjs.org/'.length, -'/latest'.length),
      );
      const version = mock.npmLatest?.[name];
      return version ? json({ version }) : json('Not Found', 404);
    }
    throw new Error(`Unexpected network call in test: ${url}`);
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

/** RepoReady temp folders currently on disk. */
export function tempDirs(): string[] {
  return existsSync(TEMP_ROOT) ? readdirSync(TEMP_ROOT).sort() : [];
}

/**
 * Waits until no temp folder created since `before` remains. Compares by name because other
 * test files may still be finishing their own cleanup, and a job deletes its folder in a
 * `finally` that runs just after its result is saved.
 */
export async function expectNoNewTempDirs(before: string[]): Promise<void> {
  try {
    await waitFor(() => tempDirs().every((d) => before.includes(d)), 5000);
  } catch {
    throw new Error(
      `temp folders left behind: ${tempDirs()
        .filter((d) => !before.includes(d))
        .join(', ')}`,
    );
  }
}
