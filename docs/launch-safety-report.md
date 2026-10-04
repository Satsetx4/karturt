# Launch Safety Gate Report

**Date:** 2026-10-05
**Branch:** `feat/launch-safety-single-rt`
**Launch Safety validated remediation code SHA:** `edcd071b713fe1a6db55513726810c7428521d96`
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

The frozen plan contains 23 threat rows. Focused security and financial suites passed (40 tests across payment verification, reversal, waiver, report authorization, and financial actor authorization); same-key cash retry coverage passed (9 tests in the cash suite). The full authorization suite passed 119/119 and the complete regression suite passed 385/385 across 60 files.

The two original blockers are closed with exact-SHA evidence:

1. Independent PostgreSQL concurrency: Test Gate A run `37219269983` used an ephemeral PostgreSQL 17 database and two one-connection pools. Backend PIDs 100 and 101 were distinct, and PostgreSQL reported a real lock wait for each of five races: payment verification, same-key cash, reversal, waiver, and household replacement. Final ledger, allocation, and audit assertions passed. The sanitized artifact is `docs/launch-safety-evidence/postgres-independent-concurrency.json`.
2. Authenticated route/session proof: the blocker-specific matrix passed for nine principal/session categories against representative handlers in all four available route families. It uses actual Better Auth signed cookies and System Admin TOTP. The System Admin recovery POST now applies the shared Origin check before parsing/authentication; foreign, missing, null, and malformed Origin requests return 403 without changing protected state.

The wider S1–S16 security plan is still partial: not every endpoint has a full principal cross-product; browser cookie delivery, session fixation/cookie attributes, brute-force boundaries, resident PIN lockout, and some malformed-input/SQL-injection cases remain untested. No confirmed Critical or unaccepted High security failure was observed in tests that ran. These remaining coverage gaps require independent audit and prevent this report from authorizing Fase 3.

## Performance smoke

Synthetic disposable PGlite comparison used 50 households/600 annual dues and 500 households/6,000 annual dues. It is a local comparison, not a Neon or production SLA.

- Chairman F13 report plus arrears median: 166.37 ms at 50 households; 11,524.89 ms at 500 (69.27x for a 10x dataset).
- Household list first page median: 39.24 ms and 205.09 ms (5.23x); the 500-household result returned its 250-row page cap.
- Resident 12-dues read: 5.04 ms. Treasurer queue/history fixtures were empty. Query count and peak memory were not instrumented.
- The report scaling result is a warning for follow-up and was not used to infer production latency or justify a schema change. No performance migration or major refactor was made.

## Quality, migration, and dependency evidence

- `npm ci`, lint (0 errors; one pre-existing unused-variable warning), typecheck, unit (42), integration (182), constraints (42), authorization (119), full suite (385 across 60 files), build, Drizzle journal check, and schema drift check passed in exact-SHA CI.
- Migration journal remains 14 entries ending at `0013_phase_12_household_management`; no `0014` was created. Neon development checks were read-only with zero writes.
- Full `npm audit` reports five High package-path entries representing one unique development-only advisory, `GHSA-vfj7-8cjw-p6xm` for `braces@3.0.3`, covered only by accepted residual `RA-2026-F12-001`. The full audit is not clean. `npm audit --omit=dev` reports zero vulnerabilities.
- Production database and deployment were not accessed.

## Finding counts and verdict

- Original blocker-specific proof gaps: 0 open of 2 (independent PostgreSQL concurrency; authenticated principal/session matrix plus System Admin Origin guard).
- Remaining blocker: wider S1–S16 security coverage is incomplete; independent audit is still required before Fase 3.
- Confirmed Critical security failures: 0.
- High: 1 accepted development-only dependency advisory (`RA-2026-F12-001`); 0 confirmed unaccepted High security failures in executed tests.
- Warnings: 1 performance scaling observation. A pre-existing lint warning is recorded separately in quality-gates.json.
- Nice-to-have: 0.

**Exact Launch Safety CI for validated remediation code:** Test Gate A run `37219269983`, PASS at SHA `edcd071b713fe1a6db55513726810c7428521d96`; Gate A passed and the PostgreSQL concurrency job `111487109094` passed. This report/evidence follow-up is separately gated on its own exact SHA.

## Final verdict

LAUNCH SAFETY FAIL — FASE 3 NO-GO — BLOCKER: wider S1–S16 security coverage remains incomplete and requires independent audit.
