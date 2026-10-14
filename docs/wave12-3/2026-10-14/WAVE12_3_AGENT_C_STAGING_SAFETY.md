# KartuRT V1 Wave 12.3 — Agent C Staging Safety Review

**Date:** 2026-10-14 (Asia/Bangkok)\
**Lane:** W12.3-C01–C08 — staging safety, tenant controls, recovery, and trigger review\
**Result:** **PARTIAL — staging remains BLOCKED / NOT READY; migration remains NOT AUTHORIZED.**\
**Application source reviewed:** `d4fc471a988c070ca2118e12ddbb0b363daa6541` (tree `15bb2fc622f19d0715906479083ae87bcbb85cec`).\
**Documentation worktree:** `docs/wave12-3-migration-rehearsal-20261014` at `08dfa5c9c501075e8368e35b0d0dbf26459fae77` (tree `d5957837be16712501027deda13e860d0f65ec00`).

## Scope and evidence method

I read all five Wave 12.2 reports and the five corresponding Wave 12.1 reports, then statically reviewed the exact source commit named above. The source review covered the staging target guard, authorization/principal modules, schema and migration SQL, the Next command wrapper and its direct CLI call sites, and `.github/workflows/gate-a.yml`.

This lane did not connect to Neon, run SQL, wake compute, access a provider, inspect credentials or `.env` files, run migrations, start GitHub Actions, edit application source, or change a Vercel setting. The coordinator supplied the current exact-project Vercel metadata summary; I did not independently re-query that provider. No commit or push was made by this lane.

## Staging isolation and provider evidence

At the reviewed source SHA, `src/lib/staging-database-target.ts` pins the approved staging identity and explicitly sets `stagingIsolationVerifiedEmpty = false`. Its fail-closed check rejects staging access because the branch lineage/content has not been shown empty. This source state is a **PASS for keeping the application guard closed**; it is not a proof that the provider database is empty or isolated.

Wave 12.2 Agent B reports fresh metadata for the allowlisted staging project, branch, database, role, and its sole endpoint. The branch remains primary/default with `init_source=parent-data`; the endpoint is `read_write` and `passwordless_access=true`; role metadata did not attest read-only privileges. A single previously authorized transaction ran with `SET TRANSACTION READ ONLY`, returned `transaction_read_only=on`, and passed its identity guard. The bounded catalog and ledger queries returned no matching rows. These results still do not establish emptiness: inherited lineage is unresolved and the queries did not inventory every possible object or prove the parent content. I performed no new query. Keep `stagingIsolationVerifiedEmpty=false`.

## Tenant controls and database boundary

Static review found application-layer checks in `src/lib/auth/principal.ts` and `src/lib/auth/permissions.ts`: inactive accounts are rejected; resident identity is tied to active person/household membership; officials require one active RT assignment; System Admin requires verified TOTP; and permission checks bind residents to their household and RT and RT-scoped operations to the matching RT.

A static search of the checked-in `src` and `drizzle` paths at the exact source SHA found no `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY`, or `FORCE ROW LEVEL SECURITY` statements. The Wave 12.2 reports record 209 focused application authorization/environment tests passing with PGlite-backed coverage. Those tests support the sampled application controls only. They do not establish database-native tenant isolation, the deployed database's RLS state, or behavior against PostgreSQL 18. If application credentials can issue direct database queries, the inspected source does not provide RLS policies as a second tenant boundary.

## Migration and recovery exposure

The Wave 12.2 inventory records 14 SQL migrations (0000–0013), 14 Drizzle journal entries, 14 snapshots, and 27 tables at the reviewed source baseline. The chain includes data-dependent work: 0003 transforms legacy `waived` due states/reasons; 0010 backfills active settlements and refuses inconsistent payment/allocation history; and 0011–0013 contain preflights for legacy waiver history, data consistency, and overlapping household periods. Several DDL operations are non-idempotent. These are reasons to rehearse against representative synthetic states and to stop on any partial failure; they are not a reason to mutate or repair staging.

No verified backup is evidenced in the Wave 12.1/12.2 packets, and no restore drill is recorded. Before a later migration decision, require a documented backup source, a successful restore rehearsal on an authorized disposable target, and a versioned recovery plan. On failure, preserve the state and logs, stop, and wait for an explicitly approved restore or repair procedure. Never replay blindly or edit the migration ledger to make the chain appear complete.

The Wave 12.2 coordinator records five historical HIGH development-only dependency advisories as **unrefreshed**. This lane did not run an advisory refresh; do not report them as either current findings or resolved findings. The direct Next CLI wrapper bypass also remains: package `dev`/`build`/`start` scripts use `scripts/lib/next-command.ts`, while multiple repository smoke scripts invoke `node_modules/next/dist/bin/next` directly (including `scripts/phase-12-household-browser-smoke.ts`). Those direct invocations are outside the wrapper's environment-file preflight. No fix or new test was made in this lane.

## Workflow and deployment-trigger review

