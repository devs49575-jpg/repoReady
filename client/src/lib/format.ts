import type { ErrorCode } from '@repoready/shared';
import { ApiError } from '../api/client';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < HOUR) return plural(Math.round(seconds / MINUTE), 'minute');
  if (seconds < DAY) return plural(Math.round(seconds / HOUR), 'hour');
  if (seconds < 60 * DAY) return plural(Math.round(seconds / DAY), 'day');
  if (seconds < 365 * DAY) return plural(Math.round(seconds / (30 * DAY)), 'month');
  return plural(Math.floor(seconds / (365 * DAY)), 'year');
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

export function compactNumber(n: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const FRIENDLY: Partial<Record<ErrorCode | 'NETWORK_ERROR', string>> = {
  INVALID_URL: 'That does not look like a GitHub repository. Try owner/repo or a github.com URL.',
  REPO_NOT_FOUND:
    'We could not find that repository. Check the spelling; only public repositories are supported.',
  REPO_TOO_LARGE: 'This repository is too large to analyze.',
  GITHUB_RATE_LIMITED: 'GitHub is rate limiting us right now. Please try again in a few minutes.',
  RATE_LIMITED: 'You have started a lot of analyses. Please wait a bit and try again.',
  NETWORK_ERROR: 'Could not reach the RepoReady server. Is it running?',
};

// Private mode: say exactly what to fix on GitHub (Addendum 01, Section 6).
const PRIVATE_FRIENDLY: Partial<Record<ErrorCode, string>> = {
  INVALID_TOKEN: 'GitHub rejected this token. Check that it was copied fully and has not expired.',
  SSO_REQUIRED:
    "This organization uses SAML single sign-on. On GitHub, open the token's settings and authorize it for the organization, then try again.",
  TOKEN_PERMISSIONS:
    'The token cannot read this repository. Give it Contents (read-only) and Metadata (read-only) access to this repo.',
  REPO_NOT_FOUND:
    'Repository not found, or the token does not have access to it. Check that the token includes this repository.',
  HTTPS_REQUIRED: 'Tokens can only be sent over a secure (HTTPS) connection.',
  PRIVATE_MODE_DISABLED: 'Private repository analysis is not available on this server.',
};

/** Turns any error into a message for the user, preferring the server's own message. */
export function errorMessage(err: unknown, privateMode = false): string {
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK_ERROR' || err.code === 'RATE_LIMITED') return FRIENDLY[err.code]!;
    if (privateMode && PRIVATE_FRIENDLY[err.code]) {
      return PRIVATE_FRIENDLY[err.code]!;
    }
    return err.message || FRIENDLY[err.code] || 'Something went wrong.';
  }
  return 'Something went wrong.';
}

/** MM:SS countdown (minutes can exceed 59), clamped at 00:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
