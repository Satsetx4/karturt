# Fase 8 — Cash Payment Design Freeze

Status: design audited and frozen before application-code changes.

## Baseline and scope

- Repository: `Satsetx4/karturt`
- Baseline branch: `fix/phase-7-1-post-resolution-lifecycle`
- Baseline HEAD and remote HEAD: `9f1549191a6f627e493f430ab44025771f8a6a67`
- F7.1 implementation ancestor: `80019e05c698a81e1b3f2718132f01e4f5cababd`
- Baseline working tree: clean
- Baseline GitHub Actions Gate A: run `36866948407`, conclusion `success`, HEAD `9f1549191a6f627e493f430ab44025771f8a6a67`
- Migration head: `0008_phase_7_1_post_resolution_lifecycle` (journal entries `0000` through `0008`)
- Implementation branch: `feat/phase-8-cash-payment`
- Out of scope: reversal, waiver, tariff changes, reports/export, notifications/outbox, deployment, production migration, and default-branch merge.

## Architecture audit

Migrations `0006`–`0008` define a request-bound transfer ledger. `payments.payment_request_id` and `payment_allocations.payment_request_id` are `NOT NULL`; payment method is constrained to `transfer`; allocation rows must reference the immutable request-item snapshot including its amount. The composite allocation-to-payment FK currently scopes payment, request, RT, and household together. Payments and allocations reject update, delete, and truncate.

`assert_payment_request_ledger_v1` is a deferred whole-request invariant. It requires pending requests to retain all claims and no ledger; verified requests to have one transfer payment, complete allocations, paid dues, matching totals, and one audit event; rejected/cancelled requests to have no claim or ledger and their dues remain unpaid. F7.1 also validates one terminal transition audit and protects terminal request history. `assert_paid_due_allocation_v1` currently accepts only allocations belonging to verified requests. Audit rows are append-only and the TypeScript writer allowlists flat context per action.

Because request IDs currently serve as both transfer provenance and the only deferred-validation routing key, simply making them nullable would let a cash row reach `assert_payment_request_ledger_v1(NULL)` and skip validation. The migration will add a second, request-independent validation route for cash and a source-independent payment-scope FK.

## Migration `0009_phase_8_cash_payment.sql`

Do not edit migrations `0000`–`0008` or their snapshots. Update Drizzle schema and journal/snapshot through the normal Drizzle migration workflow, then add the custom PostgreSQL functions/triggers to the new `0009` SQL migration.

1. Drop `NOT NULL` from `payments.payment_request_id` and `payment_allocations.payment_request_id`; preserve every existing non-null transfer value.
2. Replace `payments_method_transfer_only` with a source check: `transfer` requires a request ID; `cash` requires a null request ID. Keep the official-account-type check and request-scope FK.
3. Add nullable UUIDv4 cash idempotency key and SHA-256 fingerprint fields to `payments`. Require both for cash and require both null for transfer. Add a partial unique index on `(rt_unit_id, verified_by_account_id, cash_idempotency_key)` for cash rows. Do not add a global unique index on `monthly_due_id`.
4. Retain the existing request-aware composite FK and immutable request-item amount FK for transfer allocations. Add an independent `(payment_id, rt_unit_id, household_id)` FK to the corresponding unique payment scope so cash allocations are still validated when `payment_request_id` is null. Keep due-scope FK, positive amount check, per-payment/per-due uniqueness, and append-only triggers.
5. Replace deferred ledger routing with a versioned validator. Non-null request IDs continue through the strict F7.1 request assertion; null request IDs route by payment ID to `assert_cash_payment_ledger_v1`. The cash assertion requires a cash payment with a null request ID, an official actor, one or more same-scope null-request allocations, one allocation per due, allocation amounts equal to the paid due amounts, payment amount equal to the allocation sum, a UUIDv4 operation key/fingerprint, and exactly one matching `payment.cash_recorded` audit event.
6. Generalize the deferred paid-due guard to accept either the existing verified-transfer path or a complete direct-cash allocation path. The cash payment assertion remains independently authoritative; nullable request IDs do not bypass ledger checks.
7. Update the request assertion’s rejected/cancelled rule so a historical item may later be `paid` only when it has a matching valid payment allocation (direct cash or a separate verified replacement transfer request). The terminal request itself keeps no claims, request-bound payment, or request-bound allocations, and its original status and audit remain immutable.
8. Add deferred cash validation triggers for payment/allocation changes. Checks run at transaction end so the payment, all allocations, paid dues, and audit must exist together. A failure rolls back all rows.

