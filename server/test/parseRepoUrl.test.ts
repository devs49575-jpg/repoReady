import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from '../src/utils/parseRepoUrl';

describe('parseRepoUrl', () => {
  it.each([
    'https://github.com/expressjs/express',
    'https://github.com/expressjs/express.git',
    'https://github.com/expressjs/express/',
    'https://github.com/expressjs/express/tree/master/lib',
    'http://www.github.com/expressjs/express',
    'github.com/expressjs/express',
    'expressjs/express',
    '  expressjs/express  ',
  ])('accepts %s', (input) => {
    expect(parseRepoUrl(input)).toEqual({ owner: 'expressjs', repo: 'express' });
  });

  it('keeps dots, dashes and underscores in names', () => {
    expect(parseRepoUrl('https://github.com/some-org/my_repo.js')).toEqual({
      owner: 'some-org',
      repo: 'my_repo.js',
    });
  });

  it.each([
    '',
    'express',
    'https://gitlab.com/owner/repo',
    'https://github.com.evil.com/owner/repo',
    'https://evil.com/github.com/owner/repo',
    'https://github.com/owner',
    'https://user:pass@github.com/owner/repo',
    'https://github.com:8080/owner/repo',
    'ftp://github.com/owner/repo',
    'owner/repo; rm -rf /',
    'owner/$(whoami)',
    'https://github.com/owner/re po',
    'https://github.com/owner/..',
    `owner/${'a'.repeat(400)}`,
  ])('rejects %s with INVALID_URL', (input) => {
    expect(() => parseRepoUrl(input)).toThrow(expect.objectContaining({ code: 'INVALID_URL' }));
  });
});