At the exact source SHA, `.github/workflows/gate-a.yml` is the only workflow under `.github/workflows`. Its `push.branches` allowlist does not include `docs/wave12-3-migration-rehearsal-20261014` or `codex/wave12-3-pg18-rehearsal-20261014`. Its `pull_request` trigger is unfiltered and it supports manual `workflow_dispatch`; neither event was created or dispatched by this lane. The independent concurrency job has its own branch allowlist, excludes these branches, and uses a PostgreSQL 17 service. This is a static trigger review only; there is no CI result.

The coordinator supplied project-scoped Vercel metadata for `karturt-review-staging-20261012`: `live=false`, `latestDeployment=null`, and no domains; the response contained no Git-link field. That readback alone cannot establish whether a Git integration exists. The Wave 12.2 coordinator report records that its same-day Git deployment context did not list this exact project among linked projects, and Wave 12.1 records an earlier dashboard view stating it was not Git-connected. I did not repeat provider access, so the current metadata supplied for this lane does not independently close the deployment-trigger question. No Vercel deployment or setting was changed.

## Findings and status

| Control | Result | Evidence boundary |
|---|---|---|
| Source guard remains closed | **PASS** | Exact source SHA has `stagingIsolationVerifiedEmpty=false`; no provider test in this lane. |
| Staging lineage and emptiness | **NOT VERIFIED / BLOCKED** | Wave 12.2 metadata and bounded read-only transaction; parent-data lineage unresolved. |
| Tenant authorization in application | **PARTIAL** | Static source review and 209 tests reported by Wave 12.2; no new test run here. |
| Database-native RLS in checked-in migrations/schema | **NOT PRESENT in reviewed source** | Static search only; live provider state is not established. |
| PostgreSQL 18 migration behavior | **NOT RUN in this lane** | No rehearsal evidence reviewed from Agent B yet. |
| Backup and restore | **NOT VERIFIED** | No successful restore drill in Wave 12.1/12.2 evidence. |
| Dependency advisory status | **STALE / NOT REFRESHED** | Five historical development-only HIGH advisories remain unrefreshed in Wave 12.2 record. |
| Next CLI environment wrapper coverage | **GAP OPEN** | Direct CLI call sites remain outside `next-command.ts`; no remediation here. |
| GitHub push trigger for proposed branches | **NO MATCH** | Static `gate-a.yml` push allowlist; no push or CI run by this lane. |
| Vercel Git linkage | **NOT CURRENTLY VERIFIED by supplied readback** | Current exact-project metadata omits Git-link status; prior same-day report provides separate evidence. |
| Migration authorization / staging readiness | **BLOCKED / NOT READY** | No permission granted; no migration performed. |

## Required gates before any separate migration request

1. Keep the current guard false until lineage and content are classified through a separately authorized safe method; do not infer emptiness from the prior no-row query.
2. Establish a demonstrably isolated disposable target with known lineage and an approved synthetic starting state.
3. Obtain a verified backup and successful restore rehearsal on authorized disposable infrastructure, with a versioned recovery and failure-stop plan.
4. Complete Agent B's exact 14-file PostgreSQL 18 rehearsal and report its source SHA, database ownership/isolation, synthetic cases, command exits, recovery evidence, and cleanup. PGlite or SQL parsing alone is not equivalent.
5. Review database-native tenant controls or document an explicit owner-accepted alternative; distinguish app-layer checks from database enforcement.
6. Refresh and disposition dependency advisories and close or explicitly accept the direct Next CLI environment-policy gap before any release decision.
7. Require a new owner decision naming the exact provider target, migration files, intended data impact, permitted operations, time window, backup/recovery authority, and stop conditions. No such authorization is implied here.

**Agent C disposition:** `PARTIAL`. Even if a disposable PostgreSQL 18 rehearsal later passes, Neon staging remains **NOT READY**, migration remains **NOT AUTHORIZED**, and release remains **NO-GO** until the separate gates above are resolved.

## Coordinator addendum — final Wave 12.3 evidence

This addendum records later coordinator evidence without changing the scope or findings of Agent C's static-review lane.

- The exact source SHA `3bc69c83265dce3a6a0863cbfceea188f40f6168` completed the disposable PostgreSQL 18.6 migration, catalog, negative-constraint, failure/rollback, synthetic legacy fixture, dump/restore, and cleanup rehearsal in [GitHub Actions run 38503239173](https://github.com/Satsetx4/karturt/actions/runs/38503239173). This result does not establish Neon staging state.
- The disposable rehearsal's `pg_dump` / `pg_restore` and restored-database cleanup passed. A backup and restore path for Neon staging remains **NOT VERIFIED**.
- Read-only current metadata for the exact Vercel project returned `live=false`, `latestDeployment=null`, no domains, and no Git `link` property; the exact-project listing returned no repository field. No deployment or setting was changed. The current metadata does not establish future provider configuration.
- The source guard remains `stagingIsolationVerifiedEmpty=false`. No Neon database operation was performed in Wave 12.3. The owner packet records the remaining migration gates.
