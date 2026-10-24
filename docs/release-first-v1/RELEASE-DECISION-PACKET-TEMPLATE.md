# KartuRT RELEASE FIRST V1 — Release Decision Packet

> Template only. Complete it after R2 and R3 evidence exists. Keep every result tied to the exact release SHA and environment. Use `PASS`, `FAIL`, `UNKNOWN`, `UNVERIFIED`, or `NOT RUN`; a skipped job is `SKIPPED`, never `PASS`.

## Candidate identity and CI

| Field | Recorded value |
|---|---|
| Candidate PR and branch | TODO |
| Exact release SHA | TODO |
| Protected main SHA and candidate base SHA | TODO |
| GitHub Actions run ID and attempt | TODO |
| Gate A job and conclusion | TODO |
| Independent concurrency job, database version, and conclusion | TODO |
| Other required job conclusions | TODO |
| Review scope, reviewer, reviewed SHA, and open P0/P1 findings | TODO |
| Migration inventory and expected Drizzle journal head | TODO |

Gate A, local PostgreSQL, and disposable PostgreSQL 17 results describe source/CI evidence only. They do not establish staging PostgreSQL 18 readiness.

## R1 — Candidate application

| Requirement | Status | Exact-SHA evidence |
|---|---|---|
| Twelve annual dues periods; future periods remain upcoming and outside arrears | TODO | TODO |
| Online requests accept current/overdue periods and reject future periods server-side | TODO | TODO |
| Treasurer cash allocation is oldest-unpaid through the selected target period | TODO | TODO |
| Receipts show canonical amount and verification time | TODO | TODO |
| Resident, Treasurer, Chairman, and System Admin authorization and cross-tenant denials | TODO | TODO |
| Retry, duplicate, reversal, and payment integrity behavior | TODO | TODO |

## R2 — PostgreSQL 18 staging

| Evidence | Status | Target-bound result and reference |
|---|---|---|
| Project, branch, endpoint, database, region, Free plan, and PostgreSQL 18 | TODO | TODO |
| Production-independent target and synthetic-only content classification | TODO | TODO |
| Runtime and migrator effective identities, role flags, grants, and negative checks | TODO | TODO |
| Client TLS encryption with verified peer certificate and hostname | TODO | TODO |
| Official Drizzle migrations `0000`–`0013` under the effective migrator identity | TODO | TODO |
| Synthetic fixtures and schema/financial integrity checks | TODO | TODO |
| Recovery/reset basis available on the verified plan | TODO | TODO |

Do not infer isolation from project labels, an empty table listing, or `init_source=parent-data` alone. Do not expose raw catalog data or credentials in this packet. Record sanitized checks and exact resource identifiers.

## R3 — Real staging UAT and concurrency

| Scenario | Status | Expected vs actual, negative-state check, verifier, and evidence |
|---|---|---|
| Resident / Treasurer / Chairman / System Admin access and cross-account denial | TODO | TODO |
| Twelve periods, future-period arrears exclusion, and future-request denial | TODO | TODO |
| Transfer verification, canonical receipt amount/time, and cash oldest-first allocation | TODO | TODO |
| Retry idempotency, reversal, and report reconciliation against an independent oracle | TODO | TODO |
| Conflicting concurrent submits against the approved live PostgreSQL 18 staging target | TODO | TODO |
| No duplicate payment/allocation/reversal and no unauthorized state change | TODO | TODO |

Record the candidate SHA, database target/version, test identity, expected result, observed result, and sanitized evidence for every scenario. Offline and PG17 concurrency results cannot fill the live PG18 row.

## R4 — Preview, rollback, and release decision

| Requirement | Status | Exact-SHA / environment evidence |
|---|---|---|
| Nonproduction Preview separately authorized and bound to the exact release SHA | TODO | TODO |
| HTTPS and mobile/tablet/desktop smoke at 360–420px, tablet, and desktop | TODO | TODO |
| Staging-only credentials and environment classification verified | TODO | TODO |
| Previous known-good Preview deployment and SHA recorded, or first-use recovery path documented | TODO | TODO |
| Database reset/restore procedure is target-bound, available on-plan, and validated | TODO | TODO |
| Rollback triggers, operator steps, and post-rollback checks recorded | TODO | TODO |
| Cost evidence and known exceptions recorded without unsupported $0 claims | TODO | TODO |

Do not assume application rollback reverses database writes. Never run destructive down migrations or in-place restores without separate approval naming the exact staging target and action. If the target is first-use, document its synthetic-only disposable reset path and authorization before writes. Keep the existing production environment, credentials, domain, and deployment outside this packet's execution scope.

### Recovery order — plan only until validated

1. Before any Preview deployment or staging write, record the approved target, candidate SHA, and known-good Preview deployment/SHA. If there is no previous deployment, mark this as first use and record the approved way to disable or reset that nonproduction deployment.
2. For an application-only failure with no database change, stop UAT and return the Preview to the recorded known-good nonproduction deployment using a provider-supported rollback that has been verified for the selected plan. Recheck HTTPS, login, authorization, and payment/report smoke before resuming.
3. For a migration, data, or integrity failure, stop database writes and preserve sanitized evidence. Do not assume a code rollback undoes database changes; do not run a down migration or in-place restore. Use only a verified Free-plan recovery point and a disposable staging-only restore target. A new branch/target or destructive reset requires separate owner approval naming that exact resource and action.
4. Compare the recovered target's Drizzle journal and independent payment/allocation/report invariants with the recorded pre-failure expectations. Record the target ID, release SHA, recovery action, verifier, and exact post-recovery checks before reopening UAT.
5. If there is no supported Free-plan recovery point, no known-good Preview, or no approved target for a reset, keep the release at `NO-GO` and stop. Do not upgrade the plan or silently substitute another project.

The procedure above is not evidence that rollback is available or has been tested. Mark recovery `UNKNOWN` until the selected plan, target, and restore/reset path have current evidence.

## Verdict

- R1: `TODO`
- R2: `TODO`
- R3: `TODO`
- R4: `TODO`
- Overall: `NO-GO` until every required R1–R4 item has current exact-SHA evidence; only then `PRODUCTION READY — AWAITING OWNER GO`.
- Separate production GO: `NOT GIVEN` until the owner approves the exact production SHA, environment, and proposed action.
- Owner decision reference and timestamp: `TODO`

Keep historical failures and skipped checks visible. Never transfer a result between source SHAs, provider resources, PostgreSQL versions, or environments.
