# KartuRT V1 Wave 12.2 — Agent C Security and QA

**Date:** 2026-10-14 (Asia/Bangkok)
**Lane verdict:** **PARTIAL** — focused local authorization, environment, and PGlite checks passed. Staging inspection and migration readiness remain blocked or unverified.
**Repository:** `Satsetx4/karturt`
**Application source:** `d4fc471a988c070ca2118e12ddbb0b363daa6541` (tree `15bb2fc622f19d0715906479083ae87bcbb85cec`), detached worktree.
**Wave 12.1 evidence read:** all five reports under `docs/wave12-1/2026-10-13/` on `origin/docs/wave12-1-staging-readonly-20261013`.

## Scope and safety

This lane ran local tests and offline Drizzle checks, reviewed source/migrations/workflow files, and made project-scoped read-only Vercel API calls. It did not connect to Neon, wake compute, run SQL, execute DDL/DML, apply migrations, create fixtures in a remote database, change provider settings, deploy, create a PR, or push. No `.env` file or credential value was read. No source file was changed.

`npm ci --ignore-scripts --no-audit --no-fund` completed with exit 0 and installed 442 packages in this worktree. Package lifecycle scripts and npm audit were disabled. This was dependency setup for local checks, not an advisory refresh.

## Local verification

All test database coverage below uses the repository test helper, which constructs an in-memory PGlite instance and applies the checked-in SQL files. The tests do not establish behavior on Neon or PostgreSQL 18.

| Exact command | Exit | Result |
|---|---:|---|
| `npm run test:authorization -- --maxWorkers=1` | 0 | 14 files, 127 tests passed. Includes principal/permission, household, route/session, cross-RT denial, and IDOR-style access cases. |
| `npm test -- --maxWorkers=1 tests/unit/environment.test.ts tests/unit/env-file-preflight.test.ts` | 0 | 2 files, 18 tests passed. |
| `npm test -- --maxWorkers=1 tests/unit/next-command.test.ts` | 0 | 1 file, 5 tests passed. |
| `npm test -- --maxWorkers=1 tests/integration/resident-dues-authorization.test.ts tests/integration/phase12-household-history.test.ts tests/integration/household-lifecycle-domain.test.ts` | 0 | 3 PGlite-backed files, 17 tests passed. |
| `npm run test:constraints -- --maxWorkers=1` | 0 | 8 PGlite-backed files, 42 tests passed. |
| `npm run db:check:offline` | 0 | Drizzle migration journal check reported “Everything's fine.” No database credentials or connection were used. |
| `npx drizzle-kit generate --config .wave12-2-agent-c-drift-c958c55939124bc8a30081a31d12c379.config.ts` | 0 | Using a temporary offline config and an isolated copy of the existing `drizzle/` journal/snapshots, Drizzle reported “No schema changes, nothing to migrate.” |

Vitest printed the existing Vite `configLoader: 'native'` compatibility warning on test commands; test exits remained 0. The full test suite, lint, typecheck, production build, CI, and PostgreSQL 18 execution were not run in this lane.

### Drizzle generation command caveat

A direct attempt to add `--name` and `--out` to `drizzle-kit generate --config ...` exited 1 with: `You can't use both --config and other cli options for generate command`. The workflow at `.github/workflows/gate-a.yml` currently runs `npm run db:generate:offline -- --name gate_a_ci_drift`; the package script already supplies `--config drizzle.offline.config.ts`. That combination therefore appears incompatible with the locked CLI and needs coordinator review. The successful isolated generation above avoided extra CLI flags and kept output outside the tracked `drizzle/` directory. An initial generation into an empty isolated output created a baseline migration and was not treated as a schema-drift result.

## Security and tenant review

Static inspection of `src/lib/auth/principal.ts` and `src/lib/auth/permissions.ts` found these application-layer controls:

- Principals require an active account. Resident principals are tied to an active person and household within the account's RT; official accounts require exactly one active RT assignment; System Admin requires an enabled, verified TOTP factor.
- Resident permissions are self-service and require the principal's matching RT and household. RT-scoped permissions reject System Admin principals and require the matching RT scope.
- The focused authorization suite passed, including cross-RT attempts against waiver, payment verification, and resident PIN-reset routes, plus household foreign-ID denial cases.
- Static search of the checked-in schema and migration paths found no `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY`, or `FORCE ROW LEVEL SECURITY` statements. This is not a read of the live database and does not establish database-native tenant isolation.

`src/lib/staging-database-target.ts` still sets `stagingIsolationVerifiedEmpty = false` and fails closed for the approved staging target. The Wave 12.1 metadata record reports `init_source=parent-data`, a read-write endpoint, and passwordless access enabled; this lane did not re-read Neon, so those provider values are historical evidence from 2026-10-13. Database contents, parent lineage, deployed RLS state, migration ledger, and emptiness remain **NOT VERIFIED** here.

The Wave 12.1 Coordinator report records five historical HIGH development-only dependency advisories as unrefreshed. This lane did not refresh npm audit data. No verified Neon backup or restore evidence is present in the Wave 12.1 evidence read or this lane's work.

The repository's `dev`, `build`, and `start` package commands use `scripts/lib/next-command.ts` and its environment-file checks. Invoking the Next CLI directly bypasses that repository wrapper policy; the Wave 12.1 report identified this gap, and no fix was made in this lane. The wrapper's focused unit tests passed, but they do not attest all ways the CLI could be invoked.

