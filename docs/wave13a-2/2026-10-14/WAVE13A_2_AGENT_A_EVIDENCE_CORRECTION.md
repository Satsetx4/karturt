# Wave 13A.2 Agent A: Migration Evidence Correction

Date: 2026-10-14
Result: **PASS — 15/15 migration-manifest entries verified at both source revisions**

## Scope

This check corrects the migration filename attribution in the Wave 13A.1 Agent C regression audit. It uses the immutable pre-remediation source baseline `1f6c71c75a3e1cf9400f6e14ea06f3a362bd8f57` and the Wave 13A.1 result source SHA `bb566ee432b5abf1905699c01ed70e9ed34624c0`. The docs branch started at `2dacec1f7865952c41b66e2a8113a50b14e7cbcd`.

No migration, Drizzle journal, source file, provider resource, or workflow was changed or queried in this work.

## Method

For each source SHA, the check read the path/hash entries from that exact commit's `src/db/migration-manifest.ts`, confirmed the path exists in that SHA's Git tree, retrieved the raw Git blob with `git cat-file blob <SHA>:<path>` into a Node `Buffer`, and computed SHA-256 over those bytes. Each result was compared to the manifest value at the same source SHA. This avoids Windows checkout line-ending conversion. The comparison covered 14 SQL files and `drizzle/meta/_journal.json`.

## Results

All 15 manifest entries exist in each source tree, and all 15 computed raw-blob hashes match each commit's manifest. The same hashes occur at the original baseline and the Wave 13A.1 result, so none of these 15 blobs changed between those source SHAs.

| Source path | Raw Git blob SHA-256 | 1f6c71c result | bb566ee result |
|---|---|---|---|
| `drizzle/0000_messy_menace.sql` | `22a2dc6d5834b3a491d929be3832e4a5194a3102931587f70920f00203fd527a` | MATCH | MATCH |
| `drizzle/0001_classy_ricochet.sql` | `6663de22b090fb66e008ef72959b54af857994b61e5347bffa0e6a99c791f161` | MATCH | MATCH |
| `drizzle/0002_monthly_due_period_guard.sql` | `fbccce0e1d134a1868ef0307599bde28bddff470887bd160b3a0913cd22a03a6` | MATCH | MATCH |
| `drizzle/0003_due_auth_audit_domain.sql` | `1349af24e1d094e0cc879181e57072d9bc880f2e0c4fda980a9acc934e05370f` | MATCH | MATCH |
| `drizzle/0004_phase_5_payment_request.sql` | `57c6c844673694fbe1fb0ccca89fb7de4b1ac4492b26656710fd4a8cd83368e2` | MATCH | MATCH |
| `drizzle/0005_phase_5_1_payment_request_items_immutable.sql` | `b72bd0c4ad4384d300029bbdb8eab4d80ef603e70b5262c6c5396ec0c0a4db67` | MATCH | MATCH |
| `drizzle/0006_phase_6_treasurer_payment_ledger.sql` | `b5bd5dd3fd5621e800a6ca66e8bc0bfbbe3b4905e7d42c0208c5e9167a553273` | MATCH | MATCH |
| `drizzle/0007_phase_7_reject_cancel.sql` | `66401840229155f0cfe85e3d2ebaf4eff93c10bf3c8c0d156ad782745ffb6d44` | MATCH | MATCH |
| `drizzle/0008_phase_7_1_post_resolution_lifecycle.sql` | `f5bb31f899b941c5417e71b8b4a6b28142bc74210487a967ef145d127428082f` | MATCH | MATCH |
| `drizzle/0009_phase_8_cash_payment.sql` | `1a2bacce06cedbbea3c2df755ae12d6f94cbef87d7fe340b5d9df35402ea2720` | MATCH | MATCH |
| `drizzle/0010_phase_9_payment_reversal.sql` | `bc58acabf918fd359613d1b039b4e466c0137f32c7a19f5e79660b14499ae0da` | MATCH | MATCH |
| `drizzle/0011_phase_10_waiver.sql` | `e0a6cd44b8b80f0b5398f7ff43d5a6249d3e0378b40d552fd3b040ce0a78ea77` | MATCH | MATCH |
| `drizzle/0012_phase_11_tariff_adjustment.sql` | `cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54` | MATCH | MATCH |
| `drizzle/0013_phase_12_household_management.sql` | `994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85` | MATCH | MATCH |
| `drizzle/meta/_journal.json` | `1e3ecdb836832da360aa944609287622da2188d06bfffdf4a16e8da18d341d5e` | MATCH | MATCH |

## Historical correction

At the docs base SHA above, `WAVE13A_1_AGENT_C_REGRESSION_AUDIT.md` had Git blob SHA-1 `51360ed23efe4ce81ee9f40aa8a0c65a7f8a5e29`. Its listed hash values matched the migration bytes, but it paired those values with 14 fabricated migration basenames. The old audit has been corrected on this new docs branch, with a provenance note; its prior blob and branch history are preserved. The dedicated errata records every old-to-correct path mapping.

## Validation and limits

- Exact-source manifest entries: 15 at each revision.
- Raw Git blob paths present: 15/15 at each revision.
- SHA-256 versus manifest: 15/15 match at `1f6c71c75a3e1cf9400f6e14ea06f3a362bd8f57` and 15/15 match at `bb566ee432b5abf1905699c01ed70e9ed34624c0`.
- Blob-content drift between those revisions: none among the 15 manifest entries.
- Automated test added: no. This task was a documentation-only correction; the exact Git-object comparison above directly checked every entry without changing source tests.
- No database connection, SQL query, provider mutation, migration, or workflow run was performed.
