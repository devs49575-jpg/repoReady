# RepoReady: Addendum 01 (Private Repository Mode)

> **Status:** CHANGE REQUEST. It overrides any conflicting statement in `REPOREADY_BUILD_PLAN.md` (the "original plan", saved as [BUILD_PLAN.md](BUILD_PLAN.md)). Everything in the original plan that is not mentioned here stays as it is.
> **Situation:** the project is already partly built from the original plan, which supported **public repos only**. This addendum adds **private repo support** and tells you how to adapt both the plan and the code that already exists.

---

## 0. Instructions to the AI (read first)

1. **Do not write any code yet.** First do **Step A (audit)** in Section 2 and report back. Wait for confirmation if anything is ambiguous.
2. After the audit, apply the changes in the order given in Section 9. Keep each step small, run lint/typecheck/tests after each one, and report results honestly.
3. The original plan's rules still hold: **no AI/LLM inside the product**, free services only, never execute code from analyzed repos, do not invent library APIs (verify against installed versions and official GitHub API docs).
4. **Security takes priority over convenience.** A user's GitHub token and private source code are sensitive. If a requirement here conflicts with an easier implementation, follow the requirement.
5. Existing public-repo behavior must **not regress**. All existing tests must keep passing.
6. Log significant AI-assisted work in `docs/AI_LOG.md`.

---

## 1. Feature summary and decisions

**Private Repo Mode:** a user can analyze a **private** GitHub repo by supplying their own **fine-grained, read-only personal access token**. The server uses the token only for the duration of the analysis, never stores it, and keeps the resulting report **in memory only** with automatic expiry.

### Decisions (already made, do not re-debate)

| Topic | Decision |
|---|---|
| Auth method | User-provided **fine-grained PAT** (read-only: Contents and Metadata). No OAuth, no GitHub App in this phase |
| How private mode is triggered | Presence of the `X-GitHub-Token` request header on `POST /api/analyses`. No token means public mode |
| Token storage | **Never** stored: not in MongoDB, not in files, not in logs, not in browser storage, not in URLs |
| Report storage (private) | **In-memory store only**, TTL **60 minutes** (configurable), capped count with oldest-first eviction. **Not written to MongoDB** |
| Report storage (public) | Unchanged (MongoDB) |
| Caching | **Disabled** for private mode (no read, no write) |
| Visibility of private reports | Not in "recent analyses", no badge, not indexable, only reachable via an unguessable ID |
| ID format | Public: unchanged. Private: `p_` + `nanoid(32)` |
| Token supplied for a repo that turns out to be public | Still treated as private mode (safest, simplest) |
| External lookups | Private mode includes an opt-out ("skip dependency lookups") and filters out non-npm-registry packages (see 5.7) |
| Hosting assumption | **Single server instance** (the in-memory store is not shared). Document this |
| Feature flag | `PRIVATE_MODE_ENABLED` env var; when false the feature is hidden and the server rejects tokens |

---

## 2. Step A: Audit the current state (do this first)

Inspect the repository and produce a short report, **before changing anything**:

1. **Phase status:** which phases from the original plan (0-6) are complete, partial, or not started.
2. **Module map:** for each file below, say whether it exists, is partial, or is missing, and note anything that deviates from the plan:
   - `server`: `config.ts`, `app.ts`, `routes/analyses.ts`, `routes/badge.ts`, `models/Analysis.ts`, `queue/jobQueue.ts`, `pipeline/runAnalysis.ts`, `services/github.ts`, `services/repoFetcher.ts`, `services/osv.ts`, `services/npmRegistry.ts`, `analyzers/*`, `workers/architecture.worker.ts`
   - `client`: `RepoInput.tsx`, `Report.tsx`, `ProgressStepper.tsx`, `RecentList.tsx`, `api/client.ts`, `api/hooks.ts`
   - `packages/shared/src/report.ts`
