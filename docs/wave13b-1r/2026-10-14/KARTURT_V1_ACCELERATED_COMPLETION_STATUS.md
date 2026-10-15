# KartuRT V1 — Accelerated Completion Status

Date: 2026-10-15

Status: **IN PROGRESS — source work and offline evidence continue; staging and release are blocked by explicit gates.**

## Product target

V1 is one operational RT. All 12 calendar months remain visible. Future unpaid months are “Belum jatuh tempo” and excluded from current arrears/due-now classification. Residents may request transfer for current or past dues only. Authorized Treasurer cash advances allocate oldest eligible unpaid dues through the selected target. A paid month exposes a scoped per-month receipt from the active, reversal-safe ledger.

## Current source candidate and verification

- PR #48, `fix/v1-post-demo-billing-20261012`, exact head `12539d83b8537d845015a2b0030d47162dae0203`, remains OPEN/DRAFT and stacked on OPEN/DRAFT PR #23. No merge occurred.
- Exact-head GitHub Actions run `38225424975`: Gate A passed and the independent PostgreSQL concurrency job passed five race scenarios.
- Report-fix PR #57 is OPEN/DRAFT on `codex/v1-d5-report-arrears-20261014`, based on the exact PR #48 head. Exact source SHA: `ddb9689b34ea3ee1373ee328952c279544758c15`. No merge occurred. GitHub Actions Gate A run `38671423539` passed on that exact SHA, including lint, typecheck, unit/integration/security/full tests, migration/schema checks, and production build. The separate independent PostgreSQL concurrency job in the same run was **skipped** by its branch allowlist; do not treat other-SHA concurrency evidence as proof for this commit.
- Local final-source checks: full suite passed **67 files / 436 tests**; production build and typecheck passed; lint passed with 0 errors and 2 existing warnings; `git diff --check` passed. Independent review passed.
- The report fix uses Jakarta year-month arrears boundaries: on 2026-10-12, September is arrears, October is current-month unpaid, and November/December are future. It reconciles monthly, yearly, and household arrears counts/balances, visibly distinguishes months without generated dues, and compares the D5 report with direct SQL over the same seeded PGlite ledger.
- Separate acceptance tests on PR #57 cover the D5 due-now/future/annual position, one-payment December cash advance, same-month receipt/reversal cases, and the September-pending/November-cash chronology. The local full suite and exact-SHA Gate A full-suite job both passed; no staging or provider evidence is implied.

## Release and staging gates

| Gate | Current state | Evidence needed to advance |
|---|---|---|
| Source integration | PR #48/#23 and report-fix PR #57 open/draft; no merge; exact-SHA Gate A passed, PostgreSQL concurrency job skipped | Keep PR #57 unmerged pending separate owner decision; if concurrency proof is required, run it against this exact SHA |
| D1v2 Neon catalog preflight | **One exact run owner-approved; not executed — access/safety blocked** | psql client, verified CA, owner-only local credential path, approved privilege/object baseline, and fresh non-waking target identity check |
| Staging isolation | **Blocked** | Positive independent lineage and content evidence proving isolated empty/synthetic-only data; the current `parent-data` metadata, zero tracked writes, and bounded catalog result are insufficient |
| Migration authorization | **Blocked** | Exact final source SHA and 15 migration hashes, owner key ceremony and verified public-key pin, plus one-time Ed25519 approval bound to exact target/source/migration within 15 minutes |
| Staging network/security | **Blocked** | Reviewed least-privilege migration/runtime/human roles and evidenced network restriction; current branch is unprotected and public connections are not blocked |
| Rp0/no-overage | **Unproven** | Current account-level usage/headroom and no-overage controls; Free/Hobby labels alone are insufficient |
| Protected Preview and runtime QA | **Not ready** | Safe isolated staging schema, exact-SHA protected READY Preview, tenant-negative deny, billing/report/receipt regression, accessible/mobile and privacy review |
| Owner devices | **Not started** | Owner Android and iPhone acceptance after protected staging is genuinely ready |
| Production/rollout | **NO-GO** | Separate owner production GO after source, provider, budget, operational and recovery evidence; no GO is implied by this document |

## Current execution evidence

- The frozen 26-statement D1v2 reference matches blob SHA-1 `e011f0e843d42d53c7c4c76ba479854644137fc9`; ordered manifest SHA-256 is `ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0`. Its psql behavior passed on disposable PostgreSQL 18.6 in run `38586768128` at separate SHA `1bdf371bb3d18265af2bb82602882b8ad93a5139`. This is not Neon evidence.
- On 2026-10-15, Ard approved one psql single-transaction execution of those exact 26 statements against the fixed target, including one possible endpoint wake. The approval is recorded in the [D1v2 owner packet](WAVE13B_1R_D1V2_OWNER_APPROVAL_PACKET.md); no SQL was executed because psql, trusted CA, secure local credential path, approved expected-state baseline, and fresh target revalidation were unavailable.
- Current-wave metadata matched the approved Neon org/project/branch/compute/database/role tuple without waking the endpoint. No SQL, credential read, wake, migration, or provider mutation occurred.
- The only Vercel project returned by the connected readback was the unlinked staging project `karturt-review-staging-20261012`, SSO-protected, with zero deployments. This does not resolve the separate legacy main-to-production trigger risk.
- No new project/resource, paid tier, purchase, deployment, merge, or production/data action was performed. Incremental spend: **Rp0**.
- Vercel read-only deployment lookup for the PR branch returned zero deployments on `karturt-review-staging-20261012`; no Preview or production deployment was initiated.

## Next work

1. Keep PR #57 draft/unmerged pending a separate owner release decision. Gate A passed on the exact source SHA; the independent PostgreSQL concurrency job was skipped by the current branch filter.
2. Make the exact local D1v2 prerequisites available for the already-approved one-run preflight; see the [next-gate packet](WAVE13B_1R_NEXT_GATE_PACKET.md). No secret should be shared in chat.
3. Continue offline code/security/release readiness while preserving `stagingIsolationVerifiedEmpty=false` and the unpinned migration public key.
4. Never fall back to the old staging target or Neon MCP SQL tools, and do not treat source tests or catalog output as migration or release approval.
