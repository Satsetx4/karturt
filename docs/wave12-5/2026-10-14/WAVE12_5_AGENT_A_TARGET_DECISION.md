# KartuRT V1 Wave 12.5 — Agent A Target Decision

**Date:** 2026-10-14 (Asia/Bangkok)
**Lane:** W12.5-A01–A08 — existing versus fresh staging target
**Result:** **PARTIAL — recommend a new independent staging project as the future candidate; owner decision and separate resource authorization are still required.**
**Neon SQL, connections, and resource changes by this lane:** none.

## Scope and evidence basis

This report compares two future target choices. It does not select a target for execution or authorize a migration. The latest target-specific metadata values below were supplied by the Wave 12.5 Coordinator; Agent A did not make Neon calls.

| Evidence | Verified baseline |
|---|---|
| Application source | `Satsetx4/karturt`, branch `codex/wave12-3-pg18-rehearsal-20261014`, SHA `3bc69c83265dce3a6a0863cbfceea188f40f6168`, tree `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9`; assigned worktree was clean at start. |
| Wave 12.4 evidence checkout | `docs/wave12-4-staging-readiness-20261014`, SHA `bea05d7f4f2346645b7354c32b6cd748654aaf05`, tree `c6beb5ab46c8428887d152019d5aa590907b1cf2`; clean read-only worktree. |
| Reviewed packets | All five Wave 12.4 reports; Wave 12.1–12.3 coordinator and owner packets; the relevant Wave 12.2 read-only-inspection/security findings and Wave 12.3 PG18/staging-safety findings. |
| Source guard | At the application SHA, `src/lib/staging-database-target.ts` pins the current project, branch, database, and endpoint, and keeps `stagingIsolationVerifiedEmpty = false`. No source file was changed. |

## Current existing-target evidence

The exact existing target is organization `satset` (`org-ancient-boat-57106549`), project `karturt-v1-staging` (`wild-art-99835126`), branch `staging` (`br-hidden-cake-a1ge5xqp`), database `karturt_staging` (`42079960`), owner `karturt_staging_owner`, and endpoint `ep-snowy-meadow-a10304d9`.

Wave 12.4 completed one server-enforced read-only transaction against that allowlisted target. Its 26 of 26 statement results were complete. The defined catalog scope found the default `public` namespace with no enumerated application objects, no Drizzle migration journal, and only the system `plpgsql` extension. The correct classification is **SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE**.

That result does not establish resident-row absence, physical database emptiness, complete object inventory, or parent provenance. Neon metadata reports `init_source=parent-data`; the parent and source point remain unknown. The branch is primary/default, and neither the empty snapshot listing nor the six-hour history-retention setting provides a tested pre-migration recovery point. No scheduled snapshot or restore rehearsal is evidenced. The endpoint is `read_write` with `passwordless_access=true`; metadata does not attest least-privilege grants for the database owner role. The checked-in schema review also found application-layer RT checks but no database-native RLS definitions.

The latest Coordinator-supplied metadata-only readback adds an unresolved discrepancy: `describe_branch` surfaced a `public.show_db_tree` function, while the Wave 12.4 fixed catalog transaction's routine inventory returned zero rows. The function was not SQL-verified in Wave 12.5, and it is outside the stated Wave 12.4 26-query result. Treat this as a discrepancy to resolve under a separately scoped safe inspection before relying on the existing target; do not describe it as a confirmed database object or dismiss it as harmless.

Wave 12.3's successful PostgreSQL 18.6 rehearsal (run `38503239173`, exact application SHA above) is useful migration-engineering evidence on a disposable synthetic database. It does not resolve this Neon target's lineage, content, or recovery state.

## Comparison

| Decision factor | A — Reuse exact `karturt_staging` | B — New independent staging project |
|---|---|---|
| Provenance | Existing project and target IDs are aligned, but `init_source=parent-data` leaves parent and point unknown. A signed owner acceptance can accept that uncertainty as a bounded risk; it cannot convert it into verified lineage or emptiness. The `public.show_db_tree` metadata discrepancy is still unresolved. | A new project with a documented empty origin can give a clearer provenance record. It must be independent of the existing parent-data branch; do not create a child branch from this target, clone it, import its contents, or restore its snapshot. Preserve creation metadata and prove no external data was copied. A fresh project still needs its own safe baseline inspection. |
| Data preservation | Requires a signed owner assertion that no operational or real resident data in this exact existing target needs preservation, plus explicit acceptance of unknown lineage. If any real resident data or unexpected object is found, stop. | Avoids carrying forward unknown inherited contents if no data is copied. The old target remains untouched and quarantined pending a separate owner retention decision. |
| Access/security | Existing endpoint is writable and passwordless access is enabled. Role privileges and all consumers are not established by the cited metadata. Before staging app connectivity, verify and constrain who can connect and how credentials are controlled; app-layer checks and the current source guard alone do not establish a database-native tenant boundary. | New IDs do not by themselves provide safe access. Apply the same access-control and tenant-boundary gates to the new endpoint before any app connection. The current guard will reject the new identity until separately reviewed source changes are made. |
| Recovery | No target snapshot or restore drill is evidenced. The six-hour history window is not a pinned or tested recovery point. | The new target also needs a target-specific recovery plan. Free-plan capabilities do not prove a snapshot exists or that restore works. A new project does not remove the need for a separately authorized snapshot/restore rehearsal. |
| Engineering and guard impact | Least identifier churn: the current source guard already contains these exact IDs. This convenience does not authorize opening the guard or using the database. | New project, branch, database, role, endpoint, and hostname identifiers must be read back and reviewed. The current source guard must be updated through a future source proposal and exact-SHA review; `stagingIsolationVerifiedEmpty` must remain false until the required isolation evidence and owner decision support a later change. |
| Plan/quota boundary | Uses the current Neon Free project. Supplied metadata reports a 10-branch limit, 1 GiB branch logical-size limit, and 21,600-second history retention. | Requires checking available Free-plan project/resource quota before any creation. The targeted metadata does not establish remaining project quota or all org-level limits. Do not upgrade or incur paid service to make this option work. Stop if the required isolated project cannot fit within verified Free limits. |
| Old-target disposition | Keep the target intact. Do not migrate, clean up, or alter it. | Leave it intact and unused while the new target is evaluated. Do not delete, reset, detach, or copy from it. Any retirement or deletion requires its own explicit owner authorization and retention review. |

