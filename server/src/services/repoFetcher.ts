import { rmSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { x as extract } from 'tar';
import { AppError } from '../utils/errors';
import type { GitHubClient } from './github';

export const TEMP_ROOT = join(tmpdir(), 'repoready');
const MAX_SYMLINKS = 200;

export const LIMITS = {
  maxFiles: 20_000,
  maxDownloadBytes: 150 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxLockfileBytes: 10 * 1024 * 1024,
};

const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'vendor',
]);

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
]);

const SKIPPED_EXTENSIONS = new Set(
  (
    'png jpg jpeg gif bmp ico webp avif tif tiff psd svg heic ' + // images
    'woff woff2 ttf otf eot ' + // fonts
    'mp3 mp4 m4a wav ogg oga webm mov avi mkv flac aac ' + // media
    'zip tar gz tgz rar 7z bz2 xz zst jar war ' + // archives
    'exe dll so dylib bin wasm pdf map class o a node pyc'
  ).split(' '),
);

const REGULAR_FILE_TYPES = new Set(['File', 'OldFile', 'ContiguousFile']);

export interface FetchedRepo {
  rootDir: string;
  files: string[]; // relative POSIX paths
  truncated: boolean; // true if the file cap was hit
}

// Temp dirs of analyses in progress, so a SIGINT/SIGTERM can still delete them.
const activeDirs = new Set<string>();

/** Synchronously deletes every in-progress temp dir. Called from signal handlers. */
export function cleanupActiveDirsSync(): void {
  for (const dir of activeDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort during shutdown
    }
  }
  activeDirs.clear();
}

/** Boot-time sweep: deletes temp folders left behind by a crash. Safe on a single instance. */
export async function sweepTempRoot(): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(TEMP_ROOT);
  } catch {
    return 0;
  }
  await Promise.all(
    entries.map((name) => rm(join(TEMP_ROOT, name), { recursive: true, force: true })),
  );
  return entries.length;
}

/** Decides whether an archive entry (path already stripped of the top folder) is extracted. */
export function shouldExtract(relPath: string, type: string, size: number): boolean {
  if (!REGULAR_FILE_TYPES.has(type)) return false; // no symlinks, hardlinks, devices; dirs are implicit
  const parts = relPath.split('/');
  if (parts.some((p) => SKIPPED_DIRS.has(p) || p === '..')) return false;
  const base = parts[parts.length - 1] ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (ext && SKIPPED_EXTENSIONS.has(ext)) return false;
  const maxBytes = LOCKFILES.has(base) ? LIMITS.maxLockfileBytes : LIMITS.maxFileBytes;
  return size <= maxBytes;
}

function stripTopFolder(entryPath: string): string {
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const slash = normalized.indexOf('/');
  return slash === -1 ? '' : normalized.slice(slash + 1);
}

/**
 * Downloads the repo tarball and extracts it into a fresh owner-only temp dir.
 * The caller MUST call `removeRepoDir(rootDir)` in a finally block.
 */
export async function fetchRepo(
  github: GitHubClient,
  owner: string,
  repo: string,
  sha: string,
  signal?: AbortSignal,
): Promise<FetchedRepo> {
  await mkdir(TEMP_ROOT, { recursive: true, mode: 0o700 });
  const rootDir = await mkdtemp(join(TEMP_ROOT, 'job-'));
  activeDirs.add(rootDir);
  await chmod(rootDir, 0o700);

  const files: string[] = [];
  const symlinks: { rel: string; linkpath: string }[] = [];
  let truncated = false;

  try {
    signal?.throwIfAborted(); // cancelled while the temp dir was being created
    const body = await github.streamTarball(owner, repo, sha, signal);

    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        bytes += chunk.length;
        if (bytes > LIMITS.maxDownloadBytes) {
          done(
            new AppError('REPO_TOO_LARGE', 'The repository download exceeded the 150 MB limit.'),
          );
          return;
        }
        done(null, chunk);
      },
    });

    const rootWithSep = resolve(rootDir) + sep;
    const extractor = extract({
      cwd: rootDir,
      strip: 1,
      gzip: true,
      filter: (entryPath, entry) => {
        const rel = stripTopFolder(entryPath);
        if (!rel) return false;
        const type = 'type' in entry ? entry.type : 'File';
        // Symlinks are never extracted, but remembered: see materializeSymlinks().
        if (type === 'SymbolicLink' && 'linkpath' in entry && typeof entry.linkpath === 'string') {
          if (symlinks.length < MAX_SYMLINKS) symlinks.push({ rel, linkpath: entry.linkpath });
          return false;
        }
        if (!shouldExtract(rel, type, entry.size ?? 0)) return false;
        // Belt and braces on top of tar's own traversal protection.
        if (!resolve(rootDir, rel).startsWith(rootWithSep)) return false;
        if (files.length >= LIMITS.maxFiles) {
          truncated = true;
          return false;
        }
        files.push(rel);
        return true;
      },
    });

    await pipeline(
      Readable.fromWeb(body as WebReadableStream<Uint8Array>),
      counter,
      extractor,
      signal ? { signal } : {},
    );
    truncated = (await materializeSymlinks(rootDir, files, symlinks)) || truncated;
  } catch (err) {
    await removeRepoDir(rootDir);
    if (signal?.aborted) throw signal.reason ?? err;
    throw err;
  }

  files.sort();
  return { rootDir, files, truncated };
}

/**
 * Monorepos often symlink root files (e.g. README.md -> packages/x/README.md). Symlinks are never
 * created on disk; instead, a link to a regular file *inside the repo* that was extracted gets a
 * plain copy of that file's content. Links that are absolute, escape the repo, point at
 * directories or other links, or name a skipped path are ignored. Returns true if the file cap
 * was hit.
 */
async function materializeSymlinks(
  rootDir: string,
  files: string[],
  symlinks: { rel: string; linkpath: string }[],
): Promise<boolean> {
  const rootWithSep = resolve(rootDir) + sep;
  const extracted = new Set(files);
  for (const { rel, linkpath } of symlinks) {
    if (files.length >= LIMITS.maxFiles) return true;
    if (posix.isAbsolute(linkpath) || /^[A-Za-z]:/.test(linkpath)) continue;
    const target = posix.normalize(posix.join(posix.dirname(rel), linkpath));
    if (
      target === '..' ||
      target.startsWith('../') ||
      !extracted.has(target) ||
      extracted.has(rel)
    ) {
      continue;
    }
    if (!shouldExtract(rel, 'File', 0)) continue;
    const from = resolve(rootDir, target);
    const to = resolve(rootDir, rel);
    if (!from.startsWith(rootWithSep) || !to.startsWith(rootWithSep)) continue;
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    files.push(rel);
    extracted.add(rel);
  }
  return false;
}

export async function removeRepoDir(rootDir: string): Promise<void> {
  activeDirs.delete(rootDir);
  await rm(rootDir, { recursive: true, force: true, maxRetries: 3 });
}
