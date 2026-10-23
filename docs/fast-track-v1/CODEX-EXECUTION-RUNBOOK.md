# Codex Coordinator — Long-Horizon Execution Runbook (F0–F4)

**Input:** owner-approved V1 Fast Track recorded in `MASTER-PLAN.md` and `OWNER-DECISION-AND-GATE-MATRIX.md` on branch `docs/fast-track-v1-f0-20261024`. Read actual HEAD/PRs/issues again before changing anything.  
**Parent tracker:** [#78](https://github.com/Satsetx4/karturt/issues/78) and phase issues [#79](https://github.com/Satsetx4/karturt/issues/79), [#80](https://github.com/Satsetx4/karturt/issues/80), [#81](https://github.com/Satsetx4/karturt/issues/81), [#82](https://github.com/Satsetx4/karturt/issues/82), [#83](https://github.com/Satsetx4/karturt/issues/83).

## Mission rules

- Use ONE coordinator from F0 through F4; create multiple independent agents/worktrees **only if actually available**. Parallel work does not override acceptance dependencies.
- No waiting for owner approval per routine safe task, no unrequested progress-only interruptions. Apply best effort continuously until F4 or a genuine gate blocks further dependent work; continue independent tasks on blocker.
- Do not assume previous screenshots, green CI or obsolete staged evidence match current release source. Actual quality gate must be proven on the exact candidate.
- Do not silently merge historical stacked PRs: #67/#73/#74 are old gate proposals and may remain deferred; #48/#55/#57/#18 may contain relevant billing work and require per-file analysis.
- Branches: isolated feature branches from a **verified integration base**. Do not write to `main` directly, don't rebase unrelated historical PR branches destructively. Use DRAFT PRs for changing code, documentation and CI.
- Produce source-of-truth status only after reading tool outputs and exact PR/CI statuses. If tools cannot launch Codex or browse account, report honestly; issue creation alone is not delegation/agent launch.
- This plan does not contain provider secrets; no secret in markdown, console, CI logs, comments or artifacts. Do not alter app GitHub App/ledger scope simply to green a status.

## Coordinator run loop

1. **Sync:** fetch latest protected `main` SHA; all open PR bases/heads/draft; CI job matrices; phase issue checkboxes; provider metadata via connected read-only APIs. Pin observed timestamp.
2. **Decompose:** choose independent tasks and assign ownership. If multi-agent platform is unavailable, process serially; do not simulate agents.
3. **Implement:** code only on dedicated branch; keep minimal diffs. Add focused negative tests for changed financial/security behaviors.
4. **Verify:** run package scripts from actual `package.json`: `lint`, `typecheck`, `test:unit`, `test:integration`, `test:constraints`, `test:authorization`, `test:security-closure`, `build`. Test additional migrations as needed. For real PG concurrency, run `test:postgres-concurrency` against an **approved isolated staging DB**, not fake PGlite as substitute.
5. **Review:** inspect PR and entire diff for permission escalation, hidden changes, secret leaks, migration changes and backwards compatibility; merge only with appropriate explicit authorization under protected branch policy.
6. **Record:** exact complete SHA, CI URL/run attempt, per-job PASS/FAIL/SKIPPED, test scope and sanitized evidence on issue. Mark phase PASS only when its DoD is proven.
7. **Advance:** begin next phase automatically when gate PASS; otherwise continue independent tasks, aggregate the exact blocker(s) into one owner-action packet.

## Suggested concurrent workstreams

| Workstream | Responsibility | First deliverable | Key stop condition |
|---|---|---|---|
| Coordinator/integration | #79 inventory, PR topology, policy issue supersession, status sync | Current main vs historical branch code delta and backlog | Unknown source branch or unapproved merge |
| App | #80 annual billing, cash allocation, receipts, role guard, mobile | V1 requirements matrix + source/test gap list | Product contract conflict or unsafe payment modification |
| DB/staging | #81 Neon Free project/branch/endpoint and proven staging isolation, Drizzle migrations | Read-only resource and migration head evidence | Shared prod/lineage UNKNOWN, credential ambiguity |
| QA/security | #80/#82 payment constraints, auth and real PG concurrency | Test matrix and negative assertions | Only mock test or concurrency SKIPPED |
| Release | #83 preview/recovery/rollback, exact SHA CI | Nonprod preview plan, release checklist | Production resources, paid service or missing F1–F3 PASS |

## Source PR integration strategy

- Prefer `main` as baseline for a clean release candidate, not an old stacked security prototype.
- Compare each relevant PR's changed files, commit range and business rules; cherry-pick or manually port only reviewed required changes with current tests. Avoid auto-merging stacked bases.
- Keep historical security PRs open/draft/deferred until owner explicitly chooses retention/closure. A successful Actions workflow on a DRAFT branch does not validate code on `main`.
- Document exactly which product fixes landed in integration PR and which historical PR heads were excluded.

## Phase priority and concurrency strategy

1. **F0 first:** current source inventory and authoritative backlog. At the same time App can perform read-only gap analysis and DB can inspect metadata (not connect/query SQL).
2. **F1 next:** integration and deterministic tests; DB can prepare migration-risk/metadata read-only evidence concurrently.
3. **F2 next:** only verified clean staging, scoped credential/owner authority, TLS PG18, migrations and fixtures. If blocked, App/QA/Release may still build safe fixtures/test logic but cannot claim F2/F3 live PASS.
4. **F3 next:** E2E + PostgreSQL concurrency with real staging and verified test provenance.
5. **F4 next:** exact candidate SHA CI + nonproduction preview + recovery drill + GO/NO-GO packet. **Stop before production**.

## Owner-action packet policy

Request human action only when necessary to proceed: scoped provider setup, authentication, protected secrets, restricted resource authorization or controlled merge. Bundle items into ONE clearly scoped packet:
- Resource exact owner/project/branch/environment; required action; why needed; least privileges; alternatives; maximum blast radius and rollback; forbidden side-effects; links and nonsecret proof.
- Never request owner paste credentials or code. Owner approval is not a substitute for technical evidence.
- Sensitive operation requiring separate platform consent remains STOP until granted even though the general F0–F4 mandate is approved.

## Status vocabulary / no fake green

- `PASS`: DoD satisfied on exact source/environment with cited evidence.
- `PARTIAL`: real progress but DoD unmet.
- `BLOCKED`: external or security gating with next precise action.
- `FAIL`: attempted gate failed; preserve immutable evidence; do not reinterpret as PASS.
- `DEFERRED`: deliberately moved out of V1; not a quality result.
- `NO-GO`: critical deployment blocked.

## Historical reading index

- [Single-RT scope freeze](../mvp-single-rt-scope-freeze.md) — single RT UI while keeping tenant security.
- [Staging UAT plan](../staging-uat-plan.md) — earlier role coverage; needs current environment revalidation.
- [Financial invariants](../gate-c-financial-invariants-report.md) — legacy tests/contract; reconcile new year/future-cash decisions.
- [Delivery readiness report](../delivery-readiness-report.md) and [backup/restore drill](../backup-restore-drill.md) — dated past proof, **not** exact current release readiness.
- [#72](https://github.com/Satsetx4/karturt/issues/72) old cloud-only planner and [#77](https://github.com/Satsetx4/karturt/issues/77) prior Viewer gate are preserved for audit but superseded for V1 critical path.

## Per-session report template

```text
KartuRT V1 Fast Track (timestamp, Asia/Jakarta)
main SHA / working source SHA / PR:
F0: ... evidence ...
F1: ... evidence ...
F2: ... evidence ...
F3: ... evidence ...
F4: ... evidence ...
Original six lanes:
1 Inventory & CI: ...
2 Legacy Solo Owner Gate: DEFERRED V1 (not PASS)
3 Staging Identity & Isolation: ...
4 PG18 readiness & migration: ...
5 Staging UAT / Release Candidate: ...
6 Preview & Production: ... (production NO-GO until explicit owner GO)
Changed branches, full SHA, CI runs and all SKIPPED:
Blocker / single next owner action if unavoidable:
Next permitted autonomous task:
```

**Exit:** F0–F4 PASS by evidence and exact candidate `PRODUCTION READY — AWAITING OWNER GO`. If platform permissions prevent reaching that state, accurately report remaining tasks and STOP only the restricted operation.
