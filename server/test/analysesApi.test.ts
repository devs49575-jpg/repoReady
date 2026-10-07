import type { AnalysisDto } from '@repoready/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createLogger } from '../src/logger';
import { JobQueue } from '../src/queue/jobQueue';
import type { GitHubClient } from '../src/services/github';
import { AppError } from '../src/utils/errors';
import {
  TestStore,
  fakeGitHub,
  fixtureDir,
  makeRepoInfo,
  mockExternalApis,
  tarballOf,
  waitFor,
} from './helpers';

beforeEach(() => vi.stubGlobal('fetch', mockExternalApis().fetchImpl));
afterEach(() => vi.unstubAllGlobals());

function setup(github: Partial<GitHubClient> = {}) {
  const store = new TestStore();
  const publicGitHub = fakeGitHub({
    streamTarball: async () => tarballOf(fixtureDir('simple-express')),
    ...github,
  });
  const app = createApp({
    clientOrigin: 'http://localhost:5173',
    logger: createLogger(undefined, 'silent'),
    rateLimits: { createsPerHour: 100, readsPerMinute: 100_000 }, // tests poll every 20ms
    analyses: {
      publicGitHub,
      stores: { public: store },
      queue: new JobQueue(2, 10_000),
      maxRepoSizeKb: 1000,
      cacheTtlHours: 24,
      privateMode: { enabled: false, requireHttps: false },
    },
  });
  return { app, store, publicGitHub };
}

describe('POST /api/analyses', () => {
  it('queues an analysis that finishes with a report (happy path)', async () => {
    const { app } = setup();
    const created = await request(app)
      .post('/api/analyses')
      .send({ repoUrl: 'https://github.com/acme/widget' });
    expect(created.status).toBe(202);
    expect(created.body).toEqual({
      id: expect.any(String),
      status: 'queued',
      visibility: 'public',
      expiresAt: null,
    });

    let dto: AnalysisDto | null = null;
    await waitFor(async () => {
      const res = await request(app).get(`/api/analyses/${created.body.id}`);
      dto = res.body as AnalysisDto;
      return dto.status === 'done' || dto.status === 'failed';
    });
    expect(dto!.status).toBe('done');
    expect(dto!.visibility).toBe('public');
    expect(dto!.report?.howToRun.ok).toBe(true);
    expect(typeof dto!.scoreTotal).toBe('number');
  });

  it.each([
    [{ repoUrl: 'not a url' }, 400, 'INVALID_URL'],
    [{ repoUrl: 'https://gitlab.com/a/b' }, 400, 'INVALID_URL'],
    [{}, 400, 'VALIDATION_ERROR'],
    [{ repoUrl: 42 }, 400, 'VALIDATION_ERROR'],
  ])('rejects %j with %d %s', async (body, status, code) => {
    const { app, store } = setup();
    const res = await request(app).post('/api/analyses').send(body);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(store.docs.size).toBe(0);
  });

  it('returns REPO_NOT_FOUND when GitHub says 404', async () => {
    const { app } = setup({
      getRepo: async () => {
        throw new AppError('REPO_NOT_FOUND', 'Repository not found.');
      },
    });
    const res = await request(app).post('/api/analyses').send({ repoUrl: 'acme/missing' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REPO_NOT_FOUND');
  });

  it('returns REPO_TOO_LARGE above MAX_REPO_SIZE_KB', async () => {
    const { app, store } = setup({ getRepo: async () => makeRepoInfo({ sizeKb: 5000 }) });
    const res = await request(app).post('/api/analyses').send({ repoUrl: 'acme/huge' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REPO_TOO_LARGE');
    expect(store.docs.size).toBe(0);
  });

  it('never analyzes a private repo in public mode, even if the server token can see it', async () => {
    const streamTarball = vi.fn();
    const { app, store } = setup({
      getRepo: async () => makeRepoInfo({ isPrivate: true }),
      streamTarball,
    });
    const res = await request(app).post('/api/analyses').send({ repoUrl: 'acme/secret' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REPO_NOT_FOUND');
    expect(store.docs.size).toBe(0);
    expect(streamTarball).not.toHaveBeenCalled();
  });

  it('rejects a token header until private mode exists, without echoing it', async () => {
    const getRepo = vi.fn();
    const { app } = setup({ getRepo });
    const token = 'github_pat_TESTSECRET0123456789';
    const res = await request(app)
      .post('/api/analyses')
      .set('X-GitHub-Token', token)
      .send({ repoUrl: 'acme/widget' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRIVATE_MODE_DISABLED');
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(getRepo).not.toHaveBeenCalled();
  });

  it('maps GitHub rate limiting to 503 GITHUB_RATE_LIMITED', async () => {
    const { app } = setup({
      getRepo: async () => {
        throw new AppError('GITHUB_RATE_LIMITED', 'GitHub rate limit reached.');
      },
    });
    const res = await request(app).post('/api/analyses').send({ repoUrl: 'acme/widget' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GITHUB_RATE_LIMITED');
  });
});

describe('GET /api/analyses/:id', () => {
  it('returns NOT_FOUND for unknown ids', async () => {
    const { app } = setup();
    for (const id of ['000000000000000000000000', 'nope']) {
      const res = await request(app).get(`/api/analyses/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns REPORT_NOT_FOUND for private ids, even with private mode off', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/analyses/p_unknownprivateid');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REPORT_NOT_FOUND');
  });
});
