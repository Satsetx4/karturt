# KartuRT V1 Wave 12.4 — Coordinator Report

**Date:** 2026-10-14 (Asia/Bangkok)<br>
**Scope:** Final Neon staging readiness and migration-authorization preparation<br>
**Overall verdict:** **STAGING PREFLIGHT PARTIAL**<br>
**Migration authorization:** **NOT GRANTED**

## Executive result

The one owner-authorized Wave 12.4 Neon inspection was completed exactly once against the allowlisted staging target. The server confirmed a read-only transaction and the in-transaction identity assertion passed. All 26 reviewed statement results were returned without an error or truncation indication. The enumerated PostgreSQL catalog scope was clean: `public` was the only non-system namespace; its relation, constraint, index, sequence, type/domain, enum, range, routine, trigger, policy, foreign-data, publication, subscription, and Drizzle-journal checks returned no objects. `plpgsql` in `pg_catalog` was the only extension.

This result is `SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE`. It does not prove row absence, physical emptiness, parent contents, branch lineage, or migration readiness. Neon reports `init_source=parent-data`; the exact parent and source point were unavailable. No current snapshot or scheduled backup was found. The target therefore remains **PARTIAL / NOT READY**, and `src/lib/staging-database-target.ts` must continue to keep `stagingIsolationVerifiedEmpty=false`.

## Exact baselines

| Item | Verified baseline |
|---|---|
| Application branch | `codex/wave12-3-pg18-rehearsal-20261014` |
| Application SHA / tree | `3bc69c83265dce3a6a0863cbfceea188f40f6168` / `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9` |
| Documentation branch | `docs/wave12-3-migration-rehearsal-20261014` |
| Documentation SHA / tree | `1b5d2facdafba0818bd205d872e006c9b6ecb257` / `252019635420aab8126e1ddfc9b446d333bd03ce` |
| Prior exact-SHA rehearsal | GitHub Actions run `38503239173`, completed successfully at the application SHA |

The Wave 12.3 run is disposable PostgreSQL 18.6 evidence for migrations `0000`–`0013`: 14 migration ledger entries, 27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums; its synthetic legacy cases and `pg_dump`/restore passed. Those results do not characterize Neon staging. The five Wave 12.3, five Wave 12.2, and five Wave 12.1 reports were read from the stated docs baseline.

## Target and transaction audit

The fresh provider metadata matched the exact allowlist:

- Organization `satset` / `org-ancient-boat-57106549`, Free plan.
- Project `karturt-v1-staging` / `wild-art-99835126`, PostgreSQL 18 in `aws-ap-southeast-1`.
- Branch `staging` / `br-hidden-cake-a1ge5xqp`, primary/default, state ready, `init_source=parent-data`.
- Database `karturt_staging` / `42079960`, owner `karturt_staging_owner`.
- Endpoint `ep-snowy-meadow-a10304d9`, approved hostname, `read_write`, `passwordless_access=true`.

The single Neon SQL call used `mcp__neon__run_sql_transaction` with explicit project, branch, database, compute/endpoint, and role arguments. The first statement was `SET TRANSACTION READ ONLY`; the next statement reported `on`; the server-side assertion returned `wave124_guard=1` only for the exact database and role. It was followed by 23 fixed catalog-only statements. There was no second SQL call, retry, stateless fallback, application-row read, user-routine invocation, or dynamic SQL. See Agent B’s report for the exact reviewed array and all 26 ordered results.

The endpoint remains writable and passwordless at the provider layer, and the owner role is not independently attested as least-privilege by metadata. The single transaction’s server-side guard applied only to this inspection; it did not change those provider settings.

## Lanes and evidence limits

| Lane | Result | Accepted evidence and open boundary |
|---|---|---|
| Agent A — target and lineage | **PARTIAL** | Exact target identity verified. `init_source=parent-data`; parent ID/source point and inherited contents unavailable. No SQL call in this lane. |
| Agent B — one read-only inspection | **PASS for defined scope** | One transaction, 26/26 ordered result groups, read-only mode on, guard 1, bounded catalog clean. No row, physical-emptiness, lineage, or recovery proof. |
| Agent C — recovery and security | **PARTIAL** | Free plan has a documented six-hour/1-GB instant-restore window; no project snapshot, snapshot schedule, or restore rehearsal evidenced. Checked-in source has app-layer RT checks but no database-native RLS definitions. Five HIGH development dependency advisories remain; production-only audit reported zero. |

Provider metadata reported logical size `31,686,656` bytes and `written_data_bytes=0`. These counters are not emptiness evidence. An empty snapshot listing and the `parent-data` label do not identify lineage. The bounded catalog inventory does not inspect table contents or sequence values and intentionally omits ACLs, dependency graphs, view/rule definitions, and other catalog families listed in Agent B’s scope boundary.

## Recovery, migration, and security gates

Neon Free currently has a limited instant-restore window, but no target-specific recovery point or restore test was observed. Any later recovery resource operation needs its own explicit authorization. The 14 migrations include state-dependent and non-idempotent work: `0003` converts legacy enum/data state; `0010` backfills settlement ownership from payment/allocation history; `0011`–`0013` enforce waiver, settlement, and household-state preflights. A future migration decision must include a target-specific recovery and partial-failure plan. No migration, schema change, seed, restore, or teardown occurred in Wave 12.4.

Additional reviewed boundaries: app-layer RT authorization does not provide a database-native tenant boundary for direct DB access; direct Next CLI smoke scripts bypass the repository command wrapper; and the five HIGH findings are in the development dependency graph. These findings are recorded for owner review and did not trigger source or dependency changes.

## Publication and deployment preflight

The required documentation branch is `docs/wave12-4-staging-readiness-20261014`, based on the exact documentation SHA above. It contains exactly the five sanitized reports listed below. The source checkout and migration files were not changed.

Static workflow review found no matching `push` workflow for this docs branch: Gate A’s push filter is an explicit allowlist, and the PG18 workflow targets only the Wave 12.3 source branch. The unfiltered pull-request trigger was not activated because no PR was created. Post-push Actions state will be checked and reported separately.

Read-only metadata for Vercel project `karturt-review-staging-20261012` / `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq` returned `live=false`, no latest deployment, no domains, and no deployments. The response omitted Git-linkage data, so current Git linkage is not independently verified. No deployment or project setting was changed.

Required report set:

1. `WAVE12_4_COORDINATOR_REPORT.md`
2. `WAVE12_4_AGENT_A_TARGET_LINEAGE.md`
3. `WAVE12_4_AGENT_B_NEON_READONLY.md`
4. `WAVE12_4_AGENT_C_RECOVERY_SECURITY.md`
5. `WAVE12_4_OWNER_DECISION_PACKET.md`

## Stop boundary

Wave 12.4 ends with this evidence publication. No migration authorization follows from the bounded clean catalog result. Wave 13 requires a separate explicit owner decision. No production, DNS, other Neon project, provider/role/endpoint setting, deployment, PR, merge, paid feature, or cost-bearing operation was performed.
