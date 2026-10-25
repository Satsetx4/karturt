# KartuRT RELEASE FIRST V1 — Release Decision Packet

> Template only. Complete it after R2 and R3 evidence exists. Keep every result tied to the exact release SHA and environment. Use `PASS`, `FAIL`, `UNKNOWN`, `UNVERIFIED`, or `NOT RUN`; a skipped job is `SKIPPED`, never `PASS`.

## Candidate identity and CI

| Field | Recorded value |
|---|---|
| Candidate PR and branch | TODO |
| Exact release SHA | TODO |
| Protected main SHA and candidate base SHA | TODO |
| GitHub Actions run ID and attempt | TODO |
| Gate A job and conclusion | TODO |
| Independent concurrency job, database version, and conclusion | TODO |
| Other required job conclusions | TODO |
| Review scope, reviewer, reviewed SHA, and open P0/P1 findings | TODO |
| Migration inventory and expected Drizzle journal head | TODO |

Gate A, local PostgreSQL, and disposable PostgreSQL 17 results describe source/CI evidence only. They do not establish staging PostgreSQL 18 readiness.

## R1 — Candidate application

| Requirement | Status | Exact-SHA evidence |
|---|---|---|
| Twelve annual dues periods; future periods remain upcoming and outside arrears | TODO | TODO |
| Online requests accept current/overdue periods and reject future periods server-side | TODO | TODO |
| Treasurer cash allocation is oldest-unpaid through the selected target period | TODO | TODO |
| Receipts show canonical amount and verification time | TODO | TODO |
| Resident, Treasurer, Chairman, and System Admin authorization and cross-tenant denials | TODO | TODO |
| Retry, duplicate, reversal, and payment integrity behavior | TODO | TODO |

## R2 — PostgreSQL 18 staging

| Evidence | Status | Target-bound result and reference |
|---|---|---|
| Project, branch, endpoint, database, region, Free plan, and PostgreSQL 18 | TODO | TODO |
| Production-independent target and synthetic-only content classification | TODO | TODO |
| Runtime and migrator effective identities, role flags, grants, and negative checks | TODO | TODO |
| Client TLS encryption with verified peer certificate and hostname | TODO | TODO |
| Official Drizzle migrations `0000`–`0013` under the effective migrator identity | TODO | TODO |
| Exact-head-CI-verified trusted staging fixture bootstrap path | PASS — candidate CI only | PR #103 run 40213718974; independent source review not recorded |
| Frozen synthetic fixture ledger and independent oracle | BLOCKED until R2 fixture authorization | TODO |
| Synthetic fixtures and schema/financial integrity checks | TODO | TODO |
| Post-migration migrator cleanup, effective grants, and TEMP-denial readback | TODO | TODO |
| Recovery/reset basis available on the verified plan | TODO | TODO |

Do not infer isolation from project labels, an empty table listing, or `init_source=parent-data` alone. Do not expose raw catalog data or credentials in this packet. Record sanitized checks and exact resource identifiers.

The repository provides a candidate-bound trusted runtime-DML bootstrap for the initial RT, open billing year, official accounts, household, resident, tariff, and dues. It passed exact-head candidate CI, but this is not an app-authenticated flow and no independent review submission is recorded. Legacy phase smoke scripts and setup commands remain bound to development targets; do not repoint or reuse them for staging. See [R2 synthetic fixture and integrity worksheet](./R2-SYNTHETIC-FIXTURE-AND-INTEGRITY-WORKSHEET.md). Do not run fixture writes until all R2 live gates pass.

