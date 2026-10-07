import type { ChecklistItem, DepsInfo, EnvInfo, HowToRun, SectionResult } from '@repoready/shared';
import { describe, expect, it } from 'vitest';
import { computeScore, scoreLabel } from '../src/analyzers/score';

const ALL_IDS = [
  'readme',
  'readme_setup',
  'license',
  'contributing',
  'gitignore',
  'env_example',
  'lockfile',
  'node_version_pinned',
  'ci',
  'tests',
  'linter',
  'formatter',
  'typescript',
  'dockerfile',
];

function checklist(failing: string[] = []): SectionResult<ChecklistItem[]> {
  return {
    ok: true,
    data: ALL_IDS.map((id) => ({ id, label: id, passed: !failing.includes(id), hint: '' })),
  };
}

function howToRun(overrides: Partial<HowToRun> = {}): SectionResult<HowToRun> {
  return {
    ok: true,
    data: {
      nodeVersion: { value: '20', source: '.nvmrc' },
      scripts: {
        install: 'npm ci',
        dev: 'npm run dev',
        start: null,
        build: null,
        test: null,
        lint: null,
      },
      docker: { dockerfile: false, compose: false },
      readme: { exists: true, hasSetupSection: true, headings: [] },
      steps: [],
      stepItems: [],
      ...overrides,
    },
  };
}

function env(undocumented = 0): SectionResult<EnvInfo> {
  return {
    ok: true,
    data: {
      exampleFile: '.env.example',
      variables: [],
      summary: { used: 3, documented: 3 - undocumented, undocumented, unused: 0 },
    },
  };
}

function deps(partial: Partial<DepsInfo> = {}): SectionResult<DepsInfo> {
  return {
    ok: true,
    data: {
      lockfileUsed: true,
      approximate: false,
      totalPackages: 10,
      directPackages: 4,
      skippedPackages: 0,
      vulnerabilities: [],
      outdated: [],
      counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      notes: [],
      ...partial,
    },
  };
}

const archOk = {
  ok: true as const,
  data: {
    level: 'file' as const,
    analyzedFiles: 10,
    nodes: [],
    edges: [],
    circular: [],
    orphans: [],
    truncated: false,
  },
};

describe('computeScore', () => {
  it('gives 100 to a perfect repo', () => {
    const score = computeScore({
      checklist: checklist(),
      howToRun: howToRun(),
      env: env(),
      deps: deps(),
      architecture: archOk,
    });
    expect(score.total).toBe(100);
    expect(score.label).toBe('Excellent');
    expect(score.breakdown.map((c) => [c.category, c.earned, c.max])).toEqual([
      ['Documentation', 15, 15],
      ['Setup', 25, 25],
      ['Quality', 25, 25],
      ['Dependencies', 20, 20],
      ['Architecture', 15, 15],
    ]);
    expect(score.breakdown.every((c) => c.reasons.length === 0)).toBe(true);
  });

  it('awards 10 and 7 with a note when deps and architecture were not analyzed', () => {
    const notYet = { ok: false as const, error: 'Not analyzed yet' };
    const score = computeScore({
      checklist: checklist(),
      howToRun: howToRun(),
      env: env(),
      deps: notYet,
      architecture: notYet,
    });
    expect(score.total).toBe(82);
    expect(score.breakdown[3]!.reasons[0]).toMatch(/not analyzed/i);
    expect(score.breakdown[4]!.reasons[0]).toMatch(/not analyzed/i);
  });

  it('applies every documented deduction with a reason', () => {
    const score = computeScore({
      checklist: checklist(['license', 'ci', 'formatter', 'lockfile']),
      howToRun: howToRun({
        scripts: { install: null, dev: null, start: null, build: null, test: null, lint: null },
      }),
      env: env(2),
      deps: deps({
        counts: { critical: 1, high: 2, medium: 3, low: 4, unknown: 0 },
        outdated: [
          { name: 'a', current: '1.0.0', latest: '3.0.0', type: 'major' },
          { name: 'b', current: '1.0.0', latest: '2.0.0', type: 'major' },
          { name: 'c', current: '1.0.0', latest: '4.0.0', type: 'major' },
        ],
      }),
      architecture: {
        ok: true,
        data: {
          ...archOk.data,
          circular: [
            ['a', 'b'],
            ['c', 'd'],
            ['e', 'f'],
            ['g', 'h'],
          ],
          orphans: ['x', 'y', 'z'],
        },
      },
    });
    const byCat = Object.fromEntries(score.breakdown.map((c) => [c.category, c]));
    expect(byCat.Documentation!.earned).toBe(13); // -2 license
    expect(byCat.Setup!.earned).toBe(10); // -5 lockfile, -5 no dev/start, -5 undocumented vars
    expect(byCat.Quality!.earned).toBe(15); // -8 CI, -2 formatter
    expect(byCat.Dependencies!.earned).toBe(0); // -12 severe (capped), -4 minor (capped), -4 majors (75%)
    expect(byCat.Architecture!.earned).toBe(3); // -9 cycles (capped), -3 orphans (30%)
    expect(score.total).toBe(41);
    expect(score.label).toBe('Needs work');
    for (const cat of score.breakdown) {
      if (cat.earned < cat.max) expect(cat.reasons.length).toBeGreaterThan(0);
    }
    expect(byCat.Setup!.reasons).toContain('2 env var(s) used but not documented (-5)');
  });

  it('labels by threshold', () => {
    expect([0, 49, 50, 74, 75, 89, 90, 100].map(scoreLabel)).toEqual([
      'Needs work',
      'Needs work',
      'Okay',
      'Okay',
      'Good',
      'Good',
      'Excellent',
      'Excellent',
    ]);
  });
});
