import {
  type CreateAnalysisResponse,
  PUBLIC_PRIVACY,
  type PrivacyInfo,
  type RecentAnalysis,
  isPrivateId,
  pipelineStep,
} from '@repoready/shared';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { Logger } from '../logger';
import { runAnalysis } from '../pipeline/runAnalysis';
import type { JobQueue } from '../queue/jobQueue';
import { type GitHubClient, type GitHubRepo, createGitHubClient } from '../services/github';
import { type AnalysisStore, type AnalysisStores, storeFor, toDto } from '../stores';
import { AppError } from '../utils/errors';
import { parseRepoUrl } from '../utils/parseRepoUrl';
import { buildMarkdown } from '../services/markdown';

export interface PrivateModeSettings {
  enabled: boolean;
  /** Reject tokens sent over plain HTTP (production). */
  requireHttps: boolean;
}

export interface AnalysesDeps {
  /** Client built with the server GITHUB_TOKEN; used only for public mode. */
  publicGitHub: GitHubClient;
  stores: AnalysisStores;
  queue: JobQueue;
  logger: Logger;
  maxRepoSizeKb: number;
  /** Reuse a finished public analysis of the same commit for this long. */
  cacheTtlHours: number;
  privateMode: PrivateModeSettings;
  /** Builds the per-request client for a user's token (overridable in tests). */
  createPrivateClient?: (token: string) => GitHubClient;
}

const createBody = z.object({
  repoUrl: z.string().max(500),
  skipExternalLookups: z.boolean().optional(),
});

// Loose on purpose (classic `ghp_…`, fine-grained `github_pat_…`, future formats).
const TOKEN_SHAPE = /^[A-Za-z0-9_]{20,255}$/;
const TOKEN_HEADER = 'x-github-token';

const REPORT_GONE = 'This report has expired or was deleted.';
const RECENT_LIMIT = 10;

/** Private reports must not be cached, indexed or leak their URL via Referer (Addendum 01, 5.5). */
function setPrivateHeaders(res: Response): void {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Referrer-Policy', 'no-referrer');
}

function checkSize(repoInfo: GitHubRepo, maxRepoSizeKb: number): void {
  if (repoInfo.sizeKb > maxRepoSizeKb) {
    throw new AppError(
      'REPO_TOO_LARGE',
      `This repository is ${Math.round(repoInfo.sizeKb / 1024)} MB; the limit is ${Math.round(maxRepoSizeKb / 1024)} MB.`,
    );
  }
}

function parseBody(req: Request) {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Body must be JSON like {"repoUrl": "owner/repo"}');
  }
  return { ...parsed.data, ...parseRepoUrl(parsed.data.repoUrl) };
}

