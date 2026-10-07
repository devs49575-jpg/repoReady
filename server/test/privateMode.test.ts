import type { AnalysisDto } from '@repoready/shared';
import type { Express } from 'express';
import mongoose from 'mongoose';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createLogger } from '../src/logger';
import { AnalysisModel } from '../src/models/Analysis';
import { JobQueue } from '../src/queue/jobQueue';
import { createGitHubClient } from '../src/services/github';
import { TEMP_ROOT } from '../src/services/repoFetcher';
import { MemoryAnalysisStore } from '../src/stores/memoryStore';
import { MongoAnalysisStore } from '../src/stores/mongoStore';
import { fixtureDir, mockExternalApis, tarballOf, waitFor } from './helpers';

// Record everything sent into the architecture worker (Addendum 01, Section 8 test 5).
const { workerMessages } = vi.hoisted(() => ({ workerMessages: [] as string[] }));
vi.mock('node:worker_threads', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:worker_threads')>();
  class RecordingWorker extends mod.Worker {
    constructor(url: string | URL, options?: import('node:worker_threads').WorkerOptions) {
      workerMessages.push(JSON.stringify(options?.workerData ?? null));
      super(url, options);
    }
  }
  return { ...mod, Worker: RecordingWorker };
});

const TOKEN = 'github_pat_TESTSECRET0123456789';
const uri = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/repoready_test';

// ---------------------------------------------------------------------------------------------
// A fake GitHub over HTTP: the REAL client talks to it, so the token flows through the real
// Authorization header and tarball-redirect code.
// ---------------------------------------------------------------------------------------------
interface GitHubBehavior {
  repoStatus?: number;
  repoHeaders?: Record<string, string>;
  repoBody?: unknown;
  tarball?: 'ok' | 'hang' | 'error';
  onDeepStep?: () => void; // runs inside the job while the temp dir exists
}

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function makeNetwork(behavior: GitHubBehavior = {}) {
  const calls: RecordedCall[] = [];
  const external = mockExternalApis();
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
    calls.push({ url, headers, body: typeof init?.body === 'string' ? init.body : '' });
    const u = new URL(url);

    if (u.hostname === 'api.github.com') {
      if (headers.Authorization !== `Bearer ${TOKEN}`)
        return json({ message: 'Bad credentials' }, 401);
      const path = u.pathname;
      if (path === '/repos/acme/secret') {
        return json(
          behavior.repoBody ?? {
            name: 'secret',
            full_name: 'acme/secret',
            owner: { login: 'acme' },
            private: true,
            description: 'Top secret',
            html_url: 'https://github.com/acme/secret',
            default_branch: 'main',
            stargazers_count: 0,
            forks_count: 0,
            open_issues_count: 0,
            size: 10,
            pushed_at: '2026-10-01T00:00:00Z',
            license: null,
          },
          behavior.repoStatus ?? 200,
          behavior.repoHeaders,
        );
      }
      if (path === '/repos/acme/secret/commits/main') {
        return json({ sha: 'abc123', commit: { committer: { date: '2026-10-01T00:00:00Z' } } });
      }
      if (path === '/repos/acme/secret/languages') return json({ JavaScript: 100 });
      if (path === '/repos/acme/secret/contributors') {
        behavior.onDeepStep?.();
        return json([{ login: 'ann', avatar_url: '', contributions: 3, type: 'User' }]);
      }
      if (path === '/repos/acme/secret/commits') return json([]);
      if (path === '/repos/acme/secret/tarball/abc123') {
        if (behavior.tarball === 'error') return json({ message: 'boom' }, 500);
        return new Response(null, {
          status: 302,
          headers: {
            location:
              'https://codeload.github.com/acme/secret/legacy.tar.gz/abc123?token=SHORTLIVED',
          },
        });
      }
      return json({ message: 'Not Found' }, 404);
    }
    if (u.hostname === 'codeload.github.com') {
      if (behavior.tarball === 'hang') {
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) return reject(init.signal.reason);
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }
      return new Response(tarballOf(fixtureDir('simple-express')), { status: 200 });
    }
    return external.fetchImpl(input, init); // OSV.dev and the npm registry
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: createLogger(stream, 'debug'), output: () => lines.join('') };
}