3. **Token-sensitive spots:** list every place that currently uses `GITHUB_TOKEN` or builds GitHub request headers, every place that logs request data, every place that writes to MongoDB, and every place that reads from the cache.
4. **Gaps and risks** you see for this change (for example, a global GitHub client constructed once with the server token, analyzers that call GitHub directly, report data saved before the pipeline finishes).
5. **Proposed plan:** the exact ordered steps you will take, mapped to Section 9.

Report this audit, then proceed.

---

## 3. Changes to the original plan (supersedes table)

| Original plan section | Change |
|---|---|
| 1. Scope boundaries | "Public GitHub repos" becomes "Public repos, plus private repos via user-supplied read-only token (Addendum 01)". "No login/accounts" still true |
| 3. Tech stack | No new runtime libraries are required. Optional: none. (`pino` redaction, `nanoid` and `zod` are already in the stack) |
| 5. Environment variables | Add `PRIVATE_MODE_ENABLED`, `PRIVATE_REPORT_TTL_MINUTES`, `MAX_PRIVATE_REPORTS` (Section 5.1) |
| 6. Data flow | Add a private branch: token check, memory store, no cache, token dropped after the job (Section 5.4) |
| 7. Shared types | Add `isPrivate` to `RepoMeta`, add `PrivacyInfo`, add `privacy` to `Report`, add API response fields (Section 5.2) |
| 8.7 Dependency health | Add the private-mode filter and the opt-out (Section 5.7) |
| 8.8 People | Must use the per-request GitHub client, not a global one (Section 5.3) |
| 9. Repo fetching | Download with the per-request client; temp dir created with owner-only permissions (Section 5.6) |
| 10. Backend API | New header, new error codes, new `DELETE` and `config` routes, new response headers (Section 5.5) |
| 11. Database model | **Unchanged.** MongoDB holds public analyses only. Add a note that private analyses must never reach it |
| 12. Frontend | Token field, private banner, delete button, no gallery or badge for private (Section 6) |
| 13. Markdown export and badge | Markdown allowed for private reports. **Badge is never available for private repos** |
| 14. Phases | Insert **Phase P** (Section 9). Phases 5 and 6 shift later |
| 15. Testing | Add the private-mode tests in Section 8 |
| 16. Security checklist | Add the items in Section 7 |
| 18. Limitations | Add the private-mode limitations in Section 10 |

---

## 4. Terminology

- **Private mode:** a request that carries a GitHub token.
- **Public mode:** a request with no token (existing behavior).
- **Private report:** a report created in private mode, stored only in memory, ID starts with `p_`.

---

## 5. Detailed specification

### 5.1 Configuration (`server/src/config.ts`, validated with zod)

| Name | Default | Purpose |
|---|---|---|
| `PRIVATE_MODE_ENABLED` | `true` | Feature flag. When `false`, requests with a token get `400 PRIVATE_MODE_DISABLED` and `GET /api/config` reports it as disabled |
| `PRIVATE_REPORT_TTL_MINUTES` | `60` | Lifetime of a private report in memory |
| `MAX_PRIVATE_REPORTS` | `50` | Max private reports held at once; evict the oldest when exceeded |

`GITHUB_TOKEN` (server token) remains and is used **only for public mode**. Update `.env.example` for all new variables.

### 5.2 Shared types (`packages/shared/src/report.ts`)

```ts
export type Visibility = 'public' | 'private';

export interface PrivacyInfo {
  visibility: Visibility;
  expiresAt: string | null;       // ISO date; null for public reports
  externalLookups: boolean;       // false if the user skipped dependency lookups
}

// RepoMeta: add
//   isPrivate: boolean;

// Report: add
//   privacy: PrivacyInfo;

// API response for create and get: add
export interface AnalysisResponseExtras {
  visibility: Visibility;
  expiresAt: string | null;
}
```

Keep the client and server in sync. Fix any compile errors this creates (older stored public reports without `privacy` must still render: treat missing `privacy` as `{visibility:'public', expiresAt:null, externalLookups:true}`).

### 5.3 Per-request GitHub client (`services/github.ts`)

**Problem to fix if present:** a global client or global headers using `GITHUB_TOKEN`.

Replace with a factory:

