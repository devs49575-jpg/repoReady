import type { SectionResult } from '@repoready/shared';
import type { ReactNode } from 'react';
import { AlertIcon } from './icons';

/**
 * A report section. When the analyzer failed (`ok: false`) it shows a small inline error card
 * instead of the content, so one broken section never breaks the page.
 */
export function SectionCard<T>({
  id,
  title,
  description,
  result,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  result: SectionResult<T> | undefined;
  children: (data: T) => ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="mb-4">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>
        )}
      </header>
      {result === undefined ? null : result.ok ? (
        children(result.data)
      ) : (
        <SectionError message={result.error} />
      )}
    </section>
  );
}

export function SectionError({ message }: { message: string }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400"
    >
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <span>
        <span className="font-medium text-slate-700 dark:text-slate-300">
          This section is unavailable.
        </span>{' '}
        {message}
      </span>
    </div>
  );
}
