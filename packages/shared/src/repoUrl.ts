export interface RepoRef {
  owner: string;
  repo: string;
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const SHORTHAND_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_INPUT_LENGTH = 300;

/**
 * Parses https://github.com/owner/repo (optionally with .git, a trailing slash or a /tree/...
 * suffix), github.com/owner/repo, and owner/repo. Only github.com is allowed.
 * Returns null for anything else. Shared so the client validates exactly like the server.
 */
export function parseRepoInput(input: string): RepoRef | null {
  const raw = input.trim();
  if (!raw || raw.length > MAX_INPUT_LENGTH) return null;

  let path: string;
  if (SHORTHAND_RE.test(raw)) {
    path = raw;
  } else {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (host !== 'github.com' && host !== 'www.github.com') ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }
    path = url.pathname;
  }

  const [owner, rawRepo] = path.split('/').filter(Boolean);
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/i, '');
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo };
}
