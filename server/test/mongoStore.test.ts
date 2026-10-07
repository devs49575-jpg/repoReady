import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalysisModel } from '../src/models/Analysis';
import { MongoAnalysisStore, failStaleAnalyses } from '../src/stores/mongoStore';

// Uses a real MongoDB: local by default, the CI service container in GitHub Actions.
const uri = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/repoready_test';

beforeAll(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
});

beforeEach(async () => {
  await AnalysisModel.deleteMany({});
});

afterAll(async () => {
  await AnalysisModel.deleteMany({});
  await mongoose.disconnect();
});

const newDoc = {
  owner: 'acme',
  repo: 'widget',
  fullName: 'acme/widget',
  commitSha: 'abc123',
  step: 'Waiting in queue',
  progress: 0,
};

describe('MongoAnalysisStore', () => {
  const store = new MongoAnalysisStore();

  it('creates, reads and updates public analyses', async () => {
    const created = await store.create(newDoc);
    expect(created).toMatchObject({
      ...newDoc,
      status: 'queued',
      visibility: 'public',
      report: null,
    });
    expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);

    await store.update(created.id, {
      status: 'running',
      progress: 45,
      step: 'Detecting the stack',
    });
    expect(await store.get(created.id)).toMatchObject({ status: 'running', progress: 45 });
  });

  it('returns null for malformed or unknown ids', async () => {
    expect(await store.get('nope')).toBeNull();
    expect(await store.get('000000000000000000000000')).toBeNull();
  });

  it('refuses to write private analyses', async () => {
    await expect(
      store.update('p_V1StGXR8_Z5jdHi6B-myTV1StGXR8_Z5', { progress: 1 }),
    ).rejects.toThrow(/private/);
  });

  it('marks queued and running analyses failed on boot', async () => {
    const queued = await store.create(newDoc);
    const running = await store.create(newDoc);
    const done = await store.create(newDoc);
    await store.update(running.id, { status: 'running' });
    await store.update(done.id, { status: 'done' });

    expect(await failStaleAnalyses()).toBe(2);
    expect((await store.get(queued.id))?.error?.code).toBe('ANALYSIS_FAILED');
    expect((await store.get(running.id))?.status).toBe('failed');
    expect((await store.get(done.id))?.status).toBe('done');
  });

  it('does not reuse results from an older analysis engine', async () => {
    await AnalysisModel.create({
      ...newDoc,
      status: 'done',
      finishedAt: new Date(),
      scoreTotal: 50,
      engineVersion: 0, // produced before an analyzer fix
    });
    expect(await store.findReusable('acme/widget', 'abc123', new Date(0))).toBeNull();
  });

  it('finds reusable analyses by commit, case-insensitively, within the cache window', async () => {
    const a = await store.create(newDoc);
    await store.update(a.id, { status: 'done', finishedAt: new Date(), scoreTotal: 70 });
    const hourAgo = new Date(Date.now() - 3_600_000);
    expect((await store.findReusable('ACME/Widget', 'abc123', hourAgo))?.id).toBe(a.id);
    expect(await store.findReusable('acme/widget', 'other-sha', hourAgo)).toBeNull();
    expect(
      await store.findReusable('acme/widget', 'abc123', new Date(Date.now() + 60_000)),
    ).toBeNull();
  });

  it('lists recent analyses one per repo and reports the latest score', async () => {
    const older = await store.create(newDoc);
    await store.update(older.id, {
      status: 'done',
      finishedAt: new Date(Date.now() - 60_000),
      scoreTotal: 50,
    });
    const newer = await store.create(newDoc);
    await store.update(newer.id, { status: 'done', finishedAt: new Date(), scoreTotal: 80 });
    const other = await store.create({ ...newDoc, fullName: 'acme/other', repo: 'other' });
    await store.update(other.id, { status: 'running' });
    expect(await store.recent(10)).toEqual([
      { id: newer.id, fullName: 'acme/widget', score: 80, createdAt: expect.any(String) },
    ]);
    expect(await store.latestScore('Acme/Widget')).toBe(80);
    expect(await store.latestScore('acme/other')).toBeNull();
  });

  it('excludes private-repo reports from every public query, even if one reached MongoDB', async () => {
    // Simulate a bug that wrote a private repo's report to MongoDB.
    await AnalysisModel.create({
      ...newDoc,
      fullName: 'acme/secret',
      status: 'done',
      finishedAt: new Date(),
      scoreTotal: 99,
      report: { meta: { isPrivate: true } },
    });
    expect(await store.recent(10)).toEqual([]);
    expect(await store.latestScore('acme/secret')).toBeNull();
    expect(await store.findReusable('acme/secret', 'abc123', new Date(0))).toBeNull();
  });
});
