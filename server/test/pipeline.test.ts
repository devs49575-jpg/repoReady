import { PUBLIC_PRIVACY } from '@repoready/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/logger';
import { runAnalysis } from '../src/pipeline/runAnalysis';
import type { GitHubClient } from '../src/services/github';
import {
  TestStore,
  expectNoNewTempDirs,
  tempDirs,
  fakeGitHub,
  fixtureDir,
  makeRepoInfo,
  mockExternalApis,
  tarballOf,
} from './helpers';

const logger = createLogger(undefined, 'silent');

async function run(github: GitHubClient, signal = new AbortController().signal) {
  const store = new TestStore();
  const analysis = await store.create({
    owner: 'acme',
    repo: 'widget',
    fullName: 'acme/widget',
    commitSha: 'abc123',
    step: 'Waiting in queue',
    progress: 0,
  });
  await runAnalysis({
    id: analysis.id,
    repoInfo: makeRepoInfo(),
    head: { sha: 'abc123', date: null },
    github,
    store,
    privacy: PUBLIC_PRIVACY,
    logger,
    signal,
  });
  return { store, result: (await store.get(analysis.id))! };
}

describe('runAnalysis', () => {
  // OSV.dev and the npm registry are reached through global fetch; never hit the network here.
  beforeEach(() => vi.stubGlobal('fetch', mockExternalApis().fetchImpl));
  afterEach(() => vi.unstubAllGlobals());

  it('produces a full report, saves progress in order, and deletes the temp dir', async () => {
    const before = tempDirs();
    const { store, result } = await run(
      fakeGitHub({ streamTarball: async () => tarballOf(fixtureDir('simple-express')) }),
    );

    expect(result.status).toBe('done');
    expect(result.progress).toBe(100);
    expect(result.error).toBeNull();
    expect(store.updates.at(-1)?.patch.error).toBeNull();
    const report = result.report!;
    expect(report.meta).toMatchObject({ fullName: 'acme/widget', commitSha: 'abc123' });
    expect(report.privacy).toEqual(PUBLIC_PRIVACY);
    for (const key of [
      'stack',
      'howToRun',
      'env',
      'checklist',
      'architecture',
      'deps',
      'people',
      'score',
    ] as const) {
      expect(report[key].ok, key).toBe(true);
    }
    expect(result.scoreTotal).toBe(report.score.ok ? report.score.data.total : null);

    const progress = store.updates.map((u) => u.patch.progress).filter((p) => p !== undefined);
    expect(progress).toEqual([...progress].sort((a, b) => a! - b!));
    expect(progress.at(-1)).toBe(100);

    await expectNoNewTempDirs(before);
  });

  it('records a failure with its error code and still cleans up', async () => {
    const before = tempDirs();
    const { result } = await run(
      fakeGitHub({
        getLanguages: async () => {
          throw Object.assign(new Error('nope'), { name: 'AppError' });
        },
      }),
    );
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({
      code: 'ANALYSIS_FAILED',
      message: 'The analysis failed unexpectedly. Please try again.',
    });
    await expectNoNewTempDirs(before);
  });

  it('records ANALYSIS_TIMEOUT when the signal fires mid-run, and removes the temp dir', async () => {
    const before = tempDirs();
    const controller = new AbortController();
    const { AppError } = await import('../src/utils/errors');
    const github = fakeGitHub({
      streamTarball: async () => tarballOf(fixtureDir('ts-react')),
      getLanguages: async () => {
        // Fire the timeout while the pipeline is running.
        setTimeout(() => controller.abort(new AppError('ANALYSIS_TIMEOUT', 'Took too long.')), 0);
        await new Promise((r) => setTimeout(r, 20));
        return {};
      },
    });
    const { result } = await run(github, controller.signal);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('ANALYSIS_TIMEOUT');
    // Give the abandoned pipeline a moment to unwind, then check nothing was left behind.
    await new Promise((r) => setTimeout(r, 200));
    await expectNoNewTempDirs(before);
  });

  it('keeps going when the repo has no package.json', async () => {
    const { result } = await run(
      fakeGitHub({ streamTarball: async () => tarballOf(fixtureDir('no-package-json')) }),
    );
    expect(result.status).toBe('done');
    const stack = result.report!.stack;
    expect(stack.ok && stack.data.hasPackageJson).toBe(false);
  });
});
