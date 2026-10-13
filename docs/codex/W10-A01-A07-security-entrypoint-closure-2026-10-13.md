# Wave 10 A01–A07 — Security and Environment Entrypoint Closure

Date: 2026-10-13 (Asia/Bangkok)
Branch: `codex/w10-agent-a-20261013`
Required baseline: `91fcdffb213ed842f6573190283495b554e27725`
Wave 9 tree: `9298f5b3c18a1c9643b8fb809761d46f7152f2e3`

## Result

**PASS for the local wrapper, guard, and bootstrap-target changes with focused checks.** No database or Neon command was run. No local `.env` values or credential values were read, copied, printed, or used. No cloud, provider, deploy, or CI operation was performed.

## Baseline and recovery artifact

The assigned worktree began clean at the required SHA and tree. The local Wave 9 candidate bundle was checked before edits:

| Check | Result |
| --- | --- |
| Bundle | `D:\!AGY\karturt-wave9-candidate-91fcdff-20261013.bundle` |
| SHA-256 | `0CB103A78779C61E41E5CEF79F810CCB15095C7220681264CF18EF8514E22247` |
| `git bundle verify` | Exit 0; complete history reported |
| `git bundle list-heads` | `91fcdffb213ed842f6573190283495b554e27725 refs/heads/codex/wave9-integration-20261013` |

The coordinator separately verified a named-ref restore against the same SHA/tree, clean status, and `git fsck --full --strict` exit 0.

## Next.js and repository entrypoints

The installed package is Next.js `16.3.8`. The installed guide `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md` documents automatic `.env*` loading and `@next/env`. The CLI guide is `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`.

The installed source confirms the ordering risk: `node_modules/next/dist/build/index.js` calls `loadEnvConfig(dir, false, ...)` before invoking the Next config loader; `node_modules/next/dist/server/config.js` also calls `loadEnvConfig` before evaluating the discovered config file. A guard inside `next.config.*` therefore runs too late for a bare `next build`.

Repository-owned entrypoints now behave as follows:

| Entry point | Guard |
| --- | --- |
| `npm run build` | Refuses any root project `.env*` file before starting Next. |
| `npm run start` | Refuses any root project `.env*` file before starting Next. |
| `npm run dev` | With project `.env*` files, requires parent-process `APP_ENV=development`, `DATABASE_ENV=development`, `KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD=1`, no production/test `NODE_ENV`, and no active `CI` marker. Without project env files, it uses process variables. |
| Vitest scripts | `vitest.config.mts` rejects project `.env*` files before test collection and has `envDir: false`. |
| Drizzle CLI | `drizzle.config.ts` calls the shared guarded loader before validating the database environment. |
| Database/bootstrap and browser-smoke tools | All direct repository `loadEnvConfig` calls route through `loadProjectEnvConfig`. The six scripts that spawn the Next CLI for browser/HTTP smokes call the guarded loader before spawning it. |
| Gate A CI | Its production build uses `npm run build`, so it passes through the build wrapper. Existing Drizzle and test steps pass through their guarded repository configs. |

`scripts/lib/next-command.ts` centralizes the preflight and CLI launch. The build wrapper uses it, and the dev/start package scripts now use dedicated wrappers. Arguments and exit codes are forwarded.

Direct arbitrary invocations such as `npx next build` or `node_modules/next/dist/bin/next build` bypass the repository wrappers. Next.js exposes no repository hook before its initial environment load, so those invocations cannot be reliably intercepted from `next.config.*`. Use the repository npm scripts; CI uses the wrapped build entrypoint. This is a workflow/CI mitigation, not a claim that all third-party CLI invocations are blocked.

## Synthetic canary and negative coverage

`tests/unit/next-command.test.ts` creates a temporary project with a generated synthetic `.env.local` canary, then calls the same wrapper helper with an injected mock launcher. Build/start are rejected before the launcher runs; dev is rejected without parent opt-in and accepted only with the matching development labels and explicit opt-in. The rejection messages are checked not to contain the canary. The test never invokes `loadEnvConfig` or reads the synthetic file contents back.

`tests/unit/environment.test.ts` directly exercises the bootstrap target allowlist. It permits only canonical `postgresql://karturt:<password>@localhost:5432/karturt_dev` under matching development labels, requires URL-free PGlite for tests, and rejects alternate host/port/database/protocol/URL forms, the approved staging Neon host, a production host, and production/staging labels. Bootstrap command flow calls this guard before `getDb()`; `src/db/client.ts` creates its lazy Pool only when `getDb()` is called after the guard. No bootstrap command or database operation was executed.

## Changed paths

- `scripts/lib/next-command.ts`
- `scripts/run-next-build.ts`
- `scripts/run-next-dev.ts`
- `scripts/run-next-start.ts`
- `package.json`
- `README.md`
- `tests/unit/next-command.test.ts`
- `tests/unit/environment.test.ts`
- `docs/codex/W10-A01-A07-security-entrypoint-closure-2026-10-13.md`

`package-lock.json` was unchanged.

## Local verification

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci --no-audit --no-fund` | 0 | 442 locked packages installed; no lockfile diff. npm printed existing allow-scripts/deprecation warnings. |
| `npx vitest run tests/unit/next-command.test.ts tests/unit/env-file-preflight.test.ts tests/unit/environment.test.ts --maxWorkers=1` | 0 | 3 files, 22 tests passed. Vite printed its existing future `configLoader: 'native'` compatibility warning. |
| `npm run typecheck` | 0 | Passed. |
| `npx eslint src/lib/env-file-preflight.ts scripts/lib/next-command.ts scripts/run-next-build.ts scripts/run-next-dev.ts scripts/run-next-start.ts tests/unit/next-command.test.ts tests/unit/environment.test.ts` | 0 | No findings. |
| `git diff --check` | 0 | No whitespace errors. |

## Evidence limits

These are focused local checks, not full-suite, exact-final-SHA build, production, CI, database, provider, or deployment evidence. The coordinator must rerun its required exact-final-SHA gates after integration. The development-file opt-in confirms the operator intends a local development load; it does not attest that an arbitrary `.env.local` database URL is the intended development branch. The dedicated bootstrap path remains constrained to its localhost allowlist.
