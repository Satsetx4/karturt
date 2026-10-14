# KartuRT V1 Wave 12.5 — Recovery Engineering Runbook

**Date:** 2026-10-14 (Asia/Bangkok)
**Lane:** W12.5-B01–B09 — recovery engineering
**Disposition:** **PARTIAL — documented recovery design is ready for owner review; exact-project snapshot/restore capability has not been exercised.**
**Wave boundary:** documentation and static analysis only. This report grants no Neon, SQL, migration, backup, restore, resource, access, deployment, or billing permission.

## 1. Scope and evidence boundary

This lane used the assigned detached worktree at source SHA `3bc69c83265dce3a6a0863cbfceea188f40f6168`, tree `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9`. The checkout was clean before this report. I read all five Wave 12.4 reports from the read-only reference checkout and reviewed the recovery-relevant Wave 12.1–12.3 evidence, including the Wave 12.2 inspection, Wave 12.3 PostgreSQL 18.6 rehearsal, and their owner/coordinator boundaries. The Wave 12.4 verdict remains **STAGING PREFLIGHT PARTIAL**; staging migration remains **NOT AUTHORIZED**.

No Neon API or MCP metadata call, SQL/query, connection, compute wake, snapshot, backup, restore, project/branch/database/endpoint creation or deletion, role/credential/access change, migration, DDL/DML, seed, application-data read, Vercel action, or paid-service action was performed in this lane. The only repository file permitted for this lane is this report. Source, migration, Drizzle, guard, workflow, and provider-setting files were not changed.

## 2. Verified baseline and current bounded state

