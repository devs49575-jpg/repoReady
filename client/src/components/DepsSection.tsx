import type { DepsInfo, SectionResult, Severity } from '@repoready/shared';
import { Chip, type Tone } from './Chip';
import { SectionCard } from './SectionCard';
import { ShowMore } from './ShowMore';
import { AlertIcon, ExternalIcon } from './icons';

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'unknown'];
const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: 'bad',
  high: 'bad',
  medium: 'warn',
  low: 'neutral',
  unknown: 'neutral',
};
const UPDATE_TONE = { major: 'warn', minor: 'neutral', patch: 'neutral' } as const;
const ROWS_SHOWN = 10;

export function DepsSection({ result }: { result: SectionResult<DepsInfo> }) {
  return (
    <SectionCard
      id="dependencies"
      title="Dependencies"
      description="Known vulnerabilities from OSV.dev and updates from the npm registry."
      result={result}
    >
      {(deps) => (
        <div className="space-y-5">
          {deps.approximate && (
            <div
              role="note"
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-200"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                No npm lockfile found, so versions are approximated from the ranges in package.json
                and only direct dependencies were checked.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {SEVERITIES.map((s) => (
              <Chip key={s} tone={deps.counts[s] ? SEVERITY_TONE[s] : 'neutral'}>
                {deps.counts[s]} {s}
              </Chip>
            ))}
            <span className="text-slate-500 dark:text-slate-400">
              {deps.totalPackages} packages checked, {deps.directPackages} direct
            </span>
          </div>

          {deps.notes.length > 0 && (
            <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
              {deps.notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold">Vulnerabilities</h3>
            {deps.vulnerabilities.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <Chip tone="good">None known</Chip> No published advisories affect the checked
                versions.
              </p>
            ) : (
              <ShowMore items={deps.vulnerabilities} initial={ROWS_SHOWN} noun="vulnerabilities">
                {(rows) => (
                  <div className="-mx-5 overflow-x-auto sm:mx-0">
                    <table className="w-full min-w-[36rem] text-left text-sm">
                      <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase">
                        <tr>
                          <th scope="col" className="py-2 pr-3 pl-5 font-medium sm:pl-0">
                            Package
                          </th>
                          <th scope="col" className="py-2 pr-3 font-medium">
                            Severity
                          </th>
                          <th scope="col" className="py-2 pr-3 font-medium">
                            Issue
                          </th>
                          <th scope="col" className="py-2 pr-5 font-medium sm:pr-0">
                            Fixed in
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((v) => (
                          <tr
                            key={`${v.id}-${v.package}`}
                            className="border-t border-slate-100 align-top dark:border-slate-800"
                          >
                            <td className="py-2 pr-3 pl-5 font-mono text-[13px] sm:pl-0">
                              {v.package}@{v.version}
                            </td>
                            <td className="py-2 pr-3">
                              <Chip tone={SEVERITY_TONE[v.severity]}>{v.severity}</Chip>
                            </td>
                            <td className="py-2 pr-3">
                              <a
                                href={v.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-xs text-accent-700 hover:underline dark:text-accent-300"
                              >
                                {v.id}
                                <ExternalIcon className="h-3 w-3" />
                              </a>
                              {v.summary && (
                                <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                                  {v.summary}
                                </p>
                              )}
                            </td>
                            <td className="py-2 pr-5 font-mono text-[13px] sm:pr-0">
                              {v.fixedIn ?? '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </ShowMore>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Outdated direct dependencies</h3>
            {deps.outdated.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                All checked direct dependencies are on their latest version.
              </p>
            ) : (
              <ShowMore items={deps.outdated} initial={ROWS_SHOWN} noun="packages">
                {(rows) => (
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    {rows.map((o) => (
                      <li key={o.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                        <span className="font-mono text-[13px]">{o.name}</span>
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {o.current} → {o.latest}
                        </span>
                        <Chip tone={UPDATE_TONE[o.type]}>{o.type}</Chip>
                      </li>
                    ))}
                  </ul>
                )}
              </ShowMore>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
