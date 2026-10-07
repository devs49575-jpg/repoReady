import type { DepsInfo, Severity } from '@repoready/shared';
import semver from 'semver';
import { getLatestVersions } from '../services/npmRegistry';
import {
  OSV_LIMITS,
  type PackageVersion,
  getVulnDetails,
  osvFixedIn,
  osvSeverity,
  queryBatch,
} from '../services/osv';
import { AppError } from '../utils/errors';
import { type AnalyzerContext, parseJsonObject, stringRecord } from './context';

export const DEPS_LIMITS = { maxPackages: 1_500, budgetMs: 40_000 };
export const SKIPPED_MESSAGE = 'Skipped: external dependency lookups were disabled';
const NPM_REGISTRY_HOST = 'registry.npmjs.org';

export interface DepsOptions {
  /** Private mode (Addendum 01, 5.7): only public-registry packages leave the server. */
  privateMode?: boolean;
  skipExternalLookups?: boolean;
  budgetMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ResolvedPackages {
  packages: PackageVersion[]; // unique name@version pairs to check
  direct: Map<string, string>; // direct dependency -> resolved (or approximated) version
  lockfileUsed: boolean;
  approximate: boolean;
  skipped: number;
  notes: string[];
}

interface LockEntry {
  version?: unknown;
  resolved?: unknown;
  link?: unknown;
  dependencies?: unknown;
}

function isRegistryUrl(resolved: unknown): boolean {
  if (typeof resolved !== 'string') return false;
  try {
    return new URL(resolved).hostname === NPM_REGISTRY_HOST;
  } catch {
    return false;
  }
}

/** Package name from a lockfile `packages` key like `node_modules/a/node_modules/@s/b`. */
function nameFromLockKey(key: string): string | null {
  const idx = key.lastIndexOf('node_modules/');
  return idx === -1 ? null : key.slice(idx + 'node_modules/'.length) || null;
}

/** Resolves the versions to check (Section 8.7 step 1). Exported for tests. */
export async function resolvePackages(
  ctx: AnalyzerContext,
  privateMode = false,
): Promise<ResolvedPackages> {
  if (!ctx.pkg) throw new AppError('ANALYSIS_FAILED', 'No package.json found');
  const directRanges = {
    ...stringRecord(ctx.pkg.devDependencies),
    ...stringRecord(ctx.pkg.dependencies),
  };
  const notes: string[] = [];
  const seen = new Set<string>();
  const packages: PackageVersion[] = [];
  const direct = new Map<string, string>();
  let skipped = 0;

  const add = (name: string, version: string, entry: LockEntry) => {
    if (privateMode && !isRegistryUrl(entry.resolved)) {
      skipped++;
      return;
    }
    const key = `${name}@${version}`;
    if (seen.has(key)) return;
    seen.add(key);
    packages.push({ name, version });
  };

  const lockName = ['package-lock.json', 'npm-shrinkwrap.json'].find((f) => ctx.fileSet.has(f));
  const lock = lockName ? parseJsonObject((await ctx.readText(lockName)) ?? '') : null;

  if (lock && lock.packages && typeof lock.packages === 'object') {
    // lockfileVersion 2/3
    for (const [key, raw] of Object.entries(lock.packages as Record<string, LockEntry>)) {
      const name = nameFromLockKey(key);
      if (!name || !raw || typeof raw !== 'object') continue; // root ('') and workspace folders
      if (raw.link || typeof raw.version !== 'string') {
        if (privateMode) skipped++;
        continue;
      }
      add(name, raw.version, raw);
      if (key === `node_modules/${name}` && name in directRanges) direct.set(name, raw.version);
    }
  } else if (lock && lock.dependencies && typeof lock.dependencies === 'object') {
    // lockfileVersion 1: nested `dependencies` tree
    const walk = (deps: Record<string, LockEntry>, topLevel: boolean) => {
      for (const [name, entry] of Object.entries(deps)) {
        if (!entry || typeof entry.version !== 'string') continue;
        add(name, entry.version, entry);
        if (topLevel && name in directRanges) direct.set(name, entry.version);
        if (entry.dependencies && typeof entry.dependencies === 'object') {
          walk(entry.dependencies as Record<string, LockEntry>, false);
        }
      }
    };
    walk(lock.dependencies as Record<string, LockEntry>, true);
  }

  const lockfileUsed = packages.length > 0 || direct.size > 0 || (lock !== null && skipped > 0);
  if (!lockfileUsed) {
    // No npm lockfile: approximate each direct dependency by the lowest version its range allows.
    for (const [name, range] of Object.entries(directRanges)) {
      if (/^(workspace|file|link|git|github|npm|http|https):|\//.test(range)) continue;
      if (!semver.validRange(range)) continue;
      const min = semver.minVersion(range);
      if (!min) continue;
      direct.set(name, min.version);
      const key = `${name}@${min.version}`;
      if (!seen.has(key)) {
        seen.add(key);
        packages.push({ name, version: min.version });
      }
    }
    if (privateMode && packages.length > 0) {
      notes.push(
        "Package names were sent to public registries; enable 'skip dependency lookups' to prevent this",
      );
    }
  }

  if (packages.length > DEPS_LIMITS.maxPackages) {
    notes.push(
      `Only the first ${DEPS_LIMITS.maxPackages} of ${packages.length} packages were checked`,
    );
    packages.length = DEPS_LIMITS.maxPackages;
  }
  if (skipped > 0) {
    notes.push(
      `${skipped} package(s) not from registry.npmjs.org were not looked up (private mode)`,
    );
  }

  return { packages, direct, lockfileUsed, approximate: !lockfileUsed, skipped, notes };
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

function outdatedType(current: string, latest: string): 'major' | 'minor' | 'patch' | null {
  if (!semver.valid(current) || !semver.valid(latest) || !semver.lt(current, latest)) return null;
  const diff = semver.diff(current, latest);
  if (diff === 'major' || diff === 'premajor') return 'major';
  if (diff === 'minor' || diff === 'preminor') return 'minor';
  return 'patch';
}

export async function analyzeDeps(
  ctx: AnalyzerContext,
  options: DepsOptions = {},
): Promise<DepsInfo> {
  if (options.skipExternalLookups) throw new AppError('ANALYSIS_FAILED', SKIPPED_MESSAGE);

  const resolved = await resolvePackages(ctx, options.privateMode);
  const notes = [...resolved.notes];
  const budget = AbortSignal.timeout(options.budgetMs ?? DEPS_LIMITS.budgetMs);
  const signal = ctx.signal ? AbortSignal.any([budget, ctx.signal]) : budget;
  const io = { signal, fetchImpl: options.fetchImpl };

  // Only public-registry direct deps are checked for updates (private mode filter applies too).
  const checkable = new Set(resolved.packages.map((p) => p.name));
  const directNames = [...resolved.direct.keys()].filter((n) => checkable.has(n)).sort();

  const [vulnResult, latestResult] = await Promise.allSettled([
    (async () => {
      const idsPerPackage = await queryBatch(resolved.packages, io);
      const uniqueIds = [...new Set(idsPerPackage.flat())];
      if (uniqueIds.length > OSV_LIMITS.maxDetails) {
        notes.push(
          `Details were fetched for ${OSV_LIMITS.maxDetails} of ${uniqueIds.length} vulnerabilities; the rest show as unknown severity`,
        );
      }
      const details = await getVulnDetails(uniqueIds.slice(0, OSV_LIMITS.maxDetails), io);
      return { idsPerPackage, details };
    })(),
    getLatestVersions(directNames, io),
  ]);
  if (ctx.signal?.aborted) throw ctx.signal.reason;
  if (budget.aborted) {
    notes.push('Dependency checks hit the 40s time limit; results may be incomplete');
  }
  if (vulnResult.status === 'rejected') {
    // Without the batch query there are no vulnerability results at all; reporting zero would
    // overstate the score, so the section fails and the score notes it.
    throw new AppError(
      'ANALYSIS_FAILED',
      'Could not check vulnerabilities: OSV.dev did not respond',
    );
  }

  const { idsPerPackage, details } = vulnResult.value;
  const vulnerabilities: DepsInfo['vulnerabilities'] = [];
  const dedupe = new Set<string>();
  resolved.packages.forEach((pkg, i) => {
    for (const id of idsPerPackage[i] ?? []) {
      const key = `${id}\0${pkg.name}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      const detail = details.get(id);
      vulnerabilities.push({
        id,
        aliases: detail?.aliases ?? [],
        package: pkg.name,
        version: pkg.version,
        severity: osvSeverity(detail),
        summary: detail?.summary ?? detail?.details?.split('\n')[0]?.slice(0, 200) ?? '',
        fixedIn: osvFixedIn(detail, pkg.name),
        url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
      });
    }
  });
  vulnerabilities.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.package.localeCompare(b.package) ||
      a.id.localeCompare(b.id),
  );

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const v of vulnerabilities) counts[v.severity]++;

  const registry =
    latestResult.status === 'fulfilled'
      ? latestResult.value
      : { latest: new Map<string, string>(), reachable: false };
  if (!registry.reachable) {
    notes.push('Could not reach the npm registry, so outdated packages were not checked');
  }
  const latest = registry.latest;
  const outdated: DepsInfo['outdated'] = [];
  for (const name of directNames) {
    const current = resolved.direct.get(name)!;
    const newest = latest.get(name);
    const type = newest ? outdatedType(current, newest) : null;
    if (type) outdated.push({ name, current, latest: newest!, type });
  }
  const typeOrder = { major: 0, minor: 1, patch: 2 };
  outdated.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.name.localeCompare(b.name));

  return {
    lockfileUsed: resolved.lockfileUsed,
    approximate: resolved.approximate,
    totalPackages: resolved.packages.length,
    directPackages: resolved.direct.size,
    skippedPackages: resolved.skipped,
    vulnerabilities,
    outdated,
    counts,
    notes,
  };
}