```ts
export interface GitHubClient {
  getRepo(owner: string, repo: string): Promise<GitHubRepo>;
  getLanguages(owner: string, repo: string): Promise<Record<string, number>>;
  getContributors(owner: string, repo: string): Promise<...>;
  getCommits(owner: string, repo: string, opts: { path?: string; perPage?: number }): Promise<...>;
  streamTarball(owner: string, repo: string, sha: string): Promise<ReadableStream | NodeJS.ReadableStream>;
}
export function createGitHubClient(token?: string): GitHubClient;
```

Rules:
- `createGitHubClient(config.GITHUB_TOKEN)` for public mode; `createGitHubClient(userToken)` for private mode.
- The token lives **only** inside the closure. It must not be a property of any object that gets serialized, logged, saved, or passed to a worker thread.
- Analyzers and pipeline steps receive the **client object** (for example `ctx.github`), never the raw token. Update `AnalyzerContext` accordingly (add `github: GitHubClient`; do not add a token field).
- Map GitHub responses to errors (details in 5.5): 401 means `INVALID_TOKEN`; 404 means `REPO_NOT_FOUND`; a 403 whose `x-github-sso` header is present means `SSO_REQUIRED`; a 403 that is a rate limit means `GITHUB_RATE_LIMITED`; any other 403 means `TOKEN_PERMISSIONS`.
- For classic tokens, if the response header `x-oauth-scopes` contains `repo`, attach a non-blocking `warnings` entry to the job ("Prefer a fine-grained read-only token"). Optional, low priority.
- **Verify against GitHub's current docs** which fine-grained permissions each endpoint needs (Contents: read-only and Metadata: read-only are expected for tarball, commits, contributors) and adjust the UI help text if reality differs.

### 5.4 Storage abstraction and flow

Introduce an interface so routes and the pipeline do not care where a report lives:

```ts
export interface AnalysisStore {
  create(doc: NewAnalysis): Promise<StoredAnalysis>;
  get(id: string): Promise<StoredAnalysis | null>;
  update(id: string, patch: Partial<StoredAnalysis>): Promise<void>;
  delete?(id: string): Promise<boolean>;
}
```

- `MongoAnalysisStore`: wraps the existing Mongoose model (public).
- `MemoryAnalysisStore`: a `Map<string, {doc, expiresAt}>` for private reports.
  - TTL from `PRIVATE_REPORT_TTL_MINUTES`; a sweep every 60 seconds removes expired entries (`setInterval(...).unref()`).
  - Cap at `MAX_PRIVATE_REPORTS`; evict oldest when full.
  - `get` must treat an expired entry as missing even if the sweep has not run yet.
  - Implements `delete`.
- Selection rule: `id.startsWith('p_')` means memory store, otherwise Mongo. One helper `storeFor(id)` and one `storeForMode(mode)`.

**Private flow (replaces the public flow only when a token is present):**

```
POST /api/analyses  (header X-GitHub-Token present)
  -> checks: PRIVATE_MODE_ENABLED, HTTPS in production, token shape, zod body
  -> client = createGitHubClient(token)
  -> client.getRepo(): validates token + access + size (fast, synchronous)
  -> SKIP cache lookup
  -> create analysis in MemoryAnalysisStore with id 'p_' + nanoid(32), expiresAt
  -> enqueue job; the job closure holds `client` (and thus the token) in memory only
  -> respond 202 { id, status:'queued', visibility:'private', expiresAt }
Job runs the same pipeline using `client`.
On finish, failure, timeout or cancel: drop references to the client/token (set to undefined) and delete temp dir.
Result is saved to the memory store only. NEVER to MongoDB.
```

### 5.5 API changes

**New request header (POST /api/analyses):** `X-GitHub-Token: <token>`
- Token shape check (loose, to avoid rejecting valid formats): `^[A-Za-z0-9_]{20,255}$`. Failing it returns `400 INVALID_TOKEN` **without echoing the token**.
- In production, if the header is present and the request is not HTTPS (`req.secure` is false; set `app.set('trust proxy', 1)` appropriately for the host), return `400 HTTPS_REQUIRED`.
- **CORS:** add `X-GitHub-Token` to `allowedHeaders` (otherwise browser preflight fails).

