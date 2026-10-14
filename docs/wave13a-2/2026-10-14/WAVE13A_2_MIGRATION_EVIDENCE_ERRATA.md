# Wave 13A.2 Migration Evidence Errata

Date: 2026-10-14
Scope: correction to the migration path list in the Wave 13A.1 Agent C regression audit.

## Provenance

The corrected docs branch is based on `2dacec1f7865952c41b66e2a8113a50b14e7cbcd`. At that revision, the prior audit file `docs/wave13a-1/2026-10-14/WAVE13A_1_AGENT_C_REGRESSION_AUDIT.md` had Git blob SHA-1 `51360ed23efe4ce81ee9f40aa8a0c65a7f8a5e29`. That SHA identifies the original document content, before this correction; the old commit and blob remain in Git history.

The prior audit correctly described hashing raw Git blobs and reported 15 entries. However, its 14 SQL basenames were fabricated and did not exist in the source tree. The SHA-256 values were valid values for the actual files at the stated source baseline; their filename attributions were wrong. This correction preserves the historic record and makes the filename correction explicit. The corrected Agent C report and Agent A verification include the new path list and the exact 15/15 results.

## Corrected SQL paths

| Prior audit basename | Actual source-tree path |
|---|---|
| `0000_early_blossom.sql` | `drizzle/0000_messy_menace.sql` |
| `0001_tan_nerd.sql` | `drizzle/0001_classy_ricochet.sql` |
| `0002_woozy_lucy.sql` | `drizzle/0002_monthly_due_period_guard.sql` |
| `0003_sharp_karolina_dean.sql` | `drizzle/0003_due_auth_audit_domain.sql` |
| `0004_fluffy_kang.sql` | `drizzle/0004_phase_5_payment_request.sql` |
| `0005_materialized_terminator.sql` | `drizzle/0005_phase_5_1_payment_request_items_immutable.sql` |
| `0006_ordinary_kalani.sql` | `drizzle/0006_phase_6_treasurer_payment_ledger.sql` |
| `0007_nebulous_zed.sql` | `drizzle/0007_phase_7_reject_cancel.sql` |
| `0008_busy_mohawk.sql` | `drizzle/0008_phase_7_1_post_resolution_lifecycle.sql` |
| `0009_slim_diana.sql` | `drizzle/0009_phase_8_cash_payment.sql` |
| `0010_tidy_hank.sql` | `drizzle/0010_phase_9_payment_reversal.sql` |
| `0011_cozy_traveler.sql` | `drizzle/0011_phase_10_waiver.sql` |
| `0012_military_corgi.sql` | `drizzle/0012_phase_11_tariff_adjustment.sql` |
| `0013_puzzled_ella.sql` | `drizzle/0013_phase_12_household_management.sql` |

The unchanged fifteenth entry is `drizzle/meta/_journal.json`.

## Verification record

The exact paths and manifest hashes were independently checked against the Git trees and manifests at source SHA `1f6c71c75a3e1cf9400f6e14ea06f3a362bd8f57` and source SHA `bb566ee432b5abf1905699c01ed70e9ed34624c0`. All 15 paths exist and all 15 raw-blob SHA-256 values match the manifest at both revisions; each blob hash is identical between the two revisions. The complete per-path hash table and byte-level method are in `WAVE13A_2_AGENT_A_EVIDENCE_CORRECTION.md`.

No migration SQL or journal was edited. No live database, Neon resource, or deployment provider was queried or changed.
