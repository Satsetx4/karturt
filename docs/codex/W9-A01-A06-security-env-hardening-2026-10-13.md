# Wave 9 A01–A06 — Security and Environment Loading

Date: 2026-10-13
Branch: `codex/w9-agent-a-20261013`
Baseline: `6aa044e37f8d0020562a99ebfdc56c03e1d86eb5`

## Result

**PASS for local code changes and focused checks.** No database, bootstrap, Neon, smoke, or migration entrypoint was run. No real `.env` contents or credential values were opened, copied, printed, or used. The worktree had only the tracked `.env.example` filename among root `.env*` files.

## Loader audit and changes

The audit found 19 explicit `loadEnvConfig()` calls across 18 files. They now call the shared preflight in `src/lib/env-file-preflight.ts` before invoking `@next/env`:

- `drizzle.config.ts`, `src/db/migrate.ts`, and `scripts/check-db.ts`.
- `scripts/bootstrap-rt.ts`, `scripts/bootstrap-initial-rt.ts`, and `scripts/provision-account.ts`.
- `scripts/launch-safety-integrity.ts` and `scripts/gate-c-financial-invariants-neon.ts`.
- `scripts/phase-4-5-neon-audit-check.ts`, `scripts/phase-5-neon-payment-request-smoke.ts`, `scripts/phase-5-1-http-smoke.ts`, and `scripts/phase-6-treasurer-verification-http-smoke.ts`.
- `scripts/phase-8-cash-payment-http-smoke.ts`, `scripts/phase-9-payment-reversal-http-smoke.ts`, `scripts/phase-10-waiver-http-smoke.ts`, and `scripts/phase-11-tariff-adjustment-http-smoke.ts` (two callsites).
- `scripts/phase-12-household-browser-smoke.ts` and `scripts/phase-12-1-post-smoke-lifecycle-audit.ts`.

When no project env file exists, the shared loader does not call `loadEnvConfig`. If one exists, it requires the parent process to provide matching `APP_ENV=development`, `DATABASE_ENV=development`, `KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD=1`, with no test, production, or CI mode. The guard never parses or logs file contents. The opt-in cannot be supplied from the file being guarded.

Next.js loads project `.env*` files itself during a production build. The `build` package script now runs `scripts/run-next-build.ts`, which rejects project env files before starting Next. Vitest performs the same filename-only check before tests and sets `envDir: false`.

Other process-environment readers such as `src/lib/env.ts`, `src/db/client.ts`, and the app metadata modules do not themselves load files. The account-password unit test reads the tracked `.env.example` template only; it does not access an ignored local env file.

## Bootstrap database allowlist

The bootstrap entrypoints still call `requireLocalDevelopmentBootstrapDatabaseEnvironment()` immediately after the guarded load. That guard requires explicit matching development labels, and `assertBootstrapDatabaseTarget()` accepts only the exact documented local PostgreSQL target for development. Test bootstrap requires in-memory PGlite with no `DATABASE_URL`; staging and production bootstrap targets are refused. Existing unit coverage exercises loopback allowlist acceptance and rejects host, port, database, protocol, URL-spoofing, staging, production, and test URL cases. No bootstrap or database operation was executed.

## Verification

- `npm ci --ignore-scripts --no-audit --no-fund` — exit 0; installed locked dependencies without running package install scripts.
- `npm run lint` — exit 0; 0 errors and 2 existing warnings at `scripts/phase-12-household-browser-smoke.ts:1005` and `src/lib/billing/resident-card.ts:91`.
- `npm run typecheck` — exit 0.
- `npx vitest run tests/unit/env-file-preflight.test.ts tests/unit/environment.test.ts` — exit 0; 2 files and 17 tests passed. The new negative tests use an in-memory synthetic environment, a generated secret canary, and a mocked loader; no real loader is invoked by the negative cases.
- `git diff --check` — exit 0.

Vitest emitted its existing Vite warning that the current config has imports unsupported by the future `configLoader: 'native'` default. The current test run succeeded.

## Limits

This is local source, lint, typecheck, and focused unit evidence. It does not prove runtime database behavior, PostgreSQL concurrency, a production build, provider safety, deployment readiness, or release readiness. All direct `.env` loader callsites found in the code audit are covered; tests and the standard `npm run build` path fail closed before environment-file reads.
