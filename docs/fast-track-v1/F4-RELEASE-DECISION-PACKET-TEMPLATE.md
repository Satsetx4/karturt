# KartuRT V1 Fast Track — F4 Release Decision Packet

> **Template only.** This file contains no release evidence until completed and reviewed. Keep every result tied to the exact source SHA and environment that produced it. Use `PASS`, `FAIL`, `UNKNOWN`, or `NOT RUN`; report skipped CI jobs as `SKIPPED` and never count them as PASS.

## 1. Candidate identity

| Field | Recorded value |
|---|---|
| Candidate PR(s) | TODO |
| Candidate full source SHA | TODO |
| Protected main full SHA | TODO |
| Candidate base SHA | TODO |
| Exact-head Gate A run ID and attempt | TODO |
| Gate A job conclusion | TODO |
| Independent PostgreSQL concurrency job and conclusion | TODO |
| Other required exact-head workflow jobs and conclusions | TODO |
| Independent reviewer, review SHA, and review scope | TODO |
| P0/P1/P2 review findings and disposition; unresolved P0/P1 count | TODO |
| Candidate changed migration files / expected journal head | TODO |
| Dependency audit, report, and remediation SHA | TODO |

## 2. F1 application acceptance

| Acceptance item | Status | Exact-SHA evidence |
|---|---|---|
| Twelve annual periods visible; future periods are upcoming and not overdue | TODO | TODO |
| Online requests accept only current and overdue periods, including server-side rejection | TODO | TODO |
| Treasurer can verify future cash; allocation is oldest-unpaid through target | TODO | TODO |
| Paid receipt has canonical amount and verification time in Asia/Jakarta | TODO | TODO |
| Resident, Treasurer, Chairman/Admin authorization and cross-tenant negatives | TODO | TODO |
| Retry, duplicate, reversal, and payment integrity checks | TODO | TODO |
| Mobile and desktop application smoke | TODO | TODO |

## 3. F2 staging identity, isolation, and recovery

| Evidence | Status | Exact resource, time, and evidence link |
|---|---|---|
| Neon project / branch / endpoint / database identity and Free plan | TODO | TODO |
| Independent proof of separation from production and synthetic-only lineage | TODO | TODO |
| Effective staging role and least-privilege evidence | TODO | TODO |
| PostgreSQL 18 client/server and validated TLS identity | TODO | TODO |
| Schema, Drizzle journal, migration inventory, and authorized result | TODO | TODO |
| Current-target synthetic backup and separate-target restore drill | TODO | TODO |
| Vercel Hobby plan and staging-only Preview project/environment | TODO | TODO |

## 4. F3 real staging UAT

| Scenario | Status | Candidate SHA, environment, verifier, time, and evidence link |
|---|---|---|
| Resident annual cards, due/future state, and paid receipts | TODO | TODO |
| Current/overdue online requests and future-period denial | TODO | TODO |
| Treasurer future cash, oldest-first allocation, and idempotent retry | TODO | TODO |
| Resident / Treasurer / Chairman / System Admin permissions and tenant denial | TODO | TODO |
| Duplicate payment, cancellation/reversal, and financial integrity checks | TODO | TODO |
| Real PostgreSQL 18 session concurrency on the approved staging lineage | TODO | TODO |
| Exact-SHA Preview HTTPS smoke at mobile, tablet, and desktop sizes | TODO | TODO |

## 5. F4 release and recovery

| Requirement | Status | Exact-SHA / environment evidence |
|---|---|---|
| Final release notes reviewed against the candidate diff | TODO | TODO |
| Exact-head CI and production build complete | TODO | TODO |
| Preview workflow run, attempt, and per-job conclusions | TODO | TODO |
| Preview deployment commit, environment classification, and smoke | TODO | TODO |
| Staging-only credentials used through protected settings; no production-scoped credentials or values exposed | TODO | TODO |
| Backup/restore and rollback path verified for the current target | TODO | TODO |
| Rollback deployment/resource and operator procedure | TODO | TODO |
| Release scope and migration compatibility review | TODO | TODO |

## 6. Open risks and limitations

| Risk / severity | Evidence | Mitigation | Residual risk / owner |
|---|---|---|---|
| TODO | TODO | TODO | TODO |

## 7. Verdict and owner decision

- **F1 verdict:** TODO
- **F2 verdict:** TODO
- **F3 verdict:** TODO
- **F4 verdict:** TODO
- **Overall release verdict:** `NO-GO` until all required F1–F4 evidence passes; then `PRODUCTION READY — AWAITING OWNER GO`.
- **Owner GO:** `NOT GIVEN` until the owner explicitly approves the exact candidate SHA and production environment.
- **Owner decision reference and timestamp:** TODO

An F1–F4 PASS does not deploy or authorize production mutation. Production deployment, credentials, data changes, and cutover require the separate owner GO for the recorded candidate and environment.

## Evidence handling

- Link sanitized evidence that identifies the exact SHA, job attempt, provider resource, environment, verifier, and time.
- Do not carry a PASS between source SHAs, provider resources, or environments.
- Never include secrets, connection strings, raw catalogs, or resident-identifying data.
- Keep historical failures and skipped checks visible; do not overwrite or relabel them as passing evidence.
