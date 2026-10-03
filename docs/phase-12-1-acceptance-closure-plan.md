# F12.1 — Acceptance Closure / Hardening Plan

**Status:** acceptance contract frozen before agent execution
**Date:** 2026-10-04 (Asia/Bangkok)
**Scope:** close only the two acceptance blockers recorded by F12. This is not a feature phase and does not authorize F13 work.

## Baseline and preflight

- Repository: Satsetx4/karturt
- Exact source branch and commit: feat/phase-12-household-management at b933cc9a279d91191d6d7fa8c76f6202fbb68da5
- F12 baseline CI: GitHub Actions run 37109800025, completed successfully on the exact SHA above.
- main remains ff9628b7fa178fb3c56ff3530adeb4719b9fe295.
- F12 reports F12 FAIL / F13 NO-GO; its two open blockers are authenticated household-flow acceptance and the High development-dependency finding.
- The original F12 worktree has a tracked, uncommitted edit to docs/phase-12-household-management-report.md that adds partial authenticated login evidence. That edit has been left untouched. F12.1 is a separate clean worktree created from the exact baseline commit; no uncommitted changes were copied into it.
- Neon preflight was read-only against project billowing-base-57949906, branch karturt-development (br-crimson-band-az6i637k), database neondb. The journal has 14 entries and the final 0013_phase_12_household_management entry matches hash 994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85.
- The official Gate C Neon audit ran read-only against that exact development branch and returned 32/32 zero. The F12.1 worktree lacks .env, so the existing local development configuration was loaded only into the audit process after the harness validated the exact project, branch, and endpoint. No credential was printed, copied, or written into the worktree. Production was not queried or changed.

## Frozen blockers

1. **Authenticated F12 household/browser smoke is incomplete.** Complete real authenticated flows using disposable synthetic RT, Chairman, Treasurer, and resident fixtures in Neon development. Capture HTTP/API and browser outcomes, screenshots, and post-smoke database integrity evidence.
2. **Full dependency audit reports one High finding in the development dependency chain.** Investigate current upstream fixes, record full and production-only audits plus outdated packages, and apply only a minimal compatible remediation if an upstream fix exists. Do not use npm audit fix --force, speculative overrides, or major-version downgrades. If the High finding remains unpatched upstream, preserve F12 FAIL.

## Hard boundaries

- Migration head remains 0013_phase_12_household_management; do not create or apply 0014 silently. If an in-scope acceptance defect cannot be fixed without 0014, stop before applying it and report the evidence.
- Use only the named Neon development project/branch/database. Do not query or write production.
- Use synthetic disposable QA identities. Never use private user credentials, and never persist or log PINs, passwords, tokens, hashes, or database connection strings.
- Do not merge to main, promote, deploy, or begin F13. A push only to the named F12.1 branch is allowed if needed to run GitHub Actions; do not force-push.
- Do not expand product scope or change frozen billing/household business rules. No Reports, Export, Official Lifecycle, prorating, or generic System Admin household editor.

## Work assignments and sequence

| Role | Assignment |
|---|---|
| Coordinator | Own baseline, this contract, branch integration, scope control, final verdict, and uncommitted-work preservation. |
| Agent A | Build/reuse scripts/phase-12-household-browser-smoke.ts; run authenticated HTTP/browser cases and viewport checks; save evidence in docs/phase-12-1-acceptance-evidence/. |
| Agent B | Run/save npm audit --json, npm audit --omit=dev --json, and npm outdated; trace exact vulnerable paths; identify and, if available, apply a minimal compatible upstream remediation. |
| Agent C | After Agent A's mutations, run read-only Neon lifecycle/auth/ledger anomaly checks, rerun Gate C 32/32, and relevant F5–F12 regression suites. |
| Agent D | On the integrated final head, assemble evidence/report updates, run final quality gates, and verify GitHub Actions on the exact final SHA. Coordinator may perform this role if concurrency requires it. |

Agent A's required authenticated cases:

- Chairman login, /app/rumah, list/search, add household/resident, edit resident, reset PIN, and deactivate.
- PIN/session proof: resident old-PIN login, Chairman reset, prior session invalidation, old PIN rejected, new PIN accepted, exactly one resident.pin.reset audit, and no secret/hash/token leakage.
- Same-house replacement at the next-month boundary: old household inactive; former resident and sessions disabled/revoked; arrears remain with the old household; future untouched dues become NOT_DUE; new household/person/account created; same-house login resolves to the new resident; no inherited debt; former resident cannot authenticate.
- Conflict protection for a post-end due with payment/request/waiver/adjustment interaction: operation safely rejected, no partial lifecycle mutation, and financial history unchanged.
- Treasurer management/reset denial and generic cross-RT denial where practical.
- Viewports 360×800, 390×844, 430×900, 768×1024, and 1440×900; no horizontal overflow, touch targets at least 44px, and loading/error/success/confirmation/double-submit behavior checked. Save key screenshots at 390×844 and 1440×900. Report raw internal errors or secret leakage as failures.

## PASS / FAIL criteria

F12 may PASS only if all items below are demonstrated on the final branch head:

1. All authenticated acceptance scenarios above pass with reusable harness and reviewable evidence; no secrets are logged or stored.
2. Post-smoke Neon development audit confirms journal still has 14 entries ending at 0013, all specified household/auth anomaly checks are zero, no financial rows were reassigned, and no interacted post-end due was rewritten.
3. The official Gate C audit returns 32/32 anomaly categories at zero after smoke.
4. The full dependency audit has no High blocker. A clean production-only audit alone does not close the blocker.
5. All requested final quality gates pass: lint, typecheck, unit, integration, constraints, authorization, full test suite, build, Drizzle check, schema drift, both npm audits, browser smoke, Neon lifecycle audit, Gate C, and GitHub Actions on the exact final SHA.
6. No Critical or High finding remains, and residual risks are explicit.

If either blocker remains, or any mandatory gate fails/unverified, the final verdict must be F12 FAIL — F13 NO-GO — remaining blocker: ... . If every criterion passes, the final verdict must be F12 PASS — GO MERGE/PROMOTE TO MAIN — GO F13 PLANNING. A PASS verdict does not authorize merge or F13 execution.

## Evidence and reporting

- Preserve run outputs and screenshots under docs/phase-12-1-acceptance-evidence/; sanitize before saving.
- Create docs/phase-12-1-acceptance-closure-report.md and update docs/phase-12-household-management-report.md without deleting prior history. Clearly label results as F12.1 closure evidence and record exact baseline/final SHAs, migration head, audit result, all gates, residual risks, findings, and verdict.
- Run git diff --check before closeout. Creating, committing, and pushing changes only on the named F12.1 branch is authorized as needed for exact-head CI evidence; do not force-push. Do not merge to main, deploy, promote, or begin F13.
