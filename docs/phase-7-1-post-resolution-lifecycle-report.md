# Fase 7.1 — Post-Resolution Lifecycle Hardening Report

**Status: PASS**  
**Fase 8 readiness: GO for design only; NO-GO for cash-payment implementation in this phase.**

## Baseline and final code

- Repository: `Satsetx4/karturt`
- Baseline branch: `feat/phase-7-reject-cancel`
- Baseline SHA: `5a547c5ddbeea177da58d914dea3a63892d211b2`
- Baseline Fase 7 GitHub Actions run: [36832213294 — PASS](https://github.com/Satsetx4/karturt/actions/runs/36832213294)
- Fase 7.1 branch: `fix/phase-7-1-post-resolution-lifecycle`
- Fase 7.1 implementation SHA: `80019e05c698a81e1b3f2718132f01e4f5cababd`
- Migration head: `0008_phase_7_1_post_resolution_lifecycle`
- Migration SHA-256: `f5bb31f899b941c5417e71b8b4a6b28142bc74210487a967ef145d127428082f`

Migration `0007` was left unchanged. Migration `0008` was applied and verified only on Neon development. No default-branch merge was performed.

## Root cause and invariant design

Fase 7's `assert_payment_request_ledger_v1()` treated a rejected or cancelled request as invalid forever after any referenced due changed from `unpaid`. That made an old terminal request conflict with the valid lifecycle of creating a replacement request and paying those same dues later.

Fase 7.1 separates the two kinds of invariant:

- **At the pending → rejected/cancelled transition:** the due rows must still be unpaid and match the saved period and amount; the request must own its complete claims and have no payment or allocation ledger; resolution metadata and the immutable item snapshot must be complete.
- **For terminal history afterward:** the old request remains terminal and immutable, retains no claims or own payment/allocation ledger, and has exactly one matching transition audit. Its referenced due rows may later be paid by a different verified request.

The terminal transition guard locks due rows and claims in deterministic order. The history trigger and audit-cardinality checks remain in force.

## Migration and trigger/call-graph audit

Migration `0008_phase_7_1_post_resolution_lifecycle.sql` replaces the ledger assertion with the historical rule while preserving pending and verified request checks, including item totals, payment totals, allocation completeness, audit matching, and verified allocations matching paid dues.

The call graph was reviewed:

- Deferred request, item, claim, payment, and allocation constraint triggers call `validate_payment_request_ledger_change_v1()`, which calls `assert_payment_request_ledger_v1()`.
- The deferred transition-audit trigger calls `validate_payment_request_transition_audit_v1()`, which calls the same ledger assertion.
- Both paths now accept a terminal historical request after its due is later paid, while still validating that request's own ledger/claims and its exact audit.
- Fase 6's separate `assert_paid_due_allocation_v1()` still requires a valid allocation belonging to a verified request before a due can be paid. `guard_paid_due_history_v1()` still prevents rewriting a paid due. Neither global paid-due invariant was weakened.

## Lifecycle and negative database evidence

Integration coverage in `tests/integration/payment-request-resolution.test.ts` verifies:

1. Cancel A → create B for the same periods → verify B. A stays cancelled and unchanged, has no claims/payment/allocations and keeps its single audit; B owns one payment and a complete allocation set; the shared dues are paid.
2. Reject A with a reason → create and verify B for the same periods. A remains rejected with the same reason and intact audit; the shared dues are paid by B.
3. Attempts to reopen or rewrite a terminal request fail.
4. Direct reject/cancel fails when the referenced due is already paid, claims are incomplete, a request-owned ledger exists, or resolution metadata is invalid.

The targeted resolution integration suite passed **13/13**. The full suite passed **127 tests across 26 files**.

## Treasurer UI coordination

A shared coordinator wraps the Verify and Reject actions on the Treasurer request detail page. While either mutation is in flight, it disables the opposite action and prevents both requests from being sent from ordinary browser interaction. The database row lock and conflict response remain authoritative. A losing request safely returns `409 already_processed`.

The real-browser smoke confirmed that Verify-in-flight disables Reject, Reject-in-flight disables Verify, no cross-action mutation was sent, and a double-click sent only one Verify mutation.

## Neon development, Gate B, races, and browser evidence

The real HTTP/browser smoke used only:

- Neon project: `billowing-base-57949906`
- Branch: `karturt-development` (`br-crimson-band-az6i637k`)
- Database: `neondb`
- Direct development endpoint: `ep-quiet-cake-azrhjiyh`
- Runtime guards: `APP_ENV=development`, `DATABASE_ENV=development`

Migration head and function presence were checked on that branch after applying `0008`. Production was not accessed.

Gate B passed through the resident request → WhatsApp handoff → Treasurer verification → resident paid flow. The primary verified request produced one payment, three allocations, zero claims, one verified audit, and paid dues. The resident view showed three months as `Sudah bayar` with no pending request.

The real HTTP race checks returned exactly one winner and one safe `409 already_processed` response for:

- cancel vs verify — cancellation won;
- reject vs verify — verification won;
- cancel vs reject — rejection won.

Same-request double verification also produced one success and one already-processed response.

Headless browser viewport regressions passed at **360×800, 390×844, 430×900, 768×1024, and 1440×900**. The retained cancelled/rejected history and paid replacement rendered without horizontal overflow, raw enum/UUID/SQL content, and with touch targets at least 44px. This is viewport emulation, not physical-device testing.

Screenshots from the browser run are in `docs/phase-6-evidence/` and `docs/phase-7-evidence/`, including `2026-10-01T12-58-42-876Z-phase-7-1-paid-replacement-history-390x844.png`. Synthetic development smoke fixtures were retained; smoke auth sessions were removed.

## Quality gate and CI

All local checks passed:

- lint;
- typecheck;
- unit tests: 29/29;
- integration and clean migrations `0000 → 0008`: 77 tests across 18 files;
- database constraints: 15 tests;
- authorization: 6 tests;
- full suite: 127 tests across 26 files;
- Drizzle journal consistency and schema drift;
- production build using build-only configuration;
- `git diff --check`;
- Neon development migration and real HTTP/browser smoke.

GitHub Actions [run 36866375140 — Test Gate A](https://github.com/Satsetx4/karturt/actions/runs/36866375140) passed on implementation SHA `80019e05c698a81e1b3f2718132f01e4f5cababd`. Lint, typecheck, unit, integration/migration, constraints, authorization, full suite, Drizzle consistency, schema drift, and production build all passed.

GitHub emitted non-blocking runner notices about Node.js 20 deprecation and the scheduled `ubuntu-latest` image migration. No Critical or High blockers were found.

## Decision and boundaries

**Fase 7.1: PASS. Fase 8: GO for design/readiness work only.** Any cash-payment implementation requires a separate scope. This branch contains no Fase 8 cash-payment implementation, reversal, waiver, tariff adjustment, report/export, notification/outbox, production migration, production deployment, or default-branch merge.

Production remained untouched. Branch is pushed to GitHub for review and CI; it is not merged.
