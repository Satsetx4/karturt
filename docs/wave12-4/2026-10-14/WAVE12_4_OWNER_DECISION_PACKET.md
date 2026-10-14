# KartuRT V1 Wave 12.4 — Owner Decision Packet

**Date:** 2026-10-14 (Asia/Bangkok)<br>
**Current verdict:** **STAGING PREFLIGHT PARTIAL**<br>
**Current migration decision:** **NOT AUTHORIZED**

## What was checked

The one new Wave 12.4 SQL permission was used once and only once after exact-target and statement review. The transaction ran against:

- Neon Free organization `satset` / `org-ancient-boat-57106549`.
- Project `karturt-v1-staging` / `wild-art-99835126`, PostgreSQL 18, Singapore region `aws-ap-southeast-1`.
- Branch `staging` / `br-hidden-cake-a1ge5xqp`.
- Database `karturt_staging` / `42079960`, role `karturt_staging_owner`.
- Endpoint `ep-snowy-meadow-a10304d9` at the approved Neon hostname.

The server reported `transaction_read_only=on`, the exact database/role guard returned `1`, and all 26 ordered statement result groups were present. The fixed catalog scope found only the expected `public` namespace and the system `plpgsql` extension. All inventoried object families and the Drizzle journal check returned zero rows. Agent B classifies this as **SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE**.

## Why staging is still partial

The branch metadata says `init_source=parent-data`, but the parent branch and source point were not exposed. Neon’s logical-size and written-bytes counters cannot prove emptiness. Catalog queries did not inspect row contents or physical storage. The project had no snapshot and no scheduled snapshot at inspection time; no restoration was rehearsed. This packet therefore does not certify inherited contents, physical emptiness, a known lineage, or a recoverable pre-migration point.

The endpoint is `read_write` with `passwordless_access=true`; provider metadata does not attest the owner role’s least-privilege grants. The source guard remains `stagingIsolationVerifiedEmpty=false`. Keep that value unchanged.

## Evidence that remains separate

GitHub Actions run `38503239173` passed the exact application SHA `3bc69c83265dce3a6a0863cbfceea188f40f6168` on disposable PostgreSQL 18.6 with synthetic migration fixtures. It verifies the Wave 12.3 rehearsal environment only. It does not change the Neon decision.

Neon Free documents a limited instant-restore window, but the current project has no verified snapshot or restore rehearsal. The checked-in app has RT authorization checks but no database-native RLS policies. Five HIGH development dependency findings remain in the audited dependency graph; the production-only audit reported zero findings. These are tracked separately from the bounded catalog result.

## Migration risks if considered in a later decision

The application baseline contains migrations `0000`–`0013`. Migration `0003` converts legacy enum and due data; `0010` backfills settlement ownership using existing payments and allocations; `0011`–`0013` have state-specific waiver, settlement, and household preflights. The chain includes non-idempotent DDL and data-dependent checks. A later proposal needs a target-specific recovery point and partial-failure handling plan, exact source/migration hashes, and an explicit migration authorization. A failure must not lead to a blind retry or manual journal edit.

## Decision boundary

**Wave 12.4 does not authorize a migration.** Its owner-authorized read-only inspection is complete. The evidence supports a bounded catalog-clean statement and leaves lineage and recovery unresolved, so the current result is `STAGING PREFLIGHT PARTIAL`; do not treat it as READY for migration.

Any future migration, restore, snapshot creation, or provider-resource action needs its own explicit owner decision with the exact target and permitted operations named. Wave 13 remains outside this authorization.

## Published evidence set

The five reports are published on branch `docs/wave12-4-staging-readiness-20261014` under `docs/wave12-4/2026-10-14/`:

- `WAVE12_4_COORDINATOR_REPORT.md`
- `WAVE12_4_AGENT_A_TARGET_LINEAGE.md`
- `WAVE12_4_AGENT_B_NEON_READONLY.md`
- `WAVE12_4_AGENT_C_RECOVERY_SECURITY.md`
- `WAVE12_4_OWNER_DECISION_PACKET.md`

The publication commit and direct GitHub file links are provided with the completion report.
