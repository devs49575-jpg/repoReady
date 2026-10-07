import type { AnalysisDto, Report } from '@repoready/shared';

export const sampleReport: Report = {
  meta: {
    isPrivate: false,
    owner: 'acme',
    repo: 'widget',
    fullName: 'acme/widget',
    description: 'A tiny widget server',
    htmlUrl: 'https://github.com/acme/widget',
    defaultBranch: 'main',
    commitSha: '5317ebe1234567890',
    stars: 1234,
    forks: 10,
    openIssues: 2,
    sizeKb: 100,
    pushedAt: '2026-10-01T00:00:00Z',
    license: 'MIT',
    languages: { JavaScript: 100 },
  },
  privacy: { visibility: 'public', expiresAt: null, externalLookups: true },
  stack: {
    ok: true,
    data: {
      languages: [{ name: 'JavaScript', percent: 100 }],
      technologies: [{ name: 'Express', category: 'framework', evidence: 'dependency: express' }],
      packageManager: 'npm',
      hasPackageJson: true,
      workspaces: [],
    },
  },
  howToRun: {
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
      readme: { exists: true, hasSetupSection: true, headings: ['Install'] },
      steps: [],
      stepItems: [
        {
          label: 'Clone the repository',
          command: 'git clone https://github.com/acme/widget.git && cd widget',
        },
        { label: 'Install dependencies', command: 'npm ci' },
      ],
    },
  },
  env: {
    ok: true,
    data: {
      exampleFile: '.env.example',
      variables: [
        { name: 'SECRET', usedIn: ['src/index.js'], documented: false, status: 'undocumented' },
        { name: 'DB_URL', usedIn: ['src/db.js'], documented: true, status: 'ok' },
      ],
      summary: { used: 2, documented: 1, undocumented: 1, unused: 0 },
    },
  },
  checklist: {
    ok: true,
    data: [
      { id: 'readme', label: 'README with real content', passed: true, hint: 'Add a README.' },
      { id: 'ci', label: 'Continuous integration', passed: false, hint: 'Add a CI workflow.' },
    ],
  },
  architecture: { ok: false, error: 'Not analyzed yet' },
  deps: { ok: false, error: 'Not analyzed yet' },
  people: { ok: false, error: 'Not analyzed yet' },
  score: {
    ok: true,
    data: {
      total: 64,
      label: 'Okay',
      breakdown: [
        { category: 'Setup', earned: 15, max: 25, reasons: ['No lockfile committed (-5)'] },
      ],
    },
  },
};

export function sampleAnalysis(overrides: Partial<AnalysisDto> = {}): AnalysisDto {
  return {
    id: '6ac40249fcf86d85661fe088',
    visibility: 'public',
    expiresAt: null,
    owner: 'acme',
    repo: 'widget',
    fullName: 'acme/widget',
    commitSha: '5317ebe1234567890',
    status: 'done',
    step: 'Done',
    progress: 100,
    error: null,
    report: sampleReport,
    scoreTotal: 64,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
