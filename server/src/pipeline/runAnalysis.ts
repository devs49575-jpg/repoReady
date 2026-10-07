import {
  type ErrorCode,
  type PipelineStepKey,
  type PrivacyInfo,
  type Report,
  type RepoMeta,
  type SectionResult,
  pipelineStep,
} from '@repoready/shared';
import { analyzeArchitecture } from '../analyzers/architecture';
import { analyzeChecklist } from '../analyzers/checklist';
import { analyzeDeps } from '../analyzers/deps';
import { createContext } from '../analyzers/context';
import { analyzeEnv } from '../analyzers/env';
import { analyzeHowToRun } from '../analyzers/howToRun';
import { analyzePeople } from '../analyzers/people';
import { computeScore } from '../analyzers/score';
import { analyzeStack } from '../analyzers/stack';
import type { Logger } from '../logger';
import { raceAbort } from '../queue/jobQueue';
import type { GitHubClient, GitHubRepo, HeadCommit } from '../services/github';
import { fetchRepo, removeRepoDir } from '../services/repoFetcher';
import type { AnalysisStore } from '../stores';
import { isAppError } from '../utils/errors';
import { sanitizeError, sanitizeText } from '../utils/sanitize';

export interface RunAnalysisInput {
  id: string;
  repoInfo: GitHubRepo; // fetched (and access-checked) when the analysis was created
  head: HeadCommit;
  github: GitHubClient; // per-mode client; never the raw token
  store: AnalysisStore;
  privacy: PrivacyInfo;
  logger: Logger;
  signal: AbortSignal;
  /** Values to scrub from any stored or logged error (e.g. the user's token in private mode). */
  secrets?: readonly string[];
}

/**
 * Runs every analyzer and saves progress after each step. Never throws: failures are recorded
 * on the analysis. The temp dir is always deleted.
 */
export async function runAnalysis(input: RunAnalysisInput): Promise<void> {
  const { id, store, signal } = input;
  const secrets = input.secrets ?? [];
  // Private analyses: log only the job id, never the repo name (Addendum 01, 5.6).
  const log = input.logger.child(
    input.privacy.visibility === 'private'
      ? { jobId: sanitizeText(id) }
      : { jobId: id, repo: input.repoInfo.fullName },
  );
  const workDir: { path: string | null } = { path: null };

  try {
    await raceAbort(pipeline(input, workDir), signal);
    log.info('Analysis finished');
  } catch (err) {
    const code: ErrorCode = isAppError(err) ? err.code : 'ANALYSIS_FAILED';
    const message = isAppError(err)
      ? sanitizeText(err.message, secrets)
      : 'The analysis failed unexpectedly. Please try again.';
    log.warn({ err: sanitizeError(err, secrets) }, 'Analysis failed');
    await store
      .update(id, { status: 'failed', error: { code, message }, finishedAt: new Date() })
      .catch((saveErr: unknown) =>
        log.error({ err: sanitizeError(saveErr, secrets) }, 'Could not save failure'),
      );
  } finally {
    if (workDir.path) await removeRepoDir(workDir.path).catch(() => undefined);
  }
}

async function pipeline(input: RunAnalysisInput, workDir: { path: string | null }): Promise<void> {
  const { id, repoInfo, head, github, store, signal } = input;
  const step = async (key: PipelineStepKey, extra: object = {}) => {
    signal.throwIfAborted();
    await store.update(id, { ...pipelineStep(key), ...extra });
  };

  // 1. Metadata
  await step('meta', { status: 'running', startedAt: new Date() });
  const languages = await github.getLanguages(repoInfo.owner, repoInfo.repo, signal);
  const meta: RepoMeta = {
    isPrivate: repoInfo.isPrivate,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    fullName: repoInfo.fullName,
    description: repoInfo.description,
    htmlUrl: repoInfo.htmlUrl,
    defaultBranch: repoInfo.defaultBranch,
    commitSha: head.sha,
    stars: repoInfo.stars,
    forks: repoInfo.forks,
    openIssues: repoInfo.openIssues,
    sizeKb: repoInfo.sizeKb,
    pushedAt: repoInfo.pushedAt,
    license: repoInfo.license,
    languages,
  };

  // 2. Download
  await step('download');
  const fetched = await fetchRepo(github, repoInfo.owner, repoInfo.repo, head.sha, signal);
  workDir.path = fetched.rootDir;
  try {
    await analyzeAndSave(input, fetched.rootDir, fetched.files, meta);
  } finally {
    // Also removed by runAnalysis(); covers a pipeline that finishes after a timeout fired.
    await removeRepoDir(fetched.rootDir);
  }
}

async function analyzeAndSave(
  input: RunAnalysisInput,
  rootDir: string,
  files: string[],
  meta: RepoMeta,
): Promise<void> {
  const { id, github, store, signal } = input;
  const secrets = input.secrets ?? [];
  const step = async (key: PipelineStepKey) => {
    signal.throwIfAborted();
    await store.update(id, pipelineStep(key));
  };
  const ctx = await createContext({
    rootDir,
    files,
    meta,
    github,
    signal,
  });

  // Each section is isolated: an exception becomes {ok:false} and the pipeline continues.
  const section = async <T>(fn: () => Promise<T> | T): Promise<SectionResult<T>> => {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      const raw = isAppError(err)
        ? err.message
        : `Analyzer error: ${String((err as Error)?.message ?? err)}`;
      return { ok: false, error: sanitizeText(raw.split(rootDir).join('.'), secrets) };
    }
  };

  // 3-5. Stack, env + how to run, checklist
  await step('stack');
  const stack = await section(() => analyzeStack(ctx));
  await step('env');
  const env = await section(() => analyzeEnv(ctx));
  const howToRun = await section(() => analyzeHowToRun(ctx, env.ok ? env.data : null));
  await step('checklist');
  const checklist = await section(() =>
    analyzeChecklist(ctx, env.ok ? env.data : null, howToRun.ok ? howToRun.data : null),
  );

  // 6-8. Architecture, dependencies and people run in parallel; each is isolated by section().
  await step('deep');
  const [architecture, deps, people] = await Promise.all([
    section(() => analyzeArchitecture(ctx)),
    section(() =>
      analyzeDeps(ctx, {
        privateMode: input.privacy.visibility === 'private',
        skipExternalLookups: !input.privacy.externalLookups,
      }),
    ),
    section(() => analyzePeople(ctx, input.head.date)),
  ]);

  // 9. Score and save
  await step('score');
  const score = await section(() => computeScore({ checklist, howToRun, env, deps, architecture }));
  const report: Report = {
    meta,
    privacy: input.privacy,
    stack,
    howToRun,
    env,
    checklist,
    architecture,
    deps,
    people,
    score,
  };
  signal.throwIfAborted();
  await store.update(id, {
    ...pipelineStep('done'),
    status: 'done',
    error: null, // a finished run supersedes any earlier failure mark (e.g. a stale-job cleanup)
    report,
    scoreTotal: score.ok ? score.data.total : null,
    finishedAt: new Date(),
  });
}
