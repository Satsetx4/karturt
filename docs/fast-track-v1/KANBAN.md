# Fast Track KartuRT V1 — Kanban / Task control

**Snapshot date:** 2026-10-24 Asia/Bangkok. **Coordination source:** [master issue #78](https://github.com/Satsetx4/karturt/issues/78); phase issues #79–#83. **Planning PR #84:** OPEN/DRAFT and unmerged. This issue-based snapshot is not a native GitHub Projects board. Issue comments hold later audit evidence.

## F0–F4 phase status

| State | Phase | Current candidate and exact evidence | Gate |
|---|---|---|---|
| PASS — planning/read-only baseline only | F0 Coordinator, [#79](https://github.com/Satsetx4/karturt/issues/79) | PR #84 was OPEN/DRAFT at pre-refresh head `e731dc22ad608d8304ce0bc15cc8beb8fa1419c4`. Exact run [#40071993876](https://github.com/Satsetx4/karturt/actions/runs/40071993876), attempt 1: Gate A #120807234365 SUCCESS; documentation-branch PostgreSQL concurrency #120808272682 SKIPPED. This scope refresh creates a new source SHA; its exact-head result is recorded on PR #84 and issue #79 without transferring this prior run. | Source map and read-only baseline are complete; the skipped docs job is not candidate concurrency evidence. |
| PASS — integrated candidate only | F1 App + QA, [#80](https://github.com/Satsetx4/karturt/issues/80) | PR #93 is OPEN/DRAFT at `b8bc74a4202225d9a54728d2c10be247dec8318f`; exact run #40040334501 Gate A #120709660348 and disposable PostgreSQL 17 concurrency #120712264849 SUCCESS. Prior future-month guard PR #85 is retained as history; its behavior is included in #93. | Historical product PRs #18/#20/#21/#23/#48/#55/#56/#57 were reconciled without blanket merge. Live paid-row allocations remain UNKNOWN. No protected-main merge. |
| BLOCKED — STOP before further database work | F2 Staging identity/isolation, [#81](https://github.com/Satsetx4/karturt/issues/81) | Sole canonical target per latest owner update: Neon Free/$0 project `flat-cloud-57657711`, PG18 Singapore, branch `br-sparkling-flower-azordm9k`, endpoint `ep-red-boat-azzqyf45`. Current metadata reports `init_source=parent-data` with no parent ID, effective project permission ADMIN, `block_public_connections=false`, and empty IP allowlist. The target-specific DB role attempt was overprivileged (LOGIN, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS); role-scoped read-only catalog found no non-system tables/routines, but reported `pg_stat_ssl.ssl=false`, so `sslmode=verify-full` is unproven. Owner directs STOP: no more SQL, role changes/deletion, migration, seed, UAT, backup, secret, or deployment action pending direct owner input on role cleanup. |
| BLOCKED — offline rehearsal only | F3 Staging E2E/UAT, [#82](https://github.com/Satsetx4/karturt/issues/82) | PR #96 is OPEN/DRAFT at `477a0fe199debec67de071376d9338f956f9dc79`; exact run #40070054841 attempt 1 completed SUCCESS: Gate A #120801347072 and disposable PostgreSQL 17 concurrency #120803138389 both SUCCESS. Focused tests 14/14 PASS; plan prints 21 scenarios; exact-head review found no P0–P2. These are offline/candidate checks only. Real PG18 staging roles, payment/retry/concurrency UAT, and HTTPS Preview smoke remain NOT RUN. |
| NO-GO | F4 Release, [#83](https://github.com/Satsetx4/karturt/issues/83) | PR #95 is OPEN/DRAFT at `5ac931b48efb781d3e7a10b1a360496beabbbafe`, based on PR #93 at `b8bc74a4202225d9a54728d2c10be247dec8318f`. Exact run #40071118229 attempt 1 completed SUCCESS: Gate A #120804565777 and disposable PostgreSQL 17 concurrency #120805614522 both SUCCESS. Independent review confirms no remaining stale SHA/CI attribution. | No verified staging target, branch-bound Preview, HTTPS smoke, or current-target recovery drill. Release target after all gates pass: **PRODUCTION READY — AWAITING OWNER GO**. |

## Original six roadmap lanes

| State | Lane | Evidence |
|---|---|---|
| PASS — candidate only | [#86 Annual resident cards + paid receipts](https://github.com/Satsetx4/karturt/issues/86) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Twelve-card/future-due/receipt candidate paths reviewed. Live paid-row allocations remain UNKNOWN. |
| PASS — candidate only | [#87 Arrears + reports](https://github.com/Satsetx4/karturt/issues/87) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Report and date-boundary candidate paths reviewed. |
| PASS — candidate only | [#88 Cash + idempotency](https://github.com/Satsetx4/karturt/issues/88) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Existing oldest-first allocation, transaction locks, and idempotency were preserved and exercised in candidate CI. |
| BLOCKED — STOP | [#81 Staging identity + isolation](https://github.com/Satsetx4/karturt/issues/81) | Sole active target is `flat-cloud-57657711` / `br-sparkling-flower-azordm9k` / `ep-red-boat-azzqyf45`, reported Free/$0, PG18 Singapore. Root has no parent ID but still reports `init_source=parent-data`. Project permission is ADMIN, public connections unblocked, allowlist empty. Handoff reports an overprivileged target role and `pg_stat_ssl.ssl=false`; no synthetic-only provenance, least privilege, network restriction, or `verify-full` proof. Further SQL/role mutation is stopped pending direct owner input. |
| BLOCKED | [#82 Real staging E2E/UAT](https://github.com/Satsetx4/karturt/issues/82) | No approved synthetic-only staging target, real PG18 concurrency/UAT, or Preview smoke. PR #96 offline plan and disposable PG17 concurrency both pass on exact candidate only. |
| NO-GO | [#83 Release readiness](https://github.com/Satsetx4/karturt/issues/83) | PR #95 exact-head Gate A and disposable PG17 concurrency both passed on `5ac931b48efb781d3e7a10b1a360496beabbbafe` in run #40071118229. Current Vercel readback shows `live=false`, `latestDeployment=null`, zero deployments, and one verified default `vercel.app` domain with SSO enabled for all deployments. No branch-bound Preview or recovery drill. |

## Current staging and release evidence

- Latest owner scope designates only Neon Free/$0 project `flat-cloud-57657711` as staging: PG18 Singapore, branch `br-sparkling-flower-azordm9k`, endpoint `ep-red-boat-azzqyf45`. Current metadata shows Free (`free_v3`), zero storage/transfer/written-byte counters, root marker `init_source=parent-data` with no parent ID, effective project permission ADMIN, public connections unblocked, and empty IP allowlist. The role-scoped read-only catalog result and TLS false result are from the F2 execution handoff; they do not satisfy synthetic-only provenance or `verify-full`. Owner ordered STOP; no further SQL or role mutation. A separate Neon project `steep-heart-48842733` was created under the earlier authorization to store Neon’s default password; the value was never retrieved or used. The latest owner update excludes this project: do not connect, modify, or delete it.
- Vercel project `karturt-review-staging-20261012` currently reads `live=false`, `latestDeployment=null`, zero deployments, and one verified default `vercel.app` domain; SSO protection is enabled for all deployments. The current team metadata response omits plan details; the last verified plan read was Hobby. No source-bound Preview, deployment, environment/secret change, or smoke occurred.
- PR #97 dependency remediation remains a separate OPEN/DRAFT candidate at `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; exact Gate A #120759456983 and disposable PG17 concurrency #120761361103 passed in run #40056147121. Scratch lock regeneration under npm `allow-remote=none` failed with `EALLOWREMOTE`; no override or alternate remote route was used. Artifact route remains UNVERIFIED.
- Historical Wave13B2 F2 remains FAILED. Solo Owner A4-03.5/.6, A4-04/05, and Trusted Neon Viewer effective-token proof remain DEFERRED from the V1 critical path; no historical gate is relabeled PASS.

## Consolidated owner-action packet

Current stop packet: (1) obtain the owner’s direct decision on disposition of the newly created overprivileged target role; no role deletion or repair is authorized by this checkpoint; (2) after owner-directed cleanup, resume only the already-authorized ordered F2 checks on `flat-cloud-57657711`: synthetic-only provenance, least privilege, Free/$0, network restriction if supported, and PostgreSQL 18 `sslmode=verify-full`; stop on any unknown. No additional SQL or provider mutation until the role disposition is resolved. The conditional authorization for official migrations, synthetic seed, UAT, real PG18 concurrency, nonproduction recovery, staging secrets, and Vercel Hobby Preview activates only after F2 PASS. #97 still needs an approved artifact route or deferral. No passwords, connection strings, raw catalog, or credentials belong in GitHub/chat. F5 production promotion remains LOCKED pending a separate owner GO naming the exact candidate SHA and environment.

## F5 production promotion

**LOCKED.** A separate owner GO must name the exact candidate SHA and target environment after the F4 packet is complete. No production access, merge, deployment, migration, or cutover is authorized by the staging approval.

## Operating rules

- Keep all Fast Track PRs OPEN/DRAFT until their objective DoD is met and separately authorized integration is available. Protected main remains `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- Do not claim a PASS across different source SHAs or evidence layers. Record exact SHA, CI run/job/attempt, test status, review scope, provider identity, and remaining blocker in the phase issue.
- Advance F1→F2→F3→F4 only on objective phase evidence. Continue independent safe work while a phase is blocked.
- No multi-RT UI, AI scope, paid service, production credential, DB session/SQL on an unverified target, protected-main merge, deployment, cutover, or production mutation.
- Update this snapshot after material gate changes; do not treat it as live provider evidence.


## 2026-10-24 Functional First snapshot

Current authoritative priorities, parallel microtask lanes, staging designation, consolidated owner actions, exceptions, and F0-F5 status are in [FUNCTIONAL-FIRST-DECISION-20261024.md](FUNCTIONAL-FIRST-DECISION-20261024.md). P0 must PASS; P1 must be fixed; P2/P3 may be documented only when they do not waive mandatory gates. Canonical planning target: flat-cloud-57657711. Duplicate steep-heart-48842733: quarantined and preserved. F2 BLOCKED; F3 BLOCKED; F4 NO-GO; F5 LOCKED for separate owner GO. Re-run exact-head CI after this docs change.

## Latest owner authorization and F2 stop checkpoint — 2026-10-24

Owner authorization is limited to the ordered, conditional staging plan in [FUNCTIONAL-FIRST-DECISION-20261024.md](FUNCTIONAL-FIRST-DECISION-20261024.md), target `flat-cloud-57657711` / `br-sparkling-flower-azordm9k` / `ep-red-boat-azzqyf45`. It does not authorize changes to another Neon project, production, `main`, production deployment, or paid services. Viewer-token proof and the custom-tag ledger remain V1.1.

| Phase | Current status | Latest evidence and gate |
|---|---|---|
| F0 | **PASS — planning/read-only baseline only** | PR #84 SHA `c3c1b07aaf6ba3de7c45efef79a134a3bffb1bc6`; run #40073550071 Gate A SUCCESS. This addendum changes the head; exact-head CI is pending. |
| F1 | **PASS — candidate only** | Open/draft PR #93 SHA `b8bc74a4202225d9a54728d2c10be247dec8318f`; run #40040334501 Gate A and disposable PG17 concurrency SUCCESS. No merge/staging claim. |
| F2 | **BLOCKED** | Metadata identifies exact Free target and zero current usage. New root branch has no parent ID, but `init_source=parent-data` remains a provenance caveat. Tool-created role had CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS. Read-only SQL reported `pg_stat_ssl.ssl=false`; verify-full is not proven. No migration/seed. Role cleanup awaits owner input. |
| F3 | **BLOCKED** | No approved isolated staging UAT or real PG18 concurrency. |
| F4 | **NO-GO** | No F2/F3 PASS, source-bound Preview, or current-target recovery drill. |
| F5 | **LOCKED** | Separate owner GO for exact SHA and production environment required. |

**Wave assignment:** #86 Application — annual cards/receipts; #87 Reports — arrears/reporting; #88 QA/Cash — cash/idempotency regressions; coordinator — integrated PR #93 and exact-SHA evidence; QA/Security — independent P0/P1 review and exception register; #81 DB/Staging — stopped at F2; #82 UAT and #83 Release — wait for F2 PASS. P0 must PASS, P1 must be fixed, and P2/P3 are acceptable only if they do not weaken a mandatory gate.
