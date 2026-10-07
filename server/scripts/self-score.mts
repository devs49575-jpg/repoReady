// Scores RepoReady itself from the files git would publish, with the real analyzers and real
// OSV.dev / npm registry lookups (network needed). Target from the build plan: >= 85.
// Run: npm run self-score -w server
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyzeArchitecture } from '../src/analyzers/architecture';
import { analyzeChecklist } from '../src/analyzers/checklist';
import { createContext } from '../src/analyzers/context';
import { analyzeDeps } from '../src/analyzers/deps';
import { analyzeEnv } from '../src/analyzers/env';
import { analyzeHowToRun } from '../src/analyzers/howToRun';
import { computeScore } from '../src/analyzers/score';
import { analyzeStack } from '../src/analyzers/stack';
import { createGitHubClient } from '../src/services/github';

const repoRoot = join(import.meta.dirname, '..', '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter(Boolean);

// Copy exactly the publishable files, like a GitHub tarball would contain.
const rootDir = mkdtempSync(join(tmpdir(), 'repoready-self-'));
for (const f of files) {
  mkdirSync(dirname(join(rootDir, f)), { recursive: true });
  cpSync(join(repoRoot, f), join(rootDir, f));
}

const section = async <T,>(fn: () => Promise<T> | T) => {
  try {
    return { ok: true as const, data: await fn() };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
};

try {
  const ctx = await createContext({
    rootDir,
    files: files.sort(),
    meta: {
      isPrivate: false,
      owner: 'you',
      repo: 'repoready',
      fullName: 'you/repoready',
      description: null,
      htmlUrl: 'https://github.com/you/repoready',
      defaultBranch: 'main',
      commitSha: 'local',
      stars: 0,
      forks: 0,
      openIssues: 0,
      sizeKb: 0,
      pushedAt: '',
      license: null,
      languages: { TypeScript: 90, JavaScript: 5, CSS: 3, HTML: 2 },
    },
    github: createGitHubClient(),
  });
  const env = await section(() => analyzeEnv(ctx));
  const howToRun = await section(() => analyzeHowToRun(ctx, env.ok ? env.data : null));
  const checklist = await section(() =>
    analyzeChecklist(ctx, env.ok ? env.data : null, howToRun.ok ? howToRun.data : null),
  );
  const architecture = await section(() => analyzeArchitecture(ctx));
  const deps = await section(() => analyzeDeps(ctx));
  const stack = await section(() => analyzeStack(ctx));
  const score = computeScore({ checklist, howToRun, env, deps, architecture });

  console.log(`files: ${files.length}`);
  console.log(`SCORE ${score.total}/100 (${score.label})`);
  for (const c of score.breakdown)
    console.log(`  ${c.category.padEnd(14)} ${c.earned}/${c.max}  ${c.reasons.join('; ')}`);
  if (checklist.ok)
    console.log(
      '  failed checks:',
      checklist.data
        .filter((i) => !i.passed)
        .map((i) => i.id)
        .join(', ') || 'none',
    );
  if (env.ok)
    console.log(
      '  env:',
      JSON.stringify(env.data.summary),
      env.data.variables
        .filter((v) => v.status !== 'ok')
        .map((v) => `${v.name}:${v.status}`)
        .join(' '),
    );
  if (howToRun.ok) console.log('  steps:', howToRun.data.steps.join(' | '));
  if (architecture.ok)
    console.log(
      `  arch: ${architecture.data.analyzedFiles} files, cycles ${JSON.stringify(architecture.data.circular)}, orphans ${architecture.data.orphans.join(', ')}`,
    );
  if (deps.ok)
    console.log(
      `  deps: ${deps.data.totalPackages} pkgs, ${JSON.stringify(deps.data.counts)}, majors: ${deps.data.outdated
        .filter((o) => o.type === 'major')
        .map((o) => o.name)
        .join(', ')}`,
    );
  if (!deps.ok) console.log('  deps error:', deps.error);
  if (stack.ok)
    console.log(
      '  stack:',
      stack.data.packageManager,
      stack.data.technologies.map((t) => t.name).join(', '),
    );
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}
