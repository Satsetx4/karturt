# KartuRT V1 Fast Track — Release Notes Draft

**Status:** Internal draft; not approved for publication or release  
**Candidate:** PR #93, `48b21ad3d208c983584fb32618254c9599297c07`  
**Base:** protected `main`, `96c84588ae0c13f68a17cffd997a3e583fb7da82`  
**Decision target:** `PRODUCTION READY — AWAITING OWNER GO`, only after F1–F4 evidence passes

This draft describes the application changes in the current integrated F1 candidate. PR #93 remains OPEN/DRAFT and unmerged. These notes are a candidate-diff summary, not evidence of staging readiness, production approval, or deployment.

## Candidate changes

- Residents can review the twelve billing periods for the year. Future periods are presented as upcoming and are excluded from overdue balances.
- Online payment requests are limited to current and overdue periods, with the server enforcing the future-period restriction.
- Paid monthly cards include a compact receipt showing the recorded amount and treasurer verification time in Asia/Jakarta.
- Chairman reports distinguish amounts due from unpaid future periods so future dues do not inflate arrears.
- Treasurer cash settlement supports a future target period and allocates from the oldest unpaid period through that target, preserving the existing transaction and idempotency safeguards.
- Regression coverage exercises authorization, tenant scoping, receipt behavior, payment retries, cash allocation, and report calculations.

## Candidate evidence recorded at this SHA

- Exact-head Gate A run [#40019070722](https://github.com/Satsetx4/karturt/actions/runs/40019070722): SUCCESS. Its Gate A verification and disposable PostgreSQL 17 concurrency jobs both passed on the candidate SHA.
- The candidate PR records a local production build, typecheck, lint, focused billing tests, and browser smoke at 360×800, 390×844, 768×1024, and 1440×900 as passing.
- The disposable PostgreSQL 17 result is regression evidence. It does not establish PostgreSQL 18 staging concurrency or F3 completion.
- PR #93’s changed-file list contains application, workflow, and test files; it contains no migration file. Recheck the migration inventory against the final release candidate SHA.

## Release evidence still required

- Independently verified staging identity, synthetic-only lineage, scoped role, TLS certificate validation, and PostgreSQL 18 session evidence.
- Approved staging migration and recovery evidence, if required after the final migration inventory.
- Real staging E2E, role and tenant negative cases, retries, reversals, receipts, mobile smoke, and independent PostgreSQL 18 concurrency.
- Verified Neon Free and Vercel Hobby plans, a staging-only Preview project, deployment bound to the final candidate SHA, and Preview smoke evidence.
- A current-target backup/restore drill, dependency review, exact-head release CI, and a tested rollback path.
- A completed F4 decision packet and separate owner GO for the exact production candidate and environment.

Until these items are evidenced, the release verdict is **NO-GO**. Production deployment, production credentials, and cutover are not authorized by this draft.