For the canonical staging target, both `DATABASE_URL` and `DATABASE_MIGRATION_URL` must use the direct endpoint; runtime uses `karturt_stg_runtime_v2`, and migration uses `karturt_stg_migrator_v2`. Prior provider metadata reported the target pooler disabled; verify current provider metadata before R2 and stop if this changes. The application and migration paths build the `node-postgres` config from parsed URL fields, reject parameters that could override identity, routing, or TLS, and require certificate-chain and endpoint-hostname verification. Staging connections explicitly use Node.js built-in trusted root certificates; `sslrootcert` may be omitted or set to `system`, and custom CA paths are rejected. The code also rejects use of the canonical staging target under another environment label and rejects a process-wide TLS verification bypass. Strict `channel_binding=require` is rejected because the driver option only enables channel binding when supported; omit it or use `prefer`. Before migration, the runner connects with both runtime and migrator credentials and checks each effective/session role, target database, PostgreSQL 18, active TLS, role flags, ownership, grants, denied database TEMP, selected non-system relation kinds, non-system routines, and the complete frozen migration tag sequence. This source configuration is not a live TLS or migration PASS.

Before a staging migration, the owner must provision separate secure LOGIN credentials for runtime and migrator without sharing them in chat. Both roles need database `CONNECT`. The runtime role must have no effective `CREATE` or `TEMPORARY`; the migrator needs a target-scoped database `CREATE` ACL grant that persists until explicitly revoked and is intended to be temporary for the migration attempt. The migrator must have no `TEMPORARY`. PostgreSQL defaults `TEMPORARY` to `PUBLIC`, so the owner must revoke `TEMP` from `PUBLIC` on this target database and verify the effective denial for both roles. The runner requires `karturt_stg_runtime_v2` to have only the expected non-admin role flags, no membership, public-schema `USAGE`, and no database or schema DDL privilege, and verifies the actual runtime login over verified TLS. The migrator preflight separately requires effective `USAGE` and `CREATE` on `public`; if either is missing, it stops before migration and does not add the grant. It also rejects any grant option for the migrator or `PUBLIC` on the target database, `public`, and `drizzle` schema ACLs. Before migrations, it revokes global and `public`-schema default `EXECUTE` grants to both `PUBLIC` and the runtime role, and verifies no such grants remain; any such default in another schema stops preflight. After migration, it checks runtime table `SELECT`/`INSERT`/`UPDATE`/`DELETE` and sequence `USAGE`, confirms no application-object ownership or extra table/sequence privilege, and verifies that runtime cannot use the Drizzle schema or read the journal. Since PostgreSQL defaults `EXECUTE` on functions to `PUBLIC`, the runner revokes `EXECUTE` from `PUBLIC` and runtime on migration-created public routines, then verifies runtime cannot execute any custom routine. The current application source does not invoke custom routines directly; trigger-based integrity behavior still requires real staging UAT. If runtime privilege verification fails, the runner attempts to revoke runtime table and sequence privileges, then checks that runtime has no application-table DML/DDL access, sequence privileges, schema `CREATE`, TEMP privilege, custom routine execution, or Drizzle-journal access. Owner readback remains required.

The migration preflight's empty-catalog evidence is deliberately bounded: it counts selected non-system relation kinds and non-system routines. It does not inventory every non-system schema, standalone custom type, or all possible catalog content. Do not describe that result as a fully empty catalog or as proof of synthetic-only provenance. Record missing schema/type inventory as separate sanitized catalog evidence, and record target lineage, plan, region, and synthetic-only provenance as independent provider evidence. Keep both `UNKNOWN` until independently established.

