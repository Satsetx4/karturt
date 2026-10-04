# F12.2 Clean Integration Plan

**Status:** Execution contract for the clean Phase 12 integration checkpoint
**Date:** 2026-10-04
**Scope:** Integrate the already-tested F12 household-management work into a clean checkpoint. This is not a feature phase.

## Baseline verified before integration

| Reference | Expected and verified value |
|---|---|
| Repository | `Satsetx4/karturt` |
| Default branch | `main` |
| `main` | `ff9628b7fa178fb3c56ff3530adeb4719b9fe295` |
| F12 source branch | `feat/phase-12-household-management` at `b933cc9a279d91191d6d7fa8c76f6202fbb68da5` |
| F12.1 closure branch | `fix/phase-12-1-acceptance-closure` at `2b6a5bb228d8fd2b0f6a9eec3e218d8b7f85e20d` |
| Exact tested source | `414e08d1689e2a5775f3c34f4ca6fe7010fcf2c7` |
| F12.1 exact-HEAD CI | Run `37177673937`, success on `2b6a5bb...` |
| Open PRs | None at preflight |
| Development database | Neon `billowing-base-57949906` / `karturt-development` (`br-crimson-band-az6i637k`) / `neondb` |
| Development migration journal | 14 entries; latest hash `994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85`, mapped to `0013_phase_12_household_management` |
| Gate C financial checks | 32/32 zero in the live read-only audit |
| F12 lifecycle checks | 11/11 global anomalies zero in the live read-only audit |

The clean integration branch is created directly from the exact verified `main` SHA. The project default branch remains `main`.

## Why F12.1 history is not promoted directly

F12.1 contains 433 evidence artifacts: 12,930,864 bytes in committed Git blobs (12.33 MiB), or 12,947,409 bytes in the expanded worktree. This includes failed attempts, superseded screenshots, duplicate captures, temporary diagnostics, and fixture details. Its source and completed final evidence remain preserved on the historical F12.1 branch. The clean checkpoint uses a squash merge only to materialize the final tree, then curates the evidence before committing so main receives the tested product source and a compact, reviewable record.

Evidence curation is limited to `docs/phase-12-1-acceptance-evidence/` in the integration worktree. Keep reusable source, tests, scripts, migration metadata, final design/report documents, and current workflow behavior. Retain a small evidence set under `docs/phase-12-final-evidence/`, targeting about 10–20 files and below 2–3 MiB. The intended subset covers authenticated browser acceptance, PIN/session handling, household lifecycle and conflict behavior, Neon lifecycle and Gate C results, dependency audits, CI, and representative mobile/desktop screenshots.

## Risk acceptance boundary

The owner-approved risk acceptance is recorded as `RA-2026-F12-001` in `docs/security-risk-acceptance-f12-braces.md`.

It applies only to `GHSA-vfj7-8cjw-p6xm` / `CVE-2026-93687` in `braces@3.0.3`, reachable through the development-only lint-tooling chain `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. The advisory remains High and the condition remains `KNOWN / ACCEPTED RESIDUAL RISK`; it is not resolved or reclassified as safe. The acceptance does not waive any other High or Critical finding, any production/runtime dependency vulnerability, or any application, authentication, or credential defect. Production-only audit must remain at zero vulnerabilities.

## Required equivalence and gates

The integrated product tree must remain semantically and byte-for-byte equivalent to tested source `414e08d...` across `src/`, `drizzle/`, `tests/`, `scripts/`, `package.json`, and `package-lock.json`. The migration and journal remain at 0013, with no 0014. Differences are limited to curated evidence, integration/risk/final documentation, and the minimal Gate A trigger adjustment.

Run and record on the clean source: `npm ci`; lint; typecheck; unit, integration, constraints, authorization, and complete test suites; build; Drizzle checks; schema-drift check; full and production-only npm audits. The full audit may contain only the known propagated entries for RA-2026-F12-001; production-only audit must report zero. Any new High/Critical result is a stop condition.

Before promotion, repeat the read-only Neon development checks for 14 entries ending at 0013, the expected journal hash, zero lifecycle anomalies, and Gate C 32/32 zero. Production remains untouched. CI must pass on the exact clean integration commit.

## Workflow and promotion

Gate A retains its pull-request and manual triggers. Its push filter must include `integrate/f12-clean-checkpoint` and `main`; the temporary `fix/phase-12-1-acceptance-closure` push filter can then be removed. Preserve unrelated workflow triggers and filters.

Promote only by a normal fast-forward of `main` to the exact clean integration commit, after rechecking that `main` is still at the verified base, the clean branch is ahead by the expected checkpoint and behind by zero, all gates pass, and no new PR or commit has changed the target. Require CI success on that exact new `main` SHA. No force push, rebase, second squash, or unnecessary merge commit is allowed. Preserve both historical F12 branches.

## Stop and recovery rules

Stop before promotion if `main` moves or diverges, clean product behavior differs from tested source without a fresh authenticated browser acceptance, migration state changes beyond 0013, any Neon anomaly is nonzero, a new High/Critical appears, the production audit is nonzero, exact-checkpoint CI fails, production is touched, or any uncommitted/unpushed work is at risk. Do not start F13 implementation.

If exact-main CI fails after a successful fast-forward, stop and report the failure; do not start F13. Preserve the integration branch and evidence so the failed checkpoint is recoverable. Do not delete source branches or unrelated worktrees.
