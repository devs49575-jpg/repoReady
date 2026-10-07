/**
 * fetch() with a per-request timeout, combined with an outer AbortSignal (job cancel/budget).
 * Error messages never include the URL: query strings can carry credentials.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function fetchJson<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    timeoutMs: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<T> {
  const signals = [AbortSignal.timeout(options.timeoutMs)];
  if (options.signal) signals.push(options.signal);
  const res = await (options.fetchImpl ?? fetch)(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'RepoReady',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.any(signals),
  });
  if (!res.ok) throw new HttpError(`Request failed with status ${res.status}`, res.status);
  return (await res.json()) as T;
}
