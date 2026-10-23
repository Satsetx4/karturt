# KartuRT V1 Fast Track — Release Notes Draft

**Status:** Internal draft; not approved for publication or release
**Candidate:** PR #93, `b8bc74a4202225d9a54728d2c10be247dec8318f`
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
- A request that is already pending remains visibly pending on a future-period card; it is not presented as merely upcoming.

## Candidate evidence

- PR #93 is OPEN/DRAFT at exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`, based on protected main `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- Local full suite: 64/64 files and 411/411 tests passed. Focused resident-card tests: 20/20 passed. Typecheck, build, Drizzle journal/schema checks, constraints, authorization and security-closure checks passed. Lint had zero errors and one existing unrelated warning in `scripts/phase-12-household-browser-smoke.ts:1005`; `git diff --check` passed.
- Local browser smoke on this head passed at 360×800, 390×844, 768×1024, and 1440×900, with no horizontal overflow and 16px status text.
- Independent read-only review of the future-pending display fix found no P0/P1/P2 issues. Paid future cards remain paid; overdue and upcoming states retain their separate behavior.
- Exact-head Gate A run [#40040334501](https://github.com/Satsetx4/karturt/actions/runs/40040334501) is currently **IN_PROGRESS** at job #120709660348, integration/migration step. Lint, typecheck, and unit steps have passed; remaining steps are pending. The dependent disposable PostgreSQL concurrency job has not started. Update this evidence after the run completes; prior-SHA results do not transfer.
- The integrated candidate diff contains no migration file. Recheck the migration inventory against the final release candidate SHA.

## Release evidence still required

- Independently verified staging identity, synthetic-only lineage, scoped role, TLS certificate validation, and PostgreSQL 18 session evidence.
- Approved staging migration and recovery evidence, if required after the final migration inventory.
- Real staging E2E, role and tenant negative cases, retries, reversals, receipts, mobile smoke, and independent PostgreSQL 18 concurrency.
- Confirmed Neon Free and Vercel Hobby plans, a staging-only Preview project, deployment bound to the final candidate SHA, and Preview smoke evidence.
- A current-target backup/restore drill, dependency review, exact-head release CI, and a tested rollback path.
- A completed F4 decision packet and separate owner GO for the exact production candidate and environment.

Until these items are evidenced, the release verdict is **NO-GO**. Production deployment, production credentials, and cutover are not authorized by this draft.
