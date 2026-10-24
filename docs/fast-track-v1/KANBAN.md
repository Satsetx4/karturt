# Fast Track KartuRT V1 — Kanban / Task control

**Snapshot date:** 2026-10-24 Asia/Bangkok. **Coordination source:** [master issue #78](https://github.com/Satsetx4/karturt/issues/78); phase issues #79–#83. **Planning PR #84:** OPEN/DRAFT and unmerged. This issue-based snapshot is not a native GitHub Projects board. Issue comments hold later audit evidence.

## F0–F4 phase status

| State | Phase | Current candidate and exact evidence | Gate |
|---|---|---|---|
| PASS — planning/read-only baseline only | F0 Coordinator, [#79](https://github.com/Satsetx4/karturt/issues/79) | PR #84 is OPEN/DRAFT at `468ed839041fc83481e21eb61eebbb055b1d88f5`, based on protected main `96c84588ae0c13f68a17cffd997a3e583fb7da82`. Exact run [#40048183786](https://github.com/Satsetx4/karturt/actions/runs/40048183786), attempt 2, Gate A job #120737498258 SUCCESS; documentation-branch PostgreSQL job #120739206441 SKIPPED. This refresh changes KANBAN.md, so its new SHA needs its own Gate A; previous evidence will not transfer. | Source map and read-only baseline are complete. No product or provider action is implied. |
| PASS — integrated candidate only | F1 App + QA, [#80](https://github.com/Satsetx4/karturt/issues/80) | PR #93 is OPEN/DRAFT at `b8bc74a4202225d9a54728d2c10be247dec8318f`; exact run #40040334501 Gate A #120709660348 and disposable PostgreSQL 17 concurrency #120712264849 SUCCESS. Prior future-month guard PR #85 is retained as history; its behavior is included in #93. | Historical product PRs #18/#20/#21/#23/#48/#55/#56/#57 were reconciled without blanket merge. Live paid-row allocations remain UNKNOWN. No protected-main merge. |
| BLOCKED before database access | F2 Staging identity/isolation, [#81](https://github.com/Satsetx4/karturt/issues/81) | PR #94 is OPEN/DRAFT at `711eb80e73ec733173306a0aa50e1e6966ecb9d7`; exact Gate A #40069661571 / job #120800163236 SUCCESS; independent concurrency #120801284254 SKIPPED. Independent re-review of exact head found no new P0–P2 findings. Source allowlists for staging and production remain empty. | Neon Free PG18 roots report `init_source=parent-data` and omit parent IDs. This does not prove synthetic-only contents or production separation. Current project permission is ADMIN, public connections are enabled, and IP allowlist is empty. No DB session, SQL, migration, seed, or provider mutation. |
| BLOCKED — offline rehearsal only | F3 Staging E2E/UAT, [#82](https://github.com/Satsetx4/karturt/issues/82) | PR #96 is OPEN/DRAFT at `477a0fe199debec67de071376d9338f956f9dc79`; exact Gate A #40070054841 / job #120801347072 SUCCESS. Independent disposable PostgreSQL 17 job #120803138389 was IN_PROGRESS at the latest read. Local plan tests 14/14 PASS; plan prints 21 scenarios; exact-head re-review found no P0–P2. | Real PG18 staging roles, payment/retry/concurrency UAT, and HTTPS Preview smoke remain NOT RUN. PG17 CI is candidate-code evidence, not F3 staging PASS. |
| NO-GO | F4 Release, [#83](https://github.com/Satsetx4/karturt/issues/83) | PR #95 is OPEN/DRAFT at `b96de7aac0673d47dc4e2280114e27c96e6de048`, based on #93. Exact run #40070480163 / job #120802630926 remained IN PROGRESS at latest read (authorization tests running). Independent review of this exact runbook head found no findings. | No verified staging target, branch-bound Preview, HTTPS smoke, or recovery drill. Release target after all gates pass: **PRODUCTION READY — AWAITING OWNER GO**. |

## Original six roadmap lanes

| State | Lane | Evidence |
|---|---|---|
| PASS — candidate only | [#86 Annual resident cards + paid receipts](https://github.com/Satsetx4/karturt/issues/86) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Twelve-card/future-due/receipt candidate paths reviewed. Live paid-row allocations remain UNKNOWN. |
| PASS — candidate only | [#87 Arrears + reports](https://github.com/Satsetx4/karturt/issues/87) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Report and date-boundary candidate paths reviewed. |
| PASS — candidate only | [#88 Cash + idempotency](https://github.com/Satsetx4/karturt/issues/88) | PR #93 exact head; Gate A and disposable PG17 concurrency passed. Existing oldest-first allocation, transaction locks, and idempotency were preserved and exercised in candidate CI. |
| BLOCKED | [#81 Staging identity + isolation](https://github.com/Satsetx4/karturt/issues/81) | Two newer Neon Free PG18 project roots and the historical candidate report `parent-data`, without parent IDs. No independent lineage/content proof, scoped non-admin runtime identity, network restriction, or TLS certificate proof. |
| BLOCKED | [#82 Real staging E2E/UAT](https://github.com/Satsetx4/karturt/issues/82) | No approved synthetic-only staging target, real PG18 concurrency/UAT, or Preview smoke. |
| NO-GO | [#83 Release readiness](https://github.com/Satsetx4/karturt/issues/83) | PR #95 exact-head CI is still running. Current Vercel readback confirms Hobby, no deployments, one default verified `vercel.app` domain, no custom domain, and SSO protection. No branch-bound Preview or recovery drill. |

## Current staging and release evidence

- Current read-only Neon candidates include `flat-cloud-57657711` / root `br-sparkling-flower-azordm9k` and `ancient-sound-84300774` / root `br-young-bonus-ao4jqzo3`; both are Free, PostgreSQL 18, Singapore, and report `init_source=parent-data` with no parent ID. The historical `super-band-12770762` candidate has the same unresolved lineage class. Project metadata and reported zero writes do not prove database contents. Do not connect or query while provenance is UNKNOWN.
- Vercel team `sekawan` is on Hobby. Project `karturt-review-staging-20261012` is `live=false`, `latestDeployment=null`, with zero deployments and a default project domain only. SSO is enabled. No deployment, environment change, secret change, or smoke occurred.
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
