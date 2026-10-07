import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  redactPrivateIds,
  sanitizeError,
  sanitizeText,
  stripUrlQueries,
} from '../src/utils/sanitize';

const TOKEN = 'github_pat_TESTSECRET0123456789';
const PRIVATE_ID = 'p_V1StGXR8_Z5jdHi6B-myTV1StGXR8_Z5';

describe('sanitizeText', () => {
  it('replaces every occurrence of a secret', () => {
    const out = sanitizeText(`bad token ${TOKEN} (again: ${TOKEN})`, [TOKEN]);
    expect(out).not.toContain(TOKEN);
    expect(out).toBe(`bad token ${REDACTED} (again: ${REDACTED})`);
  });

  it('ignores very short secrets instead of mangling text', () => {
    expect(sanitizeText('a cat', ['a'])).toBe('a cat');
  });
});

describe('stripUrlQueries', () => {
  it('drops query strings, which may carry short-lived credentials', () => {
    const url = 'https://codeload.github.com/o/r/legacy.tar.gz/abc?token=SHORTLIVED123';
    expect(stripUrlQueries(`GET ${url} failed`)).toBe(
      `GET https://codeload.github.com/o/r/legacy.tar.gz/abc?${REDACTED} failed`,
    );
  });

  it('leaves URLs without queries alone', () => {
    expect(stripUrlQueries('see https://api.github.com/repos/o/r')).toBe(
      'see https://api.github.com/repos/o/r',
    );
  });
});

describe('redactPrivateIds', () => {
  it('keeps only the first 4 characters of a private id', () => {
    expect(redactPrivateIds(`/api/analyses/${PRIVATE_ID}/markdown`)).toBe(
      '/api/analyses/p_V1St…/markdown',
    );
  });

  it('does not touch strings that merely start with p_', () => {
    expect(redactPrivateIds('p_short and help_me')).toBe('p_short and help_me');
  });
});

describe('sanitizeError', () => {
  it('scrubs message, stack and cause', () => {
    const cause = new Error(`connect failed for ${TOKEN}`);
    const err = new Error(`GitHub said no to ${TOKEN}`, { cause });
    const out = sanitizeError(err, [TOKEN]);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(out.message).toBe(`GitHub said no to ${REDACTED}`);
    expect(out.cause?.message).toBe(`connect failed for ${REDACTED}`);
  });

  it('handles non-Error values', () => {
    expect(sanitizeError(`raw ${TOKEN}`, [TOKEN])).toEqual({
      name: 'Error',
      message: `raw ${REDACTED}`,
    });
  });

  it('keeps string error codes', () => {
    const err = Object.assign(new Error('nope'), { code: 'ECONNRESET' });
    expect(sanitizeError(err).code).toBe('ECONNRESET');
  });
});
