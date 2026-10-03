# KartuRT TEST GATE C — Financial Invariants Report

This report applies to the recorded F11 contract, with adjustments blocked once a due is WAIVED and any valid pre-waiver adjustment retained in immutable history. See the contract note below.

## Baseline and final state

- Repository: `Satsetx4/karturt`
- Verification branch: `verify/gate-c-financial-invariants`
- Baseline branch / SHA: `feat/phase-11-tariff-adjustment` / `8fcbcf77bc06c8d0966a4d1db6fe86fa018df1a8`
- Baseline F11 Actions run: `37057834512` — success on the exact baseline SHA
- Migration head before and after verification: `0012_phase_11_tariff_adjustment`; no `0013` was created
- Neon development journal: 13 entries, final hash `cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54`
- Gate C verification implementation SHA: `00754ba72829d52192785d8797d0327de1be9f34`; GitHub Actions run `37098745533` passed on this exact SHA. The final report-closeout HEAD is a documentation-only follow-up and is recorded in the accompanying handoff.
- No `src/`, Drizzle schema, migration, financial service, or product UI feature was changed. The only edits outside new verification assets are the documented fixture typing correction and a 60-second timeout for the full-chain migration test after one aggregate-suite timeout; the migration replay itself passed in isolation and on the complete-suite rerun.

## Contract interpretation

The request's “WAIVED … no adjustment” line conflicts with the explicit F11 rule that WAIVED dues cannot receive a new adjustment and with the existing F10 regression that permits an adjustment while UNPAID, then snapshots its effective target when waived. Gate C applies the F11 lifecycle interpretation: reject adjustments after waiver; retain valid earlier adjustment history unchanged. The live audit reports zero adjustments created after their waiver action. A stricter rule forbidding any pre-waiver adjustment would change that existing contract and was not implemented in this verification branch.

## Independent manual balance oracle

The frozen dataset in the [Gate C plan](gate-c-financial-invariants-plan.md) is independently calculable:

| Period | Original | Adjustment | Active received | Outstanding | Expected state |
|---|---:|---:|---:|---:|---|
| Jan | 40,000 | 0 | 40,000 | 0 | PAID |
| Feb | 40,000 | +10,000 | 50,000 (two full settlements) | 0 | PAID |
| Mar | 50,000 | -10,000 | 40,000 | 0 | PAID |
| Apr | 40,000 | 0 | 0 | 40,000 | UNPAID |
| May | 40,000 | 0 | 0 | 40,000 | UNPAID in storage; derived PENDING |
| Jun | 40,000 | 0 | 0 | excluded | WAIVED |
| Jul | 0 | 0 | 0 | excluded | NOT_DUE |
| Aug | 40,000 | +10,000 | 0 (40,000 historical payment reversed) | 50,000 | UNPAID |

Manual totals: potential original obligation 290,000; waived original 40,000; payable original 250,000; positive adjustments +20,000; negative adjustments -10,000; effective collectible target 260,000; non-reversed active received 130,000; outstanding 130,000.

`tests/integration/gate-c-balance-oracle.test.ts` compares those constants and each period against independently authored SQL aggregation and the resident application read model. All three agree exactly. It checks that PAID has zero outstanding, UNPAID has positive outstanding, active receipts never exceed target, the August reversal preserves payment/allocation history while removing active ownership, and a credit-creating negative adjustment is rejected. The fixture uses eight isolated households, one per period, to keep each business-flow call scoped to one due; the amounts, states, and aggregate arithmetic are unchanged.

## Invariant evidence

| Area | Verification and result |
|---|---|
| Balance and adjustment | Manual constants = SQL = resident read model; partial settlement only occurs after a new adjustment creates a new full outstanding amount; no credit/refund state. PASS. |
| Request lifecycle | `tests/integration/gate-c-request-invariants.test.ts` verifies pending is derived from an active request plus exact claim/item, the due remains stored UNPAID, the request item snapshots the full outstanding, adjustment is blocked while pending, verification produces one matching payment, and cancelled/rejected request history does not regain claims after a later payment or waiver. PASS. |
| Payment ledger | `tests/constraints/gate-c-payment-ledger.test.ts` checks payment/allocation sums, nonempty allocations, request-vs-cash linkage, RT/household scope, unique payment+due allocation, exact active ownership, reversal preservation, and direct DB rejection/rollback for over-allocation, duplicate allocation, missing/mismatched ownership, and invalid PAID/UNPAID state. PASS. |
| WAIVED / NOT_DUE | `tests/constraints/gate-c-exclusion-history.test.ts` verifies one matching waiver item/action/audit, nonblank reason and Chairman scope, no active receipt/claim, WAIVED exclusion from collectible totals, and zero-value NOT_DUE with no financial activity. Historical reversed payment, allocation, cancelled request, and request item remain intact through waiver. PASS. |
| Tariff and immutable history | The same constraint suite verifies tariffs affect only newly generated due snapshots; direct UPDATE/DELETE/TRUNCATE attempts on fee rates, adjustments, waiver rows, payments, allocations, reversals, requests, and request items are rejected; changes to historical due amount or fee-rate reference are rejected. PASS. |
| Roles, audits, tenant scope, and household history | `tests/authorization/gate-c-financial-actors.test.ts` verifies the nine financial audit action types, matching actor/entity/reason/context/cardinality, Treasurer/Chairman/Resident/System Admin boundaries, RT and account scope, active-role exclusivity, and old-household debt/payment ownership after household turnover. PASS. Existing tests also verify transactional audit rollback and role dates. |
| Concurrency | New tests verify simultaneous same-key adjustment retries create one ledger row/audit and different fingerprints yield one serial winner plus one conflict. Existing F5–F11 suites cover double verify, verify/reject/cancel, request/cash/waiver/adjustment, reversal/adjustment/repayment, direct allocation attacks, malformed payloads, and audit-failure rollback; full suite passes. PASS. |

### Read-only Neon global audit

The reusable [Neon audit script](../scripts/gate-c-financial-invariants-neon.ts) confirms the exact development project, branch, direct endpoint, database, and migration head before issuing SELECT-only queries. The saved [count evidence](gate-c-financial-invariants-evidence/neon-global-anomaly-counts.json) has **32 categories, all zero**, with no nonzero anomaly keys:

| Domain | Zero-count anomaly checks |
|---|---|
| Balances | `paid_balance_mismatch`, `unpaid_fully_settled`, `payable_target_nonpositive`, `active_received_over_target` |
| Request/payment ledger | `verified_request_payment_allocation_mismatch`, `payment_without_allocation`, `payment_amount_allocation_sum_mismatch`, `duplicate_allocation_for_payment_due`, `pending_request_missing_valid_claim_or_item`, `active_claim_without_pending_request_or_item`, `terminal_request_with_active_claim`, `pending_item_snapshot_outstanding_mismatch` |
| Allocation ownership | `active_allocation_missing_exact_owner`, `active_owner_allocation_payment_mismatch`, `reversed_payment_retains_active_owner`, `active_ownership_sum_vs_direct_receipts` |
| WAIVED / NOT_DUE | `waived_ledger_anomaly`, `waived_active_received`, `waived_active_claim`, `waived_adjustment_after_action`, `not_due_financial_activity` |
| Audit parity | `adjustment_audit_mismatch`, `waiver_audit_mismatch`, `fee_rate_audit_mismatch`, `payment_request_creation_audit_mismatch`, `verified_request_audit_mismatch`, `request_resolution_audit_mismatch`, `cash_payment_audit_mismatch`, `payment_reversal_audit_mismatch` |
| Actors and roles | `system_admin_financial_actor`, `duplicate_active_treasurer_or_chairman`, `same_account_active_treasurer_and_chairman` |

The audit ran after the live smoke so its zero counts include that development fixture activity. No production query, write, migration, or fixture was performed.

### Live PostgreSQL and browser evidence

The existing guarded F11 Better Auth / HTTP harness ran with `--resume-f11` against the approved development branch, with the source checkout at the exact F11 baseline SHA. It did not run a migration. It passed transfer verification, cash receipt, adjustment/idempotency behavior, pending protection, positive and negative adjustment behavior, reversal and repayment, waiver and NOT_DUE protection, tariff snapshotting, and transactional rollback of direct over-allocation. The [live-flow summary](gate-c-financial-invariants-evidence/neon-business-flow-summary.md) records its results. Its synthetic financial history remains on Neon development; temporary login sessions were removed.

The live browser flow reported no page errors or horizontal overflow at 360x800, 390x844, 430x900, 768x1024, and 1440x900. The resident component smoke used the controlled Gate C states at 390x844 and 1440x900, verified all five labels, and confirmed a formerly paid 40,000 due with a +10,000 adjustment renders **Belum bayar**, with 10,000 outstanding. Screenshots: [390x844](gate-c-financial-invariants-evidence/resident-card-390x844.png) and [1440x900](gate-c-financial-invariants-evidence/resident-card-1440x900.png). This component smoke uses fixture data and CSS from the production build; it is not an authenticated live resident-route session.

## Quality gates and regressions

| Gate | Result |
|---|---|
| `npm run lint` | PASS; no warnings after the harness correction |
| `npm run typecheck` | PASS |
| `npm run test:unit -- --maxWorkers=1` | PASS — 5 files, 33 tests |
| `npm run test:integration -- --maxWorkers=1` | PASS — 28 files, 132 tests |
| `npm run test:constraints -- --maxWorkers=1` | PASS — 7 files, 38 tests |
| `npm run test:authorization -- --maxWorkers=1` | PASS — 7 files, 60 tests |
| `npm test -- --maxWorkers=1` | PASS on final rerun — 47 files, 263 tests |
| `npx drizzle-kit check` | PASS — migration journal consistent |
| Schema drift generation to isolated scratch output | PASS — “No schema changes, nothing to migrate”; repository migration directory unchanged |
| Manual oracle / PGlite attacks / race tests | PASS |
| Neon dev global audit | PASS — 32/32 categories zero |
| Neon dev real HTTP/Better Auth smoke | PASS |
| Resident derived-state visual smoke | PASS at 390x844 and 1440x900; no horizontal overflow |
| Final Gate C GitHub Actions | `37098745533` PASS on implementation SHA `00754ba72829d52192785d8797d0327de1be9f34`; documentation closeout HEAD is checked separately before handoff |

The local production build compiled and generated all routes. Turbopack emitted a cache-persistence warning because the D: volume had roughly 60 MB free; the final GitHub Actions build is the authoritative clean build check.

## Findings, severity, and residual risks

- **Critical product defects:** 0
- **High product defects:** 0
- **Medium financial integrity defects:** 0
- **Low verification-harness issues corrected:** the balance-oracle fixture gained explicit TypeScript collection types; the Neon audit CTE gained its selected `waived_reason` field and exact one-item waiver cardinality check; the clean-chain PGlite test timeout increased from 30s to 60s after one aggregate-suite timeout, then passed both in isolation and in the complete 263-test rerun. The initial GitHub run also exposed a test that selected the surviving cash payment by unspecified database row order; it now selects by the expected amount and the local constraint suite passes 38/38.
- No product/source issue was repaired in this branch. No migration 0013, F12 work, default-branch merge, deployment, or Neon production mutation occurred.
- Residual scope limit: the resident visual check is a controlled component-level browser render, not a logged-in production-like resident route session. Real development HTTP/Better Auth business flows and the separate adjustment browser flow did run.

## Final decision

`GATE C PASS — GO FASE 12`
