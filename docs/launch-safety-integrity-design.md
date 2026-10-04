# Launch Safety Integrity Design

## Purpose and frozen scope

This document freezes the launch-critical integrity contract for the Launch Safety gate. It is based on promoted main commit `4890678b91c4c4e2c535f1149da60dbfcde32370` and must be implemented as a deterministic, detect-only checker. It does not authorize repair, data mutation, migration, or production access.

The checker evaluates all RT units in the development database. The deployment operating mode is one RT, while the data model and safeguards remain multi-RT: keep `rt_unit_id`, composite tenant constraints, cross-RT authorization rules, and cross-RT tests. Do not add an RT selector, onboarding, switching, or multi-tenant administration UI.

The migration boundary is `0013_phase_12_household_management`: 14 journal entries, no `0014`. If a required invariant cannot be checked or maintained without a schema change, stop and report the defect and proposed migration separately. Do not create or run a migration as part of this gate.

## Evidence already available

The promoted source includes two relevant read-only global audits:

- Gate C's development audit has 32 zero-count anomaly categories. Its frozen predicate set is in `scripts/gate-c-financial-invariants-neon.ts`; the source report is `docs/gate-c-financial-invariants-report.md`; the F13.1 snapshot is `docs/phase-13-1-acceptance-evidence/gate-c.json`.
- The F12 lifecycle audit has 11 zero-count global categories in `scripts/phase-12-1-post-smoke-lifecycle-audit.ts`; the source snapshot is `docs/phase-13-1-acceptance-evidence/f12-lifecycle-global-summary.json`.

Those artifacts are baseline evidence, not proof of current state. The Launch Safety checker must freshly evaluate its frozen categories. Its value is the combined current-state gate plus explicit request-due eligibility and broader relation-scope checks; it must not merely replay the saved counts.

Relevant schema and domain sources include `src/db/schema.ts`, `drizzle/0006_phase_6_treasurer_payment_ledger.sql`, `drizzle/0011_phase_10_waiver.sql`, `drizzle/0013_phase_12_household_management.sql`, `src/lib/billing/due-balance.ts`, `src/lib/households/lifecycle.ts`, and `src/lib/officials/lifecycle.ts`. Existing composite foreign keys, partial unique indexes, triggers, and tests are defense in depth; the live audit still checks for persisted anomalies and legacy or bypassed writes.

## Frozen predicates

A predicate count is the number of distinct offending logical entities for that category. Pair and group checks count offending groups once. Categories must be stable and machine-readable. The query must not emit raw rows or identifiers.

| ID | Category | Frozen predicate | Existing Gate C / F12 coverage | Severity |
|---|---|---|---|---|
| I01 | `pending_request_invalid_due_state` | Every pending request has a nonempty, cardinality-consistent item set; each item has its exact active claim; each referenced due is in the same RT and household, is `UNPAID`, has positive outstanding, and the item snapshot equals that outstanding. A pending request against PAID, WAIVED, NOT_DUE, or zero-outstanding due is an anomaly. | Gate C `pending_request_missing_valid_claim_or_item`, `active_claim_without_pending_request_or_item`, `terminal_request_with_active_claim`, and `pending_item_snapshot_outstanding_mismatch` cover claim/item structure and amount arithmetic; `waived_active_claim` and `not_due_financial_activity` cover two invalid states. The explicit due-state/eligibility predicate is an addition. | HIGH |
| I02 | `paid_due_without_exact_active_settlement` | For each PAID due, every non-reversed allocation is represented by exactly one active settlement owner with identical RT, household, payment, due, allocation, and amount; the active settlement sum equals the direct non-reversed receipt sum and the effective target is positive. A PAID due with no valid active allocation is an anomaly. | Gate C `active_allocation_missing_exact_owner`, `active_owner_allocation_payment_mismatch`, `active_ownership_sum_vs_direct_receipts`, and `paid_balance_mismatch` cover these dimensions. | CRITICAL |
| I03 | `paid_due_unexplained_balance` | A PAID due has effective target greater than zero and active non-reversed received equal to that target; outstanding must be exactly zero. | Gate C `paid_balance_mismatch` and `payable_target_nonpositive` cover this; its independent balance oracle also compares manual arithmetic, SQL, and the read model. | CRITICAL |
| I04 | `verified_request_payment_allocation_mismatch` | Each VERIFIED request has exactly one matching payment; its payment amount equals the request total; allocations match every request item by RT, household, due, and amount, with matching item count and sum. A verified request without a payment is an anomaly. | Gate C has the same category and checks payment count, amount, allocation count/sum, and item matching. | CRITICAL |
| I05 | `payment_allocation_mismatch` | Every payment has at least one allocation; allocation amounts sum exactly to the payment amount; duplicate allocations for the same payment and due are rejected. | Gate C `payment_without_allocation`, `payment_amount_allocation_sum_mismatch`, and `duplicate_allocation_for_payment_due` cover this. | CRITICAL |
| I06 | `active_received_over_effective_target` | For each payable due, the sum of active non-reversed allocations and the exact active-owner ledger do not exceed the effective target. The owner total must equal direct receipt total. Effective target is the original due amount plus all valid adjustment deltas. | Gate C `active_received_over_target`, `active_ownership_sum_vs_direct_receipts`, and its balance oracle cover this. | CRITICAL |
| I07 | `reversed_payment_still_active` | A reversed payment has no active settlement owner and contributes zero to active received; its historical payment and allocation rows remain intact. | Gate C `reversed_payment_retains_active_owner` and `active_ownership_sum_vs_direct_receipts`, plus the balance oracle, cover this. | CRITICAL |
| I08 | `waived_ledger_or_activity_mismatch` | Every WAIVED due has exactly one valid waiver item linked to one waiver action with matching RT, household, due, period, and amount; no active settlement owner, non-reversed receipt, or claim may remain; and no adjustment may be created after the waiver action. Every `waiver_actions` row, including one without a due-linked item, must have an official actor in the same RT with a Chairman assignment covering the action's `Asia/Jakarta` creation date, item count and amount total equal to its items, and exactly one matching `waiver.created` audit event whose actor, reason, item count, total, and sorted period list match the ledger. Orphan or malformed waiver audit events are anomalies. A valid pre-waiver adjustment remains part of the immutable history and is allowed by the frozen F11 contract. Account status has no historical timestamp; historical actor validation uses the account's RT/type and role assignment effective on the action date. | Gate C `waived_ledger_anomaly`, `waived_active_received`, `waived_active_claim`, `waived_adjustment_after_action`, and `waiver_audit_mismatch` cover this. | CRITICAL |
| I09 | `not_due_invalid_snapshot_or_activity` | A NOT_DUE row has amount zero, no fee-rate reference, no waiver reason, and no allocation, request item, claim, waiver item, or adjustment. Post-end interacted due history must not be rewritten to NOT_DUE. | Gate C `not_due_financial_activity`; F12 `not_due_financial_activity` and `post_end_interacted_due_rewritten_to_not_due`; schema checks and the phase 12 trigger cover this. | CRITICAL |
| I10 | `household_period_overlap` | Household periods for the same physical house and RT must not overlap, using inclusive start/end dates and treating a null end as open-ended. | F12 `overlapping_household_periods`; migration 0013 includes a preflight and serialization trigger. Gate C does not cover this. | HIGH |
| I11 | `multiple_active_households_same_house` | At most one household per house and RT may have status ACTIVE. | F12 `multiple_active_households_same_house`; schema has `households_one_active_per_house_uq`. Gate C does not cover this. | HIGH |
| I12 | `active_resident_linked_to_inactive_household` | Every ACTIVE resident account links to an existing ACTIVE household with the same RT and household ID. | F12 has the same category; composite account/household foreign keys add database protection. Gate C does not cover this. | HIGH |
| I13 | `active_resident_linked_to_inactive_person` | Every ACTIVE resident account links to an existing active person, and the person belongs to the same RT and household recorded on the account. | F12 `active_resident_linked_to_inactive_person` checks existence and active state; the checker also verifies the full account-person-household scope. Gate C does not cover this. | HIGH |
| I14 | `duplicate_current_treasurer_or_chairman` | For one captured `Asia/Jakarta` business date, each RT has at most one ACTIVE official account assigned as Treasurer and at most one as Chairman. An assignment is current iff `starts_on <= businessDate` and `ends_on IS NULL OR ends_on >= businessDate`. | Gate C `duplicate_active_treasurer_or_chairman` uses these current-date and active-account conditions. Existing official lifecycle/auth code is in `src/lib/officials/lifecycle.ts` and `src/lib/auth/principal.ts`. | HIGH |
| I15 | `same_account_current_treasurer_and_chairman` | No one ACTIVE official account may hold both current Treasurer and Chairman assignments in the same RT on the captured business date. | Gate C `same_account_active_treasurer_and_chairman` uses current assignment dates and active-account status. | HIGH |
| I16 | `cross_rt_financial_scope_mismatch` | Every financial row's RT and household/due/request/payment/allocation/owner/waiver/reversal/adjustment/actor references must agree. Check monthly dues against their household, billing year, and optional fee rate; fee rates against billing years; and composite identities across payment requests/items/claims, payments/allocations, active settlement owners, waivers/items, reversals, adjustments, and referenced actors. A foreign key that exists in a different RT or household is still a mismatch. | F12 `financial_rows_with_household_scope_mismatch` checks request/payment/item/allocation/owner/waiver/reversal/adjustment household scope. Gate C constraint suites test RT/household ownership and composite constraints. The launch checker must cover the full relation set in one fresh scope check. | CRITICAL |

Severity is risk classification. Every nonzero category above is launch-blocking: any CRITICAL or HIGH count greater than zero means FAIL. No warning-only exception or manual waiver is allowed for these predicates.

## Execution and determinism contract

1. Run the same category definitions against fresh local PGlite fixtures and, separately, Neon DEVELOPMENT in read-only mode.
2. The Neon path must use the repository's strict development-target guard. Confirm the development project/branch/database and migration journal before any domain query: 14 entries ending at `0013_phase_12_household_management`, with no `0014`. If identity or migration validation fails, stop before domain checks and fail closed. Never connect to or query production.
3. Execute all Neon reads inside one explicit `REPEATABLE READ READ ONLY` transaction. Capture one audit instant and one `Asia/Jakarta` business date, then bind that date to all current-assignment predicates. Do not use repeated wall-clock evaluations that can split categories across dates.
4. Do not write fixtures or cleanup rows to Neon. Local PGlite fixtures must be deterministic, isolated, synthetic, and reset between scenarios. Include clean-state and one-anomaly-at-a-time cases for each category, plus combined anomalies to prove category counts remain independent.
5. Do not mutate schema, data, session state, migration journal, or application state. Do not auto-fix. Keep the check global across RT units; do not add a single-RT filter.
6. Sort category output by stable category ID. Count distinct offending entities/groups; use no unordered sample rows. A query or parsing failure is an execution failure, never a zero count.
7. Keep diagnostics aggregate-only. Never print resident or official names, house numbers, phone/login identifiers, account/person/household/due/payment UUIDs, PINs, passwords, cookies, tokens, authentication IDs, database URLs, secret environment values, raw rows, or SQL parameter values. Error output must be sanitized and must not include a driver connection string or row data.

## Machine-readable output and verdict

Emit one JSON object with a stable schema, for example:

```json
{
  "schemaVersion": 1,
  "event": "launch_safety.integrity_read_only_audit",
  "generatedAt": "ISO-8601 timestamp",
  "environment": "development",
  "operationMode": "REPEATABLE READ READ ONLY",
  "migrationEntries": 14,
  "migrationHead": "0013_phase_12_household_management",
  "result": "PASS",
  "totalChecks": 16,
  "zeroAnomalyChecks": 16,
  "nonzeroCategoryCount": 0,
  "anomalyCategories": [
    {
      "name": "pending_request_invalid_due_state",
      "severity": "HIGH",
      "count": 0
    }
  ]
}
```

The example lists one category for readability; the real output includes all 16 categories in stable order. Counts are nonnegative JSON integers. If a database count cannot be represented safely as an integer, the audit fails instead of rounding.

Return `PASS` only when target and migration preconditions pass, every required category query completes in the same read-only snapshot, and all 16 counts equal zero. Return `FAIL` if any count is greater than zero, target or migration validation fails, or any check fails to execute or parse. For a failed precondition or execution error, set `result` to `FAIL`, set a sanitized `failureKind` such as `target_guard`, `migration_guard`, `query_error`, or `parse_error`, and mark unrun category counts as null rather than zero. Never emit `PASS` for partial results.

The local fixture run must report the same schema with `environment: "local-fixture"`; its result proves deterministic predicate behavior only and is not a substitute for the fresh Neon development read-only run. No PASS claim is valid unless both required evidence layers are recorded independently.
