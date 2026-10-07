import { AppError } from '../utils/errors';

/**
 * GitHub REST client, one instance per mode (Addendum 01, 5.3).
 *
 * The token lives only inside the createGitHubClient() closure. It is never a property of the
 * returned object, so the client can be passed around (e.g. as ctx.github) without the token being
 * serialized, logged, stored or sent to a worker. Error messages are fixed strings and never
 * include the token or request URLs.
 */

const API = 'https://api.github.com';
const JSON_TIMEOUT_MS = 15_000;

export type GitHubMode = 'public' | 'private';

export interface GitHubRepo {
  owner: string;
  repo: string;
  fullName: string;
  isPrivate: boolean;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number;
  pushedAt: string;
  license: string | null;
}

export interface HeadCommit {
  sha: string;
  date: string | null;
}

export interface Contributor {
  login: string;
  avatarUrl: string;
  commits: number;
}

export interface CommitSummary {
  authorLogin: string | null;
  date: string | null;
}

export interface GitHubClient {
  getRepo(owner: string, repo: string, signal?: AbortSignal): Promise<GitHubRepo>;
  getHeadCommit(
    owner: string,
    repo: string,
    ref: string,
    signal?: AbortSignal,
  ): Promise<HeadCommit>;
  getLanguages(owner: string, repo: string, signal?: AbortSignal): Promise<Record<string, number>>;
  getContributors(owner: string, repo: string, signal?: AbortSignal): Promise<Contributor[]>;
  getCommits(
    owner: string,
    repo: string,
    opts: { path?: string; perPage?: number },
    signal?: AbortSignal,
  ): Promise<CommitSummary[]>;
  /** Streams the gzipped tarball of `sha`. */
  streamTarball(
    owner: string,
    repo: string,
    sha: string,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>;
}

export interface GitHubClientOptions {
  mode?: GitHubMode;
  fetchImpl?: typeof fetch;
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function readMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : '';
  } catch {
    return '';
  }
}

/** Maps a non-OK GitHub response to an AppError (Addendum 01, 5.3 and 5.5). */
export async function mapGitHubError(res: Response, mode: GitHubMode): Promise<AppError> {
  const status = res.status;
  const message = await readMessage(res);
  const remaining = res.headers.get('x-ratelimit-remaining');
  const isRateLimit =
    status === 429 ||
    (status === 403 &&
      (remaining === '0' || res.headers.has('retry-after') || /rate limit/i.test(message)));

  if (isRateLimit) {
    return new AppError(
      'GITHUB_RATE_LIMITED',
      'GitHub rate limit reached. Please try again in a few minutes.',
    );
  }
  if (status === 401) {
    return mode === 'private'
      ? new AppError(
          'INVALID_TOKEN',
          'GitHub rejected the token. Check that it is valid and not expired.',
        )
      : new AppError('ANALYSIS_FAILED', 'The server GitHub token was rejected by GitHub.', 500);
  }
  if (status === 403 && res.headers.has('x-github-sso')) {
    return new AppError(
      'SSO_REQUIRED',
      'This organization uses SAML SSO. Authorize the token for the organization on GitHub, then try again.',
    );
  }
  if (status === 403) {
    return mode === 'private'
      ? new AppError(
          'TOKEN_PERMISSIONS',
          'The token cannot read this repository. Give it Contents (read-only) and Metadata (read-only) access.',
        )
      : new AppError('REPO_NOT_FOUND', 'Repository not found or not accessible.');
  }
  if (status === 404) {
    return new AppError(
      'REPO_NOT_FOUND',
      mode === 'private'
        ? 'Repository not found, or the token does not have access to it.'
        : 'Repository not found. Check the URL; private repositories need a token.',
    );
  }
  if (status === 409) {
    return new AppError('ANALYSIS_FAILED', 'The repository is empty.', 422);
  }
  return new AppError('ANALYSIS_FAILED', `GitHub returned an unexpected error (${status}).`, 502);
}