function setup(
  options: {
    behavior?: GitHubBehavior;
    enabled?: boolean;
    requireHttps?: boolean;
    now?: () => number;
  } = {},
) {
  const network = makeNetwork(options.behavior);
  vi.stubGlobal('fetch', network.fetchImpl); // deps analyzer -> OSV/npm via global fetch
  const logs = captureLogs();
  const enabled = options.enabled ?? true;
  const memory = new MemoryAnalysisStore({ ttlMinutes: 60, maxEntries: 10, now: options.now });
  const queue = new JobQueue(2, 20_000);
  const app = createApp({
    clientOrigin: 'http://localhost:5173',
    logger: logs.logger,
    rateLimits: { createsPerHour: 100, readsPerMinute: 100_000 }, // tests poll every 20ms
    analyses: {
      // The public client must never be used for a token request.
      publicGitHub: createGitHubClient('server-token-not-for-private', {
        fetchImpl: network.fetchImpl,
      }),
      stores: { public: new MongoAnalysisStore(), private: enabled ? memory : undefined },
      queue,
      maxRepoSizeKb: 1000,
      cacheTtlHours: 24,
      privateMode: { enabled, requireHttps: options.requireHttps ?? false },
      createPrivateClient: (token) =>
        createGitHubClient(token, { mode: 'private', fetchImpl: network.fetchImpl }),
    },
    publicConfig: { privateModeEnabled: enabled, privateReportTtlMinutes: 60 },
  });
  const responses: string[] = [];
  const record = (res: request.Response) => {
    responses.push(JSON.stringify(res.headers) + JSON.stringify(res.body) + (res.text ?? ''));
    return res;
  };
  stores.push(memory);
  return { app, memory, queue, network, logs, responses, record };
}

const stores: MemoryAnalysisStore[] = [];

beforeAll(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
});
beforeEach(async () => {
  await AnalysisModel.deleteMany({});
  workerMessages.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const s of stores.splice(0)) s.close();
});
afterAll(async () => {
  await AnalysisModel.deleteMany({});
  await mongoose.disconnect();
});

function postPrivate(app: Express, body: object = { repoUrl: 'acme/secret' }, token = TOKEN) {
  return request(app).post('/api/analyses').set('X-GitHub-Token', token).send(body);
}

async function waitDone(app: Express, id: string): Promise<AnalysisDto> {
  let dto: AnalysisDto | null = null;
  await waitFor(async () => {
    const res = await request(app).get(`/api/analyses/${id}`);
    dto = res.body as AnalysisDto;
    return dto.status === 'done' || dto.status === 'failed';
  }, 20_000);
  return dto!;
}

function tempDirs(): string[] {
  return existsSync(TEMP_ROOT) ? readdirSync(TEMP_ROOT).sort() : [];
}

/** Temp folders created since `before` (other test files may still be cleaning up theirs). */
function newTempDirs(before: string[]): string[] {
  return tempDirs().filter((d) => !before.includes(d));
}

function scanDir(dir: string, needle: string): string[] {
  const hits: string[] = [];
  if (!existsSync(dir)) return hits;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (name.includes(needle)) hits.push(p);
      if (statSync(p).isDirectory()) walk(p);
      else if (readFileSync(p, 'latin1').includes(needle)) hits.push(p);
    }
  };
  walk(dir);
  return hits;
}

