import { describe, expect, it, vi } from 'vitest';
import { analyzePeople, topLevelFolders } from '../src/analyzers/people';
import { AppError } from '../src/utils/errors';
import { fakeGitHub, fixtureContext } from './helpers';

describe('topLevelFolders', () => {
  it('picks the busiest top-level dirs, ignoring dot-folders and root files', () => {
    const files = [
      'README.md',
      '.github/workflows/ci.yml',
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'docs/x.md',
      'test/a.test.ts',
      'test/b.test.ts',
    ];
    expect(topLevelFolders(files)).toEqual(['src', 'test', 'docs']);
    expect(topLevelFolders(files, 1)).toEqual(['src']);
  });
});

describe('people analyzer', () => {
  it('lists top contributors and who to ask per folder', async () => {
    const getCommits = vi.fn(async (_o: string, _r: string, opts: { path?: string }) =>
      opts.path === 'src'
        ? [
            { authorLogin: 'ann', date: null },
            { authorLogin: 'bob', date: null },
            { authorLogin: 'ann', date: null },
            { authorLogin: null, date: null },
          ]
        : [],
    );
    const ctx = await fixtureContext('simple-express');
    ctx.github = fakeGitHub({
      getContributors: async () => [{ login: 'ann', avatarUrl: 'a.png', commits: 40 }],
      getCommits,
    });
    const people = await analyzePeople(ctx, '2026-10-01T00:00:00Z');
    expect(people).toEqual({
      contributors: [{ login: 'ann', avatarUrl: 'a.png', commits: 40 }],
      byFolder: [
        {
          folder: 'src',
          people: [
            { login: 'ann', commits: 2 },
            { login: 'bob', commits: 1 },
          ],
        },
      ],
      lastCommitAt: '2026-10-01T00:00:00Z',
    });
    expect(getCommits).toHaveBeenCalledWith(
      'acme',
      'widget',
      { path: 'src', perPage: 30 },
      undefined,
    );
  });

  it('returns what it collected when GitHub rate limits', async () => {
    const ctx = await fixtureContext('ts-react');
    ctx.github = fakeGitHub({
      getContributors: async () => [{ login: 'ann', avatarUrl: '', commits: 3 }],
      getCommits: async () => {
        throw new AppError('GITHUB_RATE_LIMITED', 'rate limited');
      },
    });
    const people = await analyzePeople(ctx, null);
    expect(people.contributors).toHaveLength(1);
    expect(people.byFolder).toEqual([]);
  });

  it('fails the section on other errors from the contributors call', async () => {
    const ctx = await fixtureContext('ts-react');
    ctx.github = fakeGitHub({
      getContributors: async () => {
        throw new AppError('ANALYSIS_FAILED', 'GitHub returned an unexpected error (500).');
      },
    });
    await expect(analyzePeople(ctx, null)).rejects.toThrow(/unexpected error/);
  });
});
