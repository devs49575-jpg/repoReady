# Contributing to RepoReady

Thanks for helping! This guide covers everything you need to make a change and get it merged.

## Getting set up

Follow [Local setup](README.md#local-setup) in the README: Node 22.12+ (`nvm use`), MongoDB, a
`.env` copied from `.env.example`, then `npm install` and `npm run dev`.

## Before you open a pull request

Run the same checks CI runs (they all must pass):

```bash
npm run lint
npm run format:check   # or `npm run format` to fix
npm run typecheck
npm test               # needs MongoDB at MONGODB_URI_TEST or 127.0.0.1:27017
npm run build
```

Tests never touch the network. To check the dependency analyzer against the real OSV.dev and npm
registry, run `LIVE_TESTS=1 npx vitest run test/live` from `server/`.

## Ground rules

- **No AI/LLM features inside the product.** Every result must come from deterministic code:
  parsing, static analysis and public APIs.
- **Never execute analyzed code.** Read and parse files only; never install, run or `eval` anything
  from a repository.
- **Never leak a user's token.** Private-mode tokens must not reach logs, storage, responses, URLs
  or the architecture worker. `server/test/privateMode.test.ts` enforces this; keep it passing and
  extend it if you touch that flow.
- **Partial results beat failure.** An analyzer that fails should return `{ok:false}` with a clear
  message, not break the report.
- **Changing what an analyzer reports?** Bump `ENGINE_VERSION` in
  `server/src/pipeline/engineVersion.ts` so cached results from the old rules are not reused.
- Add or update tests with every change; fixtures for analyzers live in `server/test/fixtures`.

## Commit and PR style

Small, focused pull requests with a short description of the problem and the fix. Note any
user-visible change (report content, scoring, API) in the description.

## Reporting security issues

Please do not open a public issue for anything that could expose a user's token or private code.
Contact the maintainers privately instead.
