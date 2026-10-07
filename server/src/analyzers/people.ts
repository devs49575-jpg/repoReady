import type { PeopleInfo } from '@repoready/shared';
import pLimit from 'p-limit';
import { isAppError } from '../utils/errors';
import type { AnalyzerContext } from './context';

const MAX_FOLDERS = 8;
const PEOPLE_PER_FOLDER = 5;
const COMMITS_PER_FOLDER = 30;

/** Top-level directories with the most files, ignoring dot-folders and node_modules. */
export function topLevelFolders(files: string[], max = MAX_FOLDERS): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const slash = f.indexOf('/');
    if (slash === -1) continue;
    const dir = f.slice(0, slash);
    if (dir.startsWith('.') || dir === 'node_modules') continue;
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([dir]) => dir);
}

function isRateLimit(err: unknown): boolean {
  return isAppError(err) && err.code === 'GITHUB_RATE_LIMITED';
}

/**
 * "Who to ask": top contributors overall and per top-level folder (Section 8.8). Uses the
 * per-request GitHub client from the context, never a global one (Addendum 01, 5.3).
 * On rate limiting, returns whatever was collected.
 */
export async function analyzePeople(
  ctx: AnalyzerContext,
  headCommitDate: string | null,
): Promise<PeopleInfo> {
  const { owner, repo } = ctx.meta;
  let rateLimited = false;

  let contributors: PeopleInfo['contributors'] = [];
  try {
    contributors = (await ctx.github.getContributors(owner, repo, ctx.signal)).slice(0, 10);
  } catch (err) {
    if (!isRateLimit(err)) throw err;
    rateLimited = true;
  }

  const limit = pLimit(4);
  const byFolder: PeopleInfo['byFolder'] = [];
  await Promise.all(
    topLevelFolders(ctx.files).map((folder) =>
      limit(async () => {
        if (rateLimited || ctx.signal?.aborted) return;
        try {
          const commits = await ctx.github.getCommits(
            owner,
            repo,
            { path: folder, perPage: COMMITS_PER_FOLDER },
            ctx.signal,
          );
          const tally = new Map<string, number>();
          for (const c of commits) {
            if (c.authorLogin) tally.set(c.authorLogin, (tally.get(c.authorLogin) ?? 0) + 1);
          }
          const people = [...tally.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, PEOPLE_PER_FOLDER)
            .map(([login, n]) => ({ login, commits: n }));
          if (people.length) byFolder.push({ folder, people });
        } catch (err) {
          if (isRateLimit(err)) rateLimited = true;
          // Any other per-folder failure just leaves that folder out.
        }
      }),
    ),
  );
  if (ctx.signal?.aborted) throw ctx.signal.reason;
  byFolder.sort((a, b) => a.folder.localeCompare(b.folder));

  return { contributors, byFolder, lastCommitAt: headCommitDate };
}
