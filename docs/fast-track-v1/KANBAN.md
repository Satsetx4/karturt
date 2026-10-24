# Fast Track KartuRT V1 — Kanban / Task control

**Snapshot date:** 2026-10-24 Asia/Bangkok. **Coordination source:** [master issue #78](https://github.com/Satsetx4/karturt/issues/78); phase issues #79–#83. **Planning PR #84:** OPEN/DRAFT and unmerged. This issue-based snapshot is not a native GitHub Projects board. Issue comments hold later audit evidence.

## F0–F4 phase status

| State | Phase | Current candidate and exact evidence | Gate |
|---|---|---|---|
| PASS — planning/read-only baseline only | F0 Coordinator, [#79](https://github.com/Satsetx4/karturt/issues/79) | PR #84 was OPEN/DRAFT at completed snapshot head `49f85548822037fa275981c9c55f40411e995723`. Exact run [#40071389616](https://github.com/Satsetx4/karturt/actions/runs/40071389616), attempt 1: Gate A #120805387307 SUCCESS; docs-branch PostgreSQL concurrency #120807161914 SKIPPED. This Kanban status refresh creates a new source SHA; use its own exact-head check recorded on PR #84 and issue #79 without transferring this run. | Source map and read-only baseline are complete; the skipped docs job is not candidate concurrency evidence. |
| PASS — integrated candidate only | F1 App + QA, [#80](https://github.com/Satsetx4/karturt/issues/80) | PR #93 is OPEN/DRAFT at `b8bc74a4202225d9a54728d2c10be247dec8318f`; exact run #40040334501 Gate A #120709660348 and disposable PostgreSQL 17 concurrency #120712264849 SUCCESS. Prior future-month guard PR #85 is retained as history; its behavior is included in #93. | Historical product PRs #18/#20/#21/#23/#48/#55/#56/#57 were reconciled without blanket merge. Live paid-row allocations remain UNKNOWN. No protected-main merge. |
| BLOCKED before database access | F2 Staging identity/isolation, [#81](https://github.com/Satsetx4/karturt/issues/81) | PR #94 is OPEN/DRAFT at `711eb80e73ec733173306a0aa50e1e6966ecb9d7`; exact Gate A #40069661571 / job #120800163236 SUCCESS; independent concurrency #120801284254 SKIPPED. Independent review found no new P0–P2 findings. New Neon project `steep-heart-48842733` is PG18 Singapore; root `br-royal-grass-azyozaxi` still reports `init_source=parent-data` and no parent ID. Project metadata reports effective permission ADMIN, public connections unblocked, and an empty IP allowlist. No DB session, SQL, migration, or seed. |
| BLOCKED — offline rehearsal only | F3 Staging E2E/UAT, [#82](https://github.com/Satsetx4/karturt/issues/82) | PR #96 is OPEN/DRAFT at `477a0fe199debec67de071376d9338f956f9dc79`; exact run #40070054841 attempt 1 completed SUCCESS: Gate A #120801347072 and disposable PostgreSQL 17 concurrency #120803138389 both SUCCESS. Focused tests 14/14 PASS; plan prints 21 scenarios; exact-head review found no P0–P2. These are offline/candidate checks only. Real PG18 staging roles, payment/retry/concurrency UAT, and HTTPS Preview smoke remain NOT RUN. |
| NO-GO | F4 Release, [#83](https://github.com/Satsetx4/karturt/issues/83) | PR #95 is OPEN/DRAFT at `5ac931b48efb781d3e7a10b1a360496beabbbafe`, based on PR #93 at `b8bc74a4202225d9a54728d2c10be247dec8318f`. Exact run #40071118229 attempt 1 completed SUCCESS: Gate A #120804565777 and disposable PostgreSQL 17 concurrency #120805614522 both SUCCESS. Independent review confirms no remaining stale SHA/CI attribution. | No verified staging target, branch-bound Preview, HTTPS smoke, or current-target recovery drill. Release target after all gates pass: **PRODUCTION READY — AWAITING OWNER GO**. |

## Original six roadmap lanes

| State | Lane | Evidence |
|---|---|---|
| PASS — candidate only | [#86 Annual resident cards + paid receipts](https://github.com/Satsetx4/karturt/issues/86) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Twelve-card/future-due/receipt candidate paths reviewed. Live paid-row allocations remain UNKNOWN. |
| PASS — candidate only | [#87 Arrears + reports](https://github.com/Satsetx4/karturt/issues/87) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Report and date-boundary candidate paths reviewed. |
| PASS — candidate only | [#88 Cash + idempotency](https://github.com/Satsetx4/karturt/issues/88) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Existing oldest-first allocation, transaction locks, and idempotency were preserved and exercised in candidate CI. |
| BLOCKED | [#81 Staging identity + isolation](https://github.com/Satsetx4/karturt/issues/81) | New Neon project ID `steep-heart-48842733`, root branch `br-royal-grass-azyozaxi`, PG18 Singapore. Metadata reports `init_source=parent-data`, logical size 31,686,656 bytes, synthetic storage size 0, and zero written-data bytes; these fields do not establish synthetic-only contents or ancestry. Effective permission is ADMIN; public connections are unblocked and IP allowlist is empty. F2 remains blocked before any DB access. |
| BLOCKED | [#82 Real staging E2E/UAT](https://github.com/Satsetx4/karturt/issues/82) | No approved synthetic-only staging target, real PG18 concurrency/UAT, or Preview smoke. PR #96 offline plan and disposable PG17 concurrency both pass on exact candidate only. |
| NO-GO | [#83 Release readiness](https://github.com/Satsetx4/karturt/issues/83) | PR #95 exact-head Gate A and disposable PG17 concurrency both passed on `5ac931b48efb781d3e7a10b1a360496beabbbafe` in run #40071118229. Current Vercel readback shows `live=false`, `latestDeployment=null`, zero deployments, and one verified default `vercel.app` domain with SSO enabled for all deployments. No branch-bound Preview or recovery drill. |

## Current staging and release evidence

- Neon readback for `steep-heart-48842733` (`karturt-v1-fast-track-clean-staging-20261024`) confirms PG18, Singapore, Free account classification, and root branch `main` / `br-royal-grass-azyozaxi`. The owner authorized Neon’s default password storage; the password was never retrieved or used. Despite project creation reporting no selected parent, root metadata still says `init_source=parent-data` and returns no parent ID. Project metadata reports ~31.7 MB logical size, `synthetic_storage_size=0`, and zero written-data bytes; none proves clean ancestry or synthetic-only contents. Effective permission is ADMIN, `block_public_connections=false`, and IP allowlist is empty. Keep DB access and SQL blocked. Earlier candidates `flat-cloud-57657711`, `ancient-sound-84300774`, and historical `super-band-12770762` share unresolved `parent-data` lineage.
- Vercel project `karturt-review-staging-20261012` currently reads `live=false`, `latestDeployment=null`, zero deployments, and one verified default `vercel.app` domain; SSO protection is enabled for all deployments. The current team metadata response omits plan details; the last verified plan read was Hobby. No source-bound Preview, deployment, environment/secret change, or smoke occurred.
- PR #97 dependency remediation remains a separate OPEN/DRAFT candidate at `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; exact Gate A #120759456983 and disposable PG17 concurrency #120761361103 passed in run #40056147121. Scratch lock regeneration under npm `allow-remote=none` failed with `EALLOWREMOTE`; no override or alternate remote route was used. Artifact route remains UNVERIFIED.
- Historical Wave13B2 F2 remains FAILED. Solo Owner A4-03.5/.6, A4-04/05, and Trusted Neon Viewer effective-token proof remain DEFERRED from the V1 critical path; no historical gate is relabeled PASS.

## Consolidated owner-action packet

If owner action becomes necessary to unlock F2–F4, bundle the concrete requests into one packet: (1) independently establish a production-independent synthetic-only staging root and its lineage; (2) authorize a scoped non-admin identity, network restriction, and target-bound PostgreSQL 18/TLS verification using a protected owner path; (3) after F2 passes, authorize a source-bound nonproduction Preview and smoke; and (4) choose an approved npm artifact route or defer #97. No secrets, connection strings, raw catalog data, or credentials belong in GitHub comments or chat. Production GO remains a separate final owner decision after F4 PASS.

## Operating rules

- Keep all Fast Track PRs OPEN/DRAFT until their objective DoD is met and separately authorized integration is available. Protected main remains `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- Do not claim a PASS across different source SHAs or evidence layers. Record exact SHA, CI run/job/attempt, test status, review scope, provider identity, and remaining blocker in the phase issue.
- Advance F1→F2→F3→F4 only on objective phase evidence. Continue independent safe work while a phase is blocked.
- No multi-RT UI, AI scope, paid service, production credential, DB session/SQL on an unverified target, protected-main merge, deployment, cutover, or production mutation.
- Update this snapshot after material gate changes; do not treat it as live provider evidence.


## 2026-10-24 Functional First snapshot

Current authoritative priorities, parallel microtask lanes, staging designation, consolidated owner actions, exceptions, and F0-F5 status are in [FUNCTIONAL-FIRST-DECISION-20261024.md](FUNCTIONAL-FIRST-DECISION-20261024.md). P0 must PASS; P1 must be fixed; P2/P3 may be documented only when they do not waive mandatory gates. Canonical planning target: flat-cloud-57657711. Duplicate steep-heart-48842733: quarantined and preserved. F2 BLOCKED; F3 BLOCKED; F4 NO-GO; F5 LOCKED for separate owner GO. Re-run exact-head CI after this docs change.
