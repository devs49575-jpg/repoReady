import { describe, expect, it } from 'vitest';
import { getPrivacy, isPrivateId } from './privacy';

describe('isPrivateId', () => {
  it('detects the p_ prefix', () => {
    expect(isPrivateId('p_V1StGXR8_Z5jdHi6B-myTV1StGXR8_Z5')).toBe(true);
    expect(isPrivateId('652f1c0a9b1e8a0012345678')).toBe(false);
  });
});

describe('getPrivacy', () => {
  it('treats reports without privacy info as public', () => {
    expect(getPrivacy({})).toEqual({
      visibility: 'public',
      expiresAt: null,
      externalLookups: true,
    });
    expect(getPrivacy(null)).toEqual({
      visibility: 'public',
      expiresAt: null,
      externalLookups: true,
    });
  });

  it('returns stored privacy info when present', () => {
    const privacy = {
      visibility: 'private' as const,
      expiresAt: '2026-10-06T12:00:00.000Z',
      externalLookups: false,
    };
    expect(getPrivacy({ privacy })).toBe(privacy);
  });
});
