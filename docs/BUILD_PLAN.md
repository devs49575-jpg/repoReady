# RepoReady: Build Specification

> **Audience:** an AI coding assistant that will build this project, plus the human supervising it.
> **How to use:** read the whole document once, then build **one phase at a time** (Section 14). After each phase, run the checks listed in that phase's "Definition of Done" and report results before continuing.
>
> **Note:** [ADDENDUM_01_PRIVATE_REPOS.md](ADDENDUM_01_PRIVATE_REPOS.md) overrides this plan where they conflict.

---

## 0. Master instruction to the AI (read first)

You are building **RepoReady**, a MERN web app. Follow these rules throughout:

1. **No AI/LLM features inside the product.** No OpenAI/Anthropic/Gemini calls, no embeddings, no "smart" summaries. Every output is produced by deterministic code (parsing, regex, static analysis, public APIs). AI is only used by the humans to build the project.
2. **Everything must be free to run:** free-tier hosting, free APIs, open-source libraries only.
3. **Never execute code from analyzed repositories.** Only read and parse files. Never run `npm install`, scripts, or `eval` on repo content.
4. **Do not invent library APIs.** Before using `madge`, `@xyflow/react`, `tar`, `octokit`, `mongoose` etc., check the installed version's docs or type definitions. If unsure, write a tiny test script to confirm behavior.
5. **Build in phases (Section 14).** Do not start a phase until the previous phase's Definition of Done passes.
6. **Partial results beat total failure.** If one analyzer fails, store its error and still finish the report (see `SectionResult` in Section 7).
7. **Keep it simple.** Prefer plain functions and small files over abstractions. No microservices, no Redis, no message queues, no auth, no payments.
8. Keep an `docs/AI_LOG.md` file (template in Section 17) and add an entry whenever something significant is generated or corrected.

---

## 1. Product summary

**RepoReady** turns any public GitHub repository into a **new-developer briefing page**. The user pastes a repo URL and within about 30 seconds sees: what the stack is, how to run it, which environment variables it needs, how the code is wired together, whether the dependencies are safe, who to ask for help, and an overall "readiness score".

**One-line pitch:** *"Paste a repo, get the onboarding doc nobody wrote."*

**Problem:** New developers lose days to setup, missing `.env` values, unclear architecture and stale dependencies. Existing tools each solve one slice (env checks, dependency graphs, vulnerability scans) as separate CLIs. RepoReady puts all of it on one readable page.

**Primary user:** a developer (or student/judge) joining or evaluating an unfamiliar JavaScript/TypeScript repository.

**Core user story:** *"As a developer joining a project, I paste the GitHub URL and get a single page that tells me how to get it running and where the risks are, so I'm productive on day one."*

### Scope boundaries (MVP)

| In scope | Out of scope |
|---|---|
| Public GitHub repos | Private repos, GitLab, Bitbucket |
| JS/TS projects (Node, React, etc.) with `package.json` | Python, Java, Go, etc. (show a partial report only) |
| Default branch only | Branch/PR/commit comparison |
| Root `package.json` analysis | Deep monorepo per-package analysis (list workspaces only) |
| Anonymous usage | Login, accounts, teams |
| Deterministic rules | Anything AI/LLM-based |

---

## 2. Feature list with priorities

**P0 (must ship, the minimum demo):**
1. Repo URL input and validation
2. Analysis pipeline with status/progress
3. Stack detection
4. "How to run" section
5. Environment variable scan vs `.env.example`
6. Repo health checklist
7. Readiness score (0-100) with breakdown
8. Report page with shareable URL

**P1 (the wow factor, build next):**
9. Interactive architecture graph with circular-dependency detection
10. Dependency health (known vulnerabilities via OSV.dev plus outdated packages)

**P2 (nice to have):**
11. "Who to ask" (top contributors, overall and per folder)
12. Markdown export of the briefing
13. README badge (SVG) showing the score
14. Recent analyses gallery on the home page
15. Result caching by commit SHA

