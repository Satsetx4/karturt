# W8-B01–B08 PostgreSQL Runner Report

Date: 2026-10-13
Worktree: D:\AGY\karturt-wave8-agent-b-20261013
Branch: codex/w8-agent-b-20261013
Base SHA: 34a2af3195a09220a6639bdcb2aff369a813d5c2
Scope: Agent B only. No push, provider/production/demo/F3/DNS access, Neon access, cloud resource creation, or real WhatsApp send.

## Per-task result

| Task | Result | Evidence / limitation |
| --- | --- | --- |
| W8-B01 — audit existing PostgreSQL runner | PASS | Replaced the fixed database/user target with names derived from a per-run identity. Runner rejects remote hosts, non-loopback names, mismatched database/user, ambiguous URL parameters, or missing test environment before opening a connection. |
| W8-B02 — positive identity guard | PASS | A random per-run token is stored as a database comment. The runner verifies database, user, marker, and empty user relations before migrations. Four focused unit tests pass. |
| W8-B03 — scoped teardown and fixtures | PASS (static; runtime unverified) | Local runner uses a unique container name and ownership label, --pull=never, tmpfs, loopback-only dynamic port, and removes only the exact container after rechecking its label. CI service DB/user and evidence file are run-scoped. Suite fixtures live only in that disposable database and are bounded by local container teardown or the GitHub job service lifecycle. Runtime cleanup could not be exercised because no local engine exists. |
| W8-B04 — local engine/database preflight | BLOCKED | Read-only lookup found no Docker, Podman, psql, pg_isready, pg_ctl, or initdb; no listener was found on local port 5432. No existing PostgreSQL was used. |
| W8-B05 — five independent PostgreSQL races | NOT RUN / BLOCKED | No safe disposable PostgreSQL engine or already-local postgres:17 image was available. No image pull, connection, migration, or database resource creation occurred. |
| W8-B06 — full suite and financial/tenant regression | PASS | npm test -- --maxWorkers=1: exit 0; 70 test files, 453 tests passed (including financial, integration, constraints, authorization, and tenant coverage). This suite uses PGlite and does not establish independent PostgreSQL lock contention. |
| W8-B07 — lint, type, Drizzle, schema | PASS with notes | Final npm run lint: exit 0, two pre-existing warnings in untouched files. Final npm run typecheck: exit 0. Drizzle check using an isolated config: exit 0. Schema generation against a copy of drizzle/: exit 0, 27 tables, no schema changes. git diff --check: exit 0. |
| W8-B08 — dependency audit and report | FINDINGS RECORDED | npm audit --json: exit 1, five HIGH findings remain; no speculative dependency upgrade or fix was applied. Findings: direct eslint-config-next; transitive @next/eslint-plugin-next, braces, fast-glob, and micromatch. |

## Changes made

- Added a local disposable PostgreSQL wrapper and shared identity validation helper.
- Added GitHub Actions-only initialization that verifies the fresh service identity and empty database, writes a random marker, and exports the run identity without printing its token.
- Hardened the concurrency runner to require that marker before migration and write evidence with exclusive-create semantics.
- Scoped the GitHub service DB/user, mapped port, and evidence path to the workflow run.
- The Windows child launch uses process.execPath and the locally installed node_modules/tsx/dist/cli.mjs; that CLI path was verified to exist. It does not execute npm.cmd.

## Commands and exit codes

| Command / check | Exit | Result |
| --- | ---: | --- |
| npm ci | 0 | 442 packages installed; npm reported five HIGH audit findings. |
| npm run lint (final rerun) | 0 | 0 errors; warnings at scripts/phase-12-household-browser-smoke.ts:1005 and src/lib/billing/resident-card.ts:91, both untouched. |
| npm run typecheck (final rerun) | 0 | TypeScript check passed. |
| npx vitest run tests/unit/disposable-postgres-identity.test.ts --maxWorkers=1 | 0 | 1 file, 4 tests passed. |
| npm test -- --maxWorkers=1 | 0 | 70 files, 453 tests passed; 338.18 seconds. |
| npm run test:postgres-concurrency | 1 | Expected safe block: no Docker/Podman local engine; no PostgreSQL connection/resource created. |
| npm run test:postgres-concurrency:runner with APP_ENV=test, DATABASE_ENV=test, and no run identity | 1 | Expected fail-closed guard: run-scoped identity required; no connection opened. |
| npm audit --json | 1 | Five HIGH dependency findings remain; no dependency changes made. |
| npx drizzle-kit check using repository config | 1 | Config guard stopped the check because explicit application/database environment was absent; no DB connection occurred. |
| npx drizzle-kit check --config <isolated temporary config> | 0 | Migration journal check passed offline. |
| npx drizzle-kit generate --config <isolated temporary config> --name w8_agent_b_drift_check against a temporary copy of drizzle/ | 0 | 27 tables; “No schema changes, nothing to migrate”; no repo migrations were generated or applied. |
| git diff --check | 0 | No whitespace errors. |

## Safety and evidence limits

The PostgreSQL preflight was read-only. No .env.local contents or secret values were printed. One diagnostic invocation of the repository Drizzle config called its loadEnvConfig(process.cwd()) loader before the environment guard stopped the check. The loader may have loaded local environment files; no values were logged, copied, or used to connect to a database. Subsequent Drizzle checks used an isolated temporary config without that loader. This is recorded as a process deviation for coordinator review.

No Neon endpoint was connected, woken, queried, or migrated. No existing local database was used. The real five-race PostgreSQL proof, runtime fixture teardown, and the changed GitHub Actions workflow remain unexecuted in this environment. They must not be reported as passed based on PGlite tests or static review. The dependency HIGH findings remain unresolved. The only verified commit baseline before these local changes was 34a2af3195a09220a6639bdcb2aff369a813d5c2; the implementation is committed locally, and its exact resulting commit SHA is sent to the coordinator with this report.