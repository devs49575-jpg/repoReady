export type AnalysisStatus = 'queued' | 'running' | 'done' | 'failed';
export type SectionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Public reports live in MongoDB; private reports (Addendum 01) live in server memory only. */
export type Visibility = 'public' | 'private';

export interface PrivacyInfo {
  visibility: Visibility;
  expiresAt: string | null; // ISO date; null for public reports
  externalLookups: boolean; // false if the user skipped dependency lookups
}

/** Extra fields on the create and get analysis API responses. */
export interface AnalysisResponseExtras {
  visibility: Visibility;
  expiresAt: string | null;
}

export interface RepoMeta {
  isPrivate: boolean; // GitHub's own flag; differs from PrivacyInfo.visibility when a token is used on a public repo
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  commitSha: string;
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number;
  pushedAt: string;
  license: string | null;
  languages: Record<string, number>; // bytes per language
}

export type TechCategory =
  'framework' | 'database' | 'testing' | 'build' | 'lint' | 'language' | 'infra' | 'other';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';

export interface StackInfo {
  languages: { name: string; percent: number }[];
  technologies: {
    name: string;
    category: TechCategory;
    evidence: string; // e.g. "dependency: express"
  }[];
  packageManager: PackageManager;
  hasPackageJson: boolean;
  workspaces: string[]; // empty if not a monorepo
}

export interface HowToRun {
  nodeVersion: { value: string | null; source: string | null }; // .nvmrc, .node-version, engines.node, .tool-versions
  scripts: {
    install: string | null;
    dev: string | null;
    start: string | null;
    build: string | null;
    test: string | null;
    lint: string | null;
  };
  docker: { dockerfile: boolean; compose: boolean };
  readme: { exists: boolean; hasSetupSection: boolean; headings: string[] };
  steps: string[]; // ordered, generated from templates
  stepItems: { label: string; command: string | null }[]; // same steps, split so the UI can offer copy buttons
}

export type EnvVarStatus = 'ok' | 'undocumented' | 'unused';

export interface EnvInfo {
  exampleFile: string | null; // e.g. ".env.example"
  variables: {
    name: string;
    usedIn: string[]; // up to 3 file paths
    documented: boolean;
    status: EnvVarStatus; // used+documented | used only | documented only
  }[];
  summary: { used: number; documented: number; undocumented: number; unused: number };
}

export interface ChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  hint: string; // tells the user how to fix it
}

export interface ArchitectureInfo {
  level: 'file' | 'folder'; // 'folder' when >400 file nodes
  analyzedFiles: number;
  nodes: {
    id: string;
    label: string;
    folder: string;
    imports: number;
    importedBy: number;
    fileCount?: number;
  }[];
  edges: { source: string; target: string; circular: boolean; weight?: number }[];
  circular: string[][]; // each cycle as ordered file paths
  orphans: string[]; // files nobody imports (excluding entry-like files)
  truncated: boolean;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface DepsInfo {
  lockfileUsed: boolean; // false => versions approximated from ranges
  approximate: boolean;
  totalPackages: number;
  directPackages: number;
  skippedPackages: number; // private mode: packages not looked up (non-npm-registry or no `resolved` URL)
  vulnerabilities: {
    id: string;
    aliases: string[];
    package: string;
    version: string;
    severity: Severity;
    summary: string;
    fixedIn: string | null;
    url: string;
  }[];
  outdated: { name: string; current: string; latest: string; type: 'major' | 'minor' | 'patch' }[];
  counts: Record<Severity, number>;
  notes: string[]; // caps hit, partial results, skipped lookups: anything that limits the numbers above
}

export interface PeopleInfo {
  contributors: { login: string; avatarUrl: string; commits: number }[]; // top 10
  byFolder: { folder: string; people: { login: string; commits: number }[] }[]; // top-level dirs, max 8
  lastCommitAt: string | null;
}

export type ScoreLabel = 'Needs work' | 'Okay' | 'Good' | 'Excellent';

export interface ScoreInfo {
  total: number; // 0-100
  label: ScoreLabel;
  breakdown: { category: string; earned: number; max: number; reasons: string[] }[];
}

export interface Report {
  meta: RepoMeta;
  privacy: PrivacyInfo; // may be missing on reports stored before Addendum 01; read it via getPrivacy()
  stack: SectionResult<StackInfo>;
  howToRun: SectionResult<HowToRun>;
  env: SectionResult<EnvInfo>;
  checklist: SectionResult<ChecklistItem[]>;
  architecture: SectionResult<ArchitectureInfo>;
  deps: SectionResult<DepsInfo>;
  people: SectionResult<PeopleInfo>;
  score: SectionResult<ScoreInfo>;
}
