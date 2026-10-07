import type { HowToRun, SectionResult } from '@repoready/shared';
import { Chip } from './Chip';
import { CopyButton } from './CopyButton';
import { SectionCard } from './SectionCard';

export function HowToRunSection({ result }: { result: SectionResult<HowToRun> }) {
  return (
    <SectionCard
      id="how-to-run"
      title="How to run"
      description="Steps generated from the repo's scripts, version files and env example."
      result={result}
    >
      {(run) => (
        <div className="space-y-5">
          <ol className="space-y-3">
            {run.stepItems.map((item, i) => (
              <li key={`${i}-${item.label}`} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-50 text-xs font-semibold text-accent-700 dark:bg-accent-500/10 dark:text-accent-200"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{item.label}</p>
                  {item.command && (
                    <div className="mt-1.5 flex items-center gap-1 rounded-lg bg-slate-100 py-1 pr-1 pl-3 dark:bg-slate-800">
                      <code className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-[13px] whitespace-pre">
                        {item.command}
                      </code>
                      <CopyButton text={item.command} label={`Copy command: ${item.command}`} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <dl className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3 dark:border-slate-800">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Node version</dt>
              <dd className="mt-0.5 font-medium">
                {run.nodeVersion.value ? (
                  <>
                    {run.nodeVersion.value}{' '}
                    <span className="font-normal text-slate-500 dark:text-slate-400">
                      ({run.nodeVersion.source})
                    </span>
                  </>
                ) : (
                  'Not pinned'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Docker</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {run.docker.dockerfile && <Chip tone="good">Dockerfile</Chip>}
                {run.docker.compose && <Chip tone="good">Compose</Chip>}
                {!run.docker.dockerfile && !run.docker.compose && (
                  <span className="font-medium">None found</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">README</dt>
              <dd className="mt-1">
                {!run.readme.exists ? (
                  <Chip tone="bad">Missing</Chip>
                ) : run.readme.hasSetupSection ? (
                  <Chip tone="good">Has setup section</Chip>
                ) : (
                  <Chip tone="warn">No setup section</Chip>
                )}
              </dd>
            </div>
          </dl>

          <ScriptsTable scripts={run.scripts} />
        </div>
      )}
    </SectionCard>
  );
}

function ScriptsTable({ scripts }: { scripts: HowToRun['scripts'] }) {
  const rows = Object.entries(scripts).filter((entry): entry is [string, string] => !!entry[1]);
  if (rows.length === 0) return null;
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
        All detected commands ({rows.length})
      </summary>
      <table className="mt-2 w-full text-left">
        <tbody>
          {rows.map(([name, cmd]) => (
            <tr key={name} className="border-t border-slate-100 dark:border-slate-800">
              <th scope="row" className="py-1.5 pr-4 font-medium capitalize">
                {name}
              </th>
              <td className="py-1.5">
                <code className="font-mono text-[13px]">{cmd}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