**Body (zod):** `{ repoUrl: string, skipExternalLookups?: boolean }`

**Responses:**
- `POST` private: `202 { id: 'p_...', status: 'queued', visibility: 'private', expiresAt }`
- `GET /api/analyses/:id` (any id): add `visibility` and `expiresAt` to the response. For `p_` ids read from memory.
- `GET /api/analyses/:id/markdown`: works for both stores.
- **New:** `DELETE /api/analyses/:id`: allowed **only** for `p_` ids. Deletes from memory and cancels the job if still running. Returns `204`. For non-private ids return `403 NOT_ALLOWED`.
- **New:** `GET /api/config`: returns `{ privateModeEnabled: boolean, privateReportTtlMinutes: number }` so the client can show or hide the feature.
- `GET /api/analyses/recent`: **must never include private reports** (it only queries MongoDB, so confirm no private data can reach it).
- `GET /api/badge/:owner/:repo.svg`: **must never expose private repo scores** (it only queries MongoDB; add an explicit guard and a test).

**Headers on every response for a `p_` id:** `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`.

**New error codes** (same `{error:{code,message}}` shape; messages must never contain the token):

| Code | HTTP | When |
|---|---|---|
| `INVALID_TOKEN` | 401 / 400 | GitHub returns 401, or token shape is invalid |
| `REPO_NOT_FOUND` | 404 | Repo missing **or** the token has no access (GitHub returns 404 for both). Message in private mode: "Repository not found, or the token does not have access to it" |
| `SSO_REQUIRED` | 403 | GitHub signals SSO authorization is required for the token (`x-github-sso` header) |
| `TOKEN_PERMISSIONS` | 403 | Token lacks required read permissions |
| `PRIVATE_MODE_DISABLED` | 400 | Feature flag off |
| `HTTPS_REQUIRED` | 400 | Token sent over plain HTTP in production |
| `REPORT_NOT_FOUND` | 404 | Unknown, expired or deleted private report. Message: "This report has expired or was deleted" |
| `NOT_ALLOWED` | 403 | DELETE on a public analysis |

Existing codes (`INVALID_URL`, `REPO_TOO_LARGE`, `GITHUB_RATE_LIMITED`, etc.) are unchanged.

**Rate limiting:** private creations use the same limiter as public ones (per-IP, 10 per hour). Consider counting failed token attempts the same way to slow token guessing.

### 5.6 Pipeline, fetcher and logging

- `pipeline/runAnalysis.ts`: receives the `GitHubClient` and `AnalysisStore` as parameters (no globals). Write progress and results through the store. Private jobs never call Mongoose.
- `services/repoFetcher.ts`: use `client.streamTarball(...)`. Create the temp dir with owner-only permissions (`fs.mkdtemp` then `chmod 0o700`). Keep the existing `finally` cleanup, and **also** clean up on `SIGINT`/`SIGTERM`. The boot-time sweep of leftover temp folders must remain.
- `workers/architecture.worker.ts`: receives only `rootDir` and options. **Never** pass the token, the client, or any report data containing secrets into the worker message.
- **Logging (`pino`):**
  - Configure `redact` for `req.headers["x-github-token"]`, `req.headers.authorization`, `req.headers.cookie`.
  - Never log request bodies or full headers.
  - For private analyses, **do not log the repo name**; log only the job id.
  - Wrap job errors with a `sanitizeError(err, secrets: string[])` helper that replaces any occurrence of the token with `[REDACTED]` in messages and stacks before logging or storing the error.
- Errors stored in a private analysis (`error.message`) must be sanitized and must not include request headers.

### 5.7 Dependency health in private mode (`analyzers/deps.ts`)

Package names are the only data that leaves the server (to OSV.dev and the npm registry), and internal package names can be sensitive.

