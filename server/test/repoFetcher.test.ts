import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS, fetchRepo, removeRepoDir, shouldExtract } from '../src/services/repoFetcher';
import { expectNoNewTempDirs, fakeGitHub, listFiles, tarballOf, tempDirs } from './helpers';

// A synthetic repo with everything the extraction filter must skip.
let srcDir: string;

beforeAll(() => {
  srcDir = mkdtempSync(join(tmpdir(), 'repoready-src-'));
  const write = (rel: string, content: string | Buffer) => {
    mkdirSync(join(srcDir, rel, '..'), { recursive: true });
    writeFileSync(join(srcDir, rel), content);
  };
  write('package.json', '{"name":"x"}');
  write('src/index.js', 'console.log(1)');
  write('node_modules/left-pad/index.js', 'module.exports = 1');
  write('dist/bundle.js', 'bundled');
  write('packages/a/build/out.js', 'built');
  write('logo.png', 'not really a png');
  write('fonts/a.woff2', 'font');
  write('big.txt', Buffer.alloc(LIMITS.maxFileBytes + 1, 'a'));
  write('package-lock.json', Buffer.alloc(LIMITS.maxFileBytes + 1, ' ')); // lockfiles may be bigger
});

afterAll(() => rmSync(srcDir, { recursive: true, force: true }));

describe('shouldExtract', () => {
  it.each([
    ['src/a.ts', 'File', 10, true],
    ['src/a.ts', 'SymbolicLink', 0, false],
    ['src/a.ts', 'Link', 0, false],
    ['a/node_modules/b.js', 'File', 10, false],
    ['.git/config', 'File', 10, false],
    ['vendor/x.js', 'File', 10, false],
    ['img/logo.PNG', 'File', 10, false],
    ['src/../../etc/passwd', 'File', 10, false],
    ['big.js', 'File', LIMITS.maxFileBytes + 1, false],
    ['yarn.lock', 'File', LIMITS.maxFileBytes + 1, true],
    ['yarn.lock', 'File', LIMITS.maxLockfileBytes + 1, false],
  ])('%s (%s, %d bytes) -> %s', (path, type, size, expected) => {
    expect(shouldExtract(path, type, size)).toBe(expected);
  });
});

describe('fetchRepo', () => {
  it('streams, filters and lists files, then cleans up', async () => {
    const github = fakeGitHub({ streamTarball: async () => tarballOf(srcDir) });
    const before = tempDirs();
    const repo = await fetchRepo(github, 'acme', 'widget', 'abc123');
    try {
      expect(repo.files).toEqual(['package-lock.json', 'package.json', 'src/index.js']);
      expect(listFiles(repo.rootDir)).toEqual(repo.files);
      expect(repo.truncated).toBe(false);
      if (process.platform !== 'win32') {
        expect(statSync(repo.rootDir).mode & 0o777).toBe(0o700);
      }
    } finally {
      await removeRepoDir(repo.rootDir);
    }
    expect(existsSync(repo.rootDir)).toBe(false);
    await expectNoNewTempDirs(before);
  });

  it('aborts with REPO_TOO_LARGE past the byte cap and leaves no temp dir', async () => {
    const original = LIMITS.maxDownloadBytes;
    LIMITS.maxDownloadBytes = 100;
    const before = tempDirs();
    try {
      const github = fakeGitHub({ streamTarball: async () => tarballOf(srcDir) });
      await expect(fetchRepo(github, 'acme', 'widget', 'abc123')).rejects.toMatchObject({
        code: 'REPO_TOO_LARGE',
      });
    } finally {
      LIMITS.maxDownloadBytes = original;
    }
    await expectNoNewTempDirs(before);
  });

  it('caps the number of files', async () => {
    const original = LIMITS.maxFiles;
    LIMITS.maxFiles = 1;
    try {
      const github = fakeGitHub({ streamTarball: async () => tarballOf(srcDir) });
      const repo = await fetchRepo(github, 'acme', 'widget', 'abc123');
      await removeRepoDir(repo.rootDir);
      expect(repo.files).toHaveLength(1);
      expect(repo.truncated).toBe(true);
    } finally {
      LIMITS.maxFiles = original;
    }
  });

  it('removes the temp dir when the download fails or is cancelled', async () => {
    const before = tempDirs();
    const failing = fakeGitHub({
      streamTarball: async () => {
        throw new Error('network down');
      },
    });
    await expect(fetchRepo(failing, 'acme', 'widget', 'abc123')).rejects.toThrow('network down');

    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const github = fakeGitHub({ streamTarball: async () => tarballOf(srcDir) });
    await expect(fetchRepo(github, 'acme', 'widget', 'abc123', controller.signal)).rejects.toThrow(
      'cancelled',
    );
    await expectNoNewTempDirs(before);
  });
});

// ---------------------------------------------------------------------------------------------
// Symlinks (regression: colinhacks/zod's root README.md links to packages/zod/README.md)
// ---------------------------------------------------------------------------------------------

/** Minimal ustar archive builder, so tests can include symlinks on any OS. */
function ustar(entries: { name: string; body?: string; link?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.body ?? '');
    const h = Buffer.alloc(512);
    const put = (s: string, off: number, len: number) => h.write(s, off, len, 'ascii');
    const octal = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0';
    put(`acme-widget-abc123/${e.name}`, 0, 100);
    put(octal(e.link ? 0o777 : 0o644, 8), 100, 8);
    put(octal(0, 8), 108, 8);
    put(octal(0, 8), 116, 8);
    put(octal(e.link ? 0 : body.length, 12), 124, 12);
    put(octal(0, 12), 136, 12);
    put('        ', 148, 8); // checksum placeholder
    put(e.link ? '2' : '0', 156, 1);
    if (e.link) put(e.link, 157, 100);
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    let sum = 0;
    for (const byte of h) sum += byte;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(h);
    if (!e.link && body.length) {
      blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

describe('fetchRepo symlinks', () => {
  it('copies in-repo file links, ignores escaping, absolute and directory links, never creates links', async () => {
    const archive = ustar([
      { name: 'packages/lib/README.md', body: '# Lib\n\n## Install\n' },
      { name: 'packages/lib/index.js', body: 'module.exports = 1;\n' },
      { name: 'README.md', link: 'packages/lib/README.md' },
      { name: 'escape.txt', link: '../../etc/passwd' },
      { name: 'abs.txt', link: '/etc/passwd' },
      { name: 'libdir', link: 'packages/lib' },
      { name: 'node_modules/x.js', link: '../packages/lib/index.js' },
    ]);
    const github = fakeGitHub({
      streamTarball: async () =>
        Readable.toWeb(Readable.from([archive])) as unknown as ReadableStream<Uint8Array>,
    });
    const before = tempDirs();
    const repo = await fetchRepo(github, 'acme', 'widget', 'abc123');
    try {
      expect(repo.files).toEqual(['README.md', 'packages/lib/README.md', 'packages/lib/index.js']);
      const readme = join(repo.rootDir, 'README.md');
      expect(lstatSync(readme).isSymbolicLink()).toBe(false);
      expect(readFileSync(readme, 'utf8')).toBe('# Lib\n\n## Install\n');
      for (const name of ['escape.txt', 'abs.txt', 'libdir', 'node_modules']) {
        expect(existsSync(join(repo.rootDir, name))).toBe(false);
      }
    } finally {
      await removeRepoDir(repo.rootDir);
    }
    await expectNoNewTempDirs(before);
  });
});
