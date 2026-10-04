# F12.2 — Clean Integration Checkpoint Report

**Date:** 2026-10-04
**Verdict:** **F12 PASS — accepted dev-tooling residual risk RA-2026-F12-001. Main integration PASS. Ready for F13 planning: YES. F13 implementation: NOT STARTED.**

## Integration result

- Repository: Satsetx4/karturt; default branch remains main.
- Main baseline before integration: ff9628b7fa178fb3c56ff3530adeb4719b9fe295.
- Clean checkpoint commit: a3b898707686cbf71b6b02dd195782c37ecf317b.
- Main was fast-forwarded directly from the baseline to that exact checkpoint SHA. No force push, rebase, merge commit, branch deletion, or GitHub merge was used.
- Test Gate A passed on the exact clean branch commit in [run 37181362310](https://github.com/Satsetx4/karturt/actions/runs/37181362310) and on the exact promoted main SHA in [run 37181930669](https://github.com/Satsetx4/karturt/actions/runs/37181930669).
- The F12 and F12.1 historical branches remain at b933cc9a279d91191d6d7fa8c76f6202fbb68da5 and 2b6a5bb228d8fd2b0f6a9eec3e218d8b7f85e20d respectively. No open PR was present at promotion.
- This report is a documentation-only follow-up after promotion; the checkpoint and both recorded CI runs identify the exact verified promotion event.

## Source equivalence and migration

The product tree in the clean checkpoint is byte-identical to tested F12.1 source 414e08d1689e2a5775f3c34f4ca6fe7010fcf2c7 for src, drizzle, tests, scripts, package.json, and package-lock.json.

- Product source difference from tested F12.1: NONE.
- Migration difference: NONE. SQL, snapshot, and journal entries are unchanged.
- Business logic difference: NONE.
- Migration head remains 0013_phase_12_household_management. The development journal has 14 entries and the expected 0013 hash is 994BCC9376B207FDC0668312CC68CAB3C2CEC46BC6101EDC4C2B5EF7F51C4A85. No 0014 exists or was applied.

## Quality gates

All requested local gates passed on the clean integration source: npm ci, lint, typecheck, unit tests (37), integration tests (153), constraint tests (42), authorization tests (89), full suite (321 tests across 54 files), production build, drizzle-kit check, and schema drift check (no schema changes).

The exact-commit branch and main CI runs above passed install, lint, typecheck, unit, integration/migration, constraints, authorization, full-suite, migration-journal consistency, schema drift, and production-build steps. CI annotations were non-blocking: an existing unused-variable warning in the browser smoke evidence helper, GitHub Actions Node.js 20 deprecation notices, and the announced ubuntu-latest migration date.

## Development database and financial integrity

Only the Neon development target was checked: project billowing-base-57949906, branch karturt-development / br-crimson-band-az6i637k, database neondb. The final pre-promotion checks were SELECT-only; no writes, DDL, migrations, or production access occurred.

- Migration journal: 14 entries ending at 0013; the live migration hash matched the expected LF-normalized 0013 hash.
- Fresh global lifecycle audit: 11/11 anomaly categories zero.
- Gate C: 32/32 financial anomaly categories zero.
- The 15/15 fixture checks are retained evidence from the earlier F12.1 post-smoke audit on this development target; they were not rerun during the final global read-only follow-up.
- Production database and deployments were untouched.

## Dependency audit and risk acceptance

- Full npm audit: 5 High entries, 0 Critical; all five entries propagate from the single accepted root advisory GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 affecting braces@3.0.3 in the development-only path eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces.
- Production-only npm audit: 0 vulnerabilities.
- Runtime High blockers: 0. Runtime Critical blockers: 0.
- [RA-2026-F12-001](security-risk-acceptance-f12-braces.md) remains KNOWN / ACCEPTED RESIDUAL RISK, NOT RESOLVED. Severity remains High. No speculative override or downgrade was applied. Acceptance is limited to this advisory and this development lint-tooling chain; it does not waive future or unrelated High findings, Critical findings, runtime/production vulnerabilities, application-code vulnerabilities, or authentication/credential defects.
- Review triggers and the patch-close process are recorded in the risk-acceptance document.

## Evidence curation

The raw F12.1 branch retains its full forensic history. The clean checkpoint excludes the superseded evidence subtree and keeps only the curated evidence in [phase-12-final-evidence/evidence-index.md](phase-12-final-evidence/evidence-index.md), including representative browser captures, audit outputs, Neon summaries, and exact-SHA CI metadata.

- Original evidence bundle: 433 files, 12,947,409 bytes.
- Curated checkpoint folder: 18 files, 388530 bytes.
- Excluded from this checkpoint: 415 files, 12558879 bytes.
- No source branch or historical evidence was deleted.

## Final disposition

**F12 PASS.** Authenticated browser acceptance is resolved; migration and financial integrity gates pass; production-only audit is clean; the single development-only High advisory is explicitly accepted as RA-2026-F12-001. The clean checkpoint is promoted to main and exact-head CI passed.

**Main integration: PASS. Gate C: 32/32 zero. Production audit: 0 vulnerabilities. Production untouched. Ready for F13 planning: YES. F13 implementation: NOT STARTED.**
