# Fase 3 — Delivery Readiness Report

**Formal verdict: FASE 3 FAIL — PRODUCTION NO-GO**

**Branch:** `feat/delivery-readiness-single-rt`

**Verified main baseline:** `ef9b6efacea01e996aec43f6eeb1429b4e86044e`

**Product code commit reviewed:** `7c56f273111ab0f94f54a493f500aed4e2e54dcd`

**Operational scope:** SINGLE-RT

**Date:** 2026-10-05

## Decision

Fase 3 cannot pass because post-fix System Admin UAT did not complete through a verified TOTP session, and the required responsive matrix did not cover authenticated Resident, Treasurer, Chairman, and MFA screens. Existing staging data remains internally consistent, and the failures above were not hidden or replaced with simulated results.

Production remains untouched. The F3 branch has not been merged to `main`. Stop here; do not start Production Pilot or Fase 4.

## Gate results

| Gate | Result | Evidence and scope |
|---|---|---|
| Baseline and scope freeze | PASS | Fresh `origin/main` stayed at the expected SHA; baseline Gate A run `37245140380` passed; migration head is 0013; branch is separate and SINGLE-RT. |
| Staging isolation and HTTPS | PASS with warning | Neon staging uses separate project `wispy-sky-99637283`; Vercel uses isolated project `karturt-f3-staging`; Preview labels match staging, HTTPS/HSTS observed, and no Production-scoped variables are configured. A separate F3 deployment was once classified as Production inside the staging project and canceled before readiness or traffic; see evidence. |
| Migration/bootstrap | PASS | 14 journal rows; head `0013_phase_12_household_management`; no 0014; `db:check`, journal consistency, Drizzle check, and schema drift checks passed. |
| Single-RT fixture | PASS | One synthetic RT. Post-UAT snapshot: 11 houses/households, 6 Resident accounts, 1 Treasurer, 1 Chairman, 2 System Admins, 72 dues, and the listed payment/lifecycle states. |
| Backup and restore | PASS | Custom-format staging backup; 19 safe table aggregates/checksums match the disposable restore target; restored migration journal, integrity suites, F13 oracle, and a synthetic verified login passed. |
| Resident UAT | PASS on earlier F3 Preview | Login, card/dues, request/cancel/re-request, Treasurer verification, PAID/history, wrong-PIN lockout, PIN reset/revocation, and expired-session checks passed on the real Preview at SHA `a81ea658`. The subsequent changes were an isolated recovery-reference validation fix and login-link sizing. |
| Treasurer UAT | PASS on earlier F3 Preview | Queue, transfer verification, rejection, cash payment, reversal/history, ledger semantics, and Chairman-only denial passed at SHA `a81ea658`. |
| Chairman UAT | PASS on earlier F3 Preview | Household list/create, PIN reset, tariff, adjustment, waiver, report/arrears, and denied payment verification passed at SHA `a81ea658`. |
| System Admin UAT | **FAIL / incomplete** | Earlier TOTP and recovery flows passed at SHA `a81ea658`, but a malformed recovery reference returned 500 without mutation. A narrow validation fix and regression test were added at `0469a487`; after redeployment, a password login reached MFA but no authorized current TOTP source was available. The post-fix protected action and recovery flow therefore remain unverified. No MFA bypass or factor reset was performed. |
| Responsive acceptance | **FAIL / partial** | On the current `7c56f27` Preview, Resident and Pengurus login screens were measured at all five required viewports. Their cross-role links now measure 44 px high and showed no horizontal overflow. The authenticated dashboards, Chairman report, and verified MFA screen were not measured. The login-route measurements alone do not satisfy the required matrix. |
| Staging performance | GOOD with scope limitation | On a synthetic Neon branch with 500 households and 5,940 dues, Chairman annual report + arrears service-layer median was 651.34 ms and slowest run 945.45 ms over five runs after one warm-up; no errors/timeouts. This does not include HTTP middleware or browser rendering. |
| Post-UAT financial/integrity checks | PASS | Launch Integrity 16/16 zero, Gate C 32/32 zero, Lifecycle 11/11 zero; active receipt, paid allocation, reversal, waiver, and NOT_DUE invariants all had zero anomalies. |
| Regression and exact-SHA CI | PASS on code SHA; final report commit pending | CI run `37295820362` passed Gate A, Launch Security Closure tests, and independent PostgreSQL concurrency on code SHA `7c56f273`. CI for the final report/evidence commit will be run after that commit and reported in the task completion record. |
| Dependencies | PASS for production / accepted development residual | `npm audit --omit=dev`: 0 vulnerabilities. Full audit reports five High dependency paths to one dev-only `braces@3.0.3` advisory, accepted as `RA-2026-F12-001`; not resolved. |

## Staging and backup identifiers

The staging Neon database is `karturt_f3_uat` on branch `br-morning-wind-b3tektlf` in project `wispy-sky-99637283` (`aws-ap-southeast-1`). The current Vercel deployment is a Ready Preview for `7c56f273` in the isolated `karturt-f3-staging` project. Evidence records identifiers and environment labels only; no connection strings or secret values are included.

The logical backup is custom format, 229,415 bytes, SHA-256 `032d2d0a876244d309d9f3adfecc1116b8988ee10a713b16fed866d31936499d`. It remains outside the repository. Restore verification used separate branch `br-small-frog-b35k2i5h` and database `karturt_f3_restore_verification`; the original staging and actual production resources were not restored into or changed.

## Blockers

1. **System Admin UAT:** The existing staging MFA factor is encrypted, and its TOTP source is not available from authorized local configuration. Vercel redacts the sensitive staging secret. Live post-fix recovery validation cannot be completed without a legitimate TOTP source.
2. **Responsive acceptance:** Required authenticated dashboard and MFA screens were not observed at the mandated viewports. Login-only measurements do not satisfy the full matrix.

## Findings and counts

Counts below are unique findings; five npm audit paths refer to the same accepted advisory.

| Classification | Count | Finding |
|---|---:|---|
| Blocker | 2 | Incomplete post-fix System Admin UAT; incomplete authenticated responsive matrix. |
| Critical | 0 | None found. |
| High | 1 accepted | `RA-2026-F12-001`, development-only `braces@3.0.3`; five dependency paths; production-only audit is clean. |
| Warning | 3 | Canceled Production-classified deployment in the isolated staging Vercel project; performance timing excludes HTTP/browser overhead; runtime model telemetry is unavailable for independent verification. |
| Nice-to-have | 0 | None recorded. |

## Model-policy evidence

Coordinator and worker assignment records specify GPT-6 Luna at the required reasoning efforts and state that Fast Mode was not enabled. The task runtime does not expose loaded-model or Fast Mode telemetry, so those assignments are attestations rather than independent runtime verification. No claim beyond that evidence is made.

## Stop boundary

`FASE 3 FAIL` / `PRODUCTION NO-GO`. Do not merge `feat/delivery-readiness-single-rt` to `main`, do not access or create production resources, do not start Production Pilot, and do not start Fase 4.