**Candidate credential path, not yet authorized or performed:** Use the staging-only GitHub Actions workflow and protected `karturt-r2-staging` environment described in [R2 secure staging runner](./R2-SECURE-STAGING-RUNNER.md). It keeps the two direct-endpoint URLs in separate environment secrets and maps them only into the final execution step after the exact candidate, Gate A, and owner/environment gates pass. The two existing SQL-created roles are `NOLOGIN`, so a password reset alone does not prove login capability: before adding either secret, the owner must authorize the narrowly scoped `LOGIN` attribute change and verify `LOGIN=true`, least-privilege flags, and no memberships. Keep generated passwords in a private password manager and enter the URLs only in the GitHub Environment UI. Never paste them into chat, commit them, or add them to repository-wide or Vercel secrets. Do not create or recreate these limited roles through Neon Console/API/CLI because Neon grants those roles membership in `neon_superuser`. Environment creation and credential provisioning remain blocked until exact-SHA authorization, target isolation, and recovery are verified. See [Neon role management](https://neon.com/docs/manage/roles) for Console password reset and the role-creation privilege distinction.

Drizzle's PostgreSQL migrator issues `CREATE SCHEMA IF NOT EXISTS` for its journal schema. The owner must create the empty `drizzle` schema and grant `USAGE` and `CREATE` on it directly to the migrator. The migration also requires direct `CREATE` on `public` and a persistent direct `CREATE` ACL grant on `karturt_staging`, intended to be temporary for the migration attempt; do not grant `CREATEDB`, `CREATEROLE`, or role membership. These schema, database `CREATE`, database `TEMP`, and routine default/execute ACL actions require explicit target-bound owner approval bound to the exact candidate SHA; the existing authorization comments do not name them. After the migrations, the runner grants the runtime role `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on application tables and `USAGE` on application sequences, then verifies those privileges. After any staging migration attempt, the owner must revoke migrator `CREATE` on both schemas, migrator `USAGE` on `drizzle`, and the database `CREATE` grant; verify database `TEMP` remains revoked from `PUBLIC` and both staging roles; return the migrator to `NOLOGIN`, and verify cleanup. Runtime table and sequence grants are retained only after successful verification. The runner does not perform owner cleanup.

## R3 — Real staging UAT and concurrency

The migration runner's exit code and `database.migrations.applied` event do not prove that owner cleanup completed. Keep R2 below `PASS` until exact-target owner readback verifies that temporary migrator `CREATE`/`USAGE` grants are removed, the migrator is back to `NOLOGIN`, and `TEMP` remains denied to `PUBLIC` and both staging roles.

The executable, bounded scenario matrix, read-only PG18 session verifier, and stop rules are in [R3-R4-UAT-AND-CUTOVER-RUNBOOK.md](./R3-R4-UAT-AND-CUTOVER-RUNBOOK.md). Execution status is `NOT RUN` until R2 passes for this exact release SHA, two same-SHA local HTTPS app workers are authorized for staging UAT, and a target-scoped R3 authorization reference is recorded. The app workers and observer use the same `KARTURT_R3_BUSINESS_DATE` in the fixture year; the app requires staging labels, a bounded R3 run ID, a non-secret authorization reference, and the full compiled release SHA for this clock override, while transaction timestamps remain real. Those inputs do not replace owner authorization. The observer uses the existing `karturt_stg_runtime_v2` login in explicit read-only transactions and reads only its own role's session metadata; it does not grant `pg_read_all_stats` or add an observer role. A Preview requires separate exact-SHA deployment authorization; Preview smoke is recorded in R4.

| Scenario | Status | Expected vs actual, negative-state check, verifier, and evidence |
|---|---|---|
| R3-AUTH role access, cross-account and cross-RT denial | TODO | TODO |
| R3-DUES 12 periods, future arrears exclusion, current/overdue acceptance, future-request denial | TODO | TODO |
| R3-TRANSFER verified transfer and canonical receipt amount/time | TODO | TODO |
| R3-CASH oldest-first allocation through selected future target | TODO | TODO |
| R3-RETRY, R3-REVERSAL, and R3-REPORT independent reconciliation | TODO | TODO |
| R3-RACE-REQUEST concurrent claim conflict on real PG18 | TODO | TODO |
| R3-RACE-VERIFY concurrent verification on real PG18 | TODO | TODO |
| R3-RACE-CASH and R3-RACE-REVERSAL concurrent financial retries on real PG18 | TODO | TODO |
| Same-SHA worker, pool, backend-session, overlap, lock-wait, runtime-role, and encrypted-session proof | TODO | TODO |

For each row record exact candidate SHA, Actions run ID/attempt, staging target and actual PostgreSQL version, app-instance SHA/mode/origin, separate-session proof for concurrency, expected and observed outcome, negative-state readback, sanitized evidence, and independent verifier. Disposable PostgreSQL 17 or offline concurrency is source/CI evidence only and cannot fill a live PG18 row.

## R4 — Preview, rollback, and release decision

| Requirement | Status | Exact-SHA / environment evidence |
|---|---|---|
| Nonproduction Preview separately authorized and bound to the exact release SHA, if authorized | NOT AUTHORIZED / NOT RUN unless separately approved | TODO |
| Preview HTTPS and mobile/tablet/desktop smoke at 360–420px, tablet, and desktop, if authorized | NOT AUTHORIZED / NOT RUN unless separately approved | TODO |
| Staging-only credentials and environment classification verified | TODO | TODO |
| Previous known-good Preview deployment and SHA recorded, or first-use recovery path documented | TODO | TODO |
| Database reset/restore procedure is target-bound, available on-plan, and validated | TODO | TODO |
| Rollback triggers, operator steps, and post-rollback checks recorded | TODO | TODO |
| Cost evidence and known exceptions recorded without unsupported $0 claims | TODO | TODO |
| Proposed cutover target, ordered actions, operator, independent verifier, and stop criteria | TODO | TODO |

Preview deployment and smoke require separate exact-SHA authorization. Without it, record `NOT AUTHORIZED / NOT RUN`; do not infer Preview evidence from local R3 HTTPS testing. Before using the overall verdict `PRODUCTION READY — AWAITING OWNER GO`, explicitly classify Preview smoke as required or optional for this release scope. If required, its rows must pass; if optional, record that scope decision and retain the rows as not run.

Do not assume application rollback reverses database writes. Never run destructive down migrations or in-place restores without separate approval naming the exact staging target and action. If the target is first-use, document its synthetic-only disposable reset path and authorization before writes. Keep the existing production environment, credentials, domain, and deployment outside this packet's execution scope.

### Recovery order — plan only until validated

1. Before any Preview deployment or staging write, record the approved target, candidate SHA, and known-good Preview deployment/SHA. If there is no previous deployment, mark this as first use and record the approved way to disable or reset that nonproduction deployment.
2. For an application-only failure with no database change, stop UAT and return the Preview to the recorded known-good nonproduction deployment using a provider-supported rollback that has been verified for the selected plan. Recheck HTTPS, login, authorization, and payment/report smoke before resuming.
3. For a migration, data, or integrity failure, stop database writes and preserve sanitized evidence. Do not assume a code rollback undoes database changes; do not run a down migration or in-place restore. Use only a verified Free-plan recovery point and a disposable staging-only restore target. A new branch/target or destructive reset requires separate owner approval naming that exact resource and action.
4. Compare the recovered target's Drizzle journal and independent payment/allocation/report invariants with the recorded pre-failure expectations. Record the target ID, release SHA, recovery action, verifier, and exact post-recovery checks before reopening UAT.
5. If there is no supported Free-plan recovery point, no known-good Preview, or no approved target for a reset, keep the release at `NO-GO` and stop. Do not upgrade the plan or silently substitute another project.

The procedure above is not evidence that rollback is available or has been tested. Mark recovery `UNKNOWN` until the selected plan, target, and restore/reset path have current evidence.

Complete the proposed cutover and separate owner decision fields in [R3-R4-UAT-AND-CUTOVER-RUNBOOK.md](./R3-R4-UAT-AND-CUTOVER-RUNBOOK.md). The historical `docs/backup-restore-drill.md` references a different quarantined Neon project; it is not recovery evidence for this canonical target. The historical `docs/staging-uat-plan.md` is not the active R3 run sheet.

## Verdict

- R1: `TODO`
- R2: `TODO`
- R3: `TODO`
- R4: `TODO`
- Overall: `NO-GO` until every required R1–R4 item has current exact-SHA evidence and the Preview-smoke scope is explicitly classified; only then `PRODUCTION READY — AWAITING OWNER GO`.
- Separate production GO: `NOT GIVEN` until the owner approves the exact production SHA, environment, and proposed action.
- Owner decision reference and timestamp: `TODO`

Keep historical failures and skipped checks visible. Never transfer a result between source SHAs, provider resources, PostgreSQL versions, or environments.