| Item | Recorded value | Evidence boundary |
|---|---|---|
| Source | `3bc69c83265dce3a6a0863cbfceea188f40f6168`; tree `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9` | Verified locally in this assigned worktree. |
| Exact migration set | 14 ordered SQL files `0000`–`0013` | Static source inventory only. SHA-256 values are listed below. |
| PostgreSQL rehearsal | GitHub Actions run [`38503239173`](https://github.com/Satsetx4/karturt/actions/runs/38503239173), exact source SHA, PostgreSQL 18.6 | PASS only for the disposable run-owned service and synthetic fixtures. It does not establish Neon target state or recovery. |
| Neon project | `karturt-v1-staging`, ID `wild-art-99835126`, Free, `aws-ap-southeast-1`, PostgreSQL 18 | Wave 12.4 scoped metadata record; not reread in this lane. |
| Branch | `staging`, ID `br-hidden-cake-a1ge5xqp`, primary/default, `init_source=parent-data` | Parent identity and source point unknown. The exact project metadata reported one branch; re-read before any later operation. |
| Database / owner | `karturt_staging`, ID `42079960`; `karturt_staging_owner` | Metadata only. Role privileges are not established by the owner name. |
| Endpoint | `ep-snowy-meadow-a10304d9`, `read_write`, `passwordless_access=true` | Metadata only; no connection or wake. This is not a read-only guarantee. |
| History metadata | `history_retention_seconds=21600` | A configured six-hour value is not proof that a desired recovery point is currently available or that a restore works. |
| Snapshot state | Wave 12.4 snapshot listing returned no snapshots; its reported schedule was empty. | Historical target readback only; this lane did not refresh it. Check again before any separately authorized operation. |
| Wave 12.4 catalog | 26/26 statement groups returned; `SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE`: only `public` namespace, no enumerated application objects or Drizzle ledger, and `plpgsql` extension | Bounded catalog result only. It does not prove physical emptiness, row absence, parent contents, lineage, or migration readiness. |
| Unexplained metadata | `describe_branch` additionally exposed `public.show_db_tree` | Not covered by the 26-query inventory. Treat as unresolved and stop before a migration until a separately authorized safe classification explains it. |
| Guard | `stagingIsolationVerifiedEmpty=false` | Must remain false. Nothing in this runbook changes it. |

The metadata and catalog evidence above is not equivalent to a tested backup. `init_source=parent-data` leaves inherited lineage unknown. A future owner may explicitly accept that uncertainty for a disposable staging decision, but that acceptance is not factual proof of an empty database and does not authorize changing the source guard.

### PostgreSQL 18 evidence stays separate

Run `38503239173` passed the checked-in chain on a fresh disposable PostgreSQL 18.6 service: 14 journal entries; expected catalog counts of 27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums; synthetic migration and failure cases; and `pg_dump`/`pg_restore`. This was not Neon, did not test a Neon snapshot, and did not test restore from this staging project. Do not rerun or transfer that evidence to Neon as part of this wave.

## 3. Current Neon documentation, separate from exact-target facts

Official Neon documentation reviewed for this report states, as of 2026-10-14:

- The Free plan includes up to one manual snapshot per project; scheduled backup snapshots are a paid-plan feature. Snapshot storage is listed at **$0.09/GB-month**. A documented feature or quota is not evidence that this project currently has a snapshot, that storage would be free, or that an operation fits this project’s remaining limits. See [Neon plans](https://neon.com/docs/introduction/plans) and [Backup & restore](https://neon.com/docs/guides/backup-restore).
- Free instant-restore history is capped at six hours and 1 GB of change history, whichever limit is reached first. The project’s recorded `21600` seconds matches the six-hour setting, but it does not establish that the desired LSN/timestamp remains available or that restore is operational. See [History window](https://neon.com/docs/postgres/backup-restore/history-window).
- Point-in-time restore is for root branches. It replaces the whole branch timeline (all databases), interrupts connections, and creates an automatic backup branch; it is not a merge. It can consume branch and storage allowance. See [Instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore).
- A snapshot can be restored in multiple steps into a new branch, leaving the existing branch unchanged; a one-step snapshot restore replaces the target branch. A branch created from a snapshot restore cannot itself use PITR at this time. The existing branch’s primary/default metadata suggests root-branch status, but the restore capability was not exercised here. See [Backup & restore](https://neon.com/docs/guides/backup-restore).
- The current published Free plan also states one GB of Postgres storage per project and ten branches per project. These are published plan limits, not a fresh measurement of this project’s remaining capacity. A restored branch may need a compute endpoint for validation; compute, branch count, logical storage, and snapshot storage must be checked against current project usage and plan terms before acting.

**Cost rule:** do not label a snapshot or restore “Rp0” from plan name alone. Before a later owner-authorized action, capture the current plan/usage and operation estimate. Stop if any charge, overage, upgrade, or unverified price is possible; do not upgrade or incur cost under this wave.

## 4. Recovery option 1 — authorized disposal/rebuild from a provably clean baseline

This option creates a fresh disposable migration target from a known-clean, approved starting point. It is a future design only; no resource may be created, reset, or deleted under this report.

1. **Resolve disposition first.** The owner must sign whether the current `karturt_staging` target has operational or real-resident data that must be preserved. Unknown parent lineage, the 26-query result, low logical size, and zero written-byte counters do not satisfy this assertion. If preservation is required or uncertain, stop and preserve the current target.
2. **Select a known-clean source.** Prefer a new isolated root/project whose baseline has an auditable, no-data provenance. A schema-only branch is acceptable only if its own parent/source has verified lineage and no inherited data. Do not use the current unknown-lineage branch as the parent or copy source. Import no external data and seed no resident data.
3. **Keep the old target intact by default.** Creating a fresh target does not authorize removing or resetting the old one. Record the old target’s IDs and intended quarantine/retention disposition. Delete or retire it only under a separate, exact owner authorization that names the resource and action. A new target needs fresh exact identifiers and a separately reviewed future source-target guard change before app connectivity.
4. **Prove the new target before migration.** Re-read organization/project/branch/database/endpoint/role identity; verify PostgreSQL 18 and the intended region; establish root/branch lineage; confirm the new root is the selected approved clean baseline; confirm no unexpected objects; resolve any `public.show_db_tree` or other unexplained state; and verify access controls and Free-plan branch/storage/compute headroom. Any mismatch or missing evidence is a stop.
5. **Freeze the build inputs.** Record exact application SHA/tree, ordered migration list and SHA-256 manifest below, and migration journal hash. The owner approves the exact target, permitted operations, execution window, recovery authority, and cleanup boundaries in a new decision.
6. **Failure and rebuild behavior.** If any migration has begun, treat the target as potentially partially modified. Stop the runner and application writes. Rebuild from the known-clean baseline only if a separate owner approval explicitly authorizes disposing of that exact disposable target and creating its replacement. Do not drop/reset automatically, replay blindly, or edit the Drizzle ledger.

**Strength:** produces the strongest provenance/clean-start case if the new baseline is independently proven and the old target is preserved. **Trade-off:** requires new resource identities, quota/headroom review, and later guard/configuration work; it does not resolve whether the old staging branch contains data. Free-plan limits and any cost are unverified until current usage is read back.

## 5. Recovery option 2 — pre-migration snapshot plus a separately authorized restore rehearsal

This option preserves the current target’s state and tests that a specific recovery artifact can be restored into a separate disposable branch. It does **not** turn the unknown source lineage into known lineage or prove the branch is empty.

### Preconditions and sequence for a future, separately authorized wave

1. Obtain distinct owner authorization to create exactly one manual snapshot for project `wild-art-99835126`, branch `br-hidden-cake-a1ge5xqp`, plus a distinct authorization for creating a disposable restore branch. Confirm the branch is still a root branch, the exact target identity still matches, no snapshot already occupies the Free-plan manual slot, current snapshot pricing/usage is understood, and project quota/headroom supports the operation. Do not assume schedule support on Free.
2. Confirm the owner has decided that preserving a point-in-time copy of the current unknown state is appropriate. The snapshot captures the current schema and data as-is; it is not a scrubbed backup and no row-level contents may be copied into GitHub or this report.
3. Create the manual snapshot only after all preconditions pass. Read back the snapshot ID, status, source branch ID, creation timestamp, and retention/expiry metadata. If the provider does not confirm a completed snapshot tied to the exact source, stop. Do not retry a timed-out mutation until its result is read back under explicit metadata-read permission.
4. With separate authorization, use the **multi-step restore** path to create a uniquely named disposable branch from that snapshot. The current branch must remain unchanged. Do not use one-step restore or PITR as the rehearsal mechanism. Confirm new branch ID, snapshot/source lineage, readiness, database presence, region, PG version, branch/compute counts, and storage use. Do not attach compute or connect unless those operations are separately named in the approval.
5. If separately authorized, validate the restored branch with a bounded read-only catalog check and artifact comparisons that reveal no resident rows or secrets. Preserve sanitized operation IDs and result status only. A snapshot-restored branch does not support PITR currently; do not treat another PITR restore as its rollback path.
6. Leave both source and restore branch untouched after validation. Cleanup/deletion is a separate permission. A successful rehearsal proves that this specific snapshot can produce a branch and pass the specifically authorized validation; it does not prove source emptiness, known original parent lineage, application correctness, or migration readiness.

### If later migration rollback is required

A snapshot restore to a **new branch** is the safer inspection path because it leaves the branch that may have partially migrated untouched. Any decision to retarget an application or endpoint to the restored branch is a further owner decision with exact new IDs and a reviewed cutover plan. An in-place PITR or one-step restore can overwrite every database on a root branch and interrupt connections; it must never be inferred as authorized by snapshot creation, restore rehearsal, or a generic “rollback” instruction.

## 6. Exact migration inputs at the assigned source SHA

The following SHA-256 values were calculated from the 14 SQL files in the assigned immutable worktree. They identify the evidence reviewed; they are not a migration authorization. Recompute and compare against the owner-approved manifest before any future run.

| Order | File | SHA-256 |
|---:|---|---|
| 0000 | `0000_messy_menace.sql` | `1e87505b8543171ab85a98fc2b9ff565952fc31d92c9aabcb063973ca1189af9` |
| 0001 | `0001_classy_ricochet.sql` | `f644351e359305b4f696a8e60ef9241706d2e1a751adfd906110e519ecc80b93` |
| 0002 | `0002_monthly_due_period_guard.sql` | `466ddc6ef468d086800b52929889ed752f3df5ed362beb6739265868bfed9ead` |
| 0003 | `0003_due_auth_audit_domain.sql` | `a0880ae7daeb81d8d47e736fbae0f925237655f7f216713692041a8b5cbf4994` |
| 0004 | `0004_phase_5_payment_request.sql` | `459150e411f0fb7386f4803616cc92684ed30c6cf4dfbb9c0787b483b5b47304` |
| 0005 | `0005_phase_5_1_payment_request_items_immutable.sql` | `e92659078ea43f77e6ca91fefe0d0711edc7580753b73070d62428556ff4bf5b` |
| 0006 | `0006_phase_6_treasurer_payment_ledger.sql` | `f1e902ddb4b7f2cb7a6cde56e9955835a07c3153ab2a04fe93e435cc18aed674` |
| 0007 | `0007_phase_7_reject_cancel.sql` | `f8be881f41d2f2c1b1520ba51cb1d6f9a2474539c122f0fe7fef3886962b7de2` |
| 0008 | `0008_phase_7_1_post_resolution_lifecycle.sql` | `c321c7b82a05082d87b9c5182f28ac9abf18ec16884dfa5a089e1fdc1fa29b11` |
| 0009 | `0009_phase_8_cash_payment.sql` | `d86b48e55cf0135015ce7a013d95994f62c62e7d3e341012fcc19350c217fbf6` |
| 0010 | `0010_phase_9_payment_reversal.sql` | `63038e8a4e7fe29a007cb80704ab8f2cadaaf15f57238af1579980ab9710a209` |
| 0011 | `0011_phase_10_waiver.sql` | `c3826aea7c0c837e07b4152e780d065fbbc6592744b3326af29b1cca44c5a119` |
| 0012 | `0012_phase_11_tariff_adjustment.sql` | `131c058f819fa1192dd7fea12b7ba7d45c1f6a967e494a6cbab7e7f4b2dff86a` |
| 0013 | `0013_phase_12_household_management.sql` | `a707f54fb504999323fd65860cfeea247288e20940d1319094195d067f30ab2c` |

The checked-in Drizzle journal file `drizzle/meta/_journal.json` has SHA-256 `d468de22e03afa8598e5a9502d6a287309a07b4a7e949d90cd98224fb8d453db`. A later source or journal change invalidates this manifest and the exact-SHA Wave 12.3 result for changed inputs.

## 7. Failure matrix and required response

**Universal rule:** any error after the migration runner is invoked leaves the target state uncertain until an explicitly authorized read-only inspection reconciles catalog and journal state. Stop the runner and application writes, preserve redacted logs and operation identifiers, and wait for an owner-approved recovery decision. No blind retry, DDL repair, manual ledger edit, data rewrite, or automatic restore.

This applies at every boundary: before `0000`, while each of `0000`–`0013` is executing, and after each file returns but before the next file starts. A failure after `000k` must not allow `000(k+1)` to run until the exact state is reconciled and the owner reauthorizes continuation or recovery.

| Failure point / condition | Risk | Required response |
|---|---|---|
| Before 0000: target identity, access, preflight, backup, or source-hash check fails | Wrong target or unprotected start | Do not start migration. Preserve the exact failed check and resolve under the appropriate separate authorization. |
| During or immediately after any migration 0000–0002 | Earlier object creation/alteration may be partially present; atomicity is not assumed | Stop before the next file. Do not rerun the file. Reconcile exact catalog objects and Drizzle ledger with a new approved read-only inspection. |
| During/after 0003 legacy enum and due conversion | Values and enum/index identities can change; reverse conversion may lose information | Stop; do not retry, reverse-convert, or alter rows. Preserve the pre-migration snapshot/recovery point and obtain an owner-approved restore or versioned repair plan. Verify the expected synthetic case only in a separately authorized isolated environment. |
| During/after 0004–0009 structural/payment changes | Non-idempotent DDL and payment lifecycle changes may be partly committed | Stop before the next migration. Do not infer rollback from a failed command. Reconcile exact schema and ledger state under separate read-only authorization. |
| During/after 0010 settlement backfill | Existing payment/allocation history may be inconsistent or rows may have been backfilled partly | Stop. Do not rerun or edit financial rows. Require separately authorized, privacy-safe integrity review of due/payment/allocation/settlement invariants, then owner-approved restore or versioned repair. |
| 0011 waiver preflight fails | Legacy `WAIVED` dues may lack structured waiver history | Stop before later migrations. Do not bypass preflight or synthesize waiver history. Preserve state and route to owner for reviewed data disposition/rebuild. |
| 0012 settlement/tariff preflight fails | Active settlement ownership/allocation/due invariants differ from expected | Stop. Do not create missing ownership rows or change dues to satisfy the preflight. Use an authorized integrity review and owner-approved recovery. |
| 0013 household-period preflight fails | Overlapping or invalid household periods may exist | Stop. Do not end-date or rewrite household records to force success. Require privacy-safe, owner-approved classification and recovery plan. |
| Drizzle journal mismatch, missing/extra entry, unexpected checksum, or journal/object mismatch | Migrator may skip needed DDL or believe an incomplete state is complete | Stop. Never insert, update, delete, or hand-edit Drizzle journal rows. Compare exact journal/migration inputs and actual objects through a separately authorized read-only inspection; restore/rebuild only with owner approval. |
| Partial or non-idempotent DDL / uncertain transaction boundary | Some statements may persist even when a migration reports failure | Assume partial state until proven otherwise. Do not replay any migration. No assumption of per-file atomicity is accepted by this runbook. |
| 0003/0010 data-dependent outcome differs from rehearsal | Synthetic fixtures do not match unknown target history | Stop. Do not transform real data to resemble fixtures. Reclassify through a fresh authorized safe inspection or choose a provably clean isolated rebuild. |
| 0011–0013 preflight or constraint error | Migration intentionally rejects an inconsistent starting state | Stop the entire chain; do not proceed to the next migration and do not remove constraints/preflight code. Route the named invariant and sanitized evidence to the owner. |
| Snapshot missing, expired, incomplete, or wrong source branch/time | Recovery point cannot be trusted for this target | Do not migrate. Preserve original branch. Do not create a second snapshot or repeat a timed-out request until exact state/cost is read back under explicit permission. |
| Snapshot restore fails or restored branch is incomplete/not ready | Backup path is not proven | Leave the original untouched. Do not use one-step restore or delete partial resources automatically. Stop and request owner disposition under exact restore/resource permission. |
| Network timeout or disconnect during snapshot, restore, read-only preflight, or migration | Operation may have succeeded partially despite client timeout | Do not retry. Re-read provider operation/target state only under an explicit read-only metadata permission; if migration may have started, preserve state and do not resume until reconciled and reauthorized. |
| Unexplained object such as `public.show_db_tree`, unexpected schema/object, target mismatch, or incomplete/truncated result | Defined-scope clean result no longer supports target acceptance | Stop. Keep `stagingIsolationVerifiedEmpty=false`. Resolve with owner-approved fixed-scope read-only evidence; do not drop or invoke objects. |

## 8. Future acceptance criteria

These are proposed gates for a later, separately authorized migration window. They are not satisfied by this runbook.

### Before migration — all required

- Owner selects option 1 or option 2, signs the exact target and execution window, and states whether any real/operational data must be preserved. If preservation is required or unknown, do not dispose of/rebuild the current target.
- Exact Neon org/project/branch/database/endpoint/role identifiers, PG18 version, region, root/parent lineage, and current access posture are re-read in the approved scope. Any mismatch, unexplained object, or inability to classify `public.show_db_tree` is a stop.
- If option 1: the new baseline’s provenance and no-data starting state are positively evidenced; no data is copied from the current unknown-lineage target; old staging remains untouched until a separately approved retirement decision.
- If option 2: the exact current-state snapshot is confirmed complete, its source branch/time match the manifest, and its multi-step restore succeeds into a separately authorized disposable branch. The original branch remains unchanged. A snapshot is not accepted as proof of isolation or emptiness.
- Current Free snapshot, branch, storage, and compute quotas are read back. A cost estimate is captured. If snapshot storage, branch/compute usage, or any planned operation may be chargeable or exceed allowance, stop unless a new owner decision explicitly resolves the amount and authorization. No upgrade is implied.
- Source SHA/tree, all 14 migration checksums, and journal checksum match the owner-approved values exactly. Any difference invalidates prior evidence and requires new review/rehearsal.
- An exact, server-enforced read-only SQL preflight has a separate authorization and its own target/statement review. A tool capable of arbitrary SQL, a writable endpoint, passwordless access, or role name does not itself prove read-only. If preflight would wake compute without explicit permission, stop.
- App connectivity/writes are disabled for the migration window; named operator, owner recovery decision-maker, stop contacts, and recovery authority are present. App connectivity and source guard changes require separate approvals.
- Separate migration approval names precisely `0000`–`0013`, approved target IDs, expected synthetic/non-PII validation, rollback mode, and allowed resource operations. Wave 12.5 supplies none of that authorization.

### After migration — required before calling the target accepted

- Read back the exact target identity and confirm PostgreSQL 18. The migration run completed once, in journal order, with exactly 14 entries whose recorded names/checksums match the approved manifest; no extra or missing entries.
- Compare the actual schema with the expected post-chain reference, including 27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums, and review unexpected objects separately. The counts are expected reference values from the disposable PostgreSQL 18.6 rehearsal, not a substitute for exact object/invariant validation.
- Validate 0003 conversion outcomes, 0010 settlement/payment/allocation invariants, and the 0011–0013 state constraints on authorized synthetic data or privacy-safe aggregates. Do not export real-resident rows or identifiers into reports.
- Ensure no migration errors, journal drift, unresolved object, failed post-check, or unintended seed/data write remains. Preserve sanitized execution logs, exact target/source manifests, and snapshot/restore evidence.
- Keep the recovery artifact and restored branch until the owner separately approves their disposition. Do not automatically delete branches, snapshots, or the old staging target after acceptance.
- Application connection, deployment, production readiness, and any change to `stagingIsolationVerifiedEmpty` require independent later decisions; this acceptance section does not grant them.

## 9. Artifact manifest and access boundaries

A future recovery packet should record only: project/branch/database/endpoint IDs and names; source SHA/tree; migration and journal hashes; snapshot ID/source branch/time/status/retention; restore operation ID and new branch ID/status; sanitized pre/post catalog/invariant outcomes; quota/cost readback; execution window; and named owner decisions. Do **not** place credentials, tokens, connection strings, environment values, resident names/addresses/records, database dumps, backup exports, or raw user rows in GitHub or this report.

| Operation | Required authority in a future phase | Explicit boundary |
|---|---|---|
| Read exact project/branch/snapshot metadata | Separate read-only metadata scope naming only project `wild-art-99835126` | Does not authorize connection, wake, SQL, or writes. No other Neon org/project. |
| Create one manual pre-migration snapshot | Explicit owner approval naming project and root branch, with current quota/cost readback | Not implied by Free plan entitlement or this runbook. No schedule changes. |
| Restore snapshot into new disposable branch | Separate owner approval naming snapshot, destination name/branch scope, validation, quota/cost, and cleanup authority | Use multi-step restore for rehearsal. No overwrite, connection retarget, or auto-delete. Compute attachment and SQL validation each require their own named scope. |
| Create new project/branch/database/endpoint for rebuild | Separate approval per exact resource and intended configuration, with free-tier headroom/cost evidence | Creating one resource does not authorize deletion of the old target or app/source configuration changes. |
| Delete/reset/retire old or disposable resource | Separate explicit approval naming exact resource and operation | No implied cleanup; no deletion by default. |
| Server-enforced read-only SQL preflight | Separate approval naming target and exact reviewed statements; confirm read-only transaction and identity guard | No DDL/DML, seed, app query, fallback connector, blind retry, or compute wake unless explicitly authorized. |
| Run migrations `0000`–`0013` | New Wave 13 owner authorization naming exact source/hash manifest, target, window, operator, recovery path, stop criteria | Not authorized by Wave 12.5 or the Wave 12.3 disposable pass. |
| Change role, credential, access, endpoint, source guard, Vercel, workflow, plan, or billing | Separate explicit authorization for the exact provider/source action | Out of scope for this runbook. No paid plan or service. |

## 10. Official references

- [Neon plans](https://neon.com/docs/introduction/plans) — current Free quotas, manual snapshots, scheduled backup availability, snapshot-storage pricing, branch/storage/compute limits.
- [Neon Backup & restore](https://neon.com/docs/guides/backup-restore) — manual snapshots, multi-step restore to a new branch, one-step overwrite behavior, schedules, and snapshot limitations.
- [Neon Instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore) — root-branch eligibility, branch-wide overwrite, automatic backup branch, connection interruption, and usage considerations.
- [Neon History window](https://neon.com/docs/postgres/backup-restore/history-window) — Free six-hour / 1 GB history cap and storage behavior.

**Agent B final state:** `PARTIAL — recovery design and source manifest documented; target-specific snapshot and restore remain unverified`. No Wave 13 migration, Neon operation, or source patch is authorized by this report.
