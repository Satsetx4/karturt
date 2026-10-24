# Fast Track V1 Functional First decision

Date: 2026-10-24 (Asia/Jakarta). Authority: owner instruction in this Codex task, read with the existing one-project Neon Free staging approval and its explicit action limits.

## Decision and priority rules

Execute V1 as Functional First with parallel, bounded microtasks. This changes prioritization and coordination; it does not waive mandatory gates.

- **P0 — critical, must PASS:** inter-resident, household, RT, and role authorization; payment amount, allocation, idempotency, duplicate settlement, reversal, and audit integrity; no production side effects. Any P0 finding stops advancement until fixed and re-proven on the exact candidate SHA.
- **P1 — blocker, must be fixed:** broken core V1 flow or required negative case; data integrity or recovery defect; missing/failed required evidence for isolated staging, least privilege, TLS, PG18, real staging concurrency, tested rollback, or exact-head CI. P1 cannot be accepted as an exception.
- **P2/P3 — noncritical accepted exceptions:** document only when no mandatory gate or material user, payment, security, or recovery outcome is weakened. Record scope, impact, evidence, rationale, compensating control, follow-up owner, and review/expiry trigger. Coordinator and QA/Security consolidate these into one exception register and final packet; do not create routine owner interrupts.

An exception cannot convert UNKNOWN, SKIPPED, or missing evidence on a mandatory gate into PASS. Mandatory CI skipped or attached to another SHA remains UNVERIFIED.

## Mandatory gates retained

1. Inter-resident, household, RT, and role authorization, with negative tests.
2. Payment integrity for transfer and cash: correct resident/period/amount, oldest-first allocation where applicable, idempotency, duplicate/concurrent submits, reversal, and canonical receipts/audit history.
3. One owner-designated isolated Neon Free staging target on PostgreSQL 18, independent of production and proven synthetic-only before database use; scoped non-admin application role; target-bound TLS certificate validation with verify-full; and verified Rp0 cost evidence.
4. Real PostgreSQL concurrency and E2E against that isolated PG18 target. PG17, PGlite, mocks, skipped jobs, and offline rehearsals do not satisfy this gate.
5. Tested non-production backup/restore and rollback tied to the candidate and staging target.
6. Exact-head CI for every changed source or planning head. Re-run after every change; no PASS transfer across SHAs.
7. Separate final owner production GO for the exact release SHA and production environment after F0-F4 pass. This GO and every production action remain outside this task.

## Parallel work allocation

- **Coordinator/integration:** maintain shared acceptance matrix, dependency order, exact-SHA evidence ledger, one owner-action packet, and exception register; integrate only reviewed, non-overlapping changes.
- **F1B / #86:** annual resident cards, future-period status, canonical paid receipts, and household/RT authorization negatives. Isolated application branch; separate QA/Security review.
- **F1C / #87:** arrears and chairman reports, paid/waived/not-due/reversed reconciliation, and Jakarta/month/year boundaries. Isolated from F1B card/UI changes.
- **F1D / #88:** cash allocation and regression coverage for oldest-first, future targets, idempotency, and concurrent transfer/cash. Preserve working behavior unless a reproduced P0/P1 requires a narrow fix.
- **QA/Security:** review P0/P1 across all F1 tasks and report one consolidated blocker list. Database/Staging may do read-only metadata and evidence prep in parallel; staging use begins only after F2 guards and narrow authorization pass.
- **Order:** F1 tasks run in parallel; coordinator reconciles and runs candidate exact-head CI. Read-only F2 prep can run in parallel. F3 starts only after F1/F2 PASS; F4 follows F3. F5 stays locked for separate owner GO.

## F1 candidate findings and exception register

These are candidate-only findings, not protected-main integration or staging evidence.

- **#86:** PR #93 candidate source-path review identified no P0/P1 defect; exact run #40040334501 Gate A job #120709660348 and disposable PG17 concurrency job #120712264849 succeeded. Live paid-row allocations remain UNKNOWN; verify on genuine isolated staging.
- **#87:** PR #93 candidate report paths identified no report-code P0/P1 defect; same exact run and PG17-only scope apply. Keep future unpaid periods out of arrears; reconcile reversals/adjustments and retain authorization tests.
- **#88:** PR #93 candidate payment/auth paths identified no P0/P1 defect; same exact run and PG17-only scope apply. **P2 accepted for V1:** cash may settle existing historic unpaid dues for an inactive household while remaining RT/household-scoped and creating no new dues. Revisit if product policy requires active-household-only collection. **P3 accepted:** one unrelated lint warning at scripts/phase-12-household-browser-smoke.ts:1005; zero lint errors reported.
- These findings do not close live allocations, isolated PG18, TLS, staging concurrency, recovery, Preview, or production gates.

## Staging project audit and canonical planning target

Read-only Neon control-plane metadata on 2026-10-24 found two staging projects in Free organization org-ancient-boat-57106549. The owner requested one canonical target and no deletion.

| Project | Metadata observed | Decision |
| --- | --- | --- |
| flat-cloud-57657711, karturt-v1-f2-clean-isolated-20261024 | Created 04:43:20Z; PG18; Singapore aws-ap-southeast-1; root br-sparkling-flower-azordm9k, karturt-staging-root-20261024 | **Canonical planning target**, matching owner direction in issue #81 comment 6380981840. Database use/mutation is not authorized. |
| steep-heart-48842733, karturt-v1-fast-track-clean-staging-20261024 | Created 06:35:32Z; PG18; Singapore aws-ap-southeast-1; root br-royal-grass-azyozaxi, main | **Duplicate, quarantined from use and preserved.** No deletion, settings change, or fallback use. |

Fresh read-only control-plane metadata confirms both projects are on Neon Free (`subscription_type=free_v3`), PostgreSQL 18/Singapore, and use 0.25 CU with `store_passwords=true`; owner accepted default password storage, but the password was not retrieved or used. Each has one root/default branch with no `parent_id`. Neon’s [Manage branches documentation](https://neon.com/docs/manage/branches) shows a root/default branch with no `parent_id` that reports `init_source=parent-data`; the marker is compatible with ordinary root/default metadata and does not identify a production parent. The canonical project and its sole branch were created together by Neon MCP at `2026-10-24T04:43:20Z`; current branch metadata reports `written_data_bytes=0` and `data_transfer_bytes=0`. This confirms no Neon parent branch and no observed branch writes/transfers since creation, but does not attest to all database contents. Root/no-parent topology is verified; synthetic-only content provenance remains **UNKNOWN** ([branch details](https://api-docs.neon.tech/reference/getprojectbranch)). The canonical project still has effective project permission ADMIN, public connections unblocked, and an empty IP allowlist. Free tier is verified; usage telemetry is not billing evidence, so actual Rp0 billing remains **UNVERIFIED**. Both projects remain BLOCKED for database use until content provenance, least-privilege/network, verify-full TLS, and cost evidence are resolved; the duplicate remains quarantined and untouched.

Owner-approved default password storage does not authorize retrieving or displaying the owner password. This audit used control-plane metadata only: no database connection, password retrieval, SQL, migration, seeding, role/network/settings change, or provider mutation occurred.

## Consolidated owner actions

1. No further owner action is needed for the planning designation: flat-cloud is the sole canonical planning target; steep-heart is quarantined and preserved.
2. Before F2 database use, provide one compact evidence/authorization packet: independent synthetic-only lineage, target identity/isolation, Free/Rp0 evidence, scoped non-admin role, TLS verify-full, backup/restore/rollback readiness, exact candidate SHA, and the exact permitted staging operation. Do not bundle production action.
3. After F0-F4 pass, request a separate production GO for the exact SHA and proposed action. Production stays locked until then.

## Phase status snapshot after exact-head CI (2026-10-24)

| Phase | Status | Evidence boundary / blocker |
| --- | --- | --- |
| F0 | **PASS — planning/read-only baseline at SHA db808781cec7a8299d10b4c02f9a582a861cfa2c** | Exact run #40072769357 completed SUCCESS; Gate A job #120809585178 succeeded. Docs-only independent concurrency job #120811442940 was SKIPPED and is not staging concurrency evidence. This phase row records the exact validated planning head; follow any later PR #84 head/CI in issue #79 and the PR body. |
| F1 | **PASS — unmerged candidate only** | PR #93 SHA b8bc74a4202225d9a54728d2c10be247dec8318f; run #40040334501 Gate A and disposable PG17 concurrency succeeded. No live staging evidence or protected-main integration. |
| F2 | **BLOCKED** | flat-cloud is the planning target, but lineage/content, least privilege, TLS verify-full, actual Rp0 cost, and scoped DB readiness remain UNVERIFIED. No DB use/mutation. |
| F3 | **BLOCKED** | PR #96 SHA 477a0fe199debec67de071376d9338f956f9dc79; run #40070054841 Gate A and disposable PG17 concurrency succeeded. No real isolated PG18 staging E2E/concurrency. |
| F4 | **NO-GO** | PR #95 SHA 5ac931b48efb781d3e7a10b1a360496beabbbafe; exact run #40071118229 Gate A job #120804565777 and independent PostgreSQL concurrency job #120805614522 both SUCCESS (disposable PG17). No verified staging Preview or tested current-target restore/rollback. |
| F5 | **LOCKED — separate owner GO required** | No production authorization is included here. |

## Non-actions and evidence rules

This decision authorizes planning/docs/issues, isolated source microtasks, read-only inspection, and safe staging preparation within its existing bounds. It authorizes no SQL, Neon/staging mutation, password/secret/environment change, merge, deployment, or production action. Keep historical Wave13B.2 F2 failure immutable.

Record each result as PASS, FAIL, BLOCKED, SKIPPED, or UNKNOWN, with repository, full SHA, PR, run/attempt/job, environment identity, and evidence link. A draft PR remains draft until reviewed; CI success is not merge or production authorization.

## Owner authorization addendum — conditional Neon Free staging scope (2026-10-24, Asia/Jakarta; suspended by the later F2 stop)

The owner initially conditionally authorized an ordered scope for only Neon Free project `flat-cloud-57657711`, branch `br-sparkling-flower-azordm9k`, endpoint `ep-red-boat-azzqyf45`. A later F2 stop supersedes any pending database/role operation: do not resume SQL, role changes, migrations, seed, UAT, recovery, staging secrets, Preview, or deployment until all F2 gates have fresh PASS evidence and the owner directly authorizes resumption. The latest owner reply permits Neon’s default password storage only (`store_passwords=true`); do not retrieve, display, or use the owner password. The following list records the original conditional scope and is not currently executable:

1. Verify Free/Rp0 cost, exact project/branch/endpoint identity, isolation from production, and synthetic-only provenance. The owner explicitly approves Neon’s default password-storage behavior (`store_passwords=true`) for the canonical project; do not retrieve, display, or use the Neon owner password.
2. Original intended scope: on this exact target, establish a non-admin PostgreSQL role; configure network restrictions only if available on Free; prove TLS with `sslmode=verify-full`; then run read-only catalog SQL to establish data origin and isolation. This step is currently suspended by the later stop. Stop if cost, provenance, isolation, privilege, or TLS cannot be proven.
3. **Only after every F2 security gate passes**, apply official staging migrations, load synthetic-only fixtures, perform UAT and actual PostgreSQL 18 concurrency, and complete nonproduction backup/restore/rollback drills.
4. **Only after F2 PASS**, configure staging-specific secrets/environment safely and deploy a nonproduction Vercel Hobby Preview with smoke tests.

No paid features, production access/change, change to any other Neon project, project deletion, merge to `main`, production deployment, or live production action is authorized. Production GO remains a separate owner decision for an exact SHA and environment. Trusted Neon Viewer-token proof and custom-tag ledger remain **V1.1**.

### F2 read-only evidence and stop checkpoint

- Neon control-plane metadata matched the three owner-designated IDs. Project classification was `free_v3`; usage counters were zero, current storage was below the published 1 GB Free allowance, and current Free pricing is $0. This is current plan/usage evidence, not a future usage guarantee.
- The canonical project's only branch is its root/default branch, created alongside the project at `2026-10-24T04:43:20Z`; no `parent_id` is present. Neon API documentation identifies `parent_id` as the parent-branch reference, and its [Manage branches example](https://neon.com/docs/manage/branches) shows a root/default branch with no `parent_id` that reports `init_source=parent-data`. The marker is therefore compatible with ordinary root/default metadata and does not identify a production parent. This verifies root/no-parent topology only. Metadata also reports zero branch writes/transfers since creation, but does not certify the database's full contents. Synthetic-only content provenance remains **UNKNOWN**.
- The optional IP allowlist remains empty and unchanged. Neon’s current plan comparison lists IP Allow Rules with Scale features but not among Free capabilities; we infer IP Allow is unavailable on this Free project ([current pricing](https://neon.com/pricing)). This is plan-document evidence, not a live entitlement test. No paid upgrade or network-setting change was made.
- The Neon role-creation tool created `karturt_f2_catalog_ro_20261024`, but a role-scoped read-only catalog query returned `rolcreatedb=true`, `rolcreaterole=true`, `rolreplication=true`, and `rolbypassrls=true`. This is **not** an acceptable least-privilege role.
- The same query reported PostgreSQL `180006`, no non-system relations or routines in `karturt_staging`, and `pg_stat_ssl.ssl=false`. The SQL tool path therefore does not prove TLS, much less client `sslmode=verify-full`. Treat its empty-catalog observation as unaccepted for the security gate.
- **Verdict: F2 STOP/BLOCKED.** The owner explicitly approved deleting only `karturt_f2_catalog_ro_20261024`; deletion on the exact target was followed by a fresh role listing that confirmed it absent. The earlier role privilege result and `pg_stat_ssl.ssl=false` remain adverse evidence. Neon root/no-parent topology is confirmed. The official Manage branches example shows that a root/default branch without `parent_id` can report `init_source=parent-data`, so the marker alone does not identify a production parent. Full content provenance remains UNKNOWN because the metadata does not attest to database contents. No non-admin application role, safe network restriction, client `sslmode=verify-full`, or actual Rp0 billing proof exists. No further SQL/role work, migration, seed, UAT, real concurrency, backup/restore, staging secrets/environment, Preview, or deployment is authorized until every F2 gate has fresh PASS evidence and the owner directly authorizes resumption.

### F0–F5 status at this checkpoint

| Phase | Status | Evidence boundary |
|---|---|---|
| F0 | **PASS for planning/read-only baseline only** on PR #84 SHA `c3c1b07aaf6ba3de7c45efef79a134a3bffb1bc6`, run [#40073550071](https://github.com/Satsetx4/karturt/actions/runs/40073550071) Gate A SUCCESS. | This addendum changes the PR head; its own exact-head CI is pending. No staging proof. |
| F1 | **PASS for candidate only** on open/draft PR #93 SHA `b8bc74a4202225d9a54728d2c10be247dec8318f`, run [#40040334501](https://github.com/Satsetx4/karturt/actions/runs/40040334501), Gate A and disposable PG17 concurrency SUCCESS. | Unmerged candidate evidence; not live PG18, staging, or production evidence. |
| F2 | **BLOCKED** | Role privilege result and TLS proof fail the required gate; lineage not accepted. |
| F3 | **BLOCKED** | Requires F2 PASS, real isolated staging UAT, and PostgreSQL 18 concurrency. |
| F4 | **NO-GO** | Requires F1–F3 PASS, then source-bound Hobby Preview and tested current-target recovery. |
| F5 | **LOCKED** | Separate production GO for exact SHA/environment required. |

### Parallel work assignments

- Coordinator owns overlap control, the integrated candidate, exact-SHA evidence, and final status synchronization.
- F1 microtasks: #86 annual cards/receipts (Application); #87 arrears/reports (Reports); #88 cash/idempotency regressions (QA/Cash). PR #93 is the integrated F1 candidate; do not duplicate completed work absent a review finding.
- QA/Security independently reviews P0/P1 and the exception register. P0 must PASS; every P1 must be fixed; P2/P3 may be accepted only when documented and when no mandatory gate is weakened.
- Database/Staging #81 is stopped at F2. F3 #82 and Release #83 remain dependent and may not perform staging or deployment work before F2 PASS.

## Owner-authorized role cleanup outcome — 2026-10-24

The owner explicitly approved deleting only `karturt_f2_catalog_ro_20261024`. After confirming it existed on the exact target branch, that role was deleted from project `flat-cloud-57657711` / branch `br-sparkling-flower-azordm9k`; a subsequent role listing confirmed it was absent and showed only the pre-existing `karturt_staging_owner`. This cleanup does not satisfy F2: the earlier role privilege result and `pg_stat_ssl.ssl=false` remain recorded as failed security evidence, data provenance is still unproven, and no further SQL or staging work is authorized by that cleanup. F2 remains BLOCKED; F3 BLOCKED; F4 NO-GO; F5 LOCKED. No owner password was accessed, displayed, or used.
