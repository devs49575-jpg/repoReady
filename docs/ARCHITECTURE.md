# Architecture

RepoReady is an npm-workspaces monorepo:

| Workspace         | Purpose                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared` | Types and small helpers shared by client and server (`Report`, API DTOs, URL parsing, pipeline steps). Ships source; Vite and tsup bundle it. |
| `server`          | Express 5 API, MongoDB via Mongoose, in-memory job queue, analyzers, architecture worker thread.                                              |
| `client`          | React + Vite + Tailwind single-page app. Polls the API with TanStack Query.                                                                   |

## Request flow (public mode)

```
POST /api/analyses {repoUrl}                  (rate limit: 10/hour/IP, every attempt counts)
  -> validate URL -> GitHub metadata + head SHA (server GITHUB_TOKEN)
  -> reject repos GitHub marks private (they need private mode)
  -> cache: same repo + commit finished within CACHE_TTL_HOURS? -> 200 {id, cached:true}
            same repo + commit still running?                     -> 202 {id} (no second job)
  -> size check -> create Analysis in MongoDB (queued) -> job queue -> 202 {id}
client polls GET /api/analyses/:id every 2s until done/failed  (reads: 120/min/IP)
```

Sharing routes: `GET /api/analyses/:id/markdown` (both stores), `GET /api/analyses/recent` and
`GET /api/badge/:owner/:repo.svg`. The last two use `PublicAnalysisStore` queries, which only the
MongoDB store implements and which also filter out any report whose repo is private.

The job runner downloads the repo tarball (streamed, filtered, capped) to an owner-only temp dir,
runs each analyzer, saves progress after each step, and always deletes the temp dir. Each analyzer
result is wrapped in `SectionResult`, so one failure never sinks the whole report. Architecture
(madge in a worker thread), dependency health (OSV.dev + npm registry) and people (GitHub) run in
parallel.

## Storage abstraction

Routes and the pipeline only talk to the `AnalysisStore` interface (`server/src/stores`):

| Store                 | Holds            | Where          | Lifetime                                                                                           |
| --------------------- | ---------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `MongoAnalysisStore`  | public analyses  | MongoDB        | 30-day TTL index                                                                                   |
| `MemoryAnalysisStore` | private analyses | process memory | `PRIVATE_REPORT_TTL_MINUTES`, capped at `MAX_PRIVATE_REPORTS` (oldest evicted), swept every minute |

`storeFor(id)` picks the store by id: `p_` + 32 random chars means memory, anything else Mongo. The
Mongo store refuses to write a `p_` id, so a routing bug cannot leak a private report into MongoDB.

## Private flow (Addendum 01)

```
POST /api/analyses  + header X-GitHub-Token
  -> PRIVATE_MODE_ENABLED? -> HTTPS (production) -> token shape -> body/URL validation
  -> client = createGitHubClient(token)        token lives only in this closure
  -> client.getRepo + head commit               validates token, access, size
  -> (no cache read or write)
  -> MemoryAnalysisStore.create -> id p_xxxx…, expiresAt
  -> enqueue job (closure holds client + token for scrubbing errors)
  -> 202 {id, status, visibility:'private', expiresAt}

job: same pipeline, per-request client, writes only to the memory store
     worker thread gets {rootDir, tsConfigPath} only, with an empty env
     deps: only registry.npmjs.org packages leave the server; "skip lookups" sends none
     finally: references to client/token dropped, temp dir deleted

GET/DELETE /api/analyses/p_…   Cache-Control: no-store, X-Robots-Tag: noindex, Referrer-Policy: no-referrer
DELETE   cancels a running job and removes the report (public ids: 403 NOT_ALLOWED)
expired/deleted/unknown p_ ids: 404 REPORT_NOT_FOUND
```

## Logging and secrets

- Request logs contain only id, method and path (query strings dropped, `p_` ids truncated).
- `pino` redacts `authorization`, `cookie` and `x-github-token` headers as defense in depth.
- `sanitizeError(err, secrets)` scrubs tokens, URL query strings and `p_` ids from any error that is
  logged or stored. Private jobs log only the (truncated) job id, never the repo name.

## Safety

Repository code is only read, never executed. See the security checklist in the build plan and
Section 7 of the addendum.
