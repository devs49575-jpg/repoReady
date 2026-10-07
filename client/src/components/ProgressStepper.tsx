import { PIPELINE_STEPS } from '@repoready/shared';
import { CheckIcon, SpinnerIcon } from './icons';

/** Shows the 9 pipeline steps with the current one highlighted, plus an overall progress bar. */
export function ProgressStepper({ step, progress }: { step: string; progress: number }) {
  const byLabel = PIPELINE_STEPS.findIndex((s) => s.label === step);
  // Fall back to progress if the label is unknown (e.g. an older server).
  const current =
    byLabel !== -1
      ? byLabel
      : Math.max(
          0,
          PIPELINE_STEPS.findLastIndex((s) => s.progress <= progress),
        );
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium">Analyzing repository</span>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      >
        <div
          className="h-full rounded-full bg-accent-600 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="mt-5 space-y-2.5">
        {PIPELINE_STEPS.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          return (
            <li
              key={s.key}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`flex items-center gap-3 text-sm ${
                state === 'todo'
                  ? 'text-slate-400 dark:text-slate-500'
                  : state === 'current'
                    ? 'font-medium text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                  state === 'done'
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : state === 'current'
                      ? 'border-accent-500 text-accent-600 dark:text-accent-200'
                      : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                {state === 'done' ? (
                  <CheckIcon className="h-3.5 w-3.5" />
                ) : state === 'current' ? (
                  <SpinnerIcon />
                ) : null}
              </span>
              {s.label}
              {state === 'done' && <span className="sr-only">(done)</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
