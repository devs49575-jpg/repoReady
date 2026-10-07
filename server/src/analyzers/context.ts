import type { RepoMeta } from '@repoready/shared';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { GitHubClient } from '../services/github';

/**
 * Root package.json. Repo content is untrusted, so every field is `unknown` and read through the
 * helpers below. (`Record<string, unknown>` instead of the plan's `Record<string, any>`.)
 */
export type PackageJson = Record<string, unknown>;

export interface AnalyzerContext {
  rootDir: string; // extracted repo root (temp dir)
  files: string[]; // relative POSIX paths of extracted files, sorted
  fileSet: Set<string>;
  meta: RepoMeta;
  pkg: PackageJson | null; // parsed root package.json or null
  readText(relPath: string): Promise<string | null>; // null if missing/unreadable
  github: GitHubClient; // never a raw token (Addendum 01, 5.3)
  signal?: AbortSignal;
}

export function makeReadText(rootDir: string): (relPath: string) => Promise<string | null> {
  const rootWithSep = resolve(rootDir) + sep;
  return async (relPath) => {
    const abs = resolve(rootDir, relPath);
    if (!abs.startsWith(rootWithSep)) return null;
    try {
      return await readFile(abs, 'utf8');
    } catch {
      return null;
    }
  };
}

export async function createContext(input: {
  rootDir: string;
  files: string[];
  meta: RepoMeta;
  github: GitHubClient;
  signal?: AbortSignal;
}): Promise<AnalyzerContext> {
  const readText = makeReadText(input.rootDir);
  const fileSet = new Set(input.files);
  let pkg: PackageJson | null = null;
  if (fileSet.has('package.json')) {
    const raw = await readText('package.json');
    pkg = raw ? parseJsonObject(raw) : null;
  }
  return { ...input, fileSet, pkg, readText };
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); // strip BOM
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Reads an object of string values (e.g. `scripts`, `dependencies`), dropping anything else. */
export function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  return out;
}

export function allDependencies(pkg: PackageJson | null): Record<string, string> {
  if (!pkg) return {};
  return { ...stringRecord(pkg.devDependencies), ...stringRecord(pkg.dependencies) };
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isRootFile(path: string): boolean {
  return !path.includes('/');
}

/** Paths whose segments include build output or vendored code. */
export function isIgnoredPath(path: string): boolean {
  return /(^|\/)(node_modules|dist|build|out|coverage|\.next|vendor)\//.test(path);
}

export function isTestPath(path: string): boolean {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)(__tests__|__mocks__|tests?|e2e|cypress)\//.test(path)
  );
}