1. **Opt-out:** if `skipExternalLookups` is true, skip the OSV and npm registry calls. Return `{ok:false, error:'Skipped: external dependency lookups were disabled'}`. The existing score rule (award 10 and note when the deps section fails) applies. Set `privacy.externalLookups=false`.
2. **Filter:** in private mode with a lockfile, only look up packages whose `resolved` URL host is `registry.npmjs.org`. Skip packages with no `resolved` (workspace/link/file) or a different host (private registries, git URLs). Record how many were skipped in the section output (add `skippedPackages: number` to `DepsInfo`).
3. Without a lockfile in private mode, look up direct dependencies as usual but show a notice: "Package names were sent to public registries; enable 'skip dependency lookups' to prevent this".
4. The UI must display what happened (Section 6).

### 5.8 Things that must not change for public mode

Caching by commit SHA, MongoDB persistence, recent gallery, badge, and the server `GITHUB_TOKEN` usage all remain exactly as in the original plan.

---

## 6. Frontend changes

**`api/client.ts`**
- Add `getConfig()`, `deleteAnalysis(id)`.
- `createAnalysis({repoUrl, token?, skipExternalLookups?})` sends the token **only** in the `X-GitHub-Token` header on that one POST.
- Do **not** use a TanStack Query mutation (or any cache that retains variables) for the create call with the token. Use a plain `fetch`, or call `mutation.reset()` immediately, so the token is not retained in a cache or devtools.
- Never put the token in a URL, query string, `localStorage`, `sessionStorage`, cookies, or React Query keys.

**`RepoInput.tsx`**
- Checkbox "Private repository" (shown only if `config.privateModeEnabled`).
- When checked, show: a password-type token input (`autoComplete="off"`, `spellCheck={false}`), a "Skip dependency lookups (no package names leave this server)" checkbox, and a collapsible help panel:
  1. GitHub: Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.
  2. Resource owner: the owner of the repo. Repository access: "Only select repositories", then pick the one repo.
  3. Permissions: Contents (read-only) and Metadata (read-only). Nothing else.
  4. Short expiry (for example 7 days). Copy the token and paste it here.
  5. Org repos: an org admin may need to approve fine-grained tokens, and SSO-protected orgs require authorizing the token.
- Privacy note (always visible in private mode): "Your token is sent over HTTPS, used only while your repo is analyzed, and never saved. The report is kept in memory for {ttl} minutes and then deleted. No one can browse it without the link."
- Hold the token in component state only; **clear it immediately after submit** (success or failure).
- Client-side validation: non-empty, loose shape check, clear inline errors. Map new error codes to friendly messages (especially `SSO_REQUIRED`, `TOKEN_PERMISSIONS`, `REPO_NOT_FOUND` in private mode, `INVALID_TOKEN`).

**`Report.tsx` (when the id starts with `p_` or `privacy.visibility === 'private'`)**
- Add `<meta name="robots" content="noindex, nofollow">` and `<meta name="referrer" content="no-referrer">`; external links get `rel="noopener noreferrer"`.
- New `PrivateBanner` component at the top: "Private report. Only people with this link can view it. Auto-deletes in MM:SS", with a live countdown to `expiresAt`.
- "Delete now" button (confirm dialog), which calls `DELETE`, then navigates home.
- **Hide:** "Copy badge Markdown", and anything that implies public sharing. Keep "Download Markdown" and "Copy link" (the link works for anyone who has it until expiry).
- Show a small "Privacy" line: whether dependency lookups were performed or skipped, and how many packages were skipped (`skippedPackages`).
- On `REPORT_NOT_FOUND` for a `p_` id, show an `ErrorState`: "This private report has expired or was deleted. Run the analysis again."
- Disable polling retries on 404.

**`RecentList.tsx`**: unchanged (it only shows public analyses). Add a test confirming private reports never appear.

**`ProgressStepper.tsx`**: unchanged.

---

## 7. Security requirements (acceptance gates)

The token must **never** appear in any of these. Add automated tests for the ones marked (T):

