import type { ChecklistItem, SectionResult } from '@repoready/shared';
import { SectionCard } from './SectionCard';
import { CheckIcon, XIcon } from './icons';

export function ChecklistSection({ result }: { result: SectionResult<ChecklistItem[]> }) {
  return (
    <SectionCard id="checklist" title="Checklist" result={result}>
      {(items) => {
        const passed = items.filter((i) => i.passed).length;
        // Failed items first: they are the actionable ones.
        const sorted = [...items].sort((a, b) => Number(a.passed) - Number(b.passed));
        return (
          <div>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
              {passed} of {items.length} checks passed.
            </p>
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {sorted.map((item) => (
                <li
                  key={item.id}
                  className="flex gap-2.5 border-t border-slate-100 py-2.5 text-sm dark:border-slate-800"
                >
                  {item.passed ? (
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <XIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  )}
                  <div>
                    <span className={item.passed ? '' : 'font-medium'}>
                      {item.label}
                      <span className="sr-only">{item.passed ? ': passed' : ': failed'}</span>
                    </span>
                    {!item.passed && (
                      <p className="mt-0.5 text-slate-600 dark:text-slate-400">{item.hint}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </SectionCard>
  );
}
