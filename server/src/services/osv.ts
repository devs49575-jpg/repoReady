import type { Severity } from '@repoready/shared';
import pLimit from 'p-limit';
import { fetchJson } from './http';

/** OSV.dev client (https://google.github.io/osv.dev/api/). Only package names and versions are sent. */
const OSV_API = 'https://api.osv.dev/v1';
export const OSV_LIMITS = { batchSize: 500, maxDetails: 150, concurrency: 8, timeoutMs: 15_000 };

export interface PackageVersion {
  name: string;
  version: string;
}

export interface OsvVulnDetail {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { events?: { introduced?: string; fixed?: string }[] }[];
  }[];
}

interface BatchResponse {
  results: { vulns?: { id: string }[] }[];
}

/** Returns, for each input package (same order), the ids of vulnerabilities affecting it. */
export async function queryBatch(
  packages: PackageVersion[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<string[][]> {
  const out: string[][] = [];
  for (let i = 0; i < packages.length; i += OSV_LIMITS.batchSize) {
    const chunk = packages.slice(i, i + OSV_LIMITS.batchSize);
    const res = await fetchJson<BatchResponse>(`${OSV_API}/querybatch`, {
      method: 'POST',
      body: {
        queries: chunk.map((p) => ({
          package: { name: p.name, ecosystem: 'npm' },
          version: p.version,
        })),
      },
      timeoutMs: OSV_LIMITS.timeoutMs,
      signal: options.signal,
      fetchImpl: options.fetchImpl,
    });
    // A package with no known vulnerabilities comes back as `{}`.
    for (let j = 0; j < chunk.length; j++) out.push((res.results[j]?.vulns ?? []).map((v) => v.id));
  }
  return out;
}

/** Fetches vulnerability details with bounded concurrency. Failed ids are simply missing. */
export async function getVulnDetails(
  ids: string[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Map<string, OsvVulnDetail>> {
  const limit = pLimit(OSV_LIMITS.concurrency);
  const details = new Map<string, OsvVulnDetail>();
  await Promise.all(
    ids.map((id) =>
      limit(async () => {
        if (options.signal?.aborted) return;
        try {
          const detail = await fetchJson<OsvVulnDetail>(
            `${OSV_API}/vulns/${encodeURIComponent(id)}`,
            {
              timeoutMs: OSV_LIMITS.timeoutMs,
              signal: options.signal,
              fetchImpl: options.fetchImpl,
            },
          );
          details.set(id, detail);
        } catch {
          // Detail missing: reported with unknown severity rather than dropped.
        }
      }),
    ),
  );
  return details;
}

export function osvSeverity(detail: OsvVulnDetail | undefined): Severity {
  switch (detail?.database_specific?.severity?.toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MODERATE':
    case 'MEDIUM':
      return 'medium';
    case 'LOW':
      return 'low';
    default:
      return 'unknown';
  }
}

/** First `fixed` version, preferring the affected entry for this exact package. */
export function osvFixedIn(detail: OsvVulnDetail | undefined, packageName: string): string | null {
  const affected = detail?.affected ?? [];
  const ordered = [
    ...affected.filter((a) => a.package?.name === packageName),
    ...affected.filter((a) => a.package?.name !== packageName),
  ];
  for (const a of ordered) {
    for (const range of a.ranges ?? []) {
      const fixed = range.events?.find((e) => e.fixed)?.fixed;
      if (fixed) return fixed;
    }
  }
  return null;
}
