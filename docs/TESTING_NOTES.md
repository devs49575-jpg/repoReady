# Testing notes

Feedback from real developers who tried RepoReady, and what changed as a result.

| Date | Tester (role) | What they tried | What confused them | What we changed |
| ---- | ------------- | --------------- | ------------------ | --------------- |

## Manual acceptance runs

| Repo                      | Type                         | Result                                                                                   | Issues found                                                                                                                         |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| expressjs/cors            | Small JS library             | Done in ~6s, score 64                                                                    | No lockfile, so package manager shows "unknown"; install step defaults to `npm install`                                              |
| sindresorhus/ky           | TypeScript library           | Done in ~6s, score 67                                                                    | `xo` linter not recognized (fixed)                                                                                                   |
| torvalds/linux            | Huge C repo                  | Rejected: 422 REPO_TOO_LARGE                                                             | As expected                                                                                                                          |
| pmndrs/zustand            | TS library                   | Done in 10s, score 85, 67 files, 0 cycles                                                | None                                                                                                                                 |
| expressjs/express         | JS framework                 | Done in 7s                                                                               | Tests/examples counted as unused files (77 of 141); fixed by excluding test/example folders                                          |
| vuejs/core                | Large TS monorepo            | Done in 10s, 330 files, 89 cycles                                                        | Type-only imports produced 251 false cycles; fixed with skipTypeImports                                                              |
| typeorm/typeorm           | 586-file TS monorepo         | Done in 22s, folder level                                                                | Two-segment grouping put 500 files in one box; grouping depth is now adaptive (45 folders)                                           |
| bradtraversy/proshop_mern | Old MERN app, lockfile v1    | Score 39: 76 advisories (5 critical), 10 outdated majors/minors, 5 undocumented env vars | One run failed on a dropped GitHub connection (now retried); one run showed 0 outdated after registry timeouts (now retried + noted) |
| pmndrs/zustand            | TS library with package-lock | 582 packages, 18 high / 14 medium advisories (mostly dev tooling)                        | None                                                                                                                                 |

| jshttp/cookie | Tiny JS lib | Done 6s, 63 | - |
| fastify/fastify | JS framework | Done 7s, 48 (20 real cycles) | A stale second server marked its job failed; the result later finished with the old error attached (now cleared on success) |
| axios/axios | JS lib | Done 7s, 71 | - |
| remix-run/react-router | pnpm monorepo | Done 11s, 54 | - |
| shadcn-ui/taxonomy | Next.js app | Done 7s, 60 | - |
| vercel/commerce | Next.js app | Done 5s, 56 | - |
| trpc/trpc | TS monorepo | Done 15s, 92 (275 files) | - |
| colinhacks/zod | TS monorepo | Done 13s, 71 → 81 | Root README.md is a symlink; was reported missing (now copied from its in-repo target) |
| date-fns/date-fns | 1,696-file TS lib | Done 15s, 81, folder level (14 groups) | - |
| vitejs/vite | Large pnpm monorepo | Done 19s, 71, folder level (85 groups) | madge aborted the whole graph on .vue imports (now JS/TS-only traversal) |
| antfu/vitesse | Vue app | Done 5s, 92 | - |
| sveltejs/realworld | Svelte app | Done 5s, 53 | File-routed pages count as unused files (documented limitation) |
| tj/commander.js | JS CLI lib | Done 5s, 72 | - |
| pallets/flask | Python | Done 5s, 53 (partial report) | - |
| BurntSushi/ripgrep | Rust | Done 5s, 58 (partial report) | - |
| golang/example | Go | Done 5s, 47 (partial report) | - |
| octocat/Hello-World | README only | Done 3s, 32 | - |
| facebook/react, nestjs/nest, sveltejs/svelte, prisma/prisma-examples | Very large | 422 REPO_TOO_LARGE | As designed (100 MB limit) |
| RepoReady itself | This repo (local files) | 84 → 99/100 | Found: zod-validated env vars reported unused, fixture .env.example counted, LOG_LEVEL undocumented, no LICENSE/CONTRIBUTING, critical shell-quote advisory missed by npm audit |

