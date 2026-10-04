# Launch Safety Gate Report

> **Historical pre-F2.1 record — superseded.** The original Launch Safety findings below describe the state before the F2.1 security closure. The **Current / Final verdict** at the end of this file is the authoritative status.

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

## Historical finding counts and verdict (pre-F2.1; superseded)

- Original blocker-specific proof gaps: 0 open of 2 (independent PostgreSQL concurrency; authenticated principal/session matrix plus System Admin Origin guard).
- Remaining blocker: wider S1–S16 security coverage is incomplete; independent audit is still required before Fase 3.
- Confirmed Critical security failures: 0.
- High: 1 accepted development-only dependency advisory (`RA-2026-F12-001`); 0 confirmed unaccepted High security failures in executed tests.
- Warnings: 1 performance scaling observation. A pre-existing lint warning is recorded separately in quality-gates.json.
- Nice-to-have: 0.

**Exact Launch Safety CI for validated remediation code:** Test Gate A run `37219269983`, PASS at SHA `edcd071b713fe1a6db55513726810c7428521d96`; Gate A passed and the PostgreSQL concurrency job `111487109094` passed. This report/evidence follow-up is separately gated on its own exact SHA.

## F2.1 Security Closure Addendum — 2026-10-05

**Previous:** LAUNCH SAFETY FAIL — S1–S16 security coverage incomplete. The earlier FAIL history above is retained as the original Launch Safety finding.

**F2.1 product/security code SHA:** `091ef09057bbb2bb3df6e7b53eb5bbb0a3ff8dd2`<br>
**Exact product/security code CI:** Test Gate A run `37227655766` — PASS. Gate A and independent PostgreSQL concurrency jobs passed.
**Pre-cleanup branch SHA:** `40ba99d2ad1e8732025d1c0ea3bd456f0bd62947`<br>
**Exact pre-cleanup branch CI:** Test Gate A run `37229395825` — PASS. Gate A local verification, the Launch Security Closure tests, and independent PostgreSQL concurrency all passed.

| Security row | F2.1 result |
|---|---|
| S1 — IDOR / cross-user | PASS |
| S2 — Cross-RT security fixture | PASS |
| S3 — Role escalation | PASS |
| S4 — Tenant spoofing | PASS |
| S5 — Role / actor spoofing | PASS |
| S6 — Direct API authorization | PASS |
| S7 — Mass assignment | PASS |
| S8 — Malformed payload | PASS |
| S9 — SQL injection | PASS |
| S10 — CSRF, including two-origin browser proof | PASS |
| S11 — Session fixation / cookie attributes | PASS |
| S12 — Session revocation | PASS |
| S13 — Inactive / ended assignment session | PASS |
| S14 — Brute-force / rate limit | PASS |
| S15 — Resident PIN lockout | PASS |
| S16 — Privileged recovery | PASS |
| S17–S23 — Revalidated without rewriting the concurrency harness | PASS |

- Integrity: 16/16 zero; Gate C: 32/32 zero; F12 lifecycle global: 11/11 zero.
- Migration journal remains 14 entries ending at `0013_phase_12_household_management`; no `0014` was created.
- Production dependency audit: 0 vulnerabilities. The only accepted residual remains `RA-2026-F12-001` for the development-only `braces@3.0.3` advisory; it is not resolved or generalized.
- Full suite: 399/399 across 64 files; exact-source Gate A, security closure suite, Drizzle checks, production build, and independent PostgreSQL concurrency all PASS.
- Browser CSRF used two loopback origins and real synthetic signed sessions; both the financial mutation and System Admin recovery returned 403 with state unchanged. Session fixation and cookie attributes also passed.
- Resident login rate limits and five-failure/15-minute PIN lockout passed configured-boundary, expiry, authorized reset, and concurrent-race checks.
- Performance: **WARNING — remeasure in staging**; the existing local PGlite 500-household F13 report measured approximately 11.5 seconds. No F2.1 optimization was made.
- Production was not accessed. The branch was not merged to `main`.
- The operational product is Single-RT. **Multi-RT user features: OUT OF MVP.** **Multi-RT security architecture: PRESERVED** only through `rt_unit_id`, tenant isolation, cross-RT constraints, cross-RT authorization, and representative security tests.
- The docs-only evidence-reconciliation commit is checked on its exact SHA; its CI run ID is reported in task completion and is not embedded in the commit itself.

The completion report and sanitized evidence pack are in `docs/launch-safety-security-closure-report.md` and `docs/launch-safety-security-closure-evidence/`. The documentation-only final branch commit is checked by the same exact-SHA workflow; its result is recorded in the task completion response.

## Current / Final verdict

**F2.1 PASS**<br>
**LAUNCH SAFETY PASS**<br>
**FASE 2 CLOSED**<br>
**BLOCKERS: 0**<br>
**CRITICAL: 0**<br>
**UNACCEPTED HIGH: 0**<br>
**Single-RT MVP: APPROVED**<br>
**Multi-RT user features: OUT OF MVP**<br>
**Multi-RT security architecture: PRESERVED**<br>
**READY FOR FASE 3**
