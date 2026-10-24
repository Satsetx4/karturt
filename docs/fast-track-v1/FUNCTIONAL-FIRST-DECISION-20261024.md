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

Both report a Free organization, fixed 0.25 CU, store_passwords=true, init_source=parent-data without a parent ID, logical size 31,686,656 bytes, zero writes, effective project permission ADMIN for the connected control-plane principal, public connections not blocked, and an empty IP allowlist. This metadata does not prove synthetic-only contents, least privilege, isolation, or Rp0 actual billing. The parent-data label alone does not prove production data was copied. Both remain **BLOCKED / UNVERIFIED for database use** until independent evidence closes the gates.

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
