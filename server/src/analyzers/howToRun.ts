import type { EnvInfo, HowToRun, PackageManager } from '@repoready/shared';
import { type AnalyzerContext, basename, isRootFile, stringRecord } from './context';
import { detectPackageManager } from './stack';

const DEV_SCRIPT_NAMES = ['dev', 'start:dev', 'serve', 'develop'];
const SETUP_HEADING_RE = /install|setup|getting started|quick ?start|usage|run/i;
const MAX_HEADINGS = 40;
const MAX_ENV_NAMES_IN_STEP = 8;

export async function detectNodeVersion(ctx: AnalyzerContext): Promise<HowToRun['nodeVersion']> {
  for (const file of ['.nvmrc', '.node-version']) {
    const text = await ctx.readText(file);
    const value = text?.split(/\r?\n/)[0]?.trim();
    if (value) return { value, source: file };
  }
  const engines = ctx.pkg?.engines;
  const engineNode = stringRecord(engines).node?.trim();
  if (engineNode) return { value: engineNode, source: 'package.json engines.node' };
  const toolVersions = await ctx.readText('.tool-versions');
  const line = toolVersions?.split(/\r?\n/).find((l) => /^\s*(nodejs|node)\s+\S/.test(l));
  if (line) return { value: line.trim().split(/\s+/)[1]!, source: '.tool-versions' };
  return { value: null, source: null };
}

/** Markdown ATX headings, ignoring fenced code blocks. */
export function extractHeadings(markdown: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) headings.push(m[1]!.trim());
    if (headings.length >= MAX_HEADINGS) break;
  }
  return headings;
}

function runCommand(pm: PackageManager, script: string): string {
  if (pm === 'yarn') return `yarn ${script}`;
  return `${pm === 'unknown' ? 'npm' : pm} run ${script}`;
}

function installCommand(pm: PackageManager, hasNpmLock: boolean): string {
  if (pm === 'npm' && hasNpmLock) return 'npm ci';
  if (pm === 'unknown') return 'npm install';
  return `${pm} install`;
}

export async function analyzeHowToRun(
  ctx: AnalyzerContext,
  env: EnvInfo | null,
): Promise<HowToRun> {
  const nodeVersion = await detectNodeVersion(ctx);
  const pm = detectPackageManager(ctx.fileSet, ctx.pkg);
  const scripts = stringRecord(ctx.pkg?.scripts);
  const hasPkg = ctx.pkg !== null;

  const devName = DEV_SCRIPT_NAMES.find((name) => scripts[name]);
  const cmd = (name: string | undefined) => (name && scripts[name] ? runCommand(pm, name) : null);
  const scriptCommands: HowToRun['scripts'] = {
    install: hasPkg ? installCommand(pm, ctx.fileSet.has('package-lock.json')) : null,
    dev: cmd(devName),
    start: cmd('start'),
    build: cmd('build'),
    test: cmd('test'),
    lint: cmd('lint'),
  };

  const docker = {
    dockerfile: ctx.files.some((f) => /^Dockerfile/i.test(basename(f))),
    compose: ctx.files.some(
      (f) => /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(basename(f)) && isRootFile(f),
    ),
  };

  const readmeFile = ctx.files.find((f) => isRootFile(f) && /^readme(\.|$)/i.test(f));
  const readmeText = readmeFile ? await ctx.readText(readmeFile) : null;
  const headings = readmeText ? extractHeadings(readmeText) : [];
  const readme = {
    exists: readmeText !== null,
    hasSetupSection: headings.some((h) => SETUP_HEADING_RE.test(h)),
    headings,
  };

  // Steps (Section 8.3), skipping the ones that do not apply.
  const stepItems: HowToRun['stepItems'] = [];
  stepItems.push({
    label: 'Clone the repository',
    command: `git clone ${ctx.meta.htmlUrl}.git && cd ${ctx.meta.repo}`,
  });
  if (nodeVersion.value) {
    stepItems.push({
      label: `Use Node ${nodeVersion.value} (from ${nodeVersion.source})`,
      command: nodeVersion.source === '.nvmrc' ? 'nvm use' : null,
    });
  }
  const needed = env?.variables.filter((v) => v.status !== 'unused').map((v) => v.name) ?? [];
  const neededList =
    needed.slice(0, MAX_ENV_NAMES_IN_STEP).join(', ') +
    (needed.length > MAX_ENV_NAMES_IN_STEP
      ? `, and ${needed.length - MAX_ENV_NAMES_IN_STEP} more`
      : '');
  if (env?.exampleFile) {
    const target = env.exampleFile.includes('/')
      ? `${env.exampleFile.slice(0, env.exampleFile.lastIndexOf('/'))}/.env`
      : '.env';
    stepItems.push({
      label: needed.length
        ? `Create your .env file and fill in: ${neededList}`
        : 'Create your .env file',
      command: `cp ${env.exampleFile} ${target}`,
    });
  } else if (needed.length) {
    stepItems.push({ label: `Create a .env file with: ${neededList}`, command: null });
  }
  if (scriptCommands.install) {
    stepItems.push({ label: 'Install dependencies', command: scriptCommands.install });
  }
  if (docker.compose) {
    stepItems.push({
      label: 'Alternative: run everything with Docker',
      command: 'docker compose up',
    });
  }
  const runCmd = scriptCommands.dev ?? scriptCommands.start;
  if (runCmd) {
    stepItems.push({
      label: scriptCommands.dev ? 'Start the development server' : 'Start the app',
      command: runCmd,
    });
  }
  if (scriptCommands.test && !isDefaultTestScript(scripts.test)) {
    stepItems.push({ label: 'Run the tests', command: scriptCommands.test });
  }

  return {
    nodeVersion,
    scripts: scriptCommands,
    docker,
    readme,
    steps: stepItems.map((s) => (s.command ? `${s.label}: ${s.command}` : s.label)),
    stepItems,
  };
}

/** npm init's placeholder: `echo "Error: no test specified" && exit 1`. */
export function isDefaultTestScript(script: string | undefined): boolean {
  return !script || /no test specified/i.test(script);
}
