# KartuRT Fase 6 — Treasurer Verification Report

## Decision

- **Fase 6:** Pending GitHub Actions on `feat/phase-6-treasurer-verification`. Local, Neon development, real HTTP, and browser gates pass.
- **Test Gate B:** Pending GitHub Actions. The real resident → request → WhatsApp → Treasurer queue/detail/verify → resident paid path, history, audit, concurrency, and authorization checks pass.
- **Critical/High blockers found:** 0.
- **Production and default branch:** Not accessed, migrated, deployed, or merged.

## Baseline and schema

- Repository: `Satsetx4/karturt`; working branch: `feat/phase-6-treasurer-verification`.
- Baseline: `fix/phase-5-1-pre-verification-hardening` at `feaab42cb1c8c013cb40184cb9d867f6167cdff1`; Fase 5.1 implementation parent: `dd8000dd44b75d6e662ce4b688f20cd8faa28b73`.
- Baseline migration: `0005_phase_5_1_payment_request_items_immutable`.
- New ledger migration: `0006_phase_6_treasurer_payment_ledger`.
- Local toolchain used for final checks: Node.js `v24.19.0`, npm `12.0.2`.
- Neon development target: project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), database `neondb`, direct endpoint `ep-quiet-cake-azrhjiyh`. No connection string or credential is recorded here.
- Baseline development data read before migration: 6 pending requests, 7 immutable items, 7 active claims, and 0 paid dues.

Migration 0006 adds one payment per request and one allocation per immutable request item. Composite foreign keys bind RT, household, request, due, and amount; unique constraints reject duplicate request payments and duplicate due allocations; amounts must be positive; history foreign keys use `RESTRICT`. Payment and allocation rows are append-only. Deferred commit checks enforce request/item totals, exact allocation coverage, closed claims, paid dues, and one matching audit event.

Existing `payment_request_items` are not changed. `payment_requests.verified_at` and `verified_by_account_id` provide state traceability. The payment row remains the financial ledger record; request metadata and audit do not replace it.

## Authorization, queue, and API

- Queue and detail require a live session whose account is active and has exactly one active Treasurer assignment for the same RT.
- Service tests deny Chairman, System Admin, resident, inactive Treasurer, and cross-RT principals. The real HTTP smoke also confirms resident queue/verify refusal and cross-origin/mass-assignment rejection.
- Queue results include only pending requests, ordered by `created_at`, then stable request ID. The query uses a request read plus a batched item read; it does not issue an item query per row.
- Browser payloads contain public request code, resident name, house number, request time, item periods/amounts, total, and status. They omit internal UUIDs and phone numbers.
- Verify accepts only an empty JSON object, uses the session principal as actor, checks same-origin, and scopes by the request code plus the Treasurer's RT. Cross-RT codes are not found.

## Verification transaction and retry behavior

`verifyTreasurerPaymentRequest` revalidates the Treasurer within one database transaction. It locks the pending request first, reads the immutable items, locks all referenced dues in UUID order, and then locks their claims in the same stable order. It validates claim ownership, unpaid due state, amount/period agreement, item count, request total, and absence of an existing payment.

It then inserts one transfer payment, one allocation per request item, marks every due paid, marks the request verified using the database clock and Treasurer account, closes claims, and appends `payment_request.verified` with only `itemCount` and `totalAmount`. Any write or audit failure rolls back all of these changes. The request and item rows remain available as history.

The request row lock serializes concurrent verification. The first verifier returns success; a second concurrent call or a retry after commit returns HTTP 409 `already_processed`. Unique payment and allocation constraints provide additional guards. No client-selected month, amount, household, RT, or actor is accepted.

## Evidence

### Tests and schema checks

- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run test:unit -- --maxWorkers=1` — 29/29 PASS.
- `npm run test:integration -- --maxWorkers=1` — 58/58 PASS across 15 files, including full migration application 0000–0006.
- `npm run test:constraints -- --maxWorkers=1` — 15/15 PASS.
- `npm run test:authorization -- --maxWorkers=1` — 5/5 PASS.
- `npm test -- --maxWorkers=1` — 107/107 PASS across 23 files.
- `npm run build` with local-only dummy build variables — PASS; it did not connect to or write to a database.
- `npx drizzle-kit check` — PASS.
- `npm run db:generate -- --name phase_6_schema_drift_check` — no schema changes.
- Allocation insertion, due update, request update, and audit insertion failure tests confirm full rollback. Other tests cover duplicate payment/allocation, ledger append-only behavior, paid-due allocation requirements, immutable snapshot retention, retry semantics, and resident summary mapping.

### Neon development migration

- `npm run db:check` — PASS with `APP_ENV=development` and `DATABASE_ENV=development`.
- `npm run db:migrate` — PASS against the exact development branch and direct endpoint listed above.
- Read-only Neon verification after migration found 7 migration records (0000–0006), both ledger tables, 31 constraints, 10 indexes, and 16 non-internal triggers on the payment/request/due tables. The database reported PostgreSQL 18.6.
- No command or query was sent to the production branch.

### Real HTTP, Neon, and browser Gate B smoke

The successful smoke used a local Next.js development server, the exact Neon development database, normal Better Auth resident and Treasurer logins, and two separate Treasurer sessions for the race. No mocked route or injected principal was used.

1. Resident read three unpaid periods and posted a normal request for April–June 2026. The response returned a WhatsApp deep link containing the request code.
2. Treasurer queue returned two requests in oldest-first order. Detail returned the immutable three-item snapshot and matching total; it did not expose internal IDs.
3. Two Treasurer sessions posted verify concurrently: **one 200 success and one safe 409 `already_processed`**.
4. The main request ended verified with exactly one 54,000 payment, three allocations totalling 54,000, no remaining claims, one audit event, intact request items, and all three dues paid.
5. Resident refresh returned `paid` with no pending request status. The UI showed the paid summary and three `Sudah bayar` rows in history.
6. A separate one-item development request verified through the browser. Two rapid clicks produced exactly one verify request and one payment/allocation set.
7. Queue, detail, processed state, and resident card were checked at 360×800, 390×844, 430×900, 768×1024, and 1440×900. No horizontal overflow or browser page/console errors were observed; the verify target measured at least 44px.

Screenshots from the real browser run:

- [Treasurer queue at 390×844](phase-6-evidence/2026-10-01T03-14-23-036Z-treasurer-queue-390x844.png)
- [Pending request detail at 390×844](phase-6-evidence/2026-10-01T03-14-23-859Z-treasurer-detail-pending-390x844.png)
- [Processed request detail at 390×844](phase-6-evidence/2026-10-01T03-14-29-911Z-treasurer-detail-processed-390x844.png)
- [Browser confirmation result at 390×844](phase-6-evidence/2026-10-01T03-14-31-761Z-treasurer-detail-confirmed-by-browser-390x844.png)
- [Resident card after payment at 390×844](phase-6-evidence/2026-10-01T03-14-36-635Z-resident-paid-390x844.png)
- [Resident payment history at 390×844](phase-6-evidence/2026-10-01T03-14-40-184Z-resident-paid-history-390x844.png)

## Development fixture note

Synthetic financial fixtures are retained on the development branch. Two earlier smoke attempts stopped after creating pending-only requests, and one stopped before creating a request. Current read-only totals for the dedicated `Phase 6 synthetic unit` fixtures are 4 RT units, 6 requests (4 pending and 2 verified), 2 payments, 4 allocations, and 8 active claims. The pending requests are test data, not reports of received transfers; they remain isolated to synthetic RT units. Authentication sessions from smoke runs were removed. No fixture or financial history was deleted.

## Residual risks and scope

- Production was intentionally not inspected or changed. Production migration state is therefore not independently re-verified in this phase.
- Browser verification used headless Chrome/Edge viewports; physical-device testing was not performed.
- The development branch contains the synthetic pending fixtures noted above.
- Reversal, cash payment, reject/cancel, waiver, tariff adjustment, reporting/export, notifications, production deployment, and default-branch merge remain outside Fase 6.

## GitHub Actions

The Gate A workflow now includes `feat/phase-6-treasurer-verification` in its push trigger. Branch push and Actions result: **pending**.
