import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';

const valid = {
  MONGODB_URI: 'mongodb://localhost:27017/repoready',
  GITHUB_TOKEN: 'ghp_test',
};

describe('parseConfig', () => {
  it('applies defaults', () => {
    const config = parseConfig(valid);
    expect(config.PORT).toBe(4000);
    expect(config.MAX_REPO_SIZE_KB).toBe(100_000);
    expect(config.CLIENT_ORIGIN).toBe('http://localhost:5173');
  });

  it('coerces numeric strings', () => {
    expect(parseConfig({ ...valid, PORT: '5000' }).PORT).toBe(5000);
  });

  it('fails fast with a clear message when required vars are missing', () => {
    expect(() => parseConfig({})).toThrow(/MONGODB_URI is required[\s\S]*GITHUB_TOKEN is required/);
  });

  it('defaults private mode on with a 60 minute TTL and a cap of 50', () => {
    const config = parseConfig(valid);
    expect(config.PRIVATE_MODE_ENABLED).toBe(true);
    expect(config.PRIVATE_REPORT_TTL_MINUTES).toBe(60);
    expect(config.MAX_PRIVATE_REPORTS).toBe(50);
    expect(parseConfig({ ...valid, PRIVATE_MODE_ENABLED: 'false' }).PRIVATE_MODE_ENABLED).toBe(
      false,
    );
    expect(() => parseConfig({ ...valid, PRIVATE_MODE_ENABLED: 'maybe' })).toThrow(
      /PRIVATE_MODE_ENABLED/,
    );
  });

  it('rejects a non-mongo URI', () => {
    expect(() => parseConfig({ ...valid, MONGODB_URI: 'http://x' })).toThrow(/mongodb/);
  });
});