describe('private mode: happy path and token leak gates', () => {
  it('analyzes with the user token, keeps the report in memory only, and never leaks the token', async () => {
    let tempScan: string[] | null = null;
    let tempDirsDuringJob = 0;
    const before = tempDirs();
    const s = setup({
      behavior: {
        onDeepStep: () => {
          tempDirsDuringJob = newTempDirs(before).length;
          tempScan = scanDir(TEMP_ROOT, TOKEN);
        },
      },
    });

    const created = s.record(
      await postPrivate(s.app, { repoUrl: 'https://github.com/acme/secret' }),
    );
    expect(created.status).toBe(202);
    expect(created.body).toEqual({
      id: expect.stringMatching(/^p_[A-Za-z0-9_-]{32}$/),
      status: 'queued',
      visibility: 'private',
      expiresAt: expect.any(String),
    });
    expect(created.headers['cache-control']).toBe('no-store');

    const get = s.record(await request(s.app).get(`/api/analyses/${created.body.id}`));
    expect(get.headers['cache-control']).toBe('no-store');
    expect(get.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(get.headers['referrer-policy']).toBe('no-referrer');

    const done = await waitDone(s.app, created.body.id);
    s.record(await request(s.app).get(`/api/analyses/${created.body.id}`));
    expect(done.status).toBe('done');
    expect(done.visibility).toBe('private');
    expect(done.expiresAt).toBe(created.body.expiresAt);
    expect(done.report?.privacy).toEqual({
      visibility: 'private',
      expiresAt: created.body.expiresAt,
      externalLookups: true,
    });
    expect(done.report?.meta.isPrivate).toBe(true);
    for (const key of [
      'stack',
      'howToRun',
      'env',
      'checklist',
      'architecture',
      'deps',
      'people',
    ] as const) {
      expect(done.report?.[key].ok, key).toBe(true);
    }

    // Report lives in memory, and nothing at all reached MongoDB.
    expect(s.memory.size).toBe(1);
    expect(await AnalysisModel.countDocuments()).toBe(0);

    // The token went to api.github.com only, never to the tarball host or OSV/npm.
    const withToken = s.network.calls.filter((c) => JSON.stringify(c).includes(TOKEN));
    expect(withToken.length).toBeGreaterThan(0);
    expect(withToken.every((c) => new URL(c.url).hostname === 'api.github.com')).toBe(true);
    expect(s.network.calls.some((c) => c.url.includes('osv.dev'))).toBe(true);

    // The token appears nowhere it could persist or be seen.
    const mongoDump = JSON.stringify(await AnalysisModel.find().lean());
    expect(s.responses.join('\n')).not.toContain(TOKEN);
    expect(s.logs.output()).not.toContain(TOKEN);
    expect(s.logs.output()).not.toContain('acme/secret'); // private repo name is not logged
    expect(s.memory.dump()).not.toContain(TOKEN);
    expect(mongoDump).not.toContain(TOKEN);
    expect(workerMessages).toHaveLength(1);
    expect(Object.keys(JSON.parse(workerMessages[0]!)).sort()).toEqual(['rootDir', 'tsConfigPath']);
    expect(workerMessages.join('')).not.toContain(TOKEN);
    expect(tempDirsDuringJob).toBe(1);
    expect(tempScan).toEqual([]);

    // Temp folder cleaned up afterwards.
    // "done" is saved just before the job's finally block deletes the folder.
    await waitFor(() => newTempDirs(before).length === 0);
  }, 30_000);

  it('never leaks the token on failure paths, and stores only sanitized errors', async () => {
    const s = setup({ behavior: { tarball: 'error' } });
    const created = s.record(await postPrivate(s.app));
    const done = await waitDone(s.app, created.body.id);
    s.record(await request(s.app).get(`/api/analyses/${created.body.id}`));
    expect(done.status).toBe('failed');
    expect(done.error?.code).toBe('ANALYSIS_FAILED');

    s.record(await postPrivate(s.app, { repoUrl: 'acme/secret' }, `${TOKEN}x`)); // wrong token -> 401
    s.record(await postPrivate(s.app, { repoUrl: 'acme/secret' }, 'short')); // bad shape
    s.record(await postPrivate(s.app, { repoUrl: 'not a url' }));

    expect(s.responses.join('\n')).not.toContain(TOKEN);
    expect(s.logs.output()).not.toContain(TOKEN);
    expect(s.memory.dump()).not.toContain(TOKEN);
    expect(await AnalysisModel.countDocuments()).toBe(0);
  }, 30_000);

  it('honors "skip dependency lookups": no OSV or npm calls at all', async () => {
    const s = setup();
    const created = await postPrivate(s.app, { repoUrl: 'acme/secret', skipExternalLookups: true });
    const done = await waitDone(s.app, created.body.id);
    expect(done.report?.privacy.externalLookups).toBe(false);
    expect(done.report?.deps).toEqual({
      ok: false,
      error: 'Skipped: external dependency lookups were disabled',
    });
    expect(s.network.calls.filter((c) => /osv\.dev|registry\.npmjs\.org/.test(c.url))).toEqual([]);
  }, 30_000);

  it('does not share anything with public mode for the same repo (no cache, no Mongo)', async () => {
    const s = setup({
      behavior: {
        repoBody: {
          name: 'secret',
          full_name: 'acme/secret',
          owner: { login: 'acme' },
          private: false, // a token used on a public repo is still private mode
          description: null,
          html_url: 'https://github.com/acme/secret',
          default_branch: 'main',
          stargazers_count: 0,
          forks_count: 0,
          open_issues_count: 0,
          size: 10,
          pushed_at: '2026-10-01T00:00:00Z',
          license: null,
        },
      },
    });
    const priv = await postPrivate(s.app);
    await waitDone(s.app, priv.body.id);
    expect(priv.body.visibility).toBe('private');
    expect(await AnalysisModel.countDocuments()).toBe(0);
  }, 30_000);

  it('never lists, badges or cache-hits a private report (Section 7 gates)', async () => {
    const s = setup();
    const first = await postPrivate(s.app);
    const done = await waitDone(s.app, first.body.id);
    expect(done.status).toBe('done');
    expect(typeof done.scoreTotal).toBe('number');

    // Not in the recent gallery.
    const recent = await request(s.app).get('/api/analyses/recent');
    expect(recent.status).toBe(200);
    expect(JSON.stringify(recent.body)).not.toContain(first.body.id);
    expect(JSON.stringify(recent.body)).not.toContain('acme/secret');

    // No badge score, even though a finished report with a score exists in memory.
    const badge = await request(s.app).get('/api/badge/acme/secret.svg');
    const svg = Buffer.isBuffer(badge.body) ? badge.body.toString('utf8') : badge.text;
    expect(svg).toContain('not analyzed');
    expect(svg).not.toContain(`${done.scoreTotal}/100`);

    // Never a cache hit: the same token, repo and commit start a brand-new private analysis.
    const second = await postPrivate(s.app);
    expect(second.status).toBe(202);
    expect(second.body.cached).toBeUndefined();
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.id).toMatch(/^p_/);
    await waitDone(s.app, second.body.id);
    expect(await AnalysisModel.countDocuments()).toBe(0);
  }, 40_000);
});

