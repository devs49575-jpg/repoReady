import type { ErrorCode } from '@repoready/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  VALIDATION_ERROR: 400,
  REPO_NOT_FOUND: 404,
  NOT_FOUND: 404,
  REPO_TOO_LARGE: 422,
  RATE_LIMITED: 429,
  GITHUB_RATE_LIMITED: 503,
  ANALYSIS_TIMEOUT: 504,
  ANALYSIS_FAILED: 500,
  INTERNAL_ERROR: 500,
  // Private repo mode (Addendum 01). INVALID_TOKEN is 401 from GitHub, 400 for a malformed token.
  INVALID_TOKEN: 401,
  SSO_REQUIRED: 403,
  TOKEN_PERMISSIONS: 403,
  PRIVATE_MODE_DISABLED: 400,
  HTTPS_REQUIRED: 400,
  REPORT_NOT_FOUND: 404,
  NOT_ALLOWED: 403,
};

/** An error that maps to a specific API error code and HTTP status. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status = STATUS_BY_CODE[code]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