---

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | **TypeScript (strict)** in client and server | `any` is not allowed unless commented why |
| Runtime | **Node.js 20+ LTS** | use built-in `fetch` |
| Server | **Express 5** | async errors propagate natively. If Express 4 is used, add an async wrapper |
| Database | **MongoDB** (Atlas free tier) with **Mongoose 8** | |
| Frontend | **React 18+** with **Vite** | |
| Styling | **Tailwind CSS** | follow its current official Vite installation guide |
| Routing | **React Router** | |
| Data fetching | **TanStack Query** | used for polling analysis status |
| Graph UI | **`@xyflow/react`** (React Flow) + **`@dagrejs/dagre`** for layout | |
| Validation | **zod** | validate all request bodies and env vars |
| GitHub access | `fetch` against the GitHub REST API with a server-side token (or `octokit`) | token needs no scopes for public data |
| Tarball extraction | **`tar`** | stream, with a filter |
| Dependency graph | **`madge`** (with `typescript` installed as its peer for TS support) | |
| Semver | **`semver`** | |
| Security middleware | `helmet`, `cors`, `express-rate-limit` | |
| Logging | `pino` | |
| IDs | `nanoid` | |
| Concurrency | `p-limit` | for registry/OSV/GitHub calls |
| Tests | **Vitest**, **supertest** (API), **React Testing Library** (a few UI tests) | |
| Lint/format | ESLint + Prettier | |
| Build | `tsup` for the server (so the worker file compiles), Vite for the client | |
| Monorepo | **npm workspaces**: `client`, `server`, `packages/shared` | |

**External services (all free):**
- **GitHub REST API**: repo metadata, languages, contributors, commits, tarball download
- **OSV.dev API** (`https://api.osv.dev`): `POST /v1/querybatch` and `GET /v1/vulns/{id}`
- **npm registry** (`https://registry.npmjs.org/<pkg>/latest`): latest versions
- **MongoDB Atlas** (free cluster)
- Hosting: static host for the client (Vercel/Netlify), a Node host for the server (Render/Railway/Fly), checking each one's current free-tier limits (memory and cold starts matter for this app)

Library versions: install the latest stable at build time (`npm view <pkg> version` to confirm) and pin them in `package.json`.

---

## 4. Repository layout

```
repoready/
├─ package.json                 # npm workspaces root; scripts: dev, build, lint, typecheck, test
├─ .env.example                 # every env var, documented (RepoReady must score well on itself)
├─ README.md
├─ docs/
│  ├─ AI_LOG.md                 # AI usage log (hackathon requirement)
│  ├─ ARCHITECTURE.md
│  └─ TESTING_NOTES.md          # real-user feedback notes
├─ packages/
│  └─ shared/
│     └─ src/report.ts          # Report types (Section 7), imported by client and server
├─ server/
│  ├─ package.json
│  ├─ src/
│  │  ├─ index.ts               # boot: connect Mongo, mark stale jobs failed, start server
│  │  ├─ app.ts                 # express app, middleware, routes
│  │  ├─ config.ts              # zod-validated env
│  │  ├─ routes/
│  │  │  ├─ analyses.ts
│  │  │  ├─ badge.ts
│  │  │  └─ health.ts
│  │  ├─ models/Analysis.ts
│  │  ├─ queue/jobQueue.ts      # in-memory queue, concurrency 2
│  │  ├─ services/
│  │  │  ├─ github.ts           # meta, languages, contributors, commits, tarball stream
│  │  │  ├─ repoFetcher.ts      # download + extract to temp dir, build file list, cleanup
│  │  │  ├─ osv.ts
│  │  │  ├─ npmRegistry.ts
│  │  │  ├─ markdown.ts         # buildMarkdown(report)
│  │  │  └─ badge.ts            # buildBadgeSvg(score)
│  │  ├─ analyzers/             # one pure-ish function per section
│  │  │  ├─ stack.ts
│  │  │  ├─ howToRun.ts
│  │  │  ├─ env.ts
│  │  │  ├─ checklist.ts
│  │  │  ├─ architecture.ts     # calls the worker
│  │  │  ├─ deps.ts
│  │  │  ├─ people.ts
│  │  │  └─ score.ts
│  │  ├─ workers/architecture.worker.ts   # runs madge off the main thread
│  │  ├─ pipeline/runAnalysis.ts          # orchestrates analyzers and saves progress
│  │  ├─ data/techMap.json                # dependency name -> technology/category
│  │  └─ utils/ (parseRepoUrl.ts, errors.ts, paths.ts)
│  └─ test/
│     ├─ fixtures/              # small fake repos (see Section 15)
│     └─ *.test.ts
└─ client/
   ├─ package.json
   └─ src/
      ├─ main.tsx, App.tsx
      ├─ api/ (client.ts, hooks.ts)
      ├─ pages/ (Home.tsx, Report.tsx, NotFound.tsx)
      └─ components/
         ├─ RepoInput.tsx
         ├─ ProgressStepper.tsx
         ├─ ScoreRing.tsx
         ├─ SectionCard.tsx
         ├─ StackSection.tsx
         ├─ HowToRunSection.tsx      # copy buttons for commands
         ├─ EnvSection.tsx
         ├─ ChecklistSection.tsx
         ├─ ArchitectureSection.tsx  # React Flow graph + side panel
         ├─ DepsSection.tsx
         ├─ PeopleSection.tsx
         ├─ RecentList.tsx
         └─ ErrorState.tsx
```

---

## 5. Environment variables (server)

Validate all of these with zod in `config.ts`; the app must fail fast with a clear message if one is missing.

| Name | Example | Purpose |
|---|---|---|
| `PORT` | `4000` | server port |
| `MONGODB_URI` | `mongodb+srv://...` | database |
| `GITHUB_TOKEN` | `ghp_...` | raises GitHub rate limits; server-side only, never sent to the client or logged |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS allow-list |
| `MAX_REPO_SIZE_KB` | `100000` | reject repos larger than this (GitHub reports `size` in KB) |
| `ANALYSIS_TIMEOUT_MS` | `90000` | hard cap for a whole analysis |
| `CACHE_TTL_HOURS` | `24` | reuse a finished analysis if commit SHA unchanged |
| `NODE_ENV` | `development` | |

Client: `VITE_API_BASE_URL`.

---

## 6. Data flow (end to end)

```
User pastes URL
  -> POST /api/analyses {repoUrl}
     -> parseRepoUrl (validate)
     -> GitHub: repo meta + default-branch head SHA  (fast, synchronous)
     -> cache hit (same fullName + SHA, fresh)? return {id, cached:true}
     -> size check (MAX_REPO_SIZE_KB) else 422 REPO_TOO_LARGE
     -> create Analysis {status:'queued'} -> push to job queue -> 202 {id}
  -> client navigates to /r/:id and polls GET /api/analyses/:id every 2s

Job runner (pipeline/runAnalysis.ts), progress saved after each step:
  1  fetch metadata + languages                     10%
  2  download tarball -> temp dir, build file list  30%
  3  stack + how-to-run                             45%
  4  env scan                                       55%
  5  checklist                                      60%
  6  architecture (worker, timeout 45s)             75%   } run 6,7,8 in parallel
  7  dependency health (OSV + npm registry)         90%   } with Promise.allSettled
  8  people (contributors, per-folder)              95%   }
  9  score + save result, delete temp dir (finally) 100%
```

Each section is wrapped so an exception becomes `{ok:false, error}` and the pipeline continues.

---

## 7. Shared types (`packages/shared/src/report.ts`)

Implement exactly these shapes (add fields only if needed, and keep client/server in sync).

```ts
export type AnalysisStatus = 'queued' | 'running' | 'done' | 'failed';
export type SectionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface RepoMeta {
  owner: string; repo: string; fullName: string;
  description: string | null; htmlUrl: string;
  defaultBranch: string; commitSha: string;
  stars: number; forks: number; openIssues: number;
  sizeKb: number; pushedAt: string; license: string | null;
  languages: Record<string, number>;           // bytes per language
}

export interface StackInfo {
  languages: { name: string; percent: number }[];
  technologies: {
    name: string;
    category: 'framework' | 'database' | 'testing' | 'build' | 'lint' | 'language' | 'infra' | 'other';
    evidence: string;                          // e.g. "dependency: express"
  }[];
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';
  hasPackageJson: boolean;
  workspaces: string[];                        // empty if not a monorepo
}

export interface HowToRun {
  nodeVersion: { value: string | null; source: string | null };   // .nvmrc, .node-version, engines.node, .tool-versions
  scripts: { install: string | null; dev: string | null; start: string | null; build: string | null; test: string | null; lint: string | null };
  docker: { dockerfile: boolean; compose: boolean };
  readme: { exists: boolean; hasSetupSection: boolean; headings: string[] };
  steps: string[];                             // ordered, generated from templates (Section 8.3)
}

export interface EnvInfo {
  exampleFile: string | null;                  // e.g. ".env.example"
  variables: {
    name: string;
    usedIn: string[];                          // up to 3 file paths
    documented: boolean;
    status: 'ok' | 'undocumented' | 'unused';  // used+documented | used only | documented only
  }[];
  summary: { used: number; documented: number; undocumented: number; unused: number };
}

export interface ChecklistItem {
  id: string; label: string; passed: boolean; hint: string;   // hint tells the user how to fix it
}

export interface ArchitectureInfo {
  level: 'file' | 'folder';                    // 'folder' when >400 file nodes
  analyzedFiles: number;
  nodes: { id: string; label: string; folder: string; imports: number; importedBy: number; fileCount?: number }[];
  edges: { source: string; target: string; circular: boolean; weight?: number }[];
  circular: string[][];                        // each cycle as ordered file paths
  orphans: string[];                           // files nobody imports (excluding entry-like files)
  truncated: boolean;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
export interface DepsInfo {
  lockfileUsed: boolean;                       // false => versions approximated from ranges
  approximate: boolean;
  totalPackages: number; directPackages: number;
  vulnerabilities: {
    id: string; aliases: string[]; package: string; version: string;
    severity: Severity; summary: string; fixedIn: string | null; url: string;
  }[];
  outdated: { name: string; current: string; latest: string; type: 'major' | 'minor' | 'patch' }[];
  counts: Record<Severity, number>;
}

export interface PeopleInfo {
  contributors: { login: string; avatarUrl: string; commits: number }[];   // top 10
  byFolder: { folder: string; people: { login: string; commits: number }[] }[];  // top-level dirs, max 8
  lastCommitAt: string | null;
}

export interface ScoreInfo {
  total: number;                               // 0-100
  label: 'Needs work' | 'Okay' | 'Good' | 'Excellent';
  breakdown: { category: string; earned: number; max: number; reasons: string[] }[];
}

export interface Report {
  meta: RepoMeta;
  stack: SectionResult<StackInfo>;
  howToRun: SectionResult<HowToRun>;
  env: SectionResult<EnvInfo>;
  checklist: SectionResult<ChecklistItem[]>;
  architecture: SectionResult<ArchitectureInfo>;
  deps: SectionResult<DepsInfo>;
  people: SectionResult<PeopleInfo>;
  score: SectionResult<ScoreInfo>;
}
```

### Analyzer context (every analyzer receives this)

```ts
interface AnalyzerContext {
  rootDir: string;                              // extracted repo root (temp dir)
  files: string[];                              // relative POSIX paths of extracted files
  meta: RepoMeta;
  pkg: Record<string, any> | null;              // parsed root package.json or null
  readText(relPath: string): Promise<string | null>;   // null if missing/unreadable
}
```

Analyzers are functions `(ctx) => Promise<T>` that are easy to unit-test against fixture folders.

---

## 8. Analyzer specifications

### 8.1 URL parsing (`utils/parseRepoUrl.ts`)
Accept: `https://github.com/owner/repo`, with `.git`, trailing slash, `/tree/...` suffix, `github.com/owner/repo` (no scheme), and `owner/repo`. Owner/repo must match `^[A-Za-z0-9_.-]+$`. Anything else throws `INVALID_URL`. Only `github.com` hosts are allowed. Never pass user input to a shell.

### 8.2 Stack (`stack.ts`)
- Languages: from GitHub languages API, converted to percentages (top 6, rest as "Other").
- Technologies: check `dependencies` + `devDependencies` against `data/techMap.json` (e.g. `react`, `next`, `vue`, `@angular/core`, `svelte`, `express`, `fastify`, `@nestjs/core`, `koa`, `mongoose`, `mongodb`, `prisma`, `sequelize`, `typeorm`, `pg`, `mysql2`, `redis`, `tailwindcss`, `vite`, `webpack`, `jest`, `vitest`, `mocha`, `cypress`, `playwright`, `eslint`, `prettier`, `typescript`). Add `Docker` if a Dockerfile exists. Record `evidence`.
- Package manager from lockfile: `package-lock.json`=npm, `yarn.lock`=yarn, `pnpm-lock.yaml`=pnpm, `bun.lockb`/`bun.lock`=bun.
- `workspaces` from `package.json` (array or `{packages: []}`).
- If there is no `package.json`: return `hasPackageJson:false`, languages only.

### 8.3 How to run (`howToRun.ts`)
- Node version priority: `.nvmrc` > `.node-version` > `package.json engines.node` > `.tool-versions` (nodejs line).
- Scripts: map from `package.json scripts`. `dev` = first existing of `dev`, `start:dev`, `serve`, `develop`. `install` = `<pm> install` (`npm ci` if package-lock exists).
- README: detect existence (`README*`, case-insensitive), extract markdown headings, `hasSetupSection` = any heading matching `/install|setup|getting started|quick ?start|usage|run/i`.
- `steps` (deterministic template, skip steps that do not apply):
  1. `git clone <htmlUrl>.git && cd <repo>`
  2. `Use Node <value> (nvm use)` if known
  3. `cp <exampleFile> .env` and "fill in: <list of variable names>" if env example exists or variables are used
  4. `<install command>`
  5. `docker compose up` if compose exists (as an alternative)
  6. `<pm> run <dev script>` (or `start`)
  7. `<pm> run test` if a test script exists

### 8.4 Environment variables (`env.ts`)
- Scan source files (`.js .jsx .ts .tsx .mjs .cjs .vue .svelte`) with regexes:
  - `process\.env\.([A-Za-z_][A-Za-z0-9_]*)`
  - `process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]`
  - `import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)`
  - destructuring: `const { A, B: alias } = process.env` (parse the braces content)
