import { type RepoRef, parseRepoInput } from '@repoready/shared';
import { AppError } from './errors';

export type { RepoRef };

/**
 * Validates a user-supplied repo URL (rules live in @repoready/shared so the client matches).
 * The result is only ever used in encoded GitHub API URLs, never in a shell.
 */
export function parseRepoUrl(input: string): RepoRef {
  const ref = parseRepoInput(input);
  if (!ref) {
    throw new AppError(
      'INVALID_URL',
      'Enter a GitHub repository URL like https://github.com/owner/repo or owner/repo',
    );
  }
  return ref;
}
