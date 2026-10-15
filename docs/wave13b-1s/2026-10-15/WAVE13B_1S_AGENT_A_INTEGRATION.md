# Wave 13B.1S — Agent A Source Integration

## Hasil

Status: **INTEGRATED; FINAL-SHA GATES PASS**. Source dasar Wave13A.2 security `48b92abbe93fbd499448b6c885d3042cb49c2128`; source branch `codex/karturt-v1-rc-wave13b1s-20261015`; final SHA `193b25be6394db9196c22617e9b55b4427cf6f86`.

PR #23 and #48 already belong to the security source ancestry. PR #57 had six unique commits and diverged from that source, so its eight-file delta was reviewed and integrated through the two-parent merge `5fbe3dbc2c60659d6be711013a824024ae81c55`, with the security source as first parent and PR #57 head as second parent. The report aggregation and chairman report changes preserve the `yearlyOutstandingTiming` response alias and add the selected monthly-period behavior and UI from PR #57.

The RC diff from the security base changes 17 files: two workflow files, three CI identity helpers, the Phase 13 report-design document, report aggregation/export/UI/style code, and seven related unit/integration tests. It adds 963 lines and removes 140. Review covered current/prior/future Jakarta billing months, 12-month billing, oldest eligible cash-advance allocation through the selected month, receipt/reversal accounting, D5 reporting, auth/session/CSRF, role and RT isolation, and finance-cache exclusion.

## Source and workflow commits

| Commit | Change |
|---|---|
| `5fbe3dbc2c60659d6be711013a824024ae81c55` | Selective PR #57 integration; security base remains first parent. |
| `44e8c65ced38fc4b31cb492908e603efe2e8d2f3` | Initial exact RC alias admission to the CI guards. |
| `9cad8f899ca5178622f5858854b60572c94ac729` | Separate PG17 concurrency validation from PG18 service validation. |
| `193b25be6394db9196c22617e9b55b4427cf6f86` | Allowlist the exact RC Gate A ref and prior PG18 rehearsal ref; add guard tests. |

## Verification on final SHA

| Check | Result |
|---|---|
| Exact-SHA Gate A | PASS — [run 38678563048](https://github.com/Satsetx4/karturt/actions/runs/38678563048). |
| Independent PG17 concurrency | PASS in Gate A job `116239687016`; initializer and proof executed, not skipped. |
| Disposable PostgreSQL 18 rehearsal | PASS — [run 38678563005](https://github.com/Satsetx4/karturt/actions/runs/38678563005). |
| Independent local suite | PASS — 80 files / 580 tests; lint 0 errors and 2 existing warnings; typecheck, offline Drizzle checks, build, and diff check passed. |
| Protected migrations and guards | PASS — all 15 migration/journal blobs match the security base; both staging approval guards are unchanged. |

The initial exact-SHA rehearsal on an earlier integration commit failed closed before journal/fixture steps because the shared initializer applied the PG18 identity check to the PG17 concurrency service. The allowlist and validators were corrected on the source branch; the final exact-SHA Gate A/concurrency and PG18 runs both passed. No Neon staging database was used in these CI jobs.

## Publication

The source branch and verification alias `verify/karturt-v1-rc-wave13b1s-20261015` were pushed and read back at the same final SHA `193b25be6394db9196c22617e9b55b4427cf6f86`. No merge to `main` was performed.
