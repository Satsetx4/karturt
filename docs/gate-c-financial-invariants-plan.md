# KartuRT TEST GATE C — Financial Invariants Plan

Status: verification-only gate; no feature implementation or product hardening is permitted on this branch.

Repo: `Satsetx4/karturt`  
Working branch: `verify/gate-c-financial-invariants`  
Baseline branch: `feat/phase-11-tariff-adjustment`  
Baseline / F11 final HEAD: `8fcbcf77bc06c8d0966a4d1db6fe86fa018df1a8`  
F11 final CI: run `37057834512`, conclusion `success` on that exact HEAD  
Migration head: `0012_phase_11_tariff_adjustment`; migration `0013` is forbidden.

## Frozen baseline evidence

- The remote F11 ref resolves to the exact baseline SHA above.
- The Gate C worktree starts at that SHA and is clean before this plan is added. The original F9 checkout and its untracked evidence remain untouched.
- The checked-in Drizzle journal ends at `0012_phase_11_tariff_adjustment`.
- Neon project `billowing-base-57949906`, development branch `karturt-development` (`br-crimson-band-az6i637k`), database `neondb` is the only permitted live development target. Its branch is `ready`; its migration journal contains 13 entries and final hash `cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54`, matching F11. Production branch `br-patient-band-azznfh28` is outside scope and must not receive writes, migrations, fixtures, or smoke tests.
- Neon development history contains retained synthetic financial fixtures from previous gates. Do not delete or rewrite them. Any new approved development HTTP smoke must retain financial fixtures and clean only temporary auth/session artifacts as its existing harness permits.

## Gate purpose and boundaries

Prove the F5–F11 financial invariants against independent arithmetic, PGlite tests, direct SQL aggregates, read models, existing regression suites, controlled Neon development reads/smokes, and final-HEAD CI. This is not F12 Household Management or a product phase.

Allowed changes: new tests, read-only verification scripts/harnesses, evidence, and Gate C plan/report documentation. A broken test harness may be corrected within its owned verification files. Do not change `src/`, UI features, financial business rules/services, schema, Drizzle definitions, migrations, or migration journal. Do not create `0013`. Do not merge to a default branch or touch Neon production.

If any Critical/High product-source defect is found, stop product-side verification, record the exact counterexample and reproduction, classify Gate C `FAIL / NO-GO`, and recommend a separate hardening branch such as `fix/phase-11-1-gate-c-financial-hardening`. Do not repair it here. Medium defects affecting financial correctness/integrity also force NO-GO. Low/evidence gaps can be fixed only in tests/docs/harnesses.

## Frozen independent manual dataset

All values are whole rupiah. Each row is one due; the counts below must not depend on invoking the application balance helper.

| Period | Original | Adjustment | Receipt history | Active received | Expected outstanding | Expected state |
|---|---:|---:|---|---:|---:|---|
| Jan | 40,000 | 0 | active payment 40,000 | 40,000 | 0 | PAID |
| Feb | 40,000 | +10,000 | active 40,000, then after the adjustment active 10,000 | 50,000 | 0 | PAID |
| Mar | 50,000 | -10,000 | active payment 40,000 | 40,000 | 0 | PAID |
| Apr | 40,000 | 0 | none | 0 | 40,000 | UNPAID |
| May | 40,000 | 0 | active pending request and claim; no payment | 0 | 40,000 | UNPAID in storage, derived PENDING in resident view |
| Jun | 40,000 | 0 | valid waiver action/item/audit; no active receipt | 0 | excluded | WAIVED, excluded from collectible target |
| Jul | 0 | 0 | none | 0 | excluded | NOT_DUE |
| Aug | 40,000 | +10,000 | historical active payment 40,000, then adjustment +10,000, then that payment is reversed | 0 | 50,000 | UNPAID |

Feb's two active payments represent successive full-balance settlements: 40,000 closes the original balance; the +10,000 adjustment opens a new balance; the second payment closes it. August retains the reversed payment/allocation history while excluding it from active received.

Manual totals:

```text
original/potential obligation = 40,000 + 40,000 + 50,000 + 40,000 + 40,000 + 40,000 + 0 + 40,000 = 290,000
waived original = 40,000
original payable = 290,000 - 40,000 = 250,000
positive adjustments = 10,000 + 10,000 = 20,000
negative adjustments = -10,000
collectible effective target = 250,000 + 20,000 - 10,000 = 260,000
active received = 40,000 + 50,000 + 40,000 = 130,000
outstanding = 260,000 - 130,000 = 130,000 (Apr 40,000 + May 40,000 + Aug 50,000)
```

