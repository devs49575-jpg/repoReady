import type {
  AnalysisDto,
  AnalysisStatus,
  ErrorCode,
  RecentAnalysis,
  Report,
  Visibility,
} from '@repoready/shared';

export interface StoredAnalysis {
  id: string;
  visibility: Visibility;
  owner: string;
  repo: string;
  fullName: string;
  commitSha: string;
  status: AnalysisStatus;
  step: string;
  progress: number;
  error: { code: ErrorCode; message: string } | null;
  report: Report | null;
  scoreTotal: number | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** When the record is deleted. Public: Mongo TTL (30 days). Private: in-memory TTL. */
  expiresAt: Date;
}

export type NewAnalysis = Pick<
  StoredAnalysis,
  'owner' | 'repo' | 'fullName' | 'commitSha' | 'step' | 'progress'
>;

export type AnalysisPatch = Partial<
  Pick<
    StoredAnalysis,
    'status' | 'step' | 'progress' | 'error' | 'report' | 'scoreTotal' | 'startedAt' | 'finishedAt'
  >
>;

/** Where an analysis lives (Addendum 01, 5.4). Routes and the pipeline only talk to this. */
export interface AnalysisStore {
  readonly visibility: Visibility;
  create(doc: NewAnalysis): Promise<StoredAnalysis>;
  get(id: string): Promise<StoredAnalysis | null>;
  update(id: string, patch: AnalysisPatch): Promise<void>;
  delete?(id: string): Promise<boolean>;
}

export function toDto(a: StoredAnalysis): AnalysisDto {
  return {
    id: a.id,
    visibility: a.visibility,
    // Only private reports auto-delete in a way the user needs to know about.
    expiresAt: a.visibility === 'private' ? a.expiresAt.toISOString() : null,
    owner: a.owner,
    repo: a.repo,
    fullName: a.fullName,
    commitSha: a.commitSha,
    status: a.status,
    step: a.step,
    progress: a.progress,
    error: a.error,
    report: a.report,
    scoreTotal: a.scoreTotal,
    createdAt: a.createdAt.toISOString(),
    startedAt: a.startedAt?.toISOString() ?? null,
    finishedAt: a.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Queries that only make sense for public analyses: cache lookups, the recent gallery and badges.
 * Only the MongoDB store implements this, so these features cannot reach private reports.
 */
export interface PublicAnalysisStore extends AnalysisStore {
  readonly visibility: 'public';
  /** A finished analysis of this exact commit (newer than `finishedSince`), or one in progress. */
  findReusable(
    fullName: string,
    commitSha: string,
    finishedSince: Date,
  ): Promise<StoredAnalysis | null>;
  /** Latest finished analysis per repo, newest first. */
  recent(limit: number): Promise<RecentAnalysis[]>;
  /** Score of the latest finished analysis of a repo, or null if never analyzed. */
  latestScore(fullName: string): Promise<number | null>;
}
