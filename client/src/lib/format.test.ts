import { describe, expect, it } from 'vitest';
import { compactNumber, shortSha, timeAgo } from './format';

describe('timeAgo', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it.each([
    [10, 'just now'],
    [60 * 5, '5 minutes ago'],
    [3600, '1 hour ago'],
    [86400 * 3, '3 days ago'],
    [86400 * 90, '3 months ago'],
    [86400 * 1256, '3 years ago'],
  ])('%i seconds -> %s', (seconds, expected) => {
    expect(timeAgo(ago(seconds), now)).toBe(expected);
  });
});

describe('formatting helpers', () => {
  it('shortens SHAs and numbers', () => {
    expect(shortSha('5317ebe1234567890')).toBe('5317ebe');
    expect(compactNumber(6234)).toBe('6.2K');
  });
});
