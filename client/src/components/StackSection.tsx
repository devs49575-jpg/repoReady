import type { SectionResult, StackInfo, TechCategory } from '@repoready/shared';
import { Chip } from './Chip';
import { SectionCard } from './SectionCard';

const CATEGORY_LABELS: Record<TechCategory, string> = {
  framework: 'Frameworks',
  database: 'Data',
  testing: 'Testing',
  build: 'Build',
  lint: 'Lint and format',
  language: 'Language',
  infra: 'Infrastructure',
  other: 'Other',
};

// Neutral shades for the language bar; status colours stay reserved for status.
const LANGUAGE_SHADES = [
  'bg-accent-600',
  'bg-accent-500/70',
  'bg-slate-500',
  'bg-slate-400',
  'bg-slate-300',
  'bg-slate-200',
  'bg-slate-100',
];

export function StackSection({ result }: { result: SectionResult<StackInfo> }) {
  return (
    <SectionCard id="stack" title="Stack" result={result}>
      {(stack) => {
        const groups = new Map<TechCategory, StackInfo['technologies']>();
        for (const tech of stack.technologies) {
          groups.set(tech.category, [...(groups.get(tech.category) ?? []), tech]);
        }
        return (
          <div className="space-y-5">
            {stack.languages.length > 0 && (
              <div>
                <div
                  className="flex h-2.5 overflow-hidden rounded-full"
                  role="img"
                  aria-label={stack.languages.map((l) => `${l.name} ${l.percent}%`).join(', ')}
                >
                  {stack.languages.map((l, i) => (
                    <div
                      key={l.name}
                      className={LANGUAGE_SHADES[i % LANGUAGE_SHADES.length]}
                      style={{ width: `${l.percent}%` }}
                    />
                  ))}
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {stack.languages.map((l, i) => (
                    <li key={l.name} className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={`h-2.5 w-2.5 rounded-full ${LANGUAGE_SHADES[i % LANGUAGE_SHADES.length]}`}
                      />
                      {l.name}{' '}
                      <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                        {l.percent}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!stack.hasPackageJson && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No package.json found, so only languages are shown. RepoReady analyzes JavaScript
                and TypeScript projects in depth.
              </p>
            )}

            {groups.size > 0 && (
              <dl className="space-y-2.5 text-sm">
                {[...groups.entries()].map(([category, techs]) => (
                  <div key={category} className="flex flex-col gap-1 sm:flex-row sm:items-center">
                    <dt className="w-36 shrink-0 text-slate-500 dark:text-slate-400">
                      {CATEGORY_LABELS[category]}
                    </dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {techs.map((t) => (
                        <Chip key={t.name} tone="accent" title={t.evidence}>
                          {t.name}
                        </Chip>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {stack.hasPackageJson && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                <span>
                  <span className="text-slate-500 dark:text-slate-400">Package manager:</span>{' '}
                  {stack.packageManager === 'unknown'
                    ? 'unknown (no lockfile)'
                    : stack.packageManager}
                </span>
                {stack.workspaces.length > 0 && (
                  <span>
                    <span className="text-slate-500 dark:text-slate-400">Workspaces:</span>{' '}
                    <code className="font-mono text-[13px]">{stack.workspaces.join(', ')}</code>
                  </span>
                )}
              </div>
            )}
          </div>
        );
      }}
    </SectionCard>
  );
}