- [ ] MongoDB documents (T)
- [ ] Any file on disk, including the temp analysis folder
- [ ] Server logs, including error logs and request logs (T)
- [ ] API responses, including error responses (T)
- [ ] Messages sent to the architecture worker (T)
- [ ] The browser's `localStorage`, `sessionStorage`, cookies, URL, or React Query cache (T for URL and storage)
- [ ] Stored `error.message` values (T)

Also required:
- [ ] Private reports never written to MongoDB (T)
- [ ] Private reports never returned by `/recent`, never badge-able, never cache-hit (T)
- [ ] `no-store`, `noindex`, `no-referrer` set for `p_` ids (T)
- [ ] Private ID is `p_` + 32 random chars (not sequential or guessable)
- [ ] Expired and deleted reports return `404 REPORT_NOT_FOUND` (T)
- [ ] Memory store capped and swept; no unbounded growth (T)
- [ ] Temp folder deleted after success, failure, timeout, and cancel (T)
- [ ] CORS allows `X-GitHub-Token`; HTTPS enforced in production when the header is present
- [ ] With `PRIVATE_MODE_ENABLED=false`, the server rejects tokens and the UI hides the feature (T)

---

## 8. Tests to add

**Server (Vitest + supertest, GitHub mocked):**
1. Private happy path: token header leads to a `p_` id, a finished report in memory, and **no** Mongo write.
2. Cache bypass: analyzing the same public repo with and without a token does not share or write cache entries in private mode.
3. `/recent` and the badge exclude private analyses.
4. Error mapping: 401 gives `INVALID_TOKEN`; 404 gives `REPO_NOT_FOUND` (private message); 403 with `x-github-sso` gives `SSO_REQUIRED`; 403 rate limit gives `GITHUB_RATE_LIMITED`; other 403 gives `TOKEN_PERMISSIONS`.
5. **Token leak test:** run a private analysis with a recognizable fake token (`github_pat_TESTSECRET0123456789`) and assert the string is absent from: all HTTP responses (success and error paths), captured pino output, the memory store's serialized contents, the Mongo collection (use the test DB), the worker message, and the temp directory.
6. Memory store: TTL expiry, sweep, max-size eviction, delete, and `get` of an expired entry returns null.
7. `DELETE`: works for `p_`, returns 403 for public ids, cancels a running job.
8. Deps filter: lockfile with a private-registry `resolved` URL is skipped and counted; `skipExternalLookups` skips the OSV and npm calls entirely (assert with mocks that they are never called).
9. Flag off: header present gives `PRIVATE_MODE_DISABLED`.
10. HTTPS rule: header over non-secure request in production mode gives `HTTPS_REQUIRED`.
11. Regression: all existing public-mode tests still pass unchanged.

**Client (React Testing Library):**
1. The token field appears only with the checkbox and only if the config enables it; it is `type="password"`.
2. The token is cleared from state after submit.
3. The private banner shows a countdown; Delete now calls the API; the badge button is hidden.
4. `REPORT_NOT_FOUND` for a `p_` id shows the expiry message.
5. The token never appears in `window.location`, `localStorage`, or `sessionStorage` after a submit.

**Manual acceptance:** analyze one of your own private repos with a fine-grained token end to end; confirm that after expiry the link returns the expiry message; confirm that the same token, repo, and run leave nothing in MongoDB.

---

## 9. Migration order (apply in this sequence)

**Step B1: Cheap structural refactors (do these now, whatever phase you are in):**
1. Introduce `createGitHubClient(token?)` and replace every direct/global GitHub call with it (5.3). Existing public behavior must stay identical.
2. Introduce the `AnalysisStore` interface with `MongoAnalysisStore` wrapping the current model; route all existing reads and writes through it (5.4). No behavior change yet.
3. Add the pino redaction config and the `sanitizeError` helper (5.6).
4. Update the shared types (5.2) and fix compile errors. Run lint, typecheck and tests, and confirm all existing tests pass.

**Step B2: Add Phase P: Private Repo Mode.** Insert it **before** Phase 5 (Sharing and hardening). It adds about 2 days of work and shifts Phases 5 and 6 later; the 29-30 Oct buffer stays untouched. If time runs short, cut the P2 items (recent gallery, badge polish) first, never the security gates in Section 7.

Phase P tasks:
1. Config and flag (5.1), `GET /api/config`.
2. `MemoryAnalysisStore` with TTL, sweep, cap (5.4).
3. POST changes: header handling, validation, HTTPS rule, CORS header, `p_` ids, the private flow (5.4 and 5.5).
4. GET/DELETE changes, response headers, new error codes (5.5).
5. Pipeline and fetcher changes: per-request client, temp dir permissions, cleanup on signals, worker isolation (5.6).
6. Deps filter and opt-out (5.7). `people` analyzer uses `ctx.github`.
7. Frontend changes (Section 6).
8. Tests from Section 8.
9. Docs updates (Section 11).

**Phase P Definition of Done:**
- All Section 7 gates satisfied, with the (T) items covered by passing automated tests.
- The full test suite (existing plus new) passes, along with lint and typecheck.
- A private repo analyzes successfully end to end in the browser using a fine-grained token, and the report disappears after the TTL.
- Public mode behaves exactly as before.

**If Phase 5/6 work already exists:** re-check caching, recent gallery, badge, rate limiting and the Dockerfile against this addendum. In particular confirm the cache lookup is skipped for token requests and that the badge and recent routes cannot read the memory store.

---

## 10. Limitations to document (add to README section 18 of the original plan)

- Private reports live in server memory only. They are lost on server restart and are not shared across multiple instances, so run a **single instance**.
- Users must create a fine-grained token themselves; organizations may require admin approval or SSO authorization.
- The user's private code is processed on the RepoReady server while the analysis runs. For maximum control, users can run RepoReady themselves (document `docker compose up` or the local setup).
- Dependency checks send package names and versions to OSV.dev and the npm registry. In private mode, non-npm-registry packages are skipped, and users can turn lookups off entirely.
- GitHub App / OAuth integration is a possible future improvement, not implemented.

---

## 11. Documentation updates

- **README:** add a "Private repositories" section (how to create the token, what is and isn't stored, TTL, limitations in Section 10) and a security note.
- **`docs/ARCHITECTURE.md`:** add the store abstraction and the private flow diagram.
- **`.env.example`:** add the three new variables with comments.
- **`docs/AI_LOG.md`:** add entries for this change (what you asked, what the AI got wrong, how it was fixed).
- **Demo video:** add a 15-second private-repo segment: "paste a private repo with a read-only token, get the report, and see it auto-delete".

---

## 12. Prompt to give the AI

> Read `REPOREADY_BUILD_PLAN.md` and `REPOREADY_ADDENDUM_01_PRIVATE_REPOS.md`. The addendum overrides the plan where they conflict. Do **Step A (audit)** from Section 2 of the addendum now: inspect the current code, report what is done versus the plan, list token-sensitive spots and risks, and propose your ordered steps. Do not change any code until you have reported the audit. Then apply Step B1, run lint, typecheck and the test suite, and report. After that, implement Phase P in the order given, and finish by running the Section 8 tests and reporting each Section 7 gate as pass or fail.

---

## Appendix: decisions confirmed after the Step A audit (2026-10-06)

The audit found only Phase 0 built, so Step B1 items 1-2 (GitHub client factory, `AnalysisStore`) are designed in during Phase 1 rather than refactored. The owner confirmed:

1. **Public-mode private-repo guard:** in public mode (no user token), if GitHub reports `private: true` the server returns `REPO_NOT_FOUND`, so a server `GITHUB_TOKEN` that can see private repos never puts private code into MongoDB, `/recent` or badges.
2. **Truncate private IDs in logs:** `p_` IDs are access secrets, so logs show only the first 4 characters after `p_`.
3. **MongoDB service in CI** for the token-leak test.
4. **Plan files saved in `docs/`** (this file and `BUILD_PLAN.md`).

Also from the audit: the pipeline, fetcher and GitHub client take an `AbortSignal` from Phase 1 (needed for timeout and `DELETE` cancel), and logs/errors never include fetch URLs with query strings (the tarball redirect to `codeload.github.com` carries a short-lived credential).
