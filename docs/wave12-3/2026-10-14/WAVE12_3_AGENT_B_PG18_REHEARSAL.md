# KartuRT V1 Wave 12.3 — Agent B PostgreSQL 18 Rehearsal

**Date:** 2026-10-14 (Asia/Bangkok)\
**Lane:** W12.3-B01–B10 — disposable PostgreSQL 18 migration rehearsal\
**Result:** **PASS on the exact source SHA below.**\
**Source branch:** `codex/wave12-3-pg18-rehearsal-20261014`\
**Source SHA:** `3bc69c83265dce3a6a0863cbfceea188f40f6168`\
**GitHub Actions run:** [38503239173](https://github.com/Satsetx4/karturt/actions/runs/38503239173)

## Runtime and ownership boundary

The local host did not provide Docker, so no local PostgreSQL server was available. The rehearsal ran in the GitHub-hosted standard Ubuntu runner for this public repository, with a fresh `postgres:18` service container attached to that one job. GitHub documents service containers as fresh per-job resources that are destroyed when the job completes ([service-container documentation](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers?learn=continuous_integration)). The database identity and fixture runner verified the exact service container, run-scoped database/user, empty initial database, identity marker, PostgreSQL major version, and database-creation role before using it. The run completed on PostgreSQL 18.6.

The workflow sets `POSTGRES_HOST_AUTH_METHOD=trust`. The [PostgreSQL image documentation](https://github.com/docker-library/docs/blob/master/postgres/content.md) warns that trust authentication allows unauthenticated connections from hosts able to reach the port. Here it was limited to the short-lived service container on the isolated job runner; the runner used no repository secrets or external database URL, and the service container and network were stopped and removed at job completion. GitHub currently documents standard hosted runners as free for public repositories ([runner documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)); this workflow creates no persistent database, artifact, or cache.

The database URL was created inside the shell step, masked before use, and emitted only as `redacted` in the runner summaries. The run-specific identity token was also masked. No Neon, Vercel, or other provider database was accessed.

## Exact journal and catalog results

The repository Drizzle migrator applied the checked-in migrations `0000` through `0013` in journal order. The final ledger contained **14 entries** with the expected hashes and timestamps. PostgreSQL 18 reported:

| Catalog item | Observed |
|---|---:|
| Public tables | 27 |
| Constraints | 355 |
| Indexes | 89 |
| Triggers | 53 |
| Functions | 41 |
| Enums | 7 |

All expected named constraint, index, trigger, function, and enum objects were present. The negative cross-RT constraint case rejected the invalid synthetic relationship. The injected migration failure rolled back without changing the real schema catalog.

## Synthetic legacy fixtures and recovery

Two separate run-owned fixture databases were created with an exact ownership marker and verified empty before use. They exercised:

- **Migration 0003:** legacy `WAIVED` / `not_yet_resident` due converted to `NOT_DUE`, with zero amount, no fee-rate reference, and no waiver reason; the legacy enum was removed.
- **Migration 0010:** active settlement rows were backfilled for synthetic cash and transfer payment histories with their expected payment, allocation, due, RT, household, and amount references.
- **Migration 0011:** a synthetic legacy `WAIVED` due caused the named preflight to fail; transaction rollback left the schema and ledger unchanged. After deleting that run-owned synthetic row, the migration retry succeeded.
- **Migration 0012:** the exact checked-in active-ownership preflight rejected a missing synthetic ownership row with the expected SQLSTATE and constraint. The probe transaction rolled back and restored the fixture state; the full migration then succeeded on valid ownership.
- **Migration 0013:** a synthetic overlapping household period caused the named preflight to fail and rolled back later DDL. After deleting the run-owned overlapping row, the clean migration retry succeeded. The fixture first retired its own original household while setting an overlapping end date, so the older one-active-household index would permit the targeted date-overlap probe.

The fixture runner removed both databases only after confirming each database owner and per-run marker still matched. It verified both names were absent after dropping them. The job then stopped and removed the PostgreSQL service container and network.

## Iteration notes and evidence limits

Earlier exact-SHA attempts exposed two fixture defects, both corrected before this passing run: the Drizzle migrator wraps PostgreSQL errors in `cause`, and the first 0013 probe collided with the pre-existing one-active-household index before reaching the intended overlap preflight. The final run exercises the corrected error unwrapping and deterministic synthetic overlap setup. The earlier failed attempts are not PASS evidence; only run `38503239173` is the passing runtime result.

Agent B’s initial worktree commit (`933a303efabc3338eedff2d9b238d7708b3070b0`) was local implementation work, not a published runtime result. The coordinator reviewed and integrated the fixture runner and final workflow on the source SHA named at the top; runtime claims above refer only to that exact SHA and Actions run.

This proves the listed behavior on one disposable PostgreSQL 18.6 instance and synthetic data. It does **not** prove Neon staging lineage, emptiness, existing contents, deployed RLS state, backup availability for staging, or migration readiness. `stagingIsolationVerifiedEmpty` remains `false`; Neon migration remains **NOT AUTHORIZED** and release remains **NO-GO**.

**Agent B disposition:** `PG18 REHEARSAL PASS — OWNER REVIEW REQUIRED`.
