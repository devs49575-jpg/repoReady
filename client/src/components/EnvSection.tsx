import type { EnvInfo, EnvVarStatus, SectionResult } from '@repoready/shared';
import { Chip, type Tone } from './Chip';
import { CopyButton } from './CopyButton';
import { SectionCard } from './SectionCard';

const STATUS: Record<EnvVarStatus, { tone: Tone; text: string; title: string }> = {
  ok: { tone: 'good', text: 'ok', title: 'Used in code and documented in the example file' },
  undocumented: {
    tone: 'bad',
    text: 'undocumented',
    title: 'Used in code but missing from the example file',
  },
  unused: { tone: 'warn', text: 'unused', title: 'Documented but not found in the code' },
};

export function EnvSection({ result }: { result: SectionResult<EnvInfo> }) {
  return (
    <SectionCard
      id="environment"
      title="Environment"
      description="Variables read in the code, compared with the example env file."
      result={result}
    >
      {(env) => {
        const missing = env.variables.filter((v) => v.status === 'undocumented');
        const missingLines = missing.map((v) => `${v.name}=`).join('\n') + '\n';
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Chip tone="neutral">{env.summary.used} used</Chip>
              <Chip tone="good">{env.summary.documented} documented</Chip>
              <Chip tone={env.summary.undocumented ? 'bad' : 'neutral'}>
                {env.summary.undocumented} undocumented
              </Chip>
              <Chip tone={env.summary.unused ? 'warn' : 'neutral'}>
                {env.summary.unused} unused
              </Chip>
              <span className="text-slate-500 dark:text-slate-400">
                Example file:{' '}
                {env.exampleFile ? <code className="font-mono">{env.exampleFile}</code> : 'none'}
              </span>
            </div>

            {env.variables.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No environment variables found in the code.
              </p>
            ) : (
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase">
                    <tr>
                      <th scope="col" className="py-2 pr-4 pl-5 font-medium sm:pl-0">
                        Variable
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Status
                      </th>
                      <th scope="col" className="py-2 pr-5 font-medium sm:pr-0">
                        Used in
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {env.variables.map((v) => (
                      <tr key={v.name} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-2 pr-4 pl-5 font-mono text-[13px] sm:pl-0">{v.name}</td>
                        <td className="py-2 pr-4">
                          <Chip tone={STATUS[v.status].tone} title={STATUS[v.status].title}>
                            {STATUS[v.status].text}
                          </Chip>
                        </td>
                        <td className="py-2 pr-5 text-xs text-slate-600 sm:pr-0 dark:text-slate-400">
                          {v.usedIn.length ? (
                            <span className="font-mono break-all">{v.usedIn.join(', ')}</span>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {missing.length > 0 && (
              <CopyButton
                text={missingLines}
                label="Copy missing variables as .env.example lines"
                className="border border-slate-200 dark:border-slate-700"
              >
                Copy missing variables as .env.example lines
              </CopyButton>
            )}
          </div>
        );
      }}
    </SectionCard>
  );
}
