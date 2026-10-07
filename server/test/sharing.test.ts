import type { AnalysisDto, Report } from '@repoready/shared';
import { existsSync, readdirSync } from 'node:fs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createLogger } from '../src/logger';
import { JobQueue } from '../src/queue/jobQueue';
import { badgeColor, buildBadgeSvg } from '../src/services/badge';
import type { GitHubClient } from '../src/services/github';
import { buildMarkdown, mdCode } from '../src/services/markdown';
import { TEMP_ROOT } from '../src/services/repoFetcher';
import { MemoryAnalysisStore } from '../src/stores/memoryStore';
import {
  TestStore,
  fakeGitHub,
  fixtureDir,
  makeMeta,
  mockExternalApis,
  tarballOf,
  waitFor,
} from './helpers';

const report: Report = {
  meta: makeMeta({ description: 'Has <script>alert(1)</script> and a | pipe' }),
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
      readme: { exists: true, hasSetupSection: true, headings: [] },
      steps: [],
      stepItems: [
        { label: 'Use Node 20 (from .nvmrc)', command: 'nvm use' },
        { label: 'Install dependencies', command: 'npm ci' },
      ],
    },
  },
  env: {
    ok: true,
    data: {
      exampleFile: '.env.example',
      variables: [
        { name: 'SECRET', usedIn: ['src/a|b.js'], documented: false, status: 'undocumented' },
      ],
      summary: { used: 1, documented: 0, undocumented: 1, unused: 0 },
    },
  },
  checklist: {
    ok: true,
    data: [
      { id: 'readme', label: 'README with real content', passed: true, hint: 'x' },
      { id: 'ci', label: 'Continuous integration', passed: false, hint: 'Add a CI workflow.' },
    ],
  },
  architecture: { ok: false, error: 'Architecture analysis timed out' },
  deps: {
    ok: true,
    data: {
      lockfileUsed: true,
      approximate: false,
      totalPackages: 3,
      directPackages: 1,
      skippedPackages: 0,
      vulnerabilities: [
        {
          id: 'GHSA-xxxx',
          aliases: [],
          package: 'lodash',
          version: '4.17.15',
          severity: 'high',
          summary: 'Prototype Pollution',
          fixedIn: '4.17.19',
          url: 'https://osv.dev/vulnerability/GHSA-xxxx',
        },
      ],
      outdated: [{ name: 'lodash', current: '4.17.15', latest: '5.0.0', type: 'major' }],
      counts: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
      notes: [],
    },
  },
  people: {
    ok: true,
    data: {
      contributors: [{ login: 'ann', avatarUrl: '', commits: 4 }],
      byFolder: [],
      lastCommitAt: null,
    },
  },
  score: {
    ok: true,
    data: {
      total: 82,
      label: 'Good',
      breakdown: [
        { category: 'Setup', earned: 20, max: 25, reasons: ['No lockfile committed (-5)'] },
      ],
    },
  },
};

