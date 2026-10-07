import type { AnalysisResponseExtras, AnalysisStatus, Report } from './report';

/** Error body returned by every failing API route. Messages never contain tokens. */
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

export type ErrorCode =
  | 'INVALID_URL'
  | 'REPO_NOT_FOUND'
  | 'REPO_TOO_LARGE'
  | 'GITHUB_RATE_LIMITED'
  | 'ANALYSIS_TIMEOUT'
  | 'ANALYSIS_FAILED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  // Private repo mode (Addendum 01)
  | 'INVALID_TOKEN'
  | 'SSO_REQUIRED'
  | 'TOKEN_PERMISSIONS'
  | 'PRIVATE_MODE_DISABLED'
  | 'HTTPS_REQUIRED'
  | 'REPORT_NOT_FOUND'
  | 'NOT_ALLOWED';

export interface HealthResponse {
  ok: true;
}

export interface ConfigResponse {
  privateModeEnabled: boolean;
  privateReportTtlMinutes: number;
}

export interface CreateAnalysisRequest {
  repoUrl: string;
  skipExternalLookups?: boolean;
}

export interface CreateAnalysisResponse extends AnalysisResponseExtras {
  id: string;
  status: AnalysisStatus;
  cached?: boolean;
}

export interface AnalysisDto extends AnalysisResponseExtras {
  id: string;
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
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RecentAnalysis {
  id: string;
  fullName: string;
  score: number | null;
  createdAt: string;
}
