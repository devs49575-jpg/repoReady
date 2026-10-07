import { describe, expect, it, vi } from 'vitest';
import { createGitHubClient } from '../src/services/github';

const TOKEN = 'github_pat_TESTSECRET0123456789';

function respond(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function clientWith(res: Response | (() => Response), mode: 'public' | 'private' = 'private') {
  const fetchImpl = vi.fn(async () => (typeof res === 'function' ? res() : res));
  return { client: createGitHubClient(TOKEN, { mode, fetchImpl }), fetchImpl };
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    return err as { code: string; status: number; message: string };
  }
  throw new Error('expected a rejection');
}

describe('GitHub error mapping', () => {
  it.each([
    [respond(401, { message: 'Bad credentials' }), 'INVALID_TOKEN', 401],
    [respond(404), 'REPO_NOT_FOUND', 404],
    [
      respond(
        403,
        { message: 'SSO' },
        { 'x-github-sso': 'required; url=https://github.com/orgs/x/sso' },
      ),
      'SSO_REQUIRED',
      403,
    ],
    [
      respond(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }),
      'GITHUB_RATE_LIMITED',
      503,
    ],
    [respond(429), 'GITHUB_RATE_LIMITED', 503],
    [
      respond(403, { message: 'Resource not accessible by personal access token' }),
      'TOKEN_PERMISSIONS',
      403,
    ],
    [respond(500), 'ANALYSIS_FAILED', 502],
  ])('private mode: %#', async (res, code, status) => {
    const { client } = clientWith(res);
    const err = await errorOf(client.getRepo('o', 'r'));
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(JSON.stringify(err) + err.message).not.toContain(TOKEN);
  });

  it('uses the private wording for 404 in private mode', async () => {
    const { client } = clientWith(respond(404));
    expect((await errorOf(client.getRepo('o', 'r'))).message).toBe(
      'Repository not found, or the token does not have access to it.',
    );
  });

  it('treats a 401 in public mode as a server misconfiguration, not a user error', async () => {
    const { client } = clientWith(respond(401), 'public');
    const err = await errorOf(client.getRepo('o', 'r'));
    expect(err.code).toBe('ANALYSIS_FAILED');
    expect(err.status).toBe(500);
  });

  it('retries once after a network blip, but never retries HTTP errors', async () => {
    const blip = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(respond(200, { JavaScript: 10 }));
    const client = createGitHubClient(TOKEN, { fetchImpl: blip });
    expect(await client.getLanguages('o', 'r')).toEqual({ JavaScript: 10 });
    expect(blip).toHaveBeenCalledTimes(2);

    const notFound = vi.fn(async () => respond(404));
    await errorOf(createGitHubClient(TOKEN, { fetchImpl: notFound }).getRepo('o', 'r'));
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('maps network failures without leaking details', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${TOKEN}`);
    });
    const client = createGitHubClient(TOKEN, { fetchImpl });
    const err = await errorOf(client.getRepo('o', 'r'));
    expect(err.code).toBe('ANALYSIS_FAILED');
    expect(err.message).toBe('Could not reach GitHub.');
  });
});

describe('GitHub requests', () => {
  it('sends the token only as a Bearer header and encodes path segments', async () => {
    const { client, fetchImpl } = clientWith(
      respond(200, {
        name: 'r',
        full_name: 'o/r',
        owner: { login: 'o' },
        private: false,
        description: null,
        html_url: 'https://github.com/o/r',
        default_branch: 'main',
        stargazers_count: 5,
        forks_count: 1,
        open_issues_count: 2,
        size: 123,
        pushed_at: '2026-01-01T00:00:00Z',
        license: { spdx_id: 'MIT', name: 'MIT License' },
      }),
    );
    const repo = await client.getRepo('o', 'r');
    expect(repo).toMatchObject({ fullName: 'o/r', sizeKb: 123, license: 'MIT', isPrivate: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/o/r');
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('never exposes the token as a property of the client', () => {
    const client = createGitHubClient(TOKEN);
    expect(JSON.stringify(client)).not.toContain(TOKEN);
    expect(Object.values(client).some((v) => v === TOKEN)).toBe(false);
  });

  it('sends no Authorization header without a token', async () => {
    const fetchImpl = vi.fn(async () => respond(200, {}));
    await createGitHubClient(undefined, { fetchImpl }).getLanguages('o', 'r');
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('follows the tarball redirect itself, without forwarding the token', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://codeload.github.com/o/r/legacy.tar.gz/abc?token=SHORT' },
        });
      }
      return new Response('tarball-bytes', { status: 200 });
    });
    const client = createGitHubClient(TOKEN, { fetchImpl: fetchImpl as typeof fetch });
    const body = await client.streamTarball('o', 'r', 'abc');
    expect(await new Response(body).text()).toBe('tarball-bytes');
    expect(calls[0]!.url).toBe('https://api.github.com/repos/o/r/tarball/abc');
    expect(calls[1]!.url).toContain('https://codeload.github.com/');
    expect(JSON.stringify(calls[1]!.headers)).not.toContain(TOKEN);
  });

  it('refuses a tarball redirect to a non-GitHub host', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x' } }),
    );
    const client = createGitHubClient(TOKEN, { fetchImpl });
    expect((await errorOf(client.streamTarball('o', 'r', 'abc'))).code).toBe('ANALYSIS_FAILED');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps contributors and commits, dropping anonymous and null authors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        respond(200, [
          { login: 'ann', avatar_url: 'a.png', contributions: 9, type: 'User' },
          { contributions: 3, type: 'Anonymous' },
        ]),
      )
      .mockResolvedValueOnce(
        respond(200, [
          { author: { login: 'ann' }, commit: { author: { date: '2026-01-01' } } },
          { author: null, commit: { author: null } },
        ]),
      );
    const client = createGitHubClient(TOKEN, { fetchImpl });
    expect(await client.getContributors('o', 'r')).toEqual([
      { login: 'ann', avatarUrl: 'a.png', commits: 9 },
    ]);
    expect(await client.getCommits('o', 'r', { path: 'src', perPage: 30 })).toEqual([
      { authorLogin: 'ann', date: '2026-01-01' },
      { authorLogin: null, date: null },
    ]);
    expect(String(fetchImpl.mock.calls[1]![0])).toContain('/commits?per_page=30&path=src');
  });
});