describe('buildMarkdown', () => {
  const md = buildMarkdown(report, new Date('2026-10-07T00:00:00Z'));

  it('has the title and every section in order', () => {
    expect(md.startsWith('# acme/widget onboarding briefing\n')).toBe(true);
    const order = [
      'Score',
      'How to run',
      'Environment variables',
      'Stack',
      'Checklist',
      'Dependencies',
      'Architecture',
      'Who to ask',
    ];
    const positions = order.map((h) => md.indexOf(`\n## ${h}\n`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('renders score, steps, env table, checklist and dependencies', () => {
    expect(md).toContain('**82/100 (Good)**');
    expect(md).toContain('2. Install dependencies\n\n   ```bash\n   npm ci\n   ```');
    expect(md).toContain('| `SECRET` | undocumented | src/a\\|b.js |');
    expect(md).toContain('- [x] README with real content');
    expect(md).toContain('- [ ] Continuous integration: Add a CI workflow.');
    expect(md).toContain(
      '[GHSA-xxxx](https://osv.dev/vulnerability/GHSA-xxxx) Prototype Pollution',
    );
    expect(md).toContain('Major updates available: `lodash` 4.17.15 → 5.0.0');
    expect(md).toContain('Top contributors: @ann (4)');
  });

  it('notes failed sections instead of skipping silently', () => {
    expect(md).toContain('## Architecture\n\n_Not available: Architecture analysis timed out_');
  });

  it('escapes HTML from repo-controlled text', () => {
    expect(md).not.toContain('<script>');
    expect(md).toContain('&lt;script>alert(1)&lt;/script>');
    expect(md).toContain('Use Node 20 (from .nvmrc)'); // ordinary text is left readable
  });

  it('marks private briefings', () => {
    const priv = buildMarkdown({
      ...report,
      privacy: { visibility: 'private', expiresAt: '2026-10-07T01:00:00Z', externalLookups: true },
    });
    expect(priv).toContain('_Private repository: share this briefing only');
  });

  it('builds inline code that survives backticks', () => {
    expect(mdCode('a`b')).toBe('``a`b``');
    expect(mdCode('`x`')).toBe('`` `x` ``');
  });
});

describe('buildBadgeSvg', () => {
  it('colours by score band', () => {
    expect([null, 10, 49, 50, 74, 75, 89, 90, 100].map(badgeColor)).toEqual([
      '#9f9f9f',
      '#e05d44',
      '#e05d44',
      '#dfb317',
      '#dfb317',
      '#4c1',
      '#4c1',
      '#2cbe4e',
      '#2cbe4e',
    ]);
  });

  it('renders the score or "not analyzed" as accessible SVG', () => {
    const svg = buildBadgeSvg(82);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('aria-label="RepoReady: 82/100"');
    expect(buildBadgeSvg(null)).toContain('not analyzed');
  });
});

// ---------------------------------------------------------------------------------------------
// API: caching, recent, markdown, badge, rate limits
// ---------------------------------------------------------------------------------------------
let headSha = 'abc123';

/** A download that hangs until the job is cancelled (then cleans up like a real one). */
const hangingTarball: GitHubClient['streamTarball'] = (_o, _r, _s, signal) =>
  new Promise((_resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason); // already cancelled: no abort event will come
    signal?.addEventListener('abort', () => reject(signal.reason));
  });

function setup(
  options: {
    github?: Partial<GitHubClient>;
    rateLimits?: { createsPerHour: number; readsPerMinute: number };
  } = {},
) {
  const store = new TestStore();
  const memory = new MemoryAnalysisStore({ ttlMinutes: 60, maxEntries: 10 });
  const queue = new JobQueue(2, 20_000);
  const app = createApp({
    clientOrigin: 'http://localhost:5173',
    logger: createLogger(undefined, 'silent'),
    // Tests poll every 20ms; keep reads generous unless a test checks the limits themselves.
    rateLimits: options.rateLimits ?? { createsPerHour: 10, readsPerMinute: 100_000 },
    analyses: {
      publicGitHub: fakeGitHub({
        streamTarball: async () => tarballOf(fixtureDir('simple-express')),
        getHeadCommit: async () => ({ sha: headSha, date: null }),
        ...options.github,
      }),
      stores: { public: store, private: memory },
      queue,
      maxRepoSizeKb: 1000,
      cacheTtlHours: 24,
      privateMode: { enabled: true, requireHttps: false },
    },
  });
  return { app, store, memory, queue };
}

async function analyze(app: ReturnType<typeof setup>['app'], repoUrl = 'acme/widget') {
  const res = await request(app).post('/api/analyses').send({ repoUrl });
  let dto: AnalysisDto | null = null;
  try {
    await waitFor(async () => {
      dto = (await request(app).get(`/api/analyses/${res.body.id}`)).body as AnalysisDto;
      return dto.status === 'done' || dto.status === 'failed';
    }, 20_000);
  } catch {
    const d = dto as AnalysisDto | null;
    throw new Error(`analysis stuck at status=${d?.status} step=${d?.step}`);
  }
  return { created: res, dto: dto! };
}

beforeEach(() => {
  headSha = 'abc123';
  vi.stubGlobal('fetch', mockExternalApis().fetchImpl);
});
afterEach(() => vi.unstubAllGlobals());

describe('commit-SHA caching', () => {
  it('returns the cached analysis when the same commit is analyzed twice', async () => {
    const { app, store } = setup();
    const first = await analyze(app);
    expect(first.created.status).toBe(202);
    const second = await request(app)
      .post('/api/analyses')
      .send({ repoUrl: 'https://github.com/acme/widget' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      id: first.created.body.id,
      status: 'done',
      visibility: 'public',
      expiresAt: null,
      cached: true,
    });
    expect(store.docs.size).toBe(1);
  }, 30_000);

  it('reuses an in-progress analysis of the same commit instead of starting another', async () => {
    const { app, store, queue } = setup({ github: { streamTarball: hangingTarball } });
    const first = await request(app).post('/api/analyses').send({ repoUrl: 'acme/widget' });
    const second = await request(app).post('/api/analyses').send({ repoUrl: 'acme/widget' });
    expect(second.status).toBe(202);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.cached).toBe(false);
    expect(store.docs.size).toBe(1);
    queue.cancel(first.body.id);
    await waitFor(() => queue.stats.running === 0);
    // The job deletes its temp folder just after freeing its queue slot; let it finish.
    await waitFor(() => !existsSync(TEMP_ROOT) || readdirSync(TEMP_ROOT).length === 0);
  });

  it('analyzes again when the commit changed', async () => {
    const { app, store } = setup();
    const first = await analyze(app);
    headSha = 'def456';
    const second = await request(app).post('/api/analyses').send({ repoUrl: 'acme/widget' });
    expect(second.status).toBe(202);
    expect(second.body.id).not.toBe(first.created.body.id);
    expect(store.docs.size).toBe(2);
  }, 30_000);
});

describe('recent, markdown and badge routes', () => {
  it('lists finished public analyses, one per repo, newest first', async () => {
    const { app } = setup();
    await analyze(app);
    const recent = await request(app).get('/api/analyses/recent');
    expect(recent.status).toBe(200);
    expect(recent.body).toEqual([
      {
        id: expect.any(String),
        fullName: 'acme/widget',
        score: expect.any(Number),
        createdAt: expect.any(String),
      },
    ]);
  }, 30_000);

  it('downloads the briefing as a Markdown attachment', async () => {
    const { app } = setup();
    const { dto } = await analyze(app);
    const md = await request(app).get(`/api/analyses/${dto.id}/markdown`);
    expect(md.status).toBe(200);
    expect(md.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(md.headers['content-disposition']).toBe(
      'attachment; filename="acme-widget-onboarding.md"',
    );
    expect(md.text).toMatch(/^# acme\/widget onboarding briefing\n/);
  }, 30_000);

  it('refuses Markdown for an unfinished analysis, and 404s unknown ids', async () => {
    const { app, queue } = setup({ github: { streamTarball: hangingTarball } });
    const created = await request(app).post('/api/analyses').send({ repoUrl: 'acme/widget' });
    expect((await request(app).get(`/api/analyses/${created.body.id}/markdown`)).status).toBe(404);
    queue.cancel(created.body.id);
    await waitFor(() => queue.stats.running === 0);
    // The job deletes its temp folder just after freeing its queue slot; let it finish.
    await waitFor(() => !existsSync(TEMP_ROOT) || readdirSync(TEMP_ROOT).length === 0);
    const priv = await request(app).get(
      '/api/analyses/p_V1StGXR8_Z5jdHi6B-myTV1StGXR8_Z5/markdown',
    );
    expect(priv.status).toBe(404);
    expect(priv.body.error.code).toBe('REPORT_NOT_FOUND');
    expect(priv.headers['cache-control']).toBe('no-store');
  });

  it('serves an embeddable badge with the latest score, or "not analyzed"', async () => {
    const { app } = setup();
    const none = await request(app).get('/api/badge/acme/widget.svg');
    expect(none.status).toBe(200);
    expect(none.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(svgText(none)).toContain('not analyzed');

    const { dto } = await analyze(app);
    const badge = await request(app).get('/api/badge/ACME/Widget.svg'); // names are case-insensitive
    expect(svgText(badge)).toContain(`${dto.scoreTotal}/100`);
    expect(badge.headers['cache-control']).toBe('public, max-age=300');
    expect(badge.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const bad = await request(app).get('/api/badge/bad name/x.svg');
    expect(svgText(bad)).toContain('not analyzed');
  }, 30_000);
});

describe('rate limits', () => {
  it('rejects the 11th analysis creation within an hour with 429 RATE_LIMITED', async () => {
    const { app } = setup({
      github: {
        getRepo: async () => {
          throw new (await import('../src/utils/errors')).AppError('REPO_NOT_FOUND', 'nope');
        },
      },
    });
    for (let i = 0; i < 10; i++) {
      // Failed attempts count too.
      expect((await request(app).post('/api/analyses').send({ repoUrl: 'acme/x' })).status).toBe(
        404,
      );
    }
    const eleventh = await request(app).post('/api/analyses').send({ repoUrl: 'acme/x' });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'You have started a lot of analyses. Please wait a bit and try again.',
      },
    });
    // Private-mode attempts share the same limit.
    const priv = await request(app)
      .post('/api/analyses')
      .set('X-GitHub-Token', 'github_pat_TESTSECRET0123456789')
      .send({ repoUrl: 'acme/x' });
    expect(priv.status).toBe(429);
    // Reads are limited separately.
    expect((await request(app).get('/api/analyses/recent')).status).toBe(200);
  });

  it('limits reads per minute, but not badges', async () => {
    const { app } = setup({ rateLimits: { createsPerHour: 10, readsPerMinute: 3 } });
    for (let i = 0; i < 3; i++)
      expect((await request(app).get('/api/analyses/recent')).status).toBe(200);
    const fourth = await request(app).get('/api/analyses/recent');
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('RATE_LIMITED');
    expect((await request(app).get('/api/badge/acme/widget.svg')).status).toBe(200);
  });
});

/** supertest buffers image/svg+xml as binary, so read the SVG from the body Buffer. */
function svgText(res: request.Response): string {
  return Buffer.isBuffer(res.body) ? res.body.toString('utf8') : res.text;
}
