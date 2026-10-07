import { describe, expect, it } from 'vitest';
import { analyzeDeps } from '../../src/analyzers/deps';
import { fixtureContext } from '../helpers';

// Hits the real OSV.dev and npm registry. Opt-in so CI and offline runs stay deterministic:
//   LIVE_TESTS=1 npx vitest run test/live
describe.skipIf(!process.env.LIVE_TESTS)('deps analyzer against the real APIs', () => {
  it('finds known vulnerabilities in lodash@4.17.15 (vulnerable-deps fixture)', async () => {
    const deps = await analyzeDeps(await fixtureContext('vulnerable-deps'));
    expect(deps.vulnerabilities.length).toBeGreaterThan(0);
    expect(deps.vulnerabilities.every((v) => v.package === 'lodash')).toBe(true);
    expect(deps.counts.high + deps.counts.critical).toBeGreaterThan(0);
    // The registry lookup has a 5s timeout and is skipped silently if it misses (Section 8.7),
    // which happened once on a cold connection; only check the result when it arrived.
    if (deps.outdated.length) {
      expect(deps.outdated[0]).toMatchObject({ name: 'lodash', current: '4.17.15' });
    }
    console.log(
      `live: ${deps.vulnerabilities.length} vulns`,
      JSON.stringify(deps.counts),
      deps.vulnerabilities.map((v) => `${v.id}:${v.severity}:fixed ${v.fixedIn}`).join(', '),
      `| latest lodash ${deps.outdated[0]?.latest}`,
    );
  }, 60_000);
});
