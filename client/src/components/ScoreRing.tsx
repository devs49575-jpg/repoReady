import type { ScoreInfo } from '@repoready/shared';

const RING_COLORS: Record<ScoreInfo['label'], string> = {
  'Needs work': 'text-red-500',
  Okay: 'text-amber-500',
  Good: 'text-emerald-500',
  Excellent: 'text-emerald-500',
};

export function ScoreRing({ score }: { score: ScoreInfo }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score.total / 100);
  return (
    <div className="flex flex-col items-center">
      <div
        className="relative h-36 w-36"
        role="img"
        aria-label={`Readiness score ${score.total} out of 100: ${score.label}`}
      >
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="10"
            className="stroke-slate-100 dark:stroke-slate-800"
          />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${RING_COLORS[score.label]} transition-[stroke-dashoffset] duration-700`}
          />
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          aria-hidden="true"
        >
          <span className="text-4xl font-bold tabular-nums">{score.total}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">/ 100</span>
        </div>
      </div>
      <span className="mt-2 text-sm font-semibold">{score.label}</span>
    </div>
  );
}

export function ScoreBreakdown({ score }: { score: ScoreInfo }) {
  return (
    <ul className="w-full space-y-3">
      {score.breakdown.map((cat) => {
        const pct = cat.max ? (cat.earned / cat.max) * 100 : 0;
        return (
          <li key={cat.category}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{cat.category}</span>
              <span className="tabular-nums text-slate-500 dark:text-slate-400">
                {cat.earned}/{cat.max}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {cat.reasons.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                {cat.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
