# RELEASE FIRST V1 — R2 synthetic fixture and integrity worksheet

**Template only.** This file does not authorize a database connection or write. Leave every value blank until a target-bound R2 run is separately authorized. `PASS` requires sanitized evidence tied to the exact candidate SHA and canonical staging target.

## Hard stop: fixture bootstrap path

The repository does not currently provide a complete, staging-safe app-native path for creating the initial RT, its open billing year, the first authorized official account, and the tariff needed to create resident dues. The Chairman household endpoint can create a household only after those prerequisites already exist.

The older phase smoke scripts seed fixtures with direct Drizzle writes and are hard-bound to a different development Neon target. `db:bootstrap-rt`, `account:provision`, and other development smoke scripts are also direct database setup paths and do not enforce the RELEASE FIRST target tuple. Do not repoint or reuse them on staging. Do not substitute ad hoc SQL/ORM writes, Neon control-plane role creation, or a migration run as the database owner.

Until a candidate-bound fixture bootstrap path is implemented, reviewed, and exact-head CI passes, record `R2 fixture bootstrap path = BLOCKED` and keep R2 below `PASS`. A future path must use only synthetic identifiers, verify the exact target and effective runtime identity before each write, require target-bound authorization, and provide sanitized post-write counts and integrity results. Do not create or seed anything while this gate is blocked.

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
| Official Drizzle journal matches the frozen migration chain `0000`–`0013` | | | | |
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
| Fixture bootstrap path reviewed and CI-verified | BLOCKED until completed | |
| Frozen fixture ledger and independent oracle | NOT RUN | |
| Post-migration integrity and negative checks | NOT RUN | |
| Migrator cleanup and effective privilege readback | NOT RUN | |
| Overall R2 fixtures/integrity | NOT RUN | |

The migration runner's exit code or `database.migrations.applied` event is not, by itself, R2 acceptance. R2 remains below `PASS` until the exact-target cleanup readback and all fixture/integrity checks above are independently verified.
