# F15/F20 acceptance, 31 October 2026

Scope: continue from released main `feee9848ef290be88e8ec3f6799d2db8c989044d`. This slice changes only the resident connection-loss message and extends the existing synthetic component browser harness. No schema, dependency, permission, ledger, offline queue, service worker or Production configuration changes.

## Online-only behavior

- A successful server response is required before showing submission or confirmation success.
- Reconnecting does not submit or confirm a payment automatically.
- A lost response does not prove the server rejected the submission. The resident sees an uncertain-status message and can inspect history or manually retry the same submission.
- The same in-memory idempotency key is retained for a manual retry of the same submission after response loss. It is not stored in localStorage and does not survive a page reload. After reload, inspect server history before starting another submission; server claim/idempotency constraints remain authoritative.
- No private financial pages or data are made available through an offline cache.

## Executed automated verification

`npx vitest run tests/integration/audit-reader.test.ts tests/unit/audit-page.test.ts tests/unit/pwa-manifest.test.ts tests/integration/resident-payment-request.test.ts tests/integration/treasurer-payment-verification.test.ts`: 39 tests across 5 files passed. Includes audit tenant isolation, rechecked role/assignment/MFA, redaction and filters/pagination. Page tests mock the session and are not authenticated Preview browser acceptance.

`npx tsx scripts/phase-5-payment-request-browser-smoke.ts`: actual headless Chromium with synthetic React components and a mock HTTP server. Tests offline submission, no false success, no automatic replay on reconnect, response loss after server acceptance, same-key manual retry with exactly one recorded request, double-click guards, and offline/manual Treasurer confirmation. The response-loss fault is injected around browser fetch after the mock server responds; it is not a real provider outage. Layout checks cover 360/390/430/768/1440 px. Browser fixtures contain synthetic data only. Next Link runs without a Next router; full application navigation is outside this harness.

Typecheck and changed-file ESLint passed before final build. An initial build attempt correctly refused a dirty source tree; a clean-source optimized build must be checked before the PR is considered ready.

## Remaining acceptance (do not mark PASS without execution)

Use isolated synthetic Preview accounts, never real resident/payment data:

1. Chairman: open Activity from account home, filter date/type, navigate older events and back; confirm another RT's events are absent.
2. System Admin: verify MFA requirement and permitted global summaries; Treasurer/Resident direct activity access must be denied.
3. Android and iPhone: install, launch, sign in and sign out; check that signed-out private routes require login.
4. In the installed app, disconnect before submitting/confirming; no success or payment-state change. Reconnect: no automatic submission. Manually retry and inspect the server's latest history.
5. Confirm CSV download from the installed app and no private offline page/data availability.

Physical installation, participant usability observation, signed-in Preview browser acceptance, independent PostgreSQL concurrency and PG18 recovery have not been executed in this slice. The last two CI jobs were SKIPPED on the prior release, not passed. Production restore capability is not established by these tests.

## Next implementation slice

F16 remains pending: Chairman-scoped list of current/scheduled/past assignments, create/schedule/end operations using existing accounts, inclusive Jakarta business dates, no overlap or backdating, transactional audit and session revocation. Preserve history; define safe Chairman succession before permitting self-ending. Account provisioning/recovery belongs to F17. Do not expand roles or add a generic admin console.