- Ignore built-ins: `NODE_ENV`, `CI`, `HOME`, `PATH`, `PWD`, `MODE`, `DEV`, `PROD`, `SSR`, `BASE_URL`.
- Find example file in this order: `.env.example`, `.env.sample`, `.env.template`, `.env.dist`, `.env.local.example`. Parse lines `KEY=value` (ignore comments/blank lines; allow `export KEY=`).
- Status: used+documented = `ok`; used only = `undocumented`; documented only = `unused`.
- Skip test files and `node_modules`, `dist`, `build` when scanning.

### 8.5 Checklist (`checklist.ts`)
Each item has `id`, `label`, `passed`, `hint`:
`readme` (exists and >300 chars), `readme_setup`, `license`, `contributing`, `gitignore`, `env_example` (passed if no env vars are used), `lockfile`, `node_version_pinned`, `ci` (`.github/workflows/*.yml|yaml`, `.gitlab-ci.yml`, `.circleci/config.yml`), `tests` (test script that is not the default `echo "Error: no test specified"` or test files/dirs exist), `linter` (eslint/biome config or dependency), `formatter` (prettier config/dependency), `typescript` (`tsconfig.json`), `dockerfile`.

### 8.6 Architecture (`architecture.ts` + `workers/architecture.worker.ts`)
- Run `madge` on `rootDir` inside a **worker thread** with a 45s hard timeout and `resourceLimits.maxOldGenerationSizeMb: 512`. Terminate the worker on timeout and return `{ok:false, error:'Architecture analysis timed out'}`.
- Madge options: `fileExtensions: ['js','jsx','ts','tsx','mjs','cjs']`, `excludeRegExp: [/node_modules/, /(^|\/)(dist|build|coverage|\.next|out)(\/|$)/, /\.(test|spec)\.[jt]sx?$/, /__tests__/]`, `tsConfig` path if `tsconfig.json` exists, `includeNpm: false`.
- Use `madge.obj()` for the graph, `.circular()` for cycles, `.orphans()` for orphans. Remove entry-like orphans from the list (`index.*`, `main.*`, `app.*`, `server.*`, `*.config.*`, `vite-env.d.ts`).
- Build `nodes` and `edges`. Mark an edge `circular` if both ends belong to the same cycle and consecutive in it.
- **Scale rule:** if file nodes > 400, aggregate to **folder level** (node id = first two path segments, edge weight = number of file imports between folders) and set `level:'folder'`. If still > 400, keep the top 400 by degree and set `truncated:true`.
- Entry-point and `src`-less repos must not crash the worker. Always return something valid or a clean error.

### 8.7 Dependency health (`deps.ts`)
1. Resolve versions:
   - If `package-lock.json` exists (lockfileVersion 2 or 3): read its `packages` map (key `node_modules/<name>`, use `version`). Direct packages = those named in `package.json`.
   - Else: use `semver.minVersion(range)` for each direct dependency, set `approximate:true`, `lockfileUsed:false`. Skip non-semver ranges (git URLs, `workspace:*`, `file:`).
   - Cap at 1,500 unique packages.
2. **OSV:** `POST https://api.osv.dev/v1/querybatch` with `{queries:[{package:{name, ecosystem:'npm'}, version}]}` in chunks of 500. The batch response lists vulnerability IDs per query. Fetch details for unique IDs via `GET /v1/vulns/{id}` using `p-limit(8)`, capped at 150 IDs (note if capped).
3. Severity: use `database_specific.severity` (map `MODERATE`->`medium`); else `unknown`. `fixedIn`: first `fixed` event found in `affected[].ranges[].events`. `url`: `https://osv.dev/vulnerability/<id>`. Deduplicate by id+package.
4. **Outdated (direct deps only, max 80):** `GET https://registry.npmjs.org/<name>/latest` with `p-limit(10)` and a 5s timeout each. Compare with `semver.diff` to classify major/minor/patch. Skip failures silently.
5. The whole analyzer has a 40s budget; on timeout return what was collected plus a note.

### 8.8 People (`people.ts`)
- `GET /repos/{o}/{r}/contributors?per_page=10` for top contributors.
- Top-level directories (from the file list, max 8, ignoring dot-folders/`node_modules`): `GET /repos/{o}/{r}/commits?path=<dir>&per_page=30`, count authors by `author.login` (skip null authors). Use `p-limit(4)`.
- `lastCommitAt` from the default-branch head commit date.
- On rate-limit errors, return what was collected.

### 8.9 Score (`score.ts`), total 100

| Category | Max | Rules |
|---|---|---|
| Documentation | 15 | README exists 5, README has setup section 5, LICENSE 2, CONTRIBUTING 3 |
| Setup | 25 | lockfile 5, Node version pinned 5, dev/start script 5, env example exists (or no env vars used) 5, all used env vars documented 5 |
| Quality | 25 | CI 8, tests 8, linter 4, TypeScript 3, formatter 2 |
| Dependencies | 20 | start 20. Critical/high vuln: -5 each (max -12). Medium/low: -1 each (max -4). Major-outdated ratio >50%: -4, >25%: -2. Floor 0. If deps section failed: award 10 and note it |
| Architecture | 15 | start 15. Each circular dependency: -3 (max -9). Orphan ratio >20%: -3. If architecture failed or non-JS repo: award 7 and note it |

