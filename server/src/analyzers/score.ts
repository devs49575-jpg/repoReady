import type {
  ArchitectureInfo,
  ChecklistItem,
  DepsInfo,
  EnvInfo,
  HowToRun,
  ScoreInfo,
  SectionResult,
} from '@repoready/shared';

export interface ScoreInput {
  checklist: SectionResult<ChecklistItem[]>;
  howToRun: SectionResult<HowToRun>;
  env: SectionResult<EnvInfo>;
  deps: SectionResult<DepsInfo>;
  architecture: SectionResult<ArchitectureInfo>;
}

type Category = ScoreInfo['breakdown'][number];

function category(
  name: string,
  max: number,
): Category & { award(points: number, ok: boolean, missing: string): void } {
  const cat = {
    category: name,
    earned: 0,
    max,
    reasons: [] as string[],
    award(points: number, ok: boolean, missing: string) {
      if (ok) cat.earned += points;
      else cat.reasons.push(`${missing} (-${points})`);
    },
  };
  return cat;
}

export function scoreLabel(total: number): ScoreInfo['label'] {
  if (total >= 90) return 'Excellent';
  if (total >= 75) return 'Good';
  if (total >= 50) return 'Okay';
  return 'Needs work';
}

/** Readiness score out of 100 (Section 8.9). Every deduction adds a human-readable reason. */
export function computeScore(input: ScoreInput): ScoreInfo {
  const items = input.checklist.ok ? input.checklist.data : [];
  const passed = (id: string) => items.some((i) => i.id === id && i.passed);
  const howToRun = input.howToRun.ok ? input.howToRun.data : null;
  const env = input.env.ok ? input.env.data : null;

  const docs = category('Documentation', 15);
  if (!input.checklist.ok) docs.reasons.push('Checklist could not be evaluated');
  docs.award(5, howToRun?.readme.exists ?? false, 'No README');
  docs.award(5, howToRun?.readme.hasSetupSection ?? false, 'README has no setup section');
  docs.award(2, passed('license'), 'No LICENSE');
  docs.award(3, passed('contributing'), 'No CONTRIBUTING guide');

  const setup = category('Setup', 25);
  setup.award(5, passed('lockfile'), 'No lockfile committed');
  setup.award(5, passed('node_version_pinned'), 'Node version not pinned');
  setup.award(
    5,
    Boolean(howToRun?.scripts.dev ?? howToRun?.scripts.start),
    'No dev or start script',
  );
  setup.award(5, passed('env_example'), 'Env vars used but no .env.example');
  setup.award(
    5,
    env !== null && env.summary.undocumented === 0,
    env
      ? `${env.summary.undocumented} env var(s) used but not documented`
      : 'Environment variables could not be scanned',
  );

  const quality = category('Quality', 25);
  quality.award(8, passed('ci'), 'No CI workflow');
  quality.award(8, passed('tests'), 'No tests found');
  quality.award(4, passed('linter'), 'No linter configured');
  quality.award(3, passed('typescript'), 'Not using TypeScript');
  quality.award(2, passed('formatter'), 'No formatter configured');

  const breakdown: Category[] = [
    docs,
    setup,
    quality,
    scoreDeps(input.deps),
    scoreArchitecture(input.architecture),
  ];
  const total = Math.max(
    0,
    Math.min(
      100,
      breakdown.reduce((sum, c) => sum + c.earned, 0),
    ),
  );
  return {
    total,
    label: scoreLabel(total),
    breakdown: breakdown.map(({ category, earned, max, reasons }) => ({
      category,
      earned,
      max,
      reasons,
    })),
  };
}

function scoreDeps(deps: SectionResult<DepsInfo>): Category {
  const max = 20;
  if (!deps.ok) {
    return {
      category: 'Dependencies',
      earned: 10,
      max,
      reasons: [`${deps.error} (10 of 20 awarded)`],
    };
  }
  const reasons: string[] = [];
  let earned = max;
  const { counts, outdated, directPackages } = deps.data;
  const severe = counts.critical + counts.high;
  if (severe > 0) {
    const penalty = Math.min(12, severe * 5);
    earned -= penalty;
    reasons.push(`${severe} critical/high vulnerabilit${severe === 1 ? 'y' : 'ies'} (-${penalty})`);
  }
  const minor = counts.medium + counts.low;
  if (minor > 0) {
    const penalty = Math.min(4, minor);
    earned -= penalty;
    reasons.push(`${minor} medium/low vulnerabilit${minor === 1 ? 'y' : 'ies'} (-${penalty})`);
  }
  const majors = outdated.filter((o) => o.type === 'major').length;
  const ratio = directPackages > 0 ? majors / directPackages : 0;
  if (ratio > 0.5) {
    earned -= 4;
    reasons.push(
      `${Math.round(ratio * 100)}% of direct dependencies are a major version behind (-4)`,
    );
  } else if (ratio > 0.25) {
    earned -= 2;
    reasons.push(
      `${Math.round(ratio * 100)}% of direct dependencies are a major version behind (-2)`,
    );
  }
  return { category: 'Dependencies', earned: Math.max(0, earned), max, reasons };
}

function scoreArchitecture(arch: SectionResult<ArchitectureInfo>): Category {
  const max = 15;
  if (!arch.ok) {
    return {
      category: 'Architecture',
      earned: 7,
      max,
      reasons: [`${arch.error} (7 of 15 awarded)`],
    };
  }
  const reasons: string[] = [];
  let earned = max;
  const cycles = arch.data.circular.length;
  if (cycles > 0) {
    const penalty = Math.min(9, cycles * 3);
    earned -= penalty;
    reasons.push(`${cycles} circular dependenc${cycles === 1 ? 'y' : 'ies'} (-${penalty})`);
  }
  const ratio =
    arch.data.analyzedFiles > 0 ? arch.data.orphans.length / arch.data.analyzedFiles : 0;
  if (ratio > 0.2) {
    earned -= 3;
    reasons.push(`${Math.round(ratio * 100)}% of files are not imported anywhere (-3)`);
  }
  return { category: 'Architecture', earned: Math.max(0, earned), max, reasons };
}
