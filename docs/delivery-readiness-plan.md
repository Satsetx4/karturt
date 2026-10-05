# Fase 3 — Delivery Readiness Plan

## Purpose and scope

Prove delivery readiness before a possible production pilot. This phase does not authorize production work, merge to main, or Production Pilot/Fase 4. Operational scope remains SINGLE-RT. Preserve internal rt_unit_id isolation and representative security coverage; do not add or test multi-RT selection, switching, onboarding, admin UI, or browser UAT.

## Verified baseline (2026-10-05, Asia/Bangkok)

- Repository: Satsetx4/karturt.
- Freshly fetched origin/main: ef9b6efacea01e996aec43f6eeb1429b4e86044e.
- Exact main CI: Test Gate A run 37245140380, completed successfully on that exact SHA: https://github.com/Satsetx4/karturt/actions/runs/37245140380
- Migration inventory: 14 files, 0000–0013; Drizzle journal has 14 entries and head 0013_phase_12_household_management.
- Fase 2 CLOSED and Launch Safety PASS are baseline assertions supplied by the user.
- No conflicting Fase 3 branch, worktree, or pull request was found at preflight.
- Branch feat/delivery-readiness-single-rt was created from the exact verified main SHA in a separate worktree. Existing untracked evidence in the original checkout was preserved.

## Agent policy

Every Codex agent and sub-agent must use GPT-6 Luna; Fast Mode is never enabled. Use the reasoning levels assigned in the delegation: coordinator and backup/restore Maximum; isolation, UAT and performance High; fixture and regression/evidence Medium. Escalate financial correctness, recovery, environment crossing, root cause and production-readiness decisions to Maximum.

## Execution gates

1. Isolate staging database, deployment, URL and auth secret from development and production; require HTTPS and matching staging labels.
2. Bootstrap only checked-in migrations 0000–0013 on empty/controlled staging. Require 14 journal entries, db:check, Drizzle consistency and no schema drift. Stop if migration 0014 is needed.
3. Create exactly one synthetic RT fixture with representative roles and financial/lifecycle states.
4. Back up staging and restore only to a disposable verification database. Compare safe aggregate counts for all required entities; run migration, integrity, Gate C, lifecycle, F13 oracle and synthetic-login checks.
5. Perform Resident, Treasurer, Chairman and System Admin UAT on the real staging deployment, including negative authorization checks.
6. Verify representative screens at 360×800, 390×844, 430×900, 768×1024 and 1440×900.
7. Remeasure Chairman annual report and arrears on staging PostgreSQL with about 500 households and 6,000 annual dues: one warm-up plus at least five runs. Median under 2s is GOOD; 2–5s is WARNING/acceptable; over 5s or timeout/crash is FAIL.
8. After all UAT mutations, rerun Launch Integrity 16/16, Gate C 32/32 and Lifecycle 11/11 with zero anomalies and reconcile payment/due/waiver/NOT_DUE states.
9. Run all requested quality, regression, build, schema and dependency gates on the final branch; ensure exact-SHA CI includes Gate A and independent PostgreSQL concurrency.

## Stop rules and evidence

Only localized fixes that do not alter financial, role, schema or architecture models are allowed. A broad security/permission fix, financial redesign, schema change, migration 0014, or major performance work stops F3 with a remediation proposal. Store sanitized evidence under docs/delivery-readiness-evidence/. Never record secrets, connection strings, credentials, auth artifacts, password hashes or real resident PII. Keep the evidence set curated to roughly 15–25 files and under 3 MiB.

Required companion documents are docs/staging-uat-plan.md, docs/backup-restore-drill.md and docs/delivery-readiness-report.md. F3 passes only when every user-defined exit criterion passes and production remains untouched. Otherwise report FASE 3 FAIL / PRODUCTION NO-GO with concrete blockers. After final evidence, commit/push and exact-SHA CI, stop; do not merge or start Fase 4.
