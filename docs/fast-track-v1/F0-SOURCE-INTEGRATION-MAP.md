# F0 — current main vs historical PR integration map

**Date:** 2026-10-24 Asia/Jakarta. **Method:** GitHub source readbacks at `main` full SHA `96c84588ae0c13f68a17cffd997a3e583fb7da82`, draft PR metadata and per-file patch lists, selected exact-file comparisons on draft head `ddb9689b34ea3ee1373ee328952c279544758c15` (#57). Read-only audit; no staging SQL, main merge or source mutation.

## An explicit branch dependency graph

```text
protected main: 96c84588...
  ├─ PR #18 (KRT-05): future month guard (draft from main)
  ├─ PR #20 (KRT-06): WhatsApp pending request CTA (draft from main)
  ├─ PR #21 (KRT-08): PWA shell (draft from main)
  ├─ PR #23: integration KRT-05+KRT-06+KRT-08 (draft from main)
  │    ├─ PR #48: 12-month annual card and canonical paid-month receipts
  │    │    └─ PR #57: arrears/report reconciliation + additional cash regression tests
  │    └─ PR #55: future-cash annual-report regression tests
  ├─ PR #56: 'wave 2' combined integration/staging candidate; spans 38 files
  ├─ PR #67 (inert phase-0 trusted launcher) → PR #73 (Solo Owner) → PR #74 (ledger prototype), DEFERRED V1
  ├─ PR #71: legacy staging source audit, separate branch; retained historical
  └─ PR #84: Fast Track owner decision/docs/roadmap (this proposal)
```

**Crucial:** PR #48 does **not** target `main`, it targets PR #23; PR #57 targets PR #48. PR #55 separately targets PR #23. Never merge PR #57 directly without reviewing transitive files. PR #56 resembles an earlier combined candidate but also carries staging-target code and tests; avoid wholesale merge/cherry-pick.

## Source-based feature gap matrix

| Invariant | Main actual state (source evidence) | Relevant draft reference | Next safe action |
|---|---|---|---|
| Annual 12-month card | `src/lib/billing/resident-card.ts` includes `yearMonths` (12 entries); `resident-dues.ts` returns stored dues only, no receipt/timing fields; main UI still uses simpler status | #23 then #48 then #57; `resident-card.ts`, `resident-dues.ts`, `resident-card.tsx` | Add/verify full 12-month display for existing annual records, and future `UPCOMING` calendar label without altering stored `unpaid` semantics |
| Future periods not overdue | Main `resident-card.ts` does not distinguish `UPCOMING` vs `OVERDUE`; main `reports/aggregation.ts` uses `dueDate < businessDate`, which may differ from month-based business rule | #18, #48, #57. #57 explicitly compares year/month to Jakarta current business period | Test status semantics in card and reports before integrating minimal fixes |
| Online transfer requests only current/overdue | Main `src/lib/billing/resident-payment-request.ts` parses `target` but **does not explicitly reject target year/month greater than current business date**. In #57, a new guard compares `target.year/target.month` to `businessDate` and rejects future periods | #18, #23, #57, integration `tests/integration/resident-payment-request.test.ts` | **P0** add exact server-side guard and negative tests on a new F1 branch; UI filter alone is insufficient |
| Cash verified for future period | Main `src/lib/billing/treasurer-cash-payments.ts` accepts a chosen target period from unpaid due list and does not impose 'current period only'; owner-defined future cash path appears implemented at service level | #48/#57 focus on associated receipt/report tests | **Preserve existing cash service**, add/verify tests for future target and cross-year period |
| Oldest unpaid through target allocation | Main cash service filters unpaid periods at or before target, sorts by canonical year-month, creates payment allocations and settles inside a DB transaction; verifies count and balances | #57 integration tests extend regression | **Do not rewrite**; test deterministic oldest-first and conflict/duplicate cases under real PG |
| Cash idempotency / transaction | Main uses input idempotency key, stored fingerprint, transactions, locked due rows `for update`, unique conflict handling (SQLSTATE 23505) | #57 additional negative concurrency-style integration tests | Keep logic, run actual PostgreSQL concurrency job on a correctly isolated test database; previous job SKIPPED |
| Receipt: actual amount + treasurer time | Main `resident-dues.ts` does not attach receipt; draft #57 service joins allocations/payments and builds canonical receipt referencing actual active ledger, `paid` cards only. `resident-card.tsx` corresponding UI changes also draft | #48/#57; `src/lib/billing/resident-dues.ts`, `resident-card.ts`, `resident-card.tsx` | **P0** port/query scoped active payment+allocation evidence; ensure amount, verifier timestamp, timezone and reversed payment exclusion |
| Role auth/tenant safety | Main resident dues checks resident/household and `rtUnitId`; main cash service asserts treasurer and scopes queries by rt/household | Existing authorization/constraints tests, #57 additions | Preserve strong guard and add cross-resident negative regressions after integration |
| Reports arrears/reconciliation | Main aggregation computes arrears using `dueDate < businessDate`; #57 adjusts to period comparison and splits due-now vs future unpaid amounts | #57 `reports/aggregation.ts`, `chairman-reports.tsx`, tests | Review report contract before porting selective edits; confirm no future unpaid counted as arrears |
| Optional WhatsApp / PWA | Source exists as draft #20, #21 and combined #23, but both are not mandatory V1 | #20/#21/#23 | **P2 defer** unless cheap/no risk; avoid bundling with critical finance fixes |
| Real PostgreSQL concurrency | `package.json` has `test:postgres-concurrency`, but independent job in #74 and draft planning #84 **SKIPPED** due to branch filter | Past concurrency source/test harness | **P0 acceptance in F3:** actual PG18 staging test with job executed and PASS, no mock-only acceptance |

## Important scope/merge hazards

1. The old `docs/delivery-readiness-report.md` from 2026-10-05 marks a different branch and Neon project as historical Production Ready. This does **not** prove current main or current draft feature branches are merged.
2. #23 includes WhatsApp+PWA+future guard and workflow changes. The Fast Track should **prefer targeted port** from #57/#48 into a clean integration branch rooted at current `main`, not merge entire legacy stack.
3. #55 overlaps #57's report test file, so compare tests before integrating; do not overwrite current test coverage blindly.
4. #56 spans old environment/staging target binding code; do not adopt an outdated Neon target or unreviewed staging permission while integrating billing.
5. Historical ledger custom gateway and effective Viewer-token proof are **DEFERRED**, not PASSED; do not bring security launcher permission escalations into F1.
6. Main already implements cash transaction, oldest-first allocation and idempotency; rewriting it raises unnecessary financial risk.

## Recommended minimal safe F1 integration sequence

- **F1A (P0)**: new clean branch from exact current `main`; copy/derive small **server-side future-period payment-request guard** and targeted tests; draft PR; full exact-head CI.
- **F1B (P0)**: scoped resident monthly-dues receipts API and resident card UI status/timing from the verified #48/#57 behavior; preserve existing tenant authorization, reversal exclusions and contract semantics; targeted tests.
- **F1C (P0)**: reconcile chairman/report arrears calculations for future periods and verify split between due-now and future unpaid; add missing negative tests.
- **F1D (P0)**: focused main cash future-year settlement, oldest-first/idempotency regression. Do **not** rewrite cash service unless tests identify a bug.
- **F1E (P1)**: integration branch and complete CI; real PG concurrency must be executed in F3 (not claimed from F1 unit/PGlite).

Run these in nonoverlapping workstreams when actually supported. All F1 code changes should remain DRAFT until reviewed, and protected main is unchanged.

## F0 DoD results (as of this audit)

- Read-only source/PR map: **PASS at evidence/documentation level**.
- Current staging content provenance: **UNKNOWN**. The canonical branch is root/default with no `parent_id`; official Neon documentation also shows this shape with `init_source=parent-data`, so the marker alone is not evidence of an external parent. F2 remains blocked on content proof and security gates, independent of F0.
- Full F0 phase: **PASS only for the planning/read-only scope** after the source map and baseline are complete, coordinator review closes its checklist, and exact-head Gate A passes. Issue #79 records the current SHA/run; documentation-only PostgreSQL concurrency may be SKIPPED and does not count as F1/F3 or staging evidence. No claim of F1 feature completion or live staging PASS.