export function createAnalysesRouter(deps: AnalysesDeps): Router {
  const router = Router();
  const createPrivateClient =
    deps.createPrivateClient ?? ((token: string) => createGitHubClient(token, { mode: 'private' }));

  router.param('id', (_req, res, next, id: string) => {
    if (isPrivateId(id)) setPrivateHeaders(res);
    next();
  });

  router.post('/', async (req, res) => {
    const token = req.get(TOKEN_HEADER);
    if (token !== undefined) {
      await createPrivate(req, res, token);
      return;
    }

    const { owner, repo } = parseBody(req);
    const repoInfo = await deps.publicGitHub.getRepo(owner, repo);
    if (repoInfo.isPrivate) {
      // The server token may be able to see private repos; public mode must never analyze them
      // (their reports would be stored in MongoDB and listed publicly).
      throw new AppError(
        'REPO_NOT_FOUND',
        'Repository not found. Check the URL; private repositories need a token.',
      );
    }
    const head = await deps.publicGitHub.getHeadCommit(
      repoInfo.owner,
      repoInfo.repo,
      repoInfo.defaultBranch,
    );

    // Cache by commit SHA (public mode only): reuse a fresh finished analysis of the same
    // commit, or one of the same commit that is still in progress.
    const store = deps.stores.public;
    const reusable = await store.findReusable(
      repoInfo.fullName,
      head.sha,
      new Date(Date.now() - deps.cacheTtlHours * 3_600_000),
    );
    if (reusable) {
      const cached: CreateAnalysisResponse = {
        id: reusable.id,
        status: reusable.status,
        visibility: 'public',
        expiresAt: null,
        cached: reusable.status === 'done',
      };
      res.status(reusable.status === 'done' ? 200 : 202).json(cached);
      return;
    }

    checkSize(repoInfo, deps.maxRepoSizeKb);
    const analysis = await store.create({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      fullName: repoInfo.fullName,
      commitSha: head.sha,
      ...pipelineStep('queued'),
    });
    deps.queue.enqueue(analysis.id, (signal) =>
      runAnalysis({
        id: analysis.id,
        repoInfo,
        head,
        github: deps.publicGitHub,
        store,
        privacy: PUBLIC_PRIVACY,
        logger: deps.logger,
        signal,
      }),
    );

    const body: CreateAnalysisResponse = {
      id: analysis.id,
      status: analysis.status,
      visibility: 'public',
      expiresAt: null,
    };
    res.status(202).json(body);
  });

  /**
   * Private flow (Addendum 01, 5.4). The token is used to build a per-request client and to scrub
   * errors; it is never stored, logged, returned or passed to the worker, and every reference to
   * it is dropped when the job ends. No cache read or write. The report lives in memory only.
   */
  async function createPrivate(req: Request, res: Response, token: string): Promise<void> {
    setPrivateHeaders(res);
    const store: AnalysisStore | undefined = deps.stores.private;
    if (!deps.privateMode.enabled || !store) {
      throw new AppError(
        'PRIVATE_MODE_DISABLED',
        'Private repository analysis is not available on this server.',
      );
    }
    if (deps.privateMode.requireHttps && !req.secure) {
      throw new AppError('HTTPS_REQUIRED', 'Tokens may only be sent over HTTPS.');
    }
    if (!TOKEN_SHAPE.test(token)) {
      // Never echo the token back.
      throw new AppError('INVALID_TOKEN', 'That does not look like a GitHub token.', 400);
    }
    const { owner, repo, skipExternalLookups } = parseBody(req);

    let github: GitHubClient | undefined = createPrivateClient(token);
    let secrets: string[] = [token];
    const repoInfo = await github.getRepo(owner, repo); // validates token, access and existence
    checkSize(repoInfo, deps.maxRepoSizeKb);
    const head = await github.getHeadCommit(repoInfo.owner, repoInfo.repo, repoInfo.defaultBranch);

    const analysis = await store.create({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      fullName: repoInfo.fullName,
      commitSha: head.sha,
      ...pipelineStep('queued'),
    });
    const privacy: PrivacyInfo = {
      visibility: 'private',
      expiresAt: analysis.expiresAt.toISOString(),
      externalLookups: !skipExternalLookups,
    };

    deps.queue.enqueue(analysis.id, async (signal) => {
      try {
        await runAnalysis({
          id: analysis.id,
          repoInfo,
          head,
          github: github!,
          store,
          privacy,
          logger: deps.logger,
          signal,
          secrets,
        });
      } finally {
        // Drop the job's references to the client (and so the token) as soon as it ends.
        github = undefined;
        secrets = [];
      }
    });

    const body: CreateAnalysisResponse = {
      id: analysis.id,
      status: analysis.status,
      visibility: 'private',
      expiresAt: privacy.expiresAt,
    };
    res.status(202).json(body);
  }

  // Must be registered before '/:id'. Reads the public (Mongo) store only, so private reports can
  // never appear here (Addendum 01, Section 7).
  router.get('/recent', async (_req, res) => {
    const body: RecentAnalysis[] = await deps.stores.public.recent(RECENT_LIMIT);
    res.json(body);
  });

  async function loadAnalysis(id: string) {
    const store = storeFor(deps.stores, id);
    const analysis = store ? await store.get(id) : null;
    if (!analysis) {
      throw isPrivateId(id)
        ? new AppError('REPORT_NOT_FOUND', REPORT_GONE)
        : new AppError('NOT_FOUND', 'Analysis not found.');
    }
    return analysis;
  }

  router.get('/:id', async (req, res) => {
    res.json(toDto(await loadAnalysis(req.params.id)));
  });

  // Works for both stores; private reports keep their no-store / noindex headers (router.param).
  router.get('/:id/markdown', async (req, res) => {
    const analysis = await loadAnalysis(req.params.id);
    if (analysis.status !== 'done' || !analysis.report) {
      throw new AppError('NOT_FOUND', 'The briefing is available once the analysis has finished.');
    }
    const filename = `${analysis.owner}-${analysis.repo}-onboarding.md`.replace(/[^\w.-]/g, '_');
    res.type('text/markdown; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buildMarkdown(analysis.report));
  });

  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    if (!isPrivateId(id)) {
      throw new AppError('NOT_ALLOWED', 'Only private reports can be deleted.');
    }
    const store = deps.stores.private;
    const existed = store?.delete ? await store.delete(id) : false;
    if (!existed) throw new AppError('REPORT_NOT_FOUND', REPORT_GONE);
    deps.queue.cancel(id, new AppError('ANALYSIS_FAILED', 'The report was deleted.'));
    res.status(204).end();
  });

  return router;
}
