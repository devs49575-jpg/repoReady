import type { PackageManager, StackInfo } from '@repoready/shared';
import { TECH_MAP } from '../data/techMap';
import { type AnalyzerContext, type PackageJson, allDependencies, basename } from './context';

const TOP_LANGUAGES = 6;

export function languagePercents(bytes: Record<string, number>): StackInfo['languages'] {
  const entries = Object.entries(bytes).filter(([, n]) => n > 0);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return [];
  entries.sort((a, b) => b[1] - a[1]);
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;
  const top = entries.slice(0, TOP_LANGUAGES).map(([name, n]) => ({ name, percent: pct(n) }));
  const rest = entries.slice(TOP_LANGUAGES).reduce((sum, [, n]) => sum + n, 0);
  if (rest > 0) top.push({ name: 'Other', percent: pct(rest) });
  return top;
}

export function detectPackageManager(
  fileSet: Set<string>,
  pkg: PackageJson | null,
): PackageManager {
  if (fileSet.has('package-lock.json') || fileSet.has('npm-shrinkwrap.json')) return 'npm';
  if (fileSet.has('yarn.lock')) return 'yarn';
  if (fileSet.has('pnpm-lock.yaml')) return 'pnpm';
  if (fileSet.has('bun.lockb') || fileSet.has('bun.lock')) return 'bun';
  // Corepack's "packageManager": "pnpm@9.0.0"
  const declared = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
  if (declared === 'npm' || declared === 'yarn' || declared === 'pnpm' || declared === 'bun') {
    return declared;
  }
  return 'unknown';
}

export function readWorkspaces(pkg: PackageJson | null): string[] {
  const ws = pkg?.workspaces;
  const list = Array.isArray(ws)
    ? ws
    : ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown }).packages)
      ? (ws as { packages: unknown[] }).packages
      : [];
  return list.filter((w): w is string => typeof w === 'string');
}

export async function analyzeStack(ctx: AnalyzerContext): Promise<StackInfo> {
  const languages = languagePercents(ctx.meta.languages);
  const technologies: StackInfo['technologies'] = [];
  const seen = new Set<string>();
  const add = (
    tech: { name: string; category: StackInfo['technologies'][number]['category'] },
    evidence: string,
  ) => {
    if (seen.has(tech.name)) return;
    seen.add(tech.name);
    technologies.push({ ...tech, evidence });
  };

  for (const dep of Object.keys(allDependencies(ctx.pkg)).sort()) {
    const tech = TECH_MAP[dep];
    if (tech) add(tech, `dependency: ${dep}`);
  }
  const dockerfile = ctx.files.find((f) => /^Dockerfile/i.test(basename(f)));
  if (dockerfile) add({ name: 'Docker', category: 'infra' }, `file: ${dockerfile}`);
  const tsconfig = ctx.files.find((f) => basename(f) === 'tsconfig.json');
  if (tsconfig) add({ name: 'TypeScript', category: 'language' }, `file: ${tsconfig}`);

  return {
    languages,
    technologies,
    packageManager: detectPackageManager(ctx.fileSet, ctx.pkg),
    hasPackageJson: ctx.pkg !== null,
    workspaces: readWorkspaces(ctx.pkg),
  };
}
