# KartuRT Fase 9 — Payment Reversal Design Freeze

Status: architecture freeze before implementation
Branch: `feat/phase-9-payment-reversal`
Baseline: `feat/phase-8-cash-payment` at `d390f5384b1e50346943db08c7050850f9fa809a`
Baseline migration head: `0009_phase_8_cash_payment`

## Baseline audit

- The checkout was clean and matched the requested baseline SHA. GitHub Actions run `36890034080` completed successfully on that SHA.
- The local Drizzle journal contains migrations `0000` through `0009`. The Neon development migration journal contains 10 rows and the known `0009` hash `1a2bacce06cedbbea3c2df755ae12d6f94cbef87d7fe340b5d9df35402ea2720`.
- The verified Neon target is project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), database `neondb`, endpoint `ep-quiet-cake-azrhjiyh`. Its `production` branch is a separate branch and is not a target for this phase.
- The development data has 119 paid dues. Each has exactly one valid current transfer or cash allocation candidate; no paid due has zero or multiple candidates, and no non-paid due has a candidate. This is safe input for deterministic ownership backfill.
- Migration `0006` made `payments` and `payment_allocations` append-only. Migration `0009` generalized the source to transfer or cash, but existing completeness assertions still use current due status and historical allocation as proof of settlement. There is no database-level single-active-settlement owner yet.
- Transfer verification locks the pending request, then its due rows by stable ID, then its claims by due ID; it creates payment and allocations, marks dues paid, closes claims, and appends the verification audit in one transaction.
- Cash recording locks its idempotency key, then all paid and unpaid payable dues through the target period by stable due ID, then claims; it computes the oldest unpaid period set only after those locks, creates payment and allocations, marks dues paid, and appends the cash audit in one transaction. Its unpaid-only lock query must be widened so reversal-versus-repayment serializes correctly.
- The paid-due guard freezes paid dues, and its deferred assertion currently accepts a matching transfer or cash allocation. The request ledger assertion keeps a verified transfer request and exactly one historical payment, while the cash assertion keeps cash history and its original audit. The Fase 8 report confirms there is no global unique constraint on historical allocation `monthly_due_id`.
- The audit writer accepts only action-specific flat allowlisted context, trims and validates reasons, and inserts through the current transaction. Reversal will add a dedicated `payment.reversed` contract and retain the existing source audit unchanged.

## Lifecycle and source-derived settlement

`payments` and `payment_allocations` remain immutable historical records. A one-to-one append-only `payment_reversals` row defines the derived payment state: no row means `ACTIVE`; one row means `REVERSED`. Reversal reason, official actor, same-RT scope, and server timestamp live in that row. A reversed transfer request remains `verified` as historical request status and continues to reference its one original payment.

`active_due_settlements` is an operational projection of current ownership, with one row per currently paid due. It references one immutable allocation and its payment, due, scope, and amount. It has a primary key on `monthly_due_id`; it does not replace the append-only ledger and does not impose uniqueness on historical allocations. A later payment can therefore add a new historical allocation for the same due after the prior payment is reversed.

At commit, database assertions require:

- Every `PAID` due has exactly one valid active settlement; every other due has none.
- Every active payment has its complete source-specific ledger and one matching active settlement for each allocation.
- Every reversed payment retains its complete original source ledger, owns no active settlement, and has one matching `payment.reversed` audit. Its dues may remain unpaid or be owned by a later active payment.
- A verified transfer request keeps its historical payment, allocations, and original `payment_request.verified` audit whether that payment is active or reversed.
- Cash retains its original `payment.cash_recorded` audit whether active or reversed.

The source phrase “recalculate affected allocations” means recompute the current settlement effect from active ownership. It does not change or delete historical allocation rows. Reversal removes the old payment's active ownership and makes its affected dues unpaid; a later payment creates new allocations and new active ownership.

## Transaction and lock order

**Payment creation**

- Transfer: authenticate an active same-RT Treasurer; lock request; read immutable items; lock all affected due rows ordered by `monthly_due_id`; lock the matching claims ordered by `monthly_due_id`; revalidate the unpaid snapshot; insert payment and allocations; insert active-settlement rows; mark all dues paid; update request to historical `verified`; close claims; append source audit; commit deferred checks.
- Cash: authenticate an active same-RT Treasurer; lock/check idempotency key; lock eligible payable dues through the target period by stable due ID, including both `PAID` and `UNPAID`; recompute and period-sort the oldest-unpaid set after locks; lock claims for that set; insert payment, allocations, and active-settlement rows; mark dues paid; append source audit; commit deferred checks.

**Payment reversal**

1. Authenticate an active same-RT Treasurer and require `payment:reverse`.
2. Select the payment by payment ID and principal RT, then lock that payment row `FOR UPDATE`.
3. Check for a reversal after the payment lock; return a safe already-reversed conflict if found.
4. Read and validate the immutable allocation set; lock every referenced due ordered by `monthly_due_id`.
5. Lock matching active-settlement rows in the same due-ID order and validate exact ownership and amounts.
6. Insert the reversal row with the normalized reason and database timestamp.
7. Change all affected dues from `PAID` to `UNPAID` while the locked ownership rows still identify this now-reversed payment.
8. Delete only those operational active-settlement rows; keep payments, allocations, request history, and original audit untouched.
9. Append exactly one `payment.reversed` audit in the same transaction, with `{ itemCount, method, totalAmount }`; commit deferred lifecycle checks.

Cash and reversal serialize on due row locks. Cash's widened lock query ensures a transaction that began before reversal releases the due re-reads its committed status before it selects oldest unpaid periods. Request creation continues to claim only unpaid dues and cannot create a claim against a paid due; when it races with reversal, its due lock serializes the final state.

## UI and read model

The Treasurer receives an authenticated same-RT transaction history listing household label, house number, method, periods, total, original timestamp, derived state, and reversal time/reason when present. An active entry exposes one whole-payment reversal action with a mandatory reason and explicit confirmation. Reversed entries remain visible without an action.

The resident's current due card and summary use the committed due state. Resident payment history includes transfer and cash, labels a reversed entry `Pembayaran dibatalkan`, and does not expose internal identifiers or actor IDs. A reversal does not create or rewrite a payment request.

## Scope lock

This design covers only payment reversal and the settlement ownership needed to make it safe. Fase 10 waiver, Fase 11 tariff adjustment, reports/exports, notifications/outbox, production migration/deploy, and default-branch merge remain out of scope.
