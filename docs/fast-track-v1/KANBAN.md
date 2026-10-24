# Fast Track KartuRT V1 — Kanban / Task control

**Snapshot date:** 2026-10-24 Asia/Bangkok. **Coordination source:** [master issue #78](https://github.com/Satsetx4/karturt/issues/78); phase issues #79–#83. **Planning PR #84:** OPEN/DRAFT and unmerged. This issue-based snapshot is not a native GitHub Projects board. Issue comments hold later audit evidence. **Cross-PR snapshot rule:** SHA and run references below describe state read while preparing this source revision; live status is maintained in PR bodies and issues #78–#83. A branch advance makes an older row historical, and CI results never transfer across SHAs.

## F0–F4 phase status

| State | Phase | Current candidate and exact evidence | Gate |
|---|---|---|---|
| PASS — planning/read-only baseline only | F0 Coordinator, [#79](https://github.com/Satsetx4/karturt/issues/79) | PR #84 exact-head SHA and Gate A run are tracked on the issue; checks never transfer across SHAs. Documentation-only PostgreSQL concurrency may be SKIPPED and is not candidate or staging concurrency evidence. | Source map and read-only baseline are complete; no app or staging acceptance is implied. |
| PASS — integrated candidate only | F1 App + QA, [#80](https://github.com/Satsetx4/karturt/issues/80) | PR #93 is OPEN/DRAFT at `b8bc74a4202225d9a54728d2c10be247dec8318f`; exact run #40040334501 Gate A #120709660348 and disposable PostgreSQL 17 concurrency #120712264849 SUCCESS. Prior future-month guard PR #85 is retained as history; its behavior is included in #93. | Historical product PRs #18/#20/#21/#23/#48/#55/#56/#57 were reconciled without blanket merge. Live paid-row allocations remain UNKNOWN. No protected-main merge. |
| BLOCKED — STOP before further database work | F2 Staging identity/isolation, [#81](https://github.com/Satsetx4/karturt/issues/81) | Current owner-authorized provisioning candidate: Neon Free organization; project little-bread-45461401 / karturt-v1-fast-track-staging-candidate-20261024, PG18 Singapore; root/default br-damp-forest-aop2zfwf has no parent, init_source=parent-data, and zero reported writes/transfers. Default password storage was authorized; no password was retrieved, displayed, or used. No database connection, SQL, role change, migration, seed, UAT, recovery, Preview, or deployment occurred. F2 remains STOP because contents, least privilege, network/TLS verify-full, and actual Rp0 cost are unproven; project permission is ADMIN, public connections are unblocked, and the IP allowlist is empty. flat-cloud is the previous planning target; steep-heart remains quarantined.
| BLOCKED — offline rehearsal only | F3 Staging E2E/UAT, [#82](https://github.com/Satsetx4/karturt/issues/82) | PR #96 is OPEN/DRAFT at `477a0fe199debec67de071376d9338f956f9dc79`; exact run #40070054841 attempt 1 completed SUCCESS: Gate A #120801347072 and disposable PostgreSQL 17 concurrency #120803138389 both SUCCESS. Focused tests 14/14 PASS; plan prints 21 scenarios; exact-head review found no P0–P2. These are offline/candidate checks only. Real PG18 staging roles, payment/retry/concurrency UAT, and HTTPS Preview smoke remain NOT RUN. |
| NO-GO | F4 Release, [#83](https://github.com/Satsetx4/karturt/issues/83) | At this Kanban snapshot, PR #95 was OPEN/DRAFT at head `ca17d2c13756711c9d77aec5db1725996a64fc71`; exact run [#40078256329](https://github.com/Satsetx4/karturt/actions/runs/40078256329), attempt 1, was IN_PROGRESS at Gate A job #120826201097 (Integration and migration tests). The prior source head `3045e0046674e407b591919ac8ac3e816f8a53ba` also had exact run #40078141419 IN_PROGRESS at job #120825854818 (Integration and migration tests). An earlier head `6d759e54f2d44364c7e0b3ad1c5650e8a7e2ca0b` passed run #40077663110 on its own SHA: Gate A #120824429639 and disposable PostgreSQL 17 concurrency #120825590437 SUCCESS. Older results do not transfer. | No verified staging target, branch-bound Preview, HTTPS smoke, or current-target recovery drill. Release target after all gates pass: **PRODUCTION READY — AWAITING OWNER GO**. |

## Original six roadmap lanes

| State | Lane | Evidence |
|---|---|---|
| PASS — candidate only | [#86 Annual resident cards + paid receipts](https://github.com/Satsetx4/karturt/issues/86) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Twelve-card/future-due/receipt candidate paths reviewed. Live paid-row allocations remain UNKNOWN. |
| PASS — candidate only | [#87 Arrears + reports](https://github.com/Satsetx4/karturt/issues/87) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Report and date-boundary candidate paths reviewed. |
| PASS — candidate only | [#88 Cash + idempotency](https://github.com/Satsetx4/karturt/issues/88) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Existing oldest-first allocation, transaction locks, and idempotency were preserved and exercised in candidate CI. |
| BLOCKED — STOP | [#81 Staging identity + isolation](https://github.com/Satsetx4/karturt/issues/81) | New Free PG18 candidate little-bread-45461401 was created only after the owner approved default password storage. Its root/default branch has no parent; contents have not been inspected. ADMIN permission, public access/unrestricted IPs, runtime identity, client verify-full TLS, and actual Rp0 evidence remain blockers. No SQL or database use is authorized.
| BLOCKED | [#82 Real staging E2E/UAT](https://github.com/Satsetx4/karturt/issues/82) | No approved synthetic-only staging target, real PG18 concurrency/UAT, or Preview smoke. PR #96 offline plan and disposable PG17 concurrency both pass on exact candidate only. |
| NO-GO | [#83 Release readiness](https://github.com/Satsetx4/karturt/issues/83) | At this Kanban snapshot, PR #95 head `ca17d2c13756711c9d77aec5db1725996a64fc71` had exact run #40078256329 IN_PROGRESS; prior head `3045e0046674e407b591919ac8ac3e816f8a53ba` had run #40078141419 IN_PROGRESS. Earlier head `6d759e54f2d44364c7e0b3ad1c5650e8a7e2ca0b` passed Gate A and disposable PG17 in run #40077663110 on that SHA only. Vercel readback is `live=false`, `latestDeployment=null`, zero deployments, one verified default `.vercel.app` domain and no custom domains; current team response omits plan details (last verified Hobby). No source-bound Preview or recovery drill. |

## Current staging and release evidence

- Current owner scope includes the newly created Neon Free PG18 candidate little-bread-45461401; it is provisioning-only and has not been used. Neon organization plan is Free. The root/default branch has no parent and reports zero branch writes/transfers. The owner approved Neon default password storage; no password was retrieved, displayed, or used. Project permission is ADMIN, public connections are unblocked, and the IP allowlist is empty. Content verification, non-admin identity, client sslmode=verify-full, network safety, and actual Rp0 billing remain unproven. The previous flat-cloud candidate remains unverified; steep-heart remains quarantined and preserved.
- Vercel project `karturt-review-staging-20261012` currently reads `live=false`, `latestDeployment=null`, zero deployments, and one verified default `vercel.app` domain; SSO protection is enabled for all deployments. The current team metadata response omits plan details; the last verified plan read was Hobby. No source-bound Preview, deployment, environment/secret change, or smoke occurred.
- PR #97 dependency remediation remains a separate OPEN/DRAFT candidate at `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; exact Gate A #120759456983 and disposable PG17 concurrency #120761361103 passed in run #40056147121. Scratch lock regeneration under npm `allow-remote=none` failed with `EALLOWREMOTE`; no override or alternate remote route was used. Artifact route remains UNVERIFIED.
- Historical Wave13B2 F2 remains FAILED. Solo Owner A4-03.5/.6, A4-04/05, and Trusted Neon Viewer effective-token proof remain DEFERRED from the V1 critical path; no historical gate is relabeled PASS.

## Consolidated owner-action packet

Current stop packet: one owner-authorized Free PG18 project creation is complete using Neon default password storage; its password was not retrieved, displayed, or used. The new candidate little-bread-45461401 has a no-parent root branch, but contents are unverified. F2 still lacks an accepted non-admin identity, network/TLS verify-full proof, and actual Rp0 billing evidence. No further SQL, database use, role changes, migration, seed, UAT, concurrency, backup/restore, staging secrets/environment, Preview, or deployment until every F2 gate has fresh PASS evidence and the owner directly authorizes resumption. F5 production promotion remains LOCKED pending a separate owner GO for an exact SHA and environment.

## F5 production promotion

**LOCKED.** A separate owner GO must name the exact candidate SHA and target environment after the F4 packet is complete. No production access, merge, deployment, migration, or cutover is authorized by the staging approval.

## Operating rules

- Keep all Fast Track PRs OPEN/DRAFT until their objective DoD is met and separately authorized integration is available. Protected main remains `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- Do not claim a PASS across different source SHAs or evidence layers. Record exact SHA, CI run/job/attempt, test status, review scope, provider identity, and remaining blocker in the phase issue.
- Advance F1→F2→F3→F4 only on objective phase evidence. Continue independent safe work while a phase is blocked.
- No multi-RT UI, AI scope, paid service, production credential, DB session/SQL on an unverified target, protected-main merge, deployment, cutover, or production mutation.
- Update this snapshot after material gate changes; do not treat it as live provider evidence.


## 2026-10-24 Functional First snapshot

Current authoritative priorities, parallel microtask lanes, staging designation, consolidated owner actions, exceptions, and F0-F5 status are in [FUNCTIONAL-FIRST-DECISION-20261024.md](FUNCTIONAL-FIRST-DECISION-20261024.md). P0 must PASS; P1 must be fixed; P2/P3 may be documented only when they do not waive mandatory gates. Current provisioning candidate: little-bread-45461401. Previous planning target flat-cloud-57657711 remains unverified; steep-heart-48842733 is quarantined and preserved. F2 BLOCKED; F3 BLOCKED; F4 NO-GO; F5 LOCKED for separate owner GO. Re-run exact-head CI after this docs change.

## Latest owner authorization and F2 stop checkpoint — 2026-10-24

The latest owner authorization permitted one Neon Free project creation with default password storage; project little-bread-45461401 was created and no password was retrieved or used. This does not authorize database use, another provider mutation, production, main, production deployment, or paid services. Viewer-token proof and the custom-tag ledger remain V1.1.

| Phase | Current status | Latest evidence and gate |
|---|---|---|
| F0 | **PASS — planning/read-only baseline only** | Current PR #84 SHA 7916a2550271266823c6a0687a415fa5dc112213; exact run #40082393734 attempt 1, Gate A #120838442407 SUCCESS. Independent PostgreSQL concurrency #120840174508 was SKIPPED. No staging proof. |
| F1 | **PASS — candidate only** | Open/draft PR #93 SHA `b8bc74a4202225d9a54728d2c10be247dec8318f`; run #40040334501 Gate A and disposable PG17 concurrency SUCCESS. No merge/staging claim. |
| F2 | **STOP/BLOCKED** | New Free PG18 provisioning candidate little-bread-45461401 has a root/default branch with no parent. Database contents are not inspected; project permission ADMIN, public connections unblocked, and empty IP allowlist remain blockers. Non-admin role, client sslmode=verify-full, and actual Rp0 cost are unproven. No database use is authorized. |
| F3 | **BLOCKED** | No approved isolated staging UAT or real PG18 concurrency. |
| F4 | **NO-GO** | PR #95 SHA 560aa9f408de757ad3eca4d83aacb6a1a67defcb; exact run #40078932771 Gate A and disposable PostgreSQL 17 concurrency succeeded. No F2/F3 pass, source-bound Preview smoke, or current-target recovery drill. |
| F5 | **LOCKED** | Separate owner GO for exact SHA and production environment required. |

**Wave assignment:** #86 Application — annual cards/receipts; #87 Reports — arrears/reporting; #88 QA/Cash — cash/idempotency regressions; coordinator — integrated PR #93 and exact-SHA evidence; QA/Security — independent P0/P1 review and exception register; #81 DB/Staging — stopped at F2; #82 UAT and #83 Release — wait for F2 PASS. P0 must PASS, P1 must be fixed, and P2/P3 are acceptable only if they do not weaken a mandatory gate.

## Owner-authorized role cleanup outcome — 2026-10-24

The owner explicitly approved deleting only `karturt_f2_catalog_ro_20261024`. After confirming it existed on the exact target branch, that role was deleted from project `flat-cloud-57657711` / branch `br-sparkling-flower-azordm9k`; a subsequent role listing confirmed it was absent and showed only the pre-existing `karturt_staging_owner`. This cleanup does not satisfy F2: the earlier role privilege result and `pg_stat_ssl.ssl=false` remain recorded as failed security evidence, data provenance is still unproven, and no further SQL or staging work is authorized by that cleanup. F2 remains BLOCKED; F3 BLOCKED; F4 NO-GO; F5 LOCKED. No owner password was accessed, displayed, or used.
