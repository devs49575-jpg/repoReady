/**
 * Scrubs secrets out of text before it is logged, stored or returned (Addendum 01, 5.6).
 *
 * - Known secrets (e.g. a user's GitHub token) are replaced with [REDACTED].
 * - URL query strings are dropped: GitHub's tarball redirect to codeload.github.com carries a
 *   short-lived credential in its query string.
 * - Private report ids (`p_` + 32 chars) are access secrets, so only their first 4 chars are kept.
 */

export const REDACTED = '[REDACTED]';

// Secrets shorter than this are not scrubbed: replacing e.g. "a" everywhere would mangle text.
const MIN_SECRET_LENGTH = 8;

const PRIVATE_ID_RE = /(?<![A-Za-z0-9_-])p_([A-Za-z0-9_-]{4})[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])/g;
const URL_QUERY_RE = /(https?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/g;

export function redactPrivateIds(text: string): string {
  return text.replace(PRIVATE_ID_RE, 'p_$1…');
}

export function stripUrlQueries(text: string): string {
  return text.replace(URL_QUERY_RE, `$1?${REDACTED}`);
}

export function sanitizeText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join(REDACTED);
  }
  return redactPrivateIds(stripUrlQueries(out));
}

export interface SanitizedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: SanitizedError;
}

/** Converts any thrown value into a plain, secret-free object safe to log or store. */
export function sanitizeError(
  err: unknown,
  secrets: readonly string[] = [],
  depth = 0,
): SanitizedError {
  if (!(err instanceof Error)) {
    return { name: 'Error', message: sanitizeText(String(err), secrets) };
  }
  const out: SanitizedError = {
    name: err.name,
    message: sanitizeText(err.message, secrets),
  };
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') out.code = code;
  if (err.stack) out.stack = sanitizeText(err.stack, secrets);
  // fetch() failures hide the real reason in `cause`; keep one level of it.
  if (err.cause !== undefined && depth < 1)
    out.cause = sanitizeError(err.cause, secrets, depth + 1);
  return out;
}
