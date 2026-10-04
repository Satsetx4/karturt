# F12.1 — Acceptance Closure / Hardening Report

**Date:** 2026-10-04 (Asia/Bangkok)
**Verdict:** **F12 FAIL — F13 NO-GO — remaining blocker: the full dependency audit still reports an unpatched High finding in the development toolchain (`braces@3.0.3`).**

F12.1 closed the authenticated browser acceptance gap and confirmed post-smoke development database integrity. It did not expand the product phase. The remaining High finding keeps the frozen F12 acceptance contract at FAIL, even though the production-only dependency audit is clean.

## Scope and source

- Repository: `Satsetx4/karturt`
- Baseline branch and exact SHA: `feat/phase-12-household-management` / `b933cc9a279d91191d6d7fa8c76f6202fbb68da5`
- Baseline CI: GitHub Actions run [37109800025](https://github.com/Satsetx4/karturt/actions/runs/37109800025) passed on that exact baseline SHA.
- F12.1 branch: `fix/phase-12-1-acceptance-closure`
- Final tested application/source SHA: `414e08d1689e2a5775f3c34f4ca6fe7010fcf2c7`
- `main` remained at `ff9628b7fa178fb3c56ff3530adeb4719b9fe295`; the F12.1 branch was not merged, and no PR was created.
- The branch adds only acceptance harnesses/evidence, the exact workflow branch filter, and a small household-page touch-target adjustment. Product scope and billing rules were not expanded.

## Migration and Neon target

All Neon checks used the non-primary development branch only:

- Project: `billowing-base-57949906`
- Branch: `karturt-development` / `br-crimson-band-az6i637k`
- Database: `neondb`
- Direct endpoint ID: `ep-quiet-cake-azrhjiyh`
- Read-only Neon branch metadata confirmed the project/branch IDs and that the branch is not primary/default.
- Migration journal: 14 entries, latest `0013_phase_12_household_management`; no `0014` was created or applied.
- Expected and observed 0013 migration hash: `994BCC9376B207FDC0668312CC68CAB3C2CEC46BC6101EDC4C2B5EF7F51C4A85`.
- Lifecycle audit ran in a read-only transaction; Gate C was SELECT-only. Production was not queried or changed.

## Authenticated browser acceptance

The reusable harness `scripts/phase-12-household-browser-smoke.ts` passed on the exact tested source SHA. The final runs were core `f3089aa7-713f-47c9-83a3-f6b3e80215f4` and lifecycle `751bc046-b7d0-49f7-b1d2-80a73600ae9f`. Evidence and screenshots are indexed in `docs/phase-12-1-acceptance-evidence/agent-a-final-414e08d/evidence-index.json`.

- Chairman authentication, `/app/rumah`, list/search, add household/resident, resident edit, PIN reset, and deactivation passed.
- PIN/session proof: the resident session worked before reset and returned 401 after reset; active sessions went 1→0; old PIN returned 401 and new PIN returned 200. Exactly one `resident.pin.reset` audit was recorded. No PIN, password, token, or hash appeared in evidence.
- Same-house replacement at the next-month boundary passed: the old household became inactive and the new one active; the old resident account was disabled; old session/API/PIN access was rejected; arrears remained with the old household; one untouched future due became `NOT_DUE`; the new household had no inherited financial history and its same-house login succeeded with exactly one current resident login.
- Interacted post-end due conflict returned 409. The lifecycle operation made no partial change: sessions remained 0→0, lifecycle audit events 0→0, and the financial row remained 1→1 with a matching content fingerprint.
- Deactivation returned 200, disabled the account, revoked the active session (1→0), and invalidated the old API session.
- Treasurer household management and PIN reset were denied with 403; cross-RT access returned a generic 404. No raw SQL/internal error or credential leakage was shown.
- Viewports covered 360×800, 390×844, 430×900, 768×1024, and 1440×900. All five list-size checks and 60 form/confirmation checks reported no horizontal overflow or actionable target under 44px. The evidence set contains 22 screenshots, including 390×844 and 1440×900 states.
- An earlier harness attempt returned a safe 409 because it had not selected the form's “new house” option. The tracked harness was corrected to select that option; final runs passed. The original attempts and normalized manifest are preserved in the evidence directory.

## Post-smoke database integrity and Gate C

The read-only lifecycle audit passed after the final browser mutations:

- 11/11 global household/auth/ledger anomaly checks were zero.
- 15/15 replacement/conflict fixture integrity checks were zero.
- Old household due rows stayed at 12; 11 due snapshots were preserved and the one untouched future due was handled as expected. The new household had 11 pre-start dues with 0 invalid rows.
- Conflict proof found no session, audit, or financial-content change.
- Official Gate C passed with 32/32 anomaly categories at zero and the exact expected 0013 hash.
- Targeted F5–F12 regression reruns passed: 7 groups, 28 files, 181 tests. The full suite also passed on this source SHA.

Read-only evidence:

- `docs/phase-12-1-acceptance-evidence/neon-final/post-smoke-lifecycle-audit-414e08d-rerun-2.json`
- `docs/phase-12-1-acceptance-evidence/neon-final/gate-c-financial-invariants-414e08d-rerun-3.json`
- `docs/phase-12-1-acceptance-evidence/neon-final/neon-final-summary-414e08d-rerun-3.json`
- `docs/phase-12-1-acceptance-evidence/regression-reruns-414e08d/regression-rerun-summary-414e08d.json`

## Local quality gates

All requested local gates passed on `414e08d1689e2a5775f3c34f4ca6fe7010fcf2c7`.

| Gate | Result |
|---|---|
| `npm run lint` | PASS, one unused-variable warning in the browser smoke evidence helper |
| `npm run typecheck` | PASS |
| `npm run test:unit -- --maxWorkers=1` | PASS, 37 tests |
| `npm run test:integration -- --maxWorkers=1` | PASS, 153 tests |
| `npm run test:constraints -- --maxWorkers=1` | PASS, 42 tests |
| `npm run test:authorization -- --maxWorkers=1` | PASS, 89 tests |
| `npm test -- --maxWorkers=1` | PASS, 54 files / 321 tests |
| `npm run build` | PASS |
| `npx drizzle-kit check` | PASS |
| Schema drift generation check | PASS, no schema changes |
| GitHub Actions Test Gate A | PASS — [run 37177247556](https://github.com/Satsetx4/karturt/actions/runs/37177247556), exact source SHA `414e08d1689e2a5775f3c34f4ca6fe7010fcf2c7` |

Detailed local logs are under `docs/phase-12-1-acceptance-evidence/local-gates-final-414e08d/`; the sanitized exact-SHA Actions result is `docs/phase-12-1-acceptance-evidence/ci/final-source-414e08d.json`.

## Dependency audit and findings

The full audit remains the sole acceptance blocker:

- `npm audit --json`: **5 High, 0 Critical** (one underlying advisory repeated through the dependency graph).
- Vulnerable path: `eslint-config-next@16.3.6 → @next/eslint-plugin-next@16.3.6 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`.
- `npm audit --omit=dev --json`: **0 vulnerabilities**.
- `npm outdated`: 11 packages reported.
- Fresh upstream version/advisory checks found no patched `braces` release. [GitHub Advisory Database GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) currently marks versions `<=3.0.3` High and lists no patched version.
- No package or lockfile changes, speculative override, or major downgrade was made.

This is a development lint-toolchain finding; the production-only audit is clean. The frozen F12 contract requires zero High findings in the full audit, so the clean production-only audit does not close this blocker.

## Residual data and safety boundaries

The read-only inventory found one earlier partial synthetic QA seed containing one house, one active household, one person, and one admin account, with no resident account or financial rows. It was left in place; no database cleanup or destructive operation was performed. Other QA fixtures used for the smoke remain in development for traceability. Production, `main`, and F13 were untouched.

All 185 JSON evidence files parse successfully. A text-artifact secret scan found no database credential URI, bearer token, or literal PIN/password/token/hash value; a test-only URL placeholder in a superseded metadata note was redacted before staging.

## Final verdict

**F12 FAIL — F13 NO-GO — remaining blocker: the full dependency audit still reports an unpatched High finding in the development dependency chain (`braces@3.0.3`).**

Browser acceptance and database integrity are closed. F12 can be reconsidered only after the full dependency audit has no High blocker or the user explicitly changes the acceptance policy. No merge, promotion, or F13 work is authorized by this report.