export function createGitHubClient(
  token?: string,
  options: GitHubClientOptions = {},
): GitHubClient {
  const mode = options.mode ?? 'public';
  const doFetch = options.fetchImpl ?? fetch;
  const baseHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'RepoReady',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function request(
    path: string,
    signal: AbortSignal | undefined,
    init: { redirect?: 'follow' | 'manual'; timeoutMs?: number | null } = {},
  ): Promise<Response> {
    const timeoutMs = init.timeoutMs === undefined ? JSON_TIMEOUT_MS : init.timeoutMs;
    const headers = token ? { ...baseHeaders, Authorization: `Bearer ${token}` } : baseHeaders;
    return withNetworkRetry(() => {
      // A fresh timeout per attempt.
      const signals = [signal, timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined].filter(
        (s): s is AbortSignal => s !== undefined,
      );
      return doFetch(`${API}${path}`, {
        headers,
        redirect: init.redirect ?? 'follow',
        signal: signals.length ? AbortSignal.any(signals) : undefined,
      });
    }, signal);
  }

  async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await request(path, signal);
    if (!res.ok) throw await mapGitHubError(res, mode);
    if (res.status === 204) return [] as T; // e.g. contributors of an empty repo
    return (await res.json()) as T;
  }

  return {
    async getRepo(owner, repo, signal) {
      const r = await getJson<{
        name: string;
        full_name: string;
        owner: { login: string };
        private: boolean;
        description: string | null;
        html_url: string;
        default_branch: string;
        stargazers_count: number;
        forks_count: number;
        open_issues_count: number;
        size: number;
        pushed_at: string | null;
        license: { spdx_id: string | null; name: string } | null;
      }>(repoPath(owner, repo), signal);
      const spdx = r.license?.spdx_id;
      return {
        owner: r.owner.login,
        repo: r.name,
        fullName: r.full_name,
        isPrivate: r.private,
        description: r.description,
        htmlUrl: r.html_url,
        defaultBranch: r.default_branch,
        stars: r.stargazers_count,
        forks: r.forks_count,
        openIssues: r.open_issues_count,
        sizeKb: r.size,
        pushedAt: r.pushed_at ?? '',
        license: spdx && spdx !== 'NOASSERTION' ? spdx : (r.license?.name ?? null),
      };
    },

    async getHeadCommit(owner, repo, ref, signal) {
      const c = await getJson<{ sha: string; commit: { committer: { date: string } | null } }>(
        `${repoPath(owner, repo)}/commits/${encodeURIComponent(ref)}`,
        signal,
      );
      return { sha: c.sha, date: c.commit.committer?.date ?? null };
    },

    getLanguages(owner, repo, signal) {
      return getJson<Record<string, number>>(`${repoPath(owner, repo)}/languages`, signal);
    },

    async getContributors(owner, repo, signal) {
      const list = await getJson<
        { login?: string; avatar_url?: string; contributions: number; type: string }[]
      >(`${repoPath(owner, repo)}/contributors?per_page=10`, signal);
      return list
        .filter((c) => c.login && c.type !== 'Anonymous')
        .map((c) => ({ login: c.login!, avatarUrl: c.avatar_url ?? '', commits: c.contributions }));
    },

    async getCommits(owner, repo, { path, perPage = 30 }, signal) {
      const params = new URLSearchParams({ per_page: String(perPage) });
      if (path) params.set('path', path);
      const list = await getJson<
        { author: { login: string } | null; commit: { author: { date: string } | null } }[]
      >(`${repoPath(owner, repo)}/commits?${params}`, signal);
      return list.map((c) => ({
        authorLogin: c.author?.login ?? null,
        date: c.commit.author?.date ?? null,
      }));
    },

    async streamTarball(owner, repo, sha, signal) {
      // Follow the redirect ourselves: the redirect target (codeload.github.com) gets a short-lived
      // signed URL instead of our token, and we never forward the Authorization header.
      const first = await request(
        `${repoPath(owner, repo)}/tarball/${encodeURIComponent(sha)}`,
        signal,
        { redirect: 'manual', timeoutMs: JSON_TIMEOUT_MS },
      );
      let res = first;
      if (first.status >= 300 && first.status < 400) {
        const location = first.headers.get('location');
        const target = location ? new URL(location, API) : null;
        if (
          !target ||
          target.protocol !== 'https:' ||
          !(target.hostname === 'github.com' || target.hostname.endsWith('.github.com'))
        ) {
          throw new AppError(
            'ANALYSIS_FAILED',
            'GitHub returned an unexpected download location.',
            502,
          );
        }
        res = await withNetworkRetry(
          () => doFetch(target, { headers: { 'User-Agent': baseHeaders['User-Agent']! }, signal }),
          signal,
        );
      }
      if (!res.ok) throw await mapGitHubError(res, mode);
      if (!res.body)
        throw new AppError('ANALYSIS_FAILED', 'GitHub returned an empty download.', 502);
      return res.body;
    },
  };
}

const RETRY_DELAY_MS = 500;

/**
 * Runs a fetch, retrying once after a short pause on a network-level failure (e.g. a reset
 * connection). HTTP error statuses, timeouts and our own aborts are never retried.
 */
async function withNetworkRetry(
  attempt: () => Promise<Response>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await attempt();
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'TimeoutError')) {
      throw toNetworkError(err, signal);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  try {
    signal?.throwIfAborted();
    return await attempt();
  } catch (err) {
    throw toNetworkError(err, signal);
  }
}

function toNetworkError(err: unknown, outer: AbortSignal | undefined): unknown {
  // Our own cancellation/timeout: surface the abort reason unchanged.
  if (outer?.aborted) return outer.reason ?? err;
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new AppError('ANALYSIS_FAILED', 'GitHub did not respond in time.', 504);
  }
  return new AppError('ANALYSIS_FAILED', 'Could not reach GitHub.', 502);
}
