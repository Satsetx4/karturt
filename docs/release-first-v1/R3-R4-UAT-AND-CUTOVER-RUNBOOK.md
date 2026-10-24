# RELEASE FIRST V1 — R3 UAT and R4 cutover runbook

**Execution status: NOT RUN.** This is a bounded procedure, not evidence or authorization. R3 may start only after R2 is `PASS` for this exact release SHA and an app instance running that same SHA is authorized for staging UAT. That instance may be an owner-approved local HTTPS process with securely provisioned runtime credentials, or a Preview with separate exact-SHA deployment authorization. R2 or R3 authorization does not authorize a Preview deployment. R4 remains preparation only until its own gates pass.

## Evidence identity

Before each run, fill these fields in the release decision packet:

| Field | Required value |
|---|---|
| Candidate PR / branch / full SHA | Exact current candidate; no shortened SHA in the evidence record |
| CI run / attempt and required job IDs | Every required check must be for that same SHA |
| Staging project / branch / endpoint / database | `flat-cloud-57657711` / `br-sparkling-flower-azordm9k` / `ep-red-boat-azzqyf45` / `karturt_staging` |
| Database version / region / plan | Actual readback, including PostgreSQL 18 and Singapore; do not infer from project labels |
| App origin / exact app-instance SHA / mode / authorization reference | Owner-authorized staging app instance and confirmed staging-only environment |
| Effective app identity / TLS result | Runtime login identity, target, verified certificate and hostname, and encrypted session |
| Run time / timezone / executor / independent verifier | Named synthetic test aliases only; no account secrets or resident details |

If any identity, target, version, role, TLS, isolation, or authorization value is missing or differs, stop and mark the dependent rows `UNKNOWN` or `NOT RUN`.

## R3 entry gate and execution rules

- R2 must have a current `PASS` at the exact candidate SHA: authenticated effective runtime and migrator identities; least-privilege readback; verified driver TLS; official migrations `0000`–`0013`; synthetic-only target evidence; integrity and negative checks; and owner-confirmed recovery/reset basis.
- Use only the approved staging target and an app instance bound to the same SHA. A local HTTPS process must satisfy the app's staging origin requirements and use securely provisioned runtime credentials; a Preview requires separate exact-SHA deployment authorization. Record the app mode, origin, and authorization reference. Use synthetic accounts in separate clean browser profiles and a fixed business date recorded in the evidence.
- Exercise product flows through the app. Do not run SQL, DDL, direct database writes, legacy F2, data export, or cleanup as part of this runbook. Keep raw catalog and row contents owner-only. A separately authorized verifier may return only sanitized booleans, counts, aggregate amounts, and generated test IDs needed by the packet.
- Freeze the fixture ledger and expected outcomes before running the app flows. Calculate the independent financial oracle from that fixture ledger and the recorded operations, not from the app report being checked.
- Do not reset, delete, truncate, restore, or reseed the canonical target without a separate approval naming the exact target and action. Stop on any non-synthetic content, target drift, privilege drift, certificate failure, unexpected side effect, or unexplained result.

## Required scenario matrix

