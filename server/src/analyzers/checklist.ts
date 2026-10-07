import type { ChecklistItem, EnvInfo, HowToRun } from '@repoready/shared';
import {
  type AnalyzerContext,
  allDependencies,
  basename,
  isIgnoredPath,
  isRootFile,
  stringRecord,
} from './context';
import { isDefaultTestScript } from './howToRun';

const MIN_README_CHARS = 300;
const LINTER_PACKAGES = ['eslint', '@biomejs/biome', 'xo', 'standard', 'oxlint'];
const LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
];

export async function analyzeChecklist(
  ctx: AnalyzerContext,
  env: EnvInfo | null,
  howToRun: HowToRun | null,
): Promise<ChecklistItem[]> {
  const { files, fileSet } = ctx;
  const rootFiles = files.filter(isRootFile);
  const deps = allDependencies(ctx.pkg);
  const has = (re: RegExp, list = files) => list.some((f) => re.test(f));

  const readmeFile = rootFiles.find((f) => /^readme(\.|$)/i.test(f));
  const readmeText = readmeFile ? await ctx.readText(readmeFile) : null;
  const scripts = stringRecord(ctx.pkg?.scripts);

  const item = (id: string, label: string, passed: boolean, hint: string): ChecklistItem => ({
    id,
    label,
    passed,
    hint,
  });

  const testFiles = files.some(
    (f) =>
      !isIgnoredPath(f) &&
      (/\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)(__tests__|tests?)\//.test(f)),
  );

  return [
    item(
      'readme',
      'README with real content',
      (readmeText?.trim().length ?? 0) > MIN_README_CHARS,
      'Add a README.md that explains what the project does and how to use it.',
    ),
    item(
      'readme_setup',
      'README has setup instructions',
      howToRun?.readme.hasSetupSection ?? false,
      'Add a "Getting started" or "Installation" section to the README.',
    ),
    item(
      'license',
      'License',
      has(/^(licen[cs]e|copying)(\.|$)/i, rootFiles) || ctx.meta.license !== null,
      'Add a LICENSE file so others know how they may use the code.',
    ),
    item(
      'contributing',
      'Contributing guide',
      has(/^(\.github\/|docs\/)?contributing(\.|$)/i),
      'Add CONTRIBUTING.md describing how to propose changes.',
    ),
    item(
      'gitignore',
      '.gitignore',
      fileSet.has('.gitignore'),
      'Add a .gitignore (at least node_modules/, .env and build output).',
    ),
    item(
      'env_example',
      'Environment variables documented',
      env ? env.exampleFile !== null || env.summary.used === 0 : false,
      'Add a .env.example listing every environment variable the app reads.',
    ),
    item(
      'lockfile',
      'Lockfile committed',
      LOCKFILES.some((f) => fileSet.has(f)),
      'Commit your lockfile (package-lock.json, yarn.lock or pnpm-lock.yaml) for reproducible installs.',
    ),
    item(
      'node_version_pinned',
      'Node version pinned',
      Boolean(howToRun?.nodeVersion.value),
      'Add an .nvmrc or an engines.node field in package.json.',
    ),
    item(
      'ci',
      'Continuous integration',
      has(/^\.github\/workflows\/[^/]+\.ya?ml$/) ||
        fileSet.has('.gitlab-ci.yml') ||
        fileSet.has('.circleci/config.yml'),
      'Add a CI workflow (e.g. .github/workflows/ci.yml) that runs lint and tests.',
    ),
    item(
      'tests',
      'Tests',
      (Boolean(scripts.test) && !isDefaultTestScript(scripts.test)) || testFiles,
      'Add tests and a working "test" script in package.json.',
    ),
    item(
      'linter',
      'Linter configured',
      has(/(^|\/)(\.eslintrc(\.\w+)?|eslint\.config\.[cm]?[jt]s|biome\.jsonc?)$/) ||
        LINTER_PACKAGES.some((name) => name in deps) ||
        (ctx.pkg !== null && ('eslintConfig' in ctx.pkg || 'xo' in ctx.pkg)),
      'Add ESLint (or Biome) to catch bugs early.',
    ),
    item(
      'formatter',
      'Formatter configured',
      has(/(^|\/)(\.prettierrc(\.\w+)?|prettier\.config\.[cm]?[jt]s|biome\.jsonc?)$/) ||
        'prettier' in deps ||
        '@biomejs/biome' in deps ||
        (ctx.pkg !== null && 'prettier' in ctx.pkg),
      'Add Prettier (or Biome) so formatting is consistent.',
    ),
    item(
      'typescript',
      'TypeScript',
      files.some((f) => basename(f) === 'tsconfig.json' && !isIgnoredPath(f)),
      'Consider TypeScript (tsconfig.json) for safer refactoring.',
    ),
    item(
      'dockerfile',
      'Dockerfile',
      files.some((f) => /^Dockerfile/i.test(basename(f)) && !isIgnoredPath(f)),
      'Add a Dockerfile so the app runs the same everywhere.',
    ),
  ];
}
