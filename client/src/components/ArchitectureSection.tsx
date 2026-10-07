import type { ArchitectureInfo, SectionResult } from '@repoready/shared';
import { Suspense, lazy, useState } from 'react';
import { Chip } from './Chip';
import { SectionCard } from './SectionCard';

// React Flow + dagre are the heaviest client dependencies; load them only when needed.
const ArchitectureExplorer = lazy(() => import('./ArchitectureExplorer'));

export function ArchitectureSection({ result }: { result: SectionResult<ArchitectureInfo> }) {
  return (
    <SectionCard
      id="architecture"
      title="Architecture"
      description="How files import each other (static imports only)."
      result={result}
    >
      {(arch) => (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Chip>{arch.analyzedFiles} files analyzed</Chip>
            <Chip tone={arch.circular.length ? 'bad' : 'good'}>
              {arch.circular.length} circular dependenc{arch.circular.length === 1 ? 'y' : 'ies'}
            </Chip>
            <Chip tone={arch.orphans.length ? 'warn' : 'neutral'}>
              {arch.orphans.length} unused file{arch.orphans.length === 1 ? '' : 's'}
            </Chip>
          </div>

          {(arch.level === 'folder' || arch.truncated) && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
              {arch.level === 'folder' &&
                `This repo has ${arch.analyzedFiles} files, so the graph groups them by folder; edge labels count file imports. `}
              {arch.truncated && `Only the ${arch.nodes.length} most connected nodes are shown.`}
            </p>
          )}

          {arch.nodes.length > 0 ? (
            <Suspense
              fallback={
                <div
                  className="h-[28rem] animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                  aria-label="Loading graph"
                />
              }
            >
              <ArchitectureExplorer arch={arch} />
            </Suspense>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">No imports found to map.</p>
          )}

          {arch.circular.length > 0 && <CycleList cycles={arch.circular} />}

          {arch.orphans.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                Files nobody imports ({arch.orphans.length})
              </summary>
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto font-mono text-xs text-slate-600 dark:text-slate-400">
                {arch.orphans.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </SectionCard>
  );
}

const CYCLES_SHOWN = 5;

function CycleList({ cycles }: { cycles: string[][] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? cycles : cycles.slice(0, CYCLES_SHOWN);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Circular dependencies ({cycles.length})</h3>
      <ol className="space-y-1.5">
        {shown.map((cycle) => (
          <li
            key={cycle.join('>')}
            className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 font-mono text-xs break-all text-red-900 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-200"
          >
            {[...cycle, cycle[0]].join(' → ')}
          </li>
        ))}
      </ol>
      {cycles.length > CYCLES_SHOWN && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-2 text-sm font-medium text-accent-700 hover:underline dark:text-accent-300"
        >
          {showAll ? 'Show fewer' : `Show all ${cycles.length} cycles`}
        </button>
      )}
    </div>
  );
}
