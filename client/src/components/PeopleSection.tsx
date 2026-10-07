import type { PeopleInfo, SectionResult } from '@repoready/shared';
import { timeAgo } from '../lib/format';
import { SectionCard } from './SectionCard';

function profileUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}`;
}

export function PeopleSection({ result }: { result: SectionResult<PeopleInfo> }) {
  return (
    <SectionCard
      id="people"
      title="People"
      description="Who has worked on this code, from recent commit history."
      result={result}
    >
      {(people) => (
        <div className="space-y-5">
          {people.lastCommitAt && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Last commit <time dateTime={people.lastCommitAt}>{timeAgo(people.lastCommitAt)}</time>
              .
            </p>
          )}

          {people.contributors.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No contributor data available.
            </p>
          ) : (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Top contributors</h3>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {people.contributors.map((c) => (
                  <li key={c.login}>
                    <a
                      href={profileUrl(c.login)}
                      aria-label={`${c.login}, ${c.commits} commit${c.commits === 1 ? '' : 's'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {c.avatarUrl ? (
                        <img
                          src={c.avatarUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-8 w-8 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700"
                        />
                      ) : (
                        <span className="h-8 w-8 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{c.login}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {c.commits} commit{c.commits === 1 ? '' : 's'}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {people.byFolder.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Who to ask</h3>
              <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {people.byFolder.map((f) => (
                  <div key={f.folder} className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
                    <dt className="shrink-0 sm:w-40">
                      About <code className="font-mono">{f.folder}/</code>
                    </dt>
                    <dd className="flex flex-wrap gap-x-3 gap-y-1">
                      {f.people.map((p) => (
                        <a
                          key={p.login}
                          href={profileUrl(p.login)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-700 hover:underline dark:text-accent-300"
                        >
                          {p.login}{' '}
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            ({p.commits})
                          </span>
                        </a>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Based on the last 30 commits that touched each folder.
              </p>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