## Offline migration inventory and future-only sequence

The journal and `npm run db:check:offline` confirm 14 ordered entries and the schema generator reports 27 tables. The following is an inventory for a future, separately authorized migration rehearsal; **none of these migrations was executed against a live database**.

1. `0000_messy_menace.sql` — base enums and schema tables.
2. `0001_classy_ricochet.sql` — composite RT/household uniqueness and foreign-key scope.
3. `0002_monthly_due_period_guard.sql` — monthly-due period constraint and trigger.
4. `0003_due_auth_audit_domain.sql` — audit/auth changes and due-status enum conversion. Its `USING CASE` maps legacy `waived` rows to `not_due`, maps the legacy waiver reason to `NULL`, and drops legacy enum types and indexes.
5. `0004_phase_5_payment_request.sql` — payment-request status and request/item/claim tables with scoped constraints.
6. `0005_phase_5_1_payment_request_items_immutable.sql` — immutable payment-request-item functions and triggers.
7. `0006_phase_6_treasurer_payment_ledger.sql` — payments and allocation ledger, verification fields, scoped constraints, and mutation guards.
8. `0007_phase_7_reject_cancel.sql` — resolution metadata and payment-request transition/audit guards.
9. `0008_phase_7_1_post_resolution_lifecycle.sql` — terminal-transition guards.
10. `0009_phase_8_cash_payment.sql` — cash-payment fields, altered payment constraints, and ledger validation functions.
11. `0010_phase_9_payment_reversal.sql` — active-settlement and reversal structures. It includes an `INSERT ... SELECT` backfill of `active_due_settlements` from existing paid dues, payments, and allocations.
12. `0011_phase_10_waiver.sql` — waiver action/item tables and append-only ledger functions; a preflight refuses legacy waived dues without structured history.
13. `0012_phase_11_tariff_adjustment.sql` — due-adjustment and fee-rate audit/idempotency structures, active-settlement key changes, and data-consistency preflights.
14. `0013_phase_12_household_management.sql` — household-period controls and RT-scoped login indexes; a preflight rejects overlapping household periods.

Several entries use non-idempotent `CREATE`, `ALTER`, or `DROP` operations. In particular, 0003 transforms existing values, 0010 backfills rows, and 0011–0013 contain state-dependent preflight checks. Unknown inherited data can therefore change the result or stop the chain. The generated PGlite pass does not prove PostgreSQL 18 compatibility or safe behavior against the actual staging contents.

**Future stop/recovery rule:** before any later migration permission is considered, require a verified target and lineage, a content classification from an owner-approved safe inspection, a tested backup/restore procedure, and a successful PostgreSQL 18 rehearsal over the exact 14-file chain with representative synthetic states. If a migration errors or only partly applies, stop immediately. Do not replay the statement, delete/edit the Drizzle ledger, or guess at manual repair. Preserve the observed state and logs, reconcile schema plus ledger through a separately approved safe inspection, and wait for an owner-approved restore or versioned repair plan. Current permission does not authorize this future DDL/DML.

## Workflow and Vercel publication checks

`.github/workflows/gate-a.yml` uses an explicit `push.branches` allowlist. It excludes `docs/wave12-2-db-inspection-20261014`; therefore a direct push to that docs branch does not match this push trigger. The workflow has an unfiltered `pull_request` trigger and a manual `workflow_dispatch` trigger. No PR or manual dispatch was created, and no CI result is claimed. The independent PostgreSQL concurrency job also has a branch-specific allowlist that excludes the docs branch.

On 2026-10-14, project-scoped read-only Vercel API calls for the approved project ID `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq` returned project `karturt-review-staging-20261012`, `latestDeployment: null`, `domains: []`, `live: false`, and SSO protection enabled for all deployments. The project-scoped deployment list returned count 0. These responses did not expose Git repository linkage. The Wave 12.1 Agent C report records an explicit Settings > Git dashboard observation on 2026-10-13 that this exact project was not connected to a Git repository; that prior observation is not a current re-read. **Current Git-link status is not independently verified by the scoped API evidence in this lane.** No other Vercel project was inspected, and no setting or deployment was changed.

## Result classification

| Area | Result | Evidence boundary |
|---|---|---|
| Focused local authorization/environment/household QA | **PASS** | 209 tests passed across the commands above; local test code and in-memory PGlite only. |
| Offline Drizzle journal and isolated schema-drift generation | **PASS** | Journal validated; isolated generation found no schema changes. |
| PostgreSQL 18 compatibility and independent server concurrency | **NOT RUN** | PGlite and offline checks are not a PostgreSQL 18 runtime result. |
| Neon read-only inspection, database contents, and emptiness | **NOT RUN / NOT VERIFIED** | No connection, wake, or query; no live-content claim. |
| Backup/restore | **NOT VERIFIED** | No verified backup/restore evidence or restore drill. |
| Current Vercel Git linkage | **NOT VERIFIED** | Scoped current API omitted link status; explicit dashboard evidence is dated 2026-10-13. |
| Migration/staging readiness and release | **BLOCKED / NOT READY / NO-GO** | No migration authorization, server-enforced read-only inspection, verified lineage/emptiness, PostgreSQL 18 rehearsal, or backup/restore proof. |