All existing transfer payments, allocations, snapshots, request histories, and audits remain unchanged. Cash does not create or attach a `payment_requests` or `payment_request_items` row.

## Service and concurrency contract

The canonical service accepts only `{ householdId, period, idempotencyKey }`; it derives RT and amount from the authenticated principal and locked database rows. One transaction verifies the active same-RT Treasurer, resolves a UUIDv4 key and canonical input fingerprint, returns a matching replay or rejects a mismatched replay, locks the household’s dues chronologically, rechecks statuses and exact amount snapshots, then locks claims and blocks if any selected due is claimed by a pending request. It creates one cash payment, N null-request allocations, changes all selected dues from unpaid to paid, writes one allowlisted audit event, and commits.

The due-row locks serialize request creation and cash recording. If request creation wins, the cash action observes its committed claim and aborts. If cash wins, request creation re-reads the paid due after waiting and cannot claim it. The cash path does not lock request rows, avoiding a lock-order cycle with verification/resolution, which lock a request before its due rows. Pending conflicts never delete claims or change request state.

Target selection is the raw `unpaid` set for the same household whose canonical period is no later than the chosen unpaid target, ordered by year/month across billing years. `paid`, `waived`, and `not_due` rows are excluded. A household may be inactive and still retain payable debt; it stays attached to its original household.

## Mobile flow and interface plan

### People and risks

- **Bendahara recording a cash payment:** must be able to identify the correct house, see every included month and the exact total, and avoid duplicate submission.
- **Warga whose household is being selected:** must not have their debt attached to another household; historical household debt remains with that household.
- **Chairman or System Admin opening the flow:** must be denied, because neither role is the financial actor for cash recording.

### 360–420 px screen flow

1. From the Bendahara dashboard, open a separate `Catat pembayaran tunai` entry; the existing transfer-verification queue stays its own section.
2. Search by house number or current resident name, then choose a result that shows house number, resident name when available, and an `Rumah tidak aktif` label for retained historical households.
3. Select `Bulan terakhir yang dibayar` from the target household’s raw unpaid periods. The preview lists every older unpaid period automatically, each amount, and the server-calculated total. Paid, waived, and not-yet-due months never appear as payable choices.
4. If any included period has an active pending request, show the blocking explanation and disable confirmation. Do not offer a local resolution action.
5. Show a clear confirmation step with house/resident identity, all included periods, total, and `Tunai`, followed by `Konfirmasi pembayaran tunai` with a 44 px minimum touch target.
6. On success, show the recorded total and a clear return to the dashboard. On retry, reuse the same request key while the submitted action is in flight or being retried.

### Existing visual system and motion

Use the existing app palette from `globals.css`: paper `#f3f6f4`, white surface `#ffffff`, ink `#152a34`, muted `#5d6b70`, border `#dce5e2`, navy `#173745`, and teal `#276f68`; dark mode uses the existing root tokens. Keep body text at the app’s 17 px, headings aligned to existing 24/32 px scale, captions at 14 px, and spacing on an 8 px rhythm. Cards use the existing rounded 13–19 px surfaces and subtle border/shadow.

Use short 180–240 ms state transitions, visible focus, and a press scale around 0.97. Respect reduced-motion preferences. The UI uses transient component state only: do not persist household identity, period selections, or payment drafts to localStorage because they contain household/financial data; server idempotency provides safe retry behavior.

### Component and data flow

`/app` → `TreasurerDashboard` → separate `/app/bendahara/tunai` page → `TreasurerCashPaymentFlow` client component. The component calls same-RT authenticated search and preview handlers, then posts only `{ householdId, period }` plus an `Idempotency-Key` header. Route handlers authenticate and validate; billing services derive tenant and actor from the principal and execute the transaction; PostgreSQL remains authoritative for ledger completeness, paid-due validity, and audit cardinality. No third-party integration is needed.

## Remaining implementation work

- Add authenticated Treasurer household search, preview, and cash-record routes with strict input schemas and same-origin mutation checks.
- Add an independent cash-payment flow to the Treasurer dashboard with explicit household/period/total confirmation and an in-flight idempotency key guard.
- Extend audit writer contracts and test schema, transaction, authorization, idempotency, concurrency, request-race, history, and UI behavior.
- Extend the Gate A branch filter and execute the requested local quality gates, development-Neon-only smoke, browser/responsive smoke, and existing Gate B/F7/F7.1 regressions.
- Record evidence, limitations, residual risks, and the Fase 8/Fase 9 gate in `docs/phase-8-cash-payment-report.md`.
