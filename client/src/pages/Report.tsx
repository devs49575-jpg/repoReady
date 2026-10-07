import {
  type AnalysisDto,
  type Report as ReportData,
  getPrivacy,
  isPrivateId,
} from '@repoready/shared';
import { useParams } from 'react-router';
import { ApiError, badgeUrl, markdownUrl } from '../api/client';
import { useAnalysis } from '../api/hooks';
import { ArchitectureSection } from '../components/ArchitectureSection';
import { ChecklistSection } from '../components/ChecklistSection';
import { DepsSection } from '../components/DepsSection';
import { CopyButton } from '../components/CopyButton';
import { EnvSection } from '../components/EnvSection';
import { ErrorState } from '../components/ErrorState';
import { HowToRunSection } from '../components/HowToRunSection';
import { PeopleSection } from '../components/PeopleSection';
import { PrivateBanner } from '../components/PrivateBanner';
import { ProgressStepper } from '../components/ProgressStepper';
import { ScoreBreakdown, ScoreRing } from '../components/ScoreRing';
import { SectionError } from '../components/SectionCard';
import { StackSection } from '../components/StackSection';
import { DownloadIcon, ExternalIcon, StarIcon } from '../components/icons';
import { compactNumber, errorMessage, shortSha, timeAgo } from '../lib/format';

const NAV = [
  { id: 'how-to-run', label: 'How to run' },
  { id: 'environment', label: 'Environment' },
  { id: 'stack', label: 'Stack' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'people', label: 'People' },
];

export default function Report() {
  const { id = '' } = useParams();
  const { data, error, isPending, refetch } = useAnalysis(id);
  const isPrivate = isPrivateId(id) || data?.visibility === 'private';

  return (
    <>
      {isPrivate && (
        // Private reports: keep them out of search engines and out of Referer headers.
        <>
          <meta name="robots" content="noindex, nofollow" />
          <meta name="referrer" content="no-referrer" />
        </>
      )}
      <ReportBody
        id={id}
        data={data}
        error={error}
        isPending={isPending}
        isPrivate={isPrivate}
        onExpired={() => void refetch()}
      />
    </>
  );
}

function ReportBody({
  id,
  data,
  error,
  isPending,
  isPrivate,
  onExpired,
}: {
  id: string;
  data: AnalysisDto | undefined;
  error: Error | null;
  isPending: boolean;
  isPrivate: boolean;
  onExpired: () => void;
}) {
  if (isPending) return <ReportSkeleton />;

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    if (notFound && isPrivate) {
      return (
        <ErrorState
          title="Private report unavailable"
          message="This private report has expired or was deleted. Run the analysis again."
        />
      );
    }
    return (
      <ErrorState
        title={notFound ? 'Report not found' : 'Could not load this report'}
        message={notFound ? 'This report does not exist or has been deleted.' : errorMessage(error)}
      />
    );
  }

  const banner =
    isPrivate && data.expiresAt ? (
      <PrivateBanner id={id} expiresAt={data.expiresAt} onExpired={onExpired} />
    ) : null;

  if (data.status === 'queued' || data.status === 'running') {
    return (
      <div className="space-y-4">
        <title>{`Analyzing ${data.fullName} | RepoReady`}</title>
        {banner}
        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          Analyzing <span className="font-mono font-medium">{data.fullName}</span>. This usually
          takes under 30 seconds.
        </p>
        <ProgressStepper step={data.step} progress={data.progress} />
      </div>
    );
  }

  if (data.status === 'failed' || !data.report) {
    return (
      <div className="space-y-4">
        {banner}
        <ErrorState
          title={`Could not analyze ${data.fullName}`}
          message={data.error?.message ?? 'The analysis failed. Please try again.'}
        />
      </div>
    );
  }

  return <DoneReport analysis={data} report={data.report} banner={banner} />;
}

