# RELEASE FIRST V1 — R2 synthetic fixture and integrity worksheet

**Template only.** This file does not authorize a database connection or write. Leave every value blank until a target-bound R2 run is separately authorized. `PASS` requires sanitized evidence tied to the exact candidate SHA and canonical staging target.

The merged source candidate includes a GitHub Actions credential path, exact-SHA dispatch checks, protected Environment, and failure/retry boundary documented in [R2 secure staging runner](./R2-SECURE-STAGING-RUNNER.md). Candidate head `b2ca52514c54b5d383d32f8d728e8e92d4126e95` passed Gate A, independent PostgreSQL concurrency, and disposable PostgreSQL 18 recovery in exact PR run `40213718974`. Live R2 preflight gates have not passed.

## Hard stop: fixture bootstrap path

The repository does not provide an app-native path for creating the initial RT, its open billing year, the first authorized official account, and the tariff needed to create resident dues. The source candidate adds a narrowly named, runtime-DML synthetic fixture bootstrap for these prerequisites; it is trusted bootstrap DML, not an app-authenticated flow. The Chairman household endpoint can create a household only after those prerequisites already exist.

The older phase smoke scripts seed fixtures with direct Drizzle writes and are hard-bound to a different development Neon target. `db:bootstrap-rt`, `account:provision`, and other development smoke scripts are also direct database setup paths and do not enforce the RELEASE FIRST target tuple. Do not repoint or reuse them on staging. Do not substitute ad hoc SQL/ORM writes, Neon control-plane role creation, or a migration run as the database owner.

The generic `db:bootstrap-rt` and `account:provision` commands reject staging and production labels. The R2 fixture path checks the exact candidate SHA, target, operation, owner GO, migration-cleanup and isolation evidence, and runtime identity in source. Its focused offline tests cover invalid credential replays and rollback after the tariff/dues phase. Candidate `b2ca52514c54b5d383d32f8d728e8e92d4126e95` passed exact-head CI run `40213718974`. No independent GitHub review submission for the fixture implementation is recorded. Live candidate-bound isolation/recovery evidence, authenticated TLS, migration cleanup, and PG18 fixture integrity are still pending.

Keep `R2 fixture bootstrap path = SOURCE-CANDIDATE / LIVE BLOCKED` and R2 below `PASS` until source review is recorded, the owner proves synthetic-only isolation and Free recovery for the current candidate, official migrations complete with migrator cleanup, and the fixture operation has fresh target-bound authorization. The bootstrap uses only synthetic identifiers and verifies target/runtime identity before writing in one transaction. It does not prove app-level tenant authorization. Do not create or seed anything while live gates remain blocked.

## Run identity

| Field | Value / evidence reference |
|---|---|
| Exact candidate SHA and PR | |
| GitHub Actions run ID and attempt | |
| Gate A and required job conclusions | |
| R2 owner authorization reference and timestamp | |
| Neon project / branch / endpoint / database | |
| PostgreSQL version / region / plan evidence | |
| Production-independence and synthetic-only provenance evidence | |
| Effective runtime role and verified-TLS evidence | |
| Independent reviewer | |
| Fixture bootstrap path code review and CI evidence | |
| Fixed business date and timezone | |

If any field is missing, stale, or mismatched, mark the dependent check `UNKNOWN` or `NOT RUN` and stop before writes.

## Frozen synthetic fixture ledger

Use aliases only. Do not enter real names, addresses, phone numbers, emails, credentials, session identifiers, or raw database rows. Freeze the ledger before any authorized app action. Do not prefill example amounts, scores, names, dates, or outcomes.

| Synthetic alias | App role | Tenant / household alias | Billing period | Amount and due date | Initial state | Planned app action | Expected state and aggregate effect | Actual sanitized result / reference |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

## Independent integrity oracle

Derive expectations from the frozen ledger and recorded app operations, not from the report being checked. Record references and aggregates only; keep raw catalog and row data owner-only.

| Check | Expected rule / value derived from the ledger | Observed sanitized result | Evidence reference | Verifier |
|---|---|---|---|---|
| Official Drizzle journal matches the frozen migration chain `0000`–`0014` | | | | |
| Required constraints and indexes exist; migration integrity checks pass | | | | |
| Tenant, household, billing-period, and fee-rate counts match approved synthetic fixtures | | | | |
| Due periods and amounts match the frozen fixture ledger | | | | |
| Payment total equals the sum of active allocations | | | | |
| Reversed allocations are excluded from active totals and reports | | | | |
| No duplicate active settlement, claim, payment, allocation, or reversal exists | | | | |
| Monthly, annual, current-due, future-due, and arrears aggregates match the oracle | | | | |
| Runtime cannot create schemas/objects, use TEMP, read migration journal, or execute custom routines | | | | |
| Migrator cleanup readback proves temporary CREATE/USAGE grants removed and migrator returned to NOLOGIN | | | | |
| TEMP remains denied to PUBLIC, runtime, and migrator | | | | |
| No non-synthetic content or cross-tenant effect is present | | | | |

## R2 result

| Gate | Status | Exact-SHA evidence / stop reason |
|---|---|---|
| Fixture bootstrap path exact-head CI | PASS | Candidate `b2ca52514c54b5d383d32f8d728e8e92d4126e95`, PR run `40213718974`, all three required jobs passed |
| Independent review of fixture bootstrap path | NOT RECORDED | PR #103 has no submitted review; do not infer one from CI |
| Fixture bootstrap live gates | BLOCKED | Candidate-bound isolation/recovery, authenticated TLS, migrations, cleanup, and fixture integrity are not run |
| Frozen fixture ledger and independent oracle | NOT RUN | |
| Post-migration integrity and negative checks | NOT RUN | |
| Migrator cleanup and effective privilege readback | NOT RUN | |
| Overall R2 fixtures/integrity | NOT RUN | |

The migration runner's exit code or `database.migrations.applied` event is not, by itself, R2 acceptance. R2 remains below `PASS` until the exact-target cleanup readback and all fixture/integrity checks above are independently verified.
