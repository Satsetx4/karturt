# Fase 3 — Delivery Readiness Report

**Formal verdict: FASE 3 PASS — PRODUCTION READY — READY FOR PILOT**

**Branch:** `feat/delivery-readiness-single-rt`

**Verified main baseline:** `ef9b6efacea01e996aec43f6eeb1429b4e86044e`

**Product code commit reviewed:** `1e976f667d5fcbbacc80fed2a0bf6935c8946359`

**Operational scope:** SINGLE-RT

**Date:** 2026-10-05

## Decision

All Fase 3 staging readiness gates passed on the isolated SINGLE-RT deployment. Resident, Treasurer, Chairman, and System Admin UAT passed; all required authenticated screens passed responsive acceptance at the five mandated viewports; backup/restore and the post-cleanup financial integrity audit passed; and temporary staging passwords, PINs, and active sessions were revoked. Final evidence-commit CI passed on the exact branch SHA. Its run ID and SHA are reported in task completion rather than recorded in a recursive evidence commit.

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
| System Admin UAT | PASS | On Ready staging deployment `dpl_NaACmdTai4S2MCH4foEpUG4fXyWX` at SHA `1e976f6`, Admin 02 recovered Admin 01 with HTTP 200 and revoked one target session; Admin 01 re-enrolled TOTP and regained access. Self-recovery 403, unverified-admin 401, financial mutation 403, and malformed recovery reference 400 all matched expectations. |
| Temporary credential cleanup | PASS | Rotated 2 official and 2 System Admin passwords, reset all 6 synthetic Resident PINs through the Chairman service, revoked 5 sessions, verified 0 remaining sessions and invalidated old credentials, removed temporary local credential keys, and redacted the one-time admin credential file. |
| Responsive acceptance | PASS | On current HTTPS Preview SHA `1e976f6`, Resident card/dues, Treasurer queue, Chairman household management, Chairman report/arrears, public login, MFA, and System Admin screens were measured at 360x800, 390x844, 430x900, 768x1024, and 1440x900. No horizontal overflow, clipped currency, off-viewport controls, overlapping actions, or rendered interactive targets below 44 px were observed. The household screen rendered 11 synthetic households; report year 2027 rendered 118 currency values and a zero-overdue summary. |
| Staging performance | GOOD with scope limitation | The measurement comes from source checkpoint `a81ea65897efd178c7ecf49eab1bc550b2905b0a`, on a synthetic Neon branch with 500 households and 5,940 dues. Chairman annual report + arrears service-layer median was 651.34 ms and slowest run 945.45 ms over five runs after one warm-up; no errors/timeouts. This does not include HTTP middleware or browser rendering. |
| Post-UAT financial/integrity checks | PASS | Fresh staging-only `REPEATABLE READ READ ONLY` audit after credential cleanup on SHA `1e976f6`: Launch Integrity 16/16 zero, Gate C 32/32 zero, Lifecycle 11/11 zero; active receipt, paid allocation, reversal, waiver, and NOT_DUE invariants all had zero anomalies. Migration remains 0013. |
| Regression and exact-SHA CI | PASS | Code SHA CI `37325026328` passed Gate A, Launch Security Closure tests, full suite, build/schema checks, and independent PostgreSQL concurrency. Exact final evidence-commit CI also passed; its run ID and exact SHA are recorded in task completion to avoid a recursive evidence-only commit. |
| Dependencies | PASS for production / accepted development residual | `npm audit --omit=dev`: 0 vulnerabilities. Full audit reports five High dependency paths to one dev-only `braces@3.0.3` advisory, accepted as `RA-2026-F12-001`; not resolved. |

## Staging and backup identifiers

The staging Neon database is `karturt_f3_uat` on branch `br-morning-wind-b3tektlf` in project `wispy-sky-99637283` (`aws-ap-southeast-1`). The current Vercel deployment `dpl_NaACmdTai4S2MCH4foEpUG4fXyWX` is a Ready HTTPS Preview for `1e976f6` in isolated project `karturt-f3-staging`. Evidence records safe identifiers only; no connection strings or secret values are included.

The logical backup is custom format, 229,415 bytes, SHA-256 `032d2d0a876244d309d9f3adfecc1116b8988ee10a713b16fed866d31936499d`. It remains outside the repository. Restore verification used separate branch `br-small-frog-b35k2i5h` and database `karturt_f3_restore_verification`; the original staging and actual production resources were not restored into or changed.

## Blockers

None.

## Findings and counts

Counts below are unique findings; five npm audit paths refer to the same accepted advisory.

| Classification | Count | Finding |
|---|---:|---|
| Blocker | 0 | None. |
| Critical | 0 | None found. |
| High | 1 accepted | `RA-2026-F12-001`, development-only `braces@3.0.3`; five dependency paths; production-only audit is clean. |
| Warning | 3 | Canceled Production-classified deployment in the isolated staging Vercel project; performance timing excludes HTTP/browser overhead; runtime model telemetry is unavailable for independent verification. |
| Nice-to-have | 0 | None recorded. |

## Model-policy evidence

Coordinator and worker assignment records specify GPT-6 Luna at the required reasoning efforts and state that Fast Mode was not enabled. The task runtime does not expose loaded-model or Fast Mode telemetry, so those assignments are attestations rather than independent runtime verification. No claim beyond that evidence is made.

## Stop boundary

`FASE 3 PASS` / `PRODUCTION READY` / `READY FOR PILOT`. Stop here. Do not merge `feat/delivery-readiness-single-rt` to `main`, do not access or create production resources, do not start Production Pilot, and do not start Fase 4.