Label: 0-49 `Needs work`, 50-74 `Okay`, 75-89 `Good`, 90-100 `Excellent`. Every deduction must add a human-readable string to `reasons`.

---

## 9. Repo fetching and safety (`services/repoFetcher.ts`)

1. Download via `GET https://api.github.com/repos/{o}/{r}/tarball/{sha}` (with token) using `fetch` and **stream** the response into `tar.x({ cwd: tempDir, strip: 1, filter })`. Do not buffer the whole archive in memory.
2. `tempDir = os.tmpdir()/repoready/<nanoid>`. **Always delete it in a `finally` block**, even on errors/timeouts.
3. Extraction filter must skip: paths containing `node_modules/`, `.git/`, `dist/`, `build/`, `coverage/`, `.next/`, `vendor/`; symlinks and non-regular files; images/fonts/media/archives by extension; files larger than 1 MB (except lockfiles up to 10 MB).
4. Caps: max 20,000 extracted files and 150 MB downloaded bytes (count bytes in a transform stream; abort and throw `REPO_TOO_LARGE`).
5. Build `files: string[]` (POSIX relative paths) while extracting.
6. Never follow archive paths outside `tempDir` (rely on `tar`'s protections and also verify resolved paths).

---

## 10. Backend API

All errors use `{ "error": { "code": "...", "message": "..." } }`.

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/analyses` | Body `{repoUrl}` (zod-validated). Returns `202 {id, status}` or `200 {id, status:'done', cached:true}` |
| `GET` | `/api/analyses/:id` | Full analysis document (status, step, progress, error, report) |
| `GET` | `/api/analyses/:id/markdown` | `text/markdown` download of the briefing |
| `GET` | `/api/analyses/recent` | Last 10 finished analyses `{id, fullName, score, createdAt}` |
| `GET` | `/api/badge/:owner/:repo.svg` | SVG badge using the latest score; grey "not analyzed" if none |
| `GET` | `/api/health` | `{ok:true}` |

**Error codes:** `INVALID_URL` (400), `REPO_NOT_FOUND` (404; also for private repos), `REPO_TOO_LARGE` (422), `GITHUB_RATE_LIMITED` (503), `ANALYSIS_TIMEOUT`, `ANALYSIS_FAILED`, `RATE_LIMITED` (429), `NOT_FOUND`.

**Middleware:** `helmet`, `cors` (only `CLIENT_ORIGIN`), `express.json({limit:'10kb'})`, `express-rate-limit` (10 analysis creations per hour per IP; 120 reads per minute per IP), central error handler, request logging with `pino`.

**Job queue (`queue/jobQueue.ts`):** in-memory FIFO, concurrency 2, each job has an overall `ANALYSIS_TIMEOUT_MS` guard. On server boot, mark any `queued`/`running` analyses as `failed` with `ANALYSIS_FAILED` ("server restarted").

---

## 11. Database model (`models/Analysis.ts`)

```ts
{
  _id: ObjectId,                // exposed to client as string id (use nanoid `shareId` if you prefer short URLs)
  owner: String, repo: String, fullName: String,   // indexed (fullName + commitSha)
  commitSha: String,
  status: 'queued'|'running'|'done'|'failed',
  step: String,                 // human label e.g. "Scanning environment variables"
  progress: Number,             // 0-100
  error: { code: String, message: String } | null,
  report: Report | null,        // Section 7 (Mixed type is fine)
  scoreTotal: Number | null,    // denormalized for badge/recent queries
  createdAt: Date, startedAt: Date|null, finishedAt: Date|null,
  expiresAt: Date               // TTL index: delete after 30 days
}
```
Indexes: `{ fullName: 1, commitSha: 1, createdAt: -1 }`, `{ status: 1, createdAt: -1 }`, TTL on `expiresAt`.

---

## 12. Frontend specification

### Pages
- **`/` Home:** headline, one-line pitch, `RepoInput` (validates format client-side, shows inline errors), 3 clickable example repos, `RecentList`, short "what you get" feature strip.
- **`/r/:id` Report:** polls the API until `done`/`failed`.
  - *While running:* `ProgressStepper` showing the 9 steps with the current one highlighted and a progress bar.
  - *On done:* header with repo name, description, stars, commit SHA (short), "analyzed X ago", `ScoreRing`, buttons (Copy link, Download Markdown, Copy badge Markdown). Below: sticky side nav (desktop) and section cards in this order: **How to run, Environment, Stack, Checklist, Architecture, Dependencies, People**. Score breakdown sits next to the ring.
  - *On failed:* `ErrorState` with the error message and a "Try another repo" button.
  - A section with `ok:false` shows a small inline error card instead of breaking the page.
- **`*` NotFound.**

### Component behavior
- **HowToRunSection:** numbered steps; every command has a copy-to-clipboard button.
- **EnvSection:** table of variables with status chips (`ok`, `undocumented`, `unused`), file paths, and a "Copy missing variables as .env.example lines" button.
- **ChecklistSection:** passed/failed list with the `hint` shown for failed items.
- **ArchitectureSection:** React Flow graph with dagre layout; circular edges drawn red and animated; node click opens a side panel (imports / imported by); search box; toggle "show circular only"; list of cycles below; note when `level:'folder'` or `truncated`.
- **DepsSection:** severity count chips, vulnerability table (package, version, severity, fixed in, link), outdated table with major/minor/patch badges; banner if `approximate`.
- **PeopleSection:** contributor avatars with commit counts; "Who to ask about `<folder>`" list.

### UX/design rules
Clean and calm: light and dark mode following the system, Tailwind with a small palette (one accent colour, red/amber/green for status only), generous spacing, responsive down to mobile width, skeleton loaders, keyboard-accessible controls, meaningful `aria-label`s, no layout shift while polling. Use the TanStack Query `refetchInterval` of 2000 ms only while `status` is `queued` or `running`.

---

## 13. Markdown export and badge

- `buildMarkdown(report)` returns a document titled `# <fullName> onboarding briefing` with sections: Score, How to run (steps), Environment variables (table), Stack, Checklist (checkbox list), Dependencies (summary and top vulnerabilities), Architecture (cycles list), Who to ask. Skip sections that failed, with a one-line note.
- `buildBadgeSvg(score)` returns a small two-part SVG (label "RepoReady", value "82/100"), colour by label (red <50, amber <75, green <90, bright green >=90). Serve with `Content-Type: image/svg+xml` and short cache headers. No external dependencies.

---

## 14. Build phases with Definition of Done

> Calendar assumes work starts 6 Oct 2026, with submission on 30 Oct. Adjust dates, keep the order.

### Phase 0: Scaffolding (6-7 Oct)
Tasks: npm workspaces; TypeScript configs; ESLint/Prettier; Vite+React+Tailwind client; Express server with `/api/health`; Mongo connection; zod config; shared package with types; Vitest set up; `.env.example`; CI workflow running lint, typecheck, test.
**DoD:** `npm run dev` starts client+server; `/api/health` returns ok; `npm run lint && npm run typecheck && npm test` pass.

### Phase 1: Backend core, P0 pipeline (8-11 Oct)
Tasks: `parseRepoUrl` + tests; GitHub service (meta, languages); `repoFetcher` (stream + filter + cleanup); analyzers `stack`, `howToRun`, `env`, `checklist`, `score` (with the architecture/deps parts stubbed as "not analyzed" defaults); Analysis model; job queue; `POST/GET /api/analyses`; progress updates; error codes.
**DoD:** with a real token, posting a small public JS repo URL returns a finished report with stack, how-to-run, env, checklist and score; temp dir is deleted afterwards (verify); invalid URL, missing repo and oversized repo return the right error codes; unit tests for every analyzer pass using fixtures.

### Phase 2: Frontend P0 (12-15 Oct)
Tasks: Home page and `RepoInput`; Report page with polling and `ProgressStepper`; `ScoreRing`; Stack, HowToRun (copy buttons), Env, Checklist sections; error and empty states; dark mode.
**DoD:** full flow works in the browser against the local server; a failed section does not break the page; the page is usable at 375 px width. Start showing it to 3+ real developers and record notes in `docs/TESTING_NOTES.md`.

### Phase 3: Architecture graph, P1 (16-19 Oct)
Tasks: `architecture.worker.ts` with timeout and memory limits; analyzer with folder aggregation; `ArchitectureSection` with React Flow, dagre layout, cycle highlighting, node side panel, search.
**DoD:** fixtures with a known circular dependency produce exactly that cycle; a repo with >400 files falls back to folder level; a deliberately slow/huge input times out cleanly without crashing the server.

### Phase 4: Dependency health + People, P1/P2 (20-22 Oct)
Tasks: `osv.ts`, `npmRegistry.ts`, `deps` analyzer; `people` analyzer; matching UI sections; update score to use real data.
**DoD:** a fixture with a known vulnerable package version (for example an old `lodash`) reports at least one vulnerability; no-lockfile repos show the "approximate" banner; OSV/registry failures degrade gracefully (section note, not a crash).

### Phase 5: Sharing and hardening (23-25 Oct)
Tasks: Markdown export; badge endpoint; recent list; commit-SHA caching; rate limits; helmet/cors; boot-time stale job cleanup; Dockerfile for the server; accessibility pass.
**DoD:** analyzing the same repo twice returns the cached result; the 11th analysis within an hour from one IP gets `RATE_LIMITED`; the badge renders in a README; Markdown download is clean.

### Phase 6: Test, deploy, document (26-28 Oct)
Tasks: run against 10+ varied public repos (small, medium, TS, plain JS, monorepo, non-JS) and fix crashes; deploy server + client + Atlas; write README (problem, screenshots, architecture, setup, limitations); record a 2-3 minute demo video; complete `docs/AI_LOG.md` and `docs/TESTING_NOTES.md`.
**DoD:** public URL works from a phone; **RepoReady analyzing its own repo scores >= 85**; README lets a stranger run the project locally in under 10 minutes.

### 29-30 Oct: buffer and submission
Only bug fixes. Submit a day early.

---

## 15. Testing plan

**Fixtures (`server/test/fixtures/`)** are tiny fake repos, each a folder of files:
- `simple-express`: `package.json` with express, `.env.example`, code using `process.env.DB_URL` and `process.env.SECRET` where only `DB_URL` is documented
- `ts-react`: tsconfig, vite, a few components importing each other
- `circular`: three files importing each other in a ring (a -> b -> c -> a)
- `no-package-json`: only a Python file and README
- `monorepo`: root `package.json` with `workspaces`
- `vulnerable-deps`: `package-lock.json` pinning an old known-vulnerable package version

**Unit tests:** one file per analyzer, plus `parseRepoUrl`, score math and markdown/badge builders.
**API tests (supertest):** mock the GitHub service; cover the happy path, invalid URL, not found, too large, cache hit, rate limit.
**UI tests (RTL):** RepoInput validation, progress state, failed-section card.
**Manual acceptance:** run 10+ real repos and note failures in `docs/TESTING_NOTES.md`.

---

## 16. Security and robustness checklist

- [ ] Only `github.com/<owner>/<repo>` is accepted; strict regex; never interpolated into shell commands
- [ ] Repo code is never executed; no install scripts run
- [ ] Temp directories always cleaned in `finally`; boot-time cleanup of leftover temp folders
- [ ] Size, file-count, byte and time caps enforced
- [ ] Worker thread has a timeout and memory limit
- [ ] GitHub token only in server env; never logged or returned
- [ ] CORS limited to the client origin; helmet enabled; JSON body limit small
- [ ] Rate limiting on analysis creation
- [ ] All external HTTP calls have timeouts and handle 403/429/5xx
- [ ] Report contents are rendered as text (React escaping); never use `dangerouslySetInnerHTML` with repo-derived content (README headings, descriptions, file names)

---

## 17. Documentation deliverables

**`README.md`:** problem, demo link, screenshots, features, architecture diagram, tech stack, local setup (clone, `.env`, `npm install`, `npm run dev`), env vars table, limitations, roadmap.

**`docs/AI_LOG.md` template** (add a row for every significant AI interaction):

| Date | Tool/model | What I asked | What went wrong or needed changing | How I fixed it | What I learned |
|---|---|---|---|---|---|

**`docs/TESTING_NOTES.md`:** each tester (role), what they tried, what confused them, what you changed.

**Demo video script (2-3 min):** problem (10s) -> paste a real repo (10s) -> progress -> walk through How to run, Env, Graph with a circular dependency, Dependencies, score (80s) -> the markdown export and badge (15s) -> how AI was used to build it and what you tested (20s).

---

## 18. Limitations to state honestly in the README

- Public GitHub repositories only; JavaScript/TypeScript analysis only
- Env-var detection is regex-based and can miss dynamically built names
- Dependency graph covers static imports only (no dynamic `require` with computed paths)
- Vulnerability results depend on OSV.dev; versions are approximate when no lockfile exists
- Very large repositories are rejected or shown at folder level
- Monorepos: root package only, workspaces are listed

---

## 19. Suggested prompt sequence for the AI

1. *"Read REPOREADY_BUILD_PLAN.md fully. Summarize the architecture back to me in 10 bullets and list any ambiguities. Do not write code yet."*
2. *"Implement Phase 0 exactly as specified. Show me the commands to run and the Definition of Done checks."*
3. After each phase: *"Implement Phase N. Write the tests first or alongside. When done, run the DoD checks and report pass/fail honestly."*
4. When something breaks: paste the exact error and the file, and ask for the smallest fix. Log it in `docs/AI_LOG.md`.