function PrivacyLine({ report }: { report: ReportData }) {
  const privacy = getPrivacy(report);
  if (privacy.visibility !== 'private') return null;
  const skipped = report.deps.ok ? report.deps.data.skippedPackages : 0;
  return (
    <p className="text-sm text-slate-600 dark:text-slate-400">
      <span className="font-medium text-slate-700 dark:text-slate-300">Privacy: </span>
      {privacy.externalLookups
        ? `Dependency lookups were performed (package names and versions were sent to OSV.dev and the npm registry)${skipped ? `; ${skipped} non-public package(s) were not looked up` : ''}.`
        : 'Dependency lookups were skipped, so no package names left the server.'}
    </p>
  );
}

function DoneReport({
  analysis,
  report,
  banner,
}: {
  analysis: AnalysisDto;
  report: ReportData;
  banner: React.ReactNode;
}) {
  const { meta } = report;
  return (
    <div className="space-y-6">
      <title>{`${meta.fullName} onboarding briefing | RepoReady`}</title>
      {banner}

      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight break-words">
              <a
                href={meta.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 hover:underline"
              >
                {meta.fullName}
                <ExternalIcon className="h-4 w-4 text-slate-400" />
              </a>
            </h1>
            {meta.description && (
              <p className="mt-1 text-slate-600 dark:text-slate-400">{meta.description}</p>
            )}
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-1">
                <StarIcon />
                <dt className="sr-only">Stars</dt>
                <dd>{compactNumber(meta.stars)}</dd>
              </div>
              <div>
                <dt className="inline">Commit </dt>
                <dd className="inline font-mono">{shortSha(meta.commitSha)}</dd>
              </div>
              {meta.license && (
                <div>
                  <dt className="inline">License </dt>
                  <dd className="inline">{meta.license}</dd>
                </div>
              )}
              <div>
                <dt className="sr-only">Analyzed</dt>
                <dd>
                  Analyzed{' '}
                  <time dateTime={analysis.finishedAt ?? analysis.createdAt}>
                    {timeAgo(analysis.finishedAt ?? analysis.createdAt)}
                  </time>
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <CopyButton
                text={window.location.href}
                label="Copy link to this report"
                className="border border-slate-200 dark:border-slate-700"
              >
                Copy link
              </CopyButton>
              <a
                href={markdownUrl(analysis.id)}
                download
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-accent-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                <DownloadIcon />
                Download Markdown
              </a>
              {/* Badges are public sharing: never offered for private reports (Addendum 01). */}
              {getPrivacy(report).visibility === 'public' && (
                <CopyButton
                  text={`[![RepoReady score](${badgeUrl(meta.owner, meta.repo)})](${window.location.href})`}
                  label="Copy badge Markdown for your README"
                  className="border border-slate-200 dark:border-slate-700"
                >
                  Copy badge Markdown
                </CopyButton>
              )}
            </div>
            <div className="mt-3">
              <PrivacyLine report={report} />
            </div>
          </div>

          {report.score.ok ? (
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start lg:w-[26rem]">
              <ScoreRing score={report.score.data} />
              <ScoreBreakdown score={report.score.data} />
            </div>
          ) : (
            <div className="lg:w-[26rem]">
              <SectionError message={report.score.error} />
            </div>
          )}
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[11rem_1fr] lg:gap-8">
        <nav aria-label="Report sections" className="hidden lg:block">
          <ul className="sticky top-6 space-y-1 text-sm">
            {NAV.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="block rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <HowToRunSection result={report.howToRun} />
          <EnvSection result={report.env} />
          <StackSection result={report.stack} />
          <ChecklistSection result={report.checklist} />
          <ArchitectureSection result={report.architecture} />
          <DepsSection result={report.deps} />
          <PeopleSection result={report.people} />
        </div>
      </div>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading report">
      <div className="h-40 rounded-xl bg-slate-200/70 dark:bg-slate-800/70" />
      <div className="h-64 rounded-xl bg-slate-200/70 dark:bg-slate-800/70" />
      <div className="h-48 rounded-xl bg-slate-200/70 dark:bg-slate-800/70" />
    </div>
  );
}