### Option A — conditions to consider reuse

Reuse is a cost- and identifier-sparing candidate only if the owner explicitly accepts the unknown parent lineage and signs that no operational or real resident data in this exact target needs preservation. The signed decision must identify all six resources above and say that acceptance of unknown lineage is a risk decision, not a factual claim that the database is empty.

Before any later connection or migration is considered, all of these conditions must hold:

1. Re-read and match project, branch, database, owner, endpoint, region, and hostname to the exact identifiers above immediately before the separately authorized operation.
2. Resolve the `public.show_db_tree` discrepancy through an independently reviewed, safe, bounded method. Do not reuse Wave 12.4's clean-scope label as an answer to this discrepancy.
3. Preserve `stagingIsolationVerifiedEmpty=false` until the owner decision and all applicable isolation gates are separately reviewed. No source change is implied here.
4. Establish a recovery point and rehearse restoration only under separate authorization naming the exact target and restore destination. The current empty snapshot list and six-hour retention do not satisfy this gate.
5. Verify access ownership, connection consumers, and credential controls. Stop if access is uncontrolled or if the endpoint/role cannot be appropriately constrained for staging.
6. Stop on any target mismatch, real resident or operational data needing preservation, unexpected object or ledger, unexplained lineage, incomplete inspection, or inability to preserve a recoverable state.

Even after those steps, the target would be **owner-accepted despite unknown lineage**, not lineage-proven. The owner must not describe it as physically empty based on Wave 12.4's bounded catalog result.

### Option B — conditions for a fresh isolated target

This is the preferred future candidate because it avoids relying on the unresolved parent-data lineage and the metadata discrepancy of the current target. Prefer a new independent Neon project on the existing Free organization over a child branch of `karturt_staging`; a child branch could inherit the very data whose provenance is unknown. The creation record should state the source/origin, creation time, resulting project/branch/database/role/endpoint identifiers, and explicitly attest that no database, snapshot, dump, resident data, or other external data was copied or restored.

Before resource creation, a separate owner approval must define the allowed Free-plan resource operation, the exact organization, the no-copy boundary, quota/cost stop condition, and who may create it. Confirm current Free quota and that creation will not trigger a paid tier or overage; the remaining project quota is not established by this report. Do not create resources under this Wave 12.5 scope.

After separately authorized creation, read back every resulting identifier and verify documented origin, branch/database mapping, and the no-copy record. Perform a new, separately authorized safe baseline inspection; metadata saying “new” or an empty catalog alone is not proof of physical emptiness. Before any application connection, review a source patch proposal for the new identifiers and exact guard behavior, plus the endpoint access and tenant controls. No patch or setting change is part of this report.

The existing project reports Free (`free_v3`), 10 branch slots, a 1 GiB branch logical-size limit, and 21,600 seconds of history retention. Wave 12.4 documents the Free snapshot allowance, but the existing target's snapshot listing was empty. These are limits/capabilities, not proof that a new project can be created, that a snapshot is available for this target, or that recovery has been tested. Verify applicable quota and provider behavior at the time of a future owner decision; do not upgrade if Free limits block the plan.

## Recommendation and owner decision state

**Recommend Option B as the candidate for a future V1 staging target:** a new independent project with documented origin and zero external data copying, subject to verified Free quota, a separately authorized creation, exact identifier readback, a safe baseline inspection, and future guard/security review. This recommendation weighs provenance and recovery clarity over the lower identifier/workload burden of reuse. It does not authorize creation, connection, snapshot, restore, migration, or source changes.

Option A remains a fallback only if the owner prefers to avoid a new project and signs the exact risk acceptance described above, after the `public.show_db_tree` discrepancy and all access/recovery gates are resolved. Owner acceptance alone is not evidence of emptiness, does not identify the unknown parent, and does not set `stagingIsolationVerifiedEmpty=true`.

## Stop conditions

Stop and request a new owner decision if any of the following occurs:

- Any real resident or operational data is found or may require preservation.
- Project, branch, database, owner, endpoint, region, or hostname does not exactly match the selected target.
- An unexpected object, migration ledger, partial-migration state, or unexplained metadata result appears.
- The `public.show_db_tree` discrepancy remains unexplained before considering reuse.
- Parent/source lineage is represented as known without positive evidence, or an owner risk acceptance is missing for Option A.
- Endpoint access is uncontrolled, permissions cannot be bounded, or the required tenant boundary is not addressed before app connectivity.
- A new target requires exceeding verified Free limits, a paid upgrade, data copying, or an unapproved resource operation.
- A recovery point or restore test is absent for a later migration decision.

**Agent A status:** `PARTIAL — OWNER DECISION REQUIRED`. Wave 12.5 remains documentation-only. The source guard remains `stagingIsolationVerifiedEmpty=false`; Wave 13 migration remains **NOT AUTHORIZED**.
