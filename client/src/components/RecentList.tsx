import { Link } from 'react-router';
import { useRecent } from '../api/hooks';
import { timeAgo } from '../lib/format';
import { Chip, type Tone } from './Chip';

function scoreTone(score: number | null): Tone {
  if (score === null) return 'neutral';
  if (score >= 75) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

/** Recently analyzed public repos. Private reports never appear here (the API excludes them). */
export function RecentList() {
  const recent = useRecent();
  if (recent.isError || (recent.isSuccess && recent.data.length === 0)) return null;

  return (
    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="mb-3 text-lg font-semibold tracking-tight">
        Recently analyzed
      </h2>
      {recent.isPending ? (
        <div
          className="grid gap-2 sm:grid-cols-2"
          aria-busy="true"
          aria-label="Loading recent analyses"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-slate-200/70 dark:bg-slate-800/70"
            />
          ))}
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {recent.data.map((r) => (
            <li key={r.id}>
              <Link
                to={`/r/${r.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-accent-500 focus-visible:outline-2 focus-visible:outline-accent-500 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm font-medium">{r.fullName}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {timeAgo(r.createdAt)}
                  </span>
                </span>
                <Chip tone={scoreTone(r.score)}>
                  {r.score === null ? 'no score' : `${r.score}/100`}
                </Chip>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