The balance-oracle test must compare (1) these constants and per-period expectations, (2) an independently authored SQL aggregation over the test database, and (3) the application read model. Any variation required by fixture constraints must preserve this exact arithmetic/status meaning and be disclosed here and in the final report before the test is accepted.

## Work ownership and subagent checkpoints

Coordinator owns the baseline/contract, this plan, the integration review, `docs/gate-c-financial-invariants-report.md`, severity decisions, final quality gates, push, and CI verdict.

| Owner | Files | Required evidence |
|---|---|---|
| A — Balance oracle | `tests/integration/gate-c-balance-oracle.test.ts` | Manual constants vs independent SQL vs read model; each due's balance/state; reversal exclusion; received never above effective target. |
| B — Request lifecycle | `tests/integration/gate-c-request-invariants.test.ts` | Derived pending, immutable full-outstanding snapshots, claim cleanup, terminal-history behavior, verified-payment cardinality, pending adjustment exclusion. |
| C — Payment ledger | `tests/constraints/gate-c-payment-ledger.test.ts` | Payment/allocation/ownership scope and sums, unique allocation, reversal ownership, direct DB adversarial rollback/state constraints. |
| D — Exclusions/history | `tests/constraints/gate-c-exclusion-history.test.ts` | WAIVED/NOT_DUE invariants and tariff/payment/request/due/adjustment/waiver history immutability. |
| E — Authorization/audit/tenant | `tests/authorization/gate-c-financial-actors.test.ts` | Action audit semantics, actor-role matrix, System Admin exclusion, RT/account exclusivity, household debt ownership. |
| F — Races and global audit | `tests/integration/gate-c-races.test.ts`, `scripts/gate-c-financial-invariants-neon.ts` | Contended operations finish in one valid serial state; reusable, exact-count, read-only Neon development anomaly audit guarded to the development target. |

Subagents may only edit their owned test/script files and may read source/tests/docs to understand the contract. They must not alter product files, migration/schema files, shared fixtures, package scripts, or each other's files. Report source/product bugs immediately with exact evidence; do not mask them in assertions or amend business logic. Coordinator resolves any need to touch an existing shared harness.

## Execution and acceptance sequence

1. Freeze baseline and the dataset above before accepting agent work.
2. Add only owned Gate C tests and the reusable read-only Neon global audit. Tests must include an independent oracle; do not trust only `getDueFinancialBalances()` or an existing suite written alongside the feature.
3. Run targeted Gate C tests; inspect every failure. Stop on Critical/High product-source defect.
4. Run PGlite constraint, rollback, adversarial, and concurrency coverage. Direct history mutation attacks belong in rollback-protected test databases/transactions; do not issue destructive Neon SQL.
5. Run the Neon anomaly audit read-only against only the exact development project/branch/database. Every requested anomaly count must be present and zero; include enough query detail to reproduce. Run a Neon real PostgreSQL business-flow/browser smoke only with existing guarded development harnesses after preflight verifies the branch, environment, and migration head. Preserve financial history/fixtures. Production remains read-only existence/state check only and is not needed to pass the dev gate.
6. Smoke the resident derived states at 390x844 and 1440x900 where a controlled existing development fixture allows, recording only what was actually observed. Do not redesign UI.
7. Run the required lint, typecheck, unit, integration, constraints, authorization, full suite, build, Drizzle journal check, and schema drift check. Record each command/result and final migration head.
8. Confirm the final diff contains only allowed verification files, migration head remains 0012, and no product changes exist. Commit and push `verify/gate-c-financial-invariants`; wait for GitHub Actions on the final HEAD itself and report its exact SHA/run/conclusion.
9. Write the final report with the invariant matrix, arithmetic, counts, evidence layers, defects/severity, residual gaps, and exactly one verdict string required by the request.

## Pass rule

PASS requires the independent manual oracle, application read model, and direct SQL to match; every global anomaly count is zero; no pending drift, orphan/over-allocation, or invalid state exists; histories are immutable; authorization/audit/tenant rules and race outcomes are valid; PGlite and live Neon development evidence pass; the final migration remains 0012; final-HEAD CI passes; and Critical/High blockers are zero. Any unperformed required layer or nonzero anomaly is an evidence gap and prevents PASS until resolved.