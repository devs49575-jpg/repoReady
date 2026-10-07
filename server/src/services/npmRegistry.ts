import pLimit from 'p-limit';
import { HttpError, fetchJson } from './http';

const REGISTRY = 'https://registry.npmjs.org';
export const NPM_LIMITS = { maxPackages: 80, concurrency: 10, timeoutMs: 5_000 };

/** Registry path for a package name; scoped names keep the `@` and encode the slash. */
export function registryPath(name: string): string {
  return name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

/**
 * Latest published version for each name. Per-package failures are skipped silently, as the plan
 * specifies, but lookups that failed for transient reasons (timeout, network, 5xx) get one retry:
 * a cold connection once timed out every lookup and silently hid all outdated packages.
 * `reachable` is false when not a single lookup got an answer.
 */
export async function getLatestVersions(
  names: string[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<{ latest: Map<string, string>; reachable: boolean }> {
  const latest = new Map<string, string>();
  let answered = 0;

  const lookup = async (pending: string[]): Promise<string[]> => {
    const limit = pLimit(NPM_LIMITS.concurrency);
    const retry: string[] = [];
    await Promise.all(
      pending.map((name) =>
        limit(async () => {
          if (options.signal?.aborted) return;
          try {
            const res = await fetchJson<{ version?: unknown }>(
              `${REGISTRY}/${registryPath(name)}/latest`,
              {
                timeoutMs: NPM_LIMITS.timeoutMs,
                signal: options.signal,
                fetchImpl: options.fetchImpl,
              },
            );
            answered++;
            if (typeof res.version === 'string') latest.set(name, res.version);
          } catch (err) {
            if (err instanceof HttpError && err.status < 500)
              answered++; // e.g. 404 is an answer
            else retry.push(name);
          }
        }),
      ),
    );
    return retry;
  };

  const capped = names.slice(0, NPM_LIMITS.maxPackages);
  const failed = await lookup(capped);
  if (failed.length > 0 && !options.signal?.aborted) await lookup(failed);
  return { latest, reachable: capped.length === 0 || answered > 0 };
}