## Browser checks (Phase 2)

Driven with playwright-core in Chrome at 1280 px (light) and 375 px (dark): invalid URL shows an inline error, analysis shows the progress stepper, the report renders with no console errors and no horizontal scroll. Found and fixed: dark-mode accent chips were unreadable (missing theme shades), Docker chips looked present when absent, score reasons repeated "not analyzed".

## Browser checks (Phase 3)

Architecture section checked in Chrome (desktop light, 375 px dark) on typeorm and vuejs/core: graph renders, node click opens the details panel, no console errors, no horizontal scroll. Fixed: the details panel resized the graph after fitView (now an overlay); 89 cycles made the section ~7,000 px tall (now the first 5 with "Show all").

## Browser checks (Phase 4)

Dependencies and People sections checked in Chrome (desktop light, 375 px dark) on proshop_mern: tables, severity chips and advisory links render, no console errors, no horizontal scroll. Fixed: "1256 days ago" now reads "3 years ago"; contributor links had a run-together accessible name ("ann40 commits").

## Browser checks (Phase P: private mode)

Chrome, server with PRIVATE_REPORT_TTL_MINUTES=1, a token on expressjs/cors (a token on a public repo still runs in private mode): form, help panel and privacy note render; report shows the private banner, countdown, Delete now and privacy line; robots meta is noindex. The token appeared only in the single POST X-GitHub-Token header (not URL, storage, cookies, server log or MongoDB; Mongo document count unchanged). The page switched to the expiry message by itself after 56 s and the API returned 404 REPORT_NOT_FOUND. Delete now on mobile (dark) worked and returned 404 afterwards; no horizontal scroll; no temp folders left. Fixed: "1 minutes" pluralization; home pitch said "public" only.

Still to do (manual, by the owner): analyze one of your own **private** repos with a fine-grained token.

## Phase 5 checks (production build)

Docker was not running locally, so the image's runtime stage was reproduced by hand (same files, npm ci --workspace server --omit=dev, built dist, NODE_ENV=production): pmndrs/jotai analyzed fully (92 TS files mapped by the bundled worker), JSON logs, HTTPS_REQUIRED for tokens over plain HTTP. On that server: the same commit again returned 200 cached:true; the 11th creation within the hour returned 429 RATE_LIMITED; the badge rendered as an image in light and dark README pages; the Markdown downloaded as pmndrs-jotai-onboarding.md and reads cleanly (fixed: "Node >=22" was escaped to "&gt;=22").

Accessibility: axe-core (WCAG 2.1 AA + best practices) on home, home with the private form, a public report, a private report and 404, in light and dark: 142 dark-mode contrast failures fixed, now 0.

**Still to do (owner):** run `docker build -t repoready-server .` once Docker Desktop is running.

## Production check (Phase 6)

Live at https://repo-ready-chi.vercel.app (client on Vercel) with the API at https://repoready-api.onrender.com (Render free, MongoDB Atlas). Verified 2026-10-07: CORS allows exactly the Vercel origin; RepoReady analyzing its own GitHub repo (devs49575-jpg/repoReady) scores **99/100** in 37 s with every section ok; in Chrome on desktop (light) and a 375 px phone (dark) the shared report link and a fresh analysis from the home page (sindresorhus/ky, 80) work with no console errors and no horizontal scroll.

Deployment issues found and fixed: CLIENT_ORIGIN was entered with a trailing slash, which blocks every browser request (the server now normalizes it to a bare origin); the redeploy then failed because Render's outbound IPs were not on the Atlas access list (fixed by adding Render's published outbound ranges, not 0.0.0.0/0).

## Real-developer sessions

Still to do (Phase 2 asks for 3+ developers). Fill in the table at the top after each session.