| ID | Scenario and steps | Required expected result | Negative-state and persistence checks |
|---|---|---|---|
| R3-AUTH | Sign in as synthetic Resident, Treasurer, Chairman, and System Admin in separate clean profiles. Complete the synthetic System Admin TOTP enrollment/challenge if no verified factor is ready; exercise each role's allowed core view/action; attempt cross-account and role-forbidden financial actions. | Allowed action succeeds for the intended role and tenant. System Admin login succeeds only after verified MFA. | Every denied action leaves financial and household business state unchanged; security/audit records may record the denial as designed. No cross-RT or other-household detail is returned, and the denied action does not escalate the session. Never capture or retain TOTP seeds or recovery codes in evidence. |
| R3-DUES | Inspect the full 12-period year. Use separate synthetic households for the current-target, overdue-target, and future-target cases, or finish/cancel each request before starting the next. From Resident flows, request current and overdue eligible targets, then attempt a future target. | All 12 periods render. Eligible current/overdue target periods are accepted; each request contains the eligible unpaid periods through its selected target. An unpaid future period remains upcoming and outside arrears. Future-period request is rejected server-side. | Rejected future request creates no request, claim, payment, or audit event. Report arrears exclude future unpaid dues; record the independent expected period/count/amount totals. |
| R3-TRANSFER | Verify a valid synthetic multi-period transfer as Treasurer; inspect each per-period receipt in the Resident view. | Exactly one canonical payment is recorded. Each receipt shows that period's allocation amount and verification time; the overall payment/request total equals the sum of its allocation amounts. | Record request, payment, allocation, and audit counts/IDs in sanitized form. No extra payment/allocation or cross-household effect. |
| R3-CASH | As Treasurer, record synthetic cash through a selected period that is in the future relative to the fixed business date. Prepare fixture periods containing older unpaid, paid, waived, and not-yet-due items. | Allocation is oldest-first across eligible unpaid periods through the selected target, skipping paid, waived, and not-yet-due periods. Payment total equals the sum of the allocations. | Compare ordered periods and amount sums with the frozen fixture oracle. Verify skipped periods remain unchanged and no duplicate payment, allocation, or audit event exists. |
| R3-RETRY | Retry an identical transfer request and cash operation with the same idempotency key; then reuse a key with changed payload. | Same key and same payload replays the existing outcome. Changed payload is rejected as a conflict. | One request/payment and one corresponding audit event only; no partial claims or duplicate allocations. |
| R3-REVERSAL | Reverse one synthetic payment through the app, then retry the reversal and inspect the period balances and reports. | One reversal is recorded. The retry is rejected as already reversed. Active received amounts and balances recalculate according to the reversal. | One reversal and one reversal audit event only; original history remains visible; no duplicate repayment or allocation is created. |
| R3-REPORT | Reconcile monthly, annual, arrears, and Treasurer totals against an independently prepared ledger from fixture amounts, due dates, adjustments/waivers, allocations, and reversals. | Every displayed total/count matches the independent oracle for the fixed business date. | Explicitly check future unpaid exclusion, reversed allocation exclusion, and the treatment of paid/waived periods. Save sanitized expected/actual aggregates and explain any rounding rule. |
| R3-RACE-REQUEST | Submit two Resident requests concurrently for the same eligible due row in the same synthetic household, using the same Resident account in independent application sessions and distinct idempotency keys. | One request wins; the conflicting submit is rejected safely. | Exactly one active request and one complete claim set exist. No partial claims, duplicate audit events, payment, or cross-account change. |
| R3-RACE-VERIFY | Use the same synthetic Treasurer account in two independent sessions to verify the same pending request concurrently against PostgreSQL 18. | One verification succeeds; the other returns the safe already-processed outcome. | Exactly one payment, the expected allocation set and amount, and one verification audit event persist. Due state and report totals agree with the oracle. |
| R3-RACE-CASH | Submit the same cash operation concurrently from two independent sessions for the same synthetic Treasurer account, household, target period, key, and payload. | One result is original and one is a replay of the same result. | One payment, one allocation set, and one cash audit event persist; totals match the fixture oracle. |
| R3-RACE-REVERSAL | Use the same synthetic Treasurer account in two independent sessions to attempt the same reversal concurrently. | One reversal succeeds; the other is rejected as already reversed. | Exactly one reversal row/event and no duplicate active repayment or allocation. |