describe('private mode: API behavior', () => {
  it.each([
    [{ repoStatus: 401 }, 401, 'INVALID_TOKEN'],
    [{ repoStatus: 404 }, 404, 'REPO_NOT_FOUND'],
    [
      { repoStatus: 403, repoHeaders: { 'x-github-sso': 'required; url=https://x' } },
      403,
      'SSO_REQUIRED',
    ],
    [
      { repoStatus: 403, repoHeaders: { 'x-ratelimit-remaining': '0' } },
      503,
      'GITHUB_RATE_LIMITED',
    ],
    [
      { repoStatus: 403, repoBody: { message: 'Resource not accessible' } },
      403,
      'TOKEN_PERMISSIONS',
    ],
  ])('maps GitHub %j to %i %s', async (behavior, status, code) => {
    const s = setup({ behavior: behavior as GitHubBehavior });
    const res = await postPrivate(s.app);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    if (code === 'REPO_NOT_FOUND') {
      expect(res.body.error.message).toBe(
        'Repository not found, or the token does not have access to it.',
      );
    }
    expect(s.memory.size).toBe(0);
  });

  it('rejects malformed tokens with 400 INVALID_TOKEN without echoing them', async () => {
    const s = setup();
    const bad = 'bad token with spaces!!';
    const res = await postPrivate(s.app, { repoUrl: 'acme/secret' }, bad);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(JSON.stringify(res.body)).not.toContain(bad);
    expect(s.network.calls).toEqual([]);
  });

  it('rejects tokens when the feature flag is off, and reports it in /api/config', async () => {
    const s = setup({ enabled: false });
    const res = await postPrivate(s.app);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRIVATE_MODE_DISABLED');
    expect(s.network.calls).toEqual([]);
    const config = await request(s.app).get('/api/config');
    expect(config.body).toEqual({ privateModeEnabled: false, privateReportTtlMinutes: 60 });
  });

  it('serves the private-mode config when enabled', async () => {
    const s = setup();
    expect((await request(s.app).get('/api/config')).body).toEqual({
      privateModeEnabled: true,
      privateReportTtlMinutes: 60,
    });
  });

  it('requires HTTPS for tokens in production', async () => {
    const s = setup({ requireHttps: true });
    const plain = await postPrivate(s.app);
    expect(plain.status).toBe(400);
    expect(plain.body.error.code).toBe('HTTPS_REQUIRED');
    const secure = await request(s.app)
      .post('/api/analyses')
      .set('X-Forwarded-Proto', 'https') // behind the hosting proxy (trust proxy = 1)
      .set('X-GitHub-Token', TOKEN)
      .send({ repoUrl: 'acme/secret' });
    expect(secure.status).toBe(202);
    await waitDone(s.app, secure.body.id);
  }, 30_000);

  it('returns 404 REPORT_NOT_FOUND for unknown and expired private reports', async () => {
    let now = Date.now();
    const s = setup({ now: () => now });
    const unknown = await request(s.app).get('/api/analyses/p_V1StGXR8_Z5jdHi6B-myTV1StGXR8_Z5');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toEqual({
      code: 'REPORT_NOT_FOUND',
      message: 'This report has expired or was deleted.',
    });
    expect(unknown.headers['cache-control']).toBe('no-store');

    const created = await postPrivate(s.app);
    await waitDone(s.app, created.body.id);
    now += 61 * 60_000;
    const expired = await request(s.app).get(`/api/analyses/${created.body.id}`);
    expect(expired.status).toBe(404);
    expect(expired.body.error.code).toBe('REPORT_NOT_FOUND');
  }, 30_000);

  it('DELETE removes a private report and cancels its running job', async () => {
    const s = setup({ behavior: { tarball: 'hang' } });
    const before = tempDirs();
    const created = await postPrivate(s.app);
    await waitFor(() => s.queue.stats.running === 1);
    await waitFor(async () => {
      const r = await request(s.app).get(`/api/analyses/${created.body.id}`);
      return r.body.step === 'Downloading source code';
    });

    const del = await request(s.app).delete(`/api/analyses/${created.body.id}`);
    expect(del.status).toBe(204);
    expect(del.headers['cache-control']).toBe('no-store');
    await waitFor(() => s.queue.stats.running === 0);
    expect((await request(s.app).get(`/api/analyses/${created.body.id}`)).status).toBe(404);
    expect(s.memory.size).toBe(0);
    await waitFor(() => newTempDirs(before).length === 0);

    const again = await request(s.app).delete(`/api/analyses/${created.body.id}`);
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('REPORT_NOT_FOUND');
  }, 30_000);

  it('DELETE is not allowed for public analyses', async () => {
    const s = setup();
    const res = await request(s.app).delete('/api/analyses/6ac4e8c91896f100838ef631');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ALLOWED');
  });

  it('allows the token header in CORS preflight for POST and DELETE', async () => {
    const s = setup();
    const res = await request(s.app)
      .options('/api/analyses')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-github-token');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-github-token');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
  });
});
