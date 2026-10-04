# Launch Safety Gate Report

**Date:** 2026-10-04
**Branch:** `feat/launch-safety-single-rt`
**Launch Safety implementation commit:** `7bce770cfa6086a1def7690fb582bf94dc5d412d`
**Promoted main SHA:** `4890678b91c4c4e2c535f1149da60dbfcde32370`

## Promotion and branch state

- Previous `main`: `322e439267cd4e5d5552f7816ed1d3a3eebf533c`.
- F13.1 source: `4890678b91c4c4e2c535f1149da60dbfcde32370`, exact source CI run `37203540712` PASS.
- Promoted with a fast-forward push, preserving F13/F13.1 history. Promoted-main Test Gate A run `37209193495` PASS at the exact promoted SHA.
- Launch Safety was created from that exact promoted SHA. It remains a separate feature branch and has not been merged to `main`.
- Single-RT is the approved operational mode. `rt_unit_id`, tenant isolation, cross-RT constraints, authorization, and tests remain in place. No RT selector or multi-tenant UI was added.
- F14, Fase 3, staging, backup/restore, UAT, and production deployment were not started.

## Integrity

`docs/launch-safety-integrity-design.md` freezes 16 deterministic, detect-only categories, including invalid pending request/due state, exact paid settlement and balance, verified request/payment/allocation parity, payment/allocation parity, over-receipt, reversal ownership, waiver ledger/audit/actor parity, NOT_DUE activity, household lifecycle overlap/duplicates, resident/account links, duplicate officials, and cross-RT financial scope. The design maps overlapping checks to Gate C and the F12 lifecycle audit; it does not count their stored reports as fresh evidence.

- Local synthetic fixtures: 27/27 checker tests PASS.
- Neon DEVELOPMENT read-only repeatable-read snapshot: 16/16 categories zero; result PASS.
- Gate C: 32/32 zero. F12 lifecycle global audit: 11/11 zero.
- The checker is read-only and aggregate-only. No auto-fix was implemented.

## Security, authorization, and concurrency

The frozen plan contains 23 threat rows. Focused security and financial suites passed (40 tests across payment verification, reversal, waiver, report authorization, and financial actor authorization); same-key cash retry coverage passed (9 tests in the cash suite), including one payment, two expected allocations, one audit, and paid dues. The full authorization suite passed 111/111; the complete regression suite passed 377/377.

Two required proof gaps remain blockers:

1. PGlite exposes one in-memory database client in these suites. `Promise.all` exercises real domain transaction paths but does not prove independent PostgreSQL backend connections or lock contention. The required independent-connection proof for payment verification, cash, reversal, waiver, and lifecycle races is unavailable under the no-shared-Neon-mutation policy.
2. The full authenticated route/session matrix across every planned principal and route family was not executed. In particular, the System Admin two-factor recovery route has no explicit Origin guard in the inspected source; browser exploitability and SameSite/session behavior were not established.

No confirmed Critical or unaccepted High security failure was observed in the tests that did run. This is not evidence that the unexecuted matrix is clear.

## Performance smoke

Synthetic disposable PGlite comparison used 50 households/600 annual dues and 500 households/6,000 annual dues. It is a local comparison, not a Neon or production SLA.

- Chairman F13 report plus arrears median: 166.37 ms at 50 households; 11,524.89 ms at 500 (69.27x for a 10x dataset).
- Household list first page median: 39.24 ms and 205.09 ms (5.23x); the 500-household result returned its 250-row page cap.
- Resident 12-dues read: 5.04 ms. Treasurer queue/history fixtures were empty. Query count and peak memory were not instrumented.
- The report scaling result is a warning for follow-up and was not used to infer production latency or justify a schema change. No performance migration or major refactor was made.

## Quality, migration, and dependency evidence

- `npm ci`, lint (0 errors; one pre-existing unused-variable warning), typecheck, unit (42), integration (182), constraints (42), authorization (111), full suite (377), build, Drizzle journal check, and schema drift check passed locally.
- Migration journal remains 14 entries ending at `0013_phase_12_household_management`; no `0014` was created. Neon development checks were read-only with zero writes.
- Full `npm audit` reports five High package-path entries representing one unique development-only advisory, `GHSA-vfj7-8cjw-p6xm` for `braces@3.0.3`, covered only by accepted residual `RA-2026-F12-001`. The full audit is not clean. `npm audit --omit=dev` reports zero vulnerabilities.
- Production database and deployment were not accessed.

## Finding counts and verdict

- Gate blockers: 2 evidence gaps (independent PostgreSQL concurrency proof; incomplete authenticated route/session matrix).
- Confirmed Critical security failures: 0.
- High: 1 accepted development-only dependency advisory (`RA-2026-F12-001`); 0 confirmed unaccepted High security failures in executed tests.
- Warnings: 1 performance scaling observation. A pre-existing lint warning is recorded separately in quality-gates.json.
- Nice-to-have: 0.

**Exact Launch Safety CI result for this implementation commit:** Test Gate A run `37213548073`, PASS at SHA `7bce770cfa6086a1def7690fb582bf94dc5d412d` (7m8s). A report-only follow-up commit receives a separate exact-SHA CI run; the final branch head and its CI run are included in the delivery response.

## Final verdict

LAUNCH SAFETY FAIL — FASE 3 NO-GO — BLOCKER: independent PostgreSQL connection concurrency proof unavailable and the full required authenticated route/session security matrix remains unexecuted.