For the four race cases, prove the requests overlapped, used separate application workers/pools, and reached separate PostgreSQL 18 backend sessions. A local setup must use two same-SHA app processes with distinguishable pool identities; two browser profiles against one process do not prove worker or pool separation. If that cannot be shown, mark the worker/session proof `UNVERIFIED`. A dedicated owner-controlled read-only verifier may report only sanitized `overlapObserved`, `lockWaitObserved`, `applicationWorkerDistinct`, `applicationPoolDistinct`, role/TLS/session-distinct booleans, generated test IDs, status values, counts, and aggregate amounts; it must use an approved identity, a read-only transaction, reviewed source bound to the candidate SHA, and an explicit target-scoped authorization reference. Do not expose raw rows/catalog data or add database triggers/functions to force contention. No such R3 verifier has been reviewed for this candidate yet; until one is included in exact-head CI and authorized for a run, mark persisted-state/session proof `UNVERIFIED` and do not claim an R3 race PASS.

## R3 evidence and stop rules

For every row, record: exact release SHA; Actions run ID and attempt; staging resource IDs and PG18 readback; app-instance SHA, mode, and origin; synthetic actor alias; fixed business date; expected and observed outcome; sanitized request/payment/allocation/reversal/audit counts and IDs; independent verifier; and evidence reference. Never include credentials, session tokens, real names, addresses, phone numbers, raw database rows, or uncurated screenshots.

Stop immediately and mark the affected case `FAIL` or `UNVERIFIED` if a negative action mutates state, a duplicate financial effect appears, a role crosses its boundary, the actual database is not PG18, sessions are not independent for a race, a report differs from the independent oracle, or any result cannot be tied to the exact SHA and target. A source-level/disposable PostgreSQL 17 concurrency PASS is not a substitute for these live PostgreSQL 18 cases.

## R4 proposed cutover plan — preparation only

Complete this section before asking for a separate production GO. It proposes steps but does not authorize Preview deployment, production access, merge, migration, or release.

| Cutover field | Proposed value / evidence |
|---|---|
| Release SHA and candidate PR | Exact full SHA and current PR state |
| Main/base SHA and exact-head CI | Protected base SHA plus run ID/attempt and required job conclusions |
| R1 / R2 / R3 verdicts | All `PASS` with evidence bound to this release SHA; otherwise `NO-GO` |
| Preview authorization / deployment | Conditional on separate approval; otherwise `NOT AUTHORIZED / NOT RUN`. If authorized, record reference, deployment ID, URL, SHA, and staging-only env identity |
| Preview smoke | Conditional on separate approval; otherwise `NOT AUTHORIZED / NOT RUN`. If authorized, record HTTPS certificate/hostname, authentication/authorization, payment/report core flows, and viewport results for 360–420px, tablet, and desktop |
| Proposed production target and action sequence | Exact project/environment, merge/deploy sequence, migration behavior, and expected user-visible impact; no production secret values |
| Operator / independent verifier | Named accountable operator and separate verifier |
| Stop conditions | Target/SHA drift, CI failure, auth/TLS/financial mismatch, non-synthetic leakage, unavailable recovery, or any unexpected mutation |
| Rollback trigger and steps | Known-good deployment/SHA, provider-supported rollback or disable step, verification checks, owner of each action |
| Database recovery basis | Current target-bound supported restore/reset path and evidence; do not assume code rollback undoes database writes |
| Cost and known exceptions | Current plan/usage evidence and bounded exceptions; do not claim an invoice total from plan metadata |
| Owner decision | `NOT GIVEN` until explicit approval names the exact production SHA, environment, and proposed action |

The existing `docs/backup-restore-drill.md` concerns a different, quarantined Neon project and is not evidence for the canonical RELEASE FIRST target. The older `docs/staging-uat-plan.md` is a historical Fase 3 plan, not this R3 run sheet. No historical, other-SHA, other-target, offline, or PG17 result fills a current R2–R4 evidence row. Only a Preview at this exact SHA with separate authorization may fill the R4 Preview rows.

The final verdict may read `PRODUCTION READY — AWAITING OWNER GO` only after all mandatory R1–R4 evidence passes at the exact release SHA and the proposed production action is reviewable. If Preview smoke lacks separate authorization, retain `NOT AUTHORIZED / NOT RUN`; the packet must explicitly classify it as optional for this release scope before claiming readiness. The production action itself remains locked until separate explicit owner authorization.
