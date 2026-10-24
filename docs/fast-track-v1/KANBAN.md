# Fast Track KartuRT V1 — Kanban / Task control

**Snapshot refreshed:** 2026-10-24 Asia/Bangkok. **Authoritative coordination:** master [issue #78](https://github.com/Satsetx4/karturt/issues/78), phase issues #79–#83. **Planning PR:** [#84](https://github.com/Satsetx4/karturt/pull/84) remains OPEN/DRAFT and unmerged. The pre-refresh head `c0e08393599ccfcdc75480e97e1dd2413eb5b7f6` passed exact-head Gate A run [#40045988775](https://github.com/Satsetx4/karturt/actions/runs/40045988775); independent PostgreSQL concurrency #120729167282 was SKIPPED. This update creates a new exact head, so its Gate A and the documentation-branch skip must be recorded separately in issue #79. This is a static snapshot, not an auto-refreshing GitHub Project board; maintain live evidence in issues after each change.

| State | Phase/workstream | Issue | Completion condition / blocker |
|---|---|---|---|
| PASS — planning/read-only baseline only | F0 Coordinator | [#79](https://github.com/Satsetx4/karturt/issues/79) | Source integration map and read-only baseline are documented in #84; pre-refresh head `c0e0839…` passed Gate A #40045988775 and docs-branch concurrency was skipped. This refresh creates a new exact PR #84 head; its SHA/CI are in #79. PR stays OPEN/DRAFT and unmerged |
| PASS — integrated candidate only | F1 App + QA | [#80](https://github.com/Satsetx4/karturt/issues/80) | PR #93 exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`; run #40040334501 Gate A job #120709660348 and disposable PostgreSQL 17 concurrency job #120712264849 both SUCCESS; local 411/411 and four viewport smoke. Earlier guard PR #85 exact head `1215db92f020ffee73d406c7c33c2422f85687ea` passed Gate A #40009762853; concurrency was SKIPPED. Its future-period guard is included in #93. No main merge |
| BLOCKED before database access | F2 DB/Staging | [#81](https://github.com/Satsetx4/karturt/issues/81) | PR #94 exact head `2882b177e674fe577643b792e0ca3566d52ef754`; run #40037337893 attempt 2 Gate A #120701070602 SUCCESS, PostgreSQL concurrency #120704030518 SKIPPED. The current Neon root and all five older KartuRT PG18/Free/Singapore candidates report `init_source=parent-data` with no parent ID from branch-list/direct reads. Current project permission is `ADMIN`; public connections are enabled, IP allowlist empty, no scoped runner. Lineage/content, least privilege, and TLS UNKNOWN. Fresh Vercel API readback returned `latestDeployment=null`, zero deployments/domains, no usable `live` value, and no team plan |
| BLOCKED — staging unavailable; offline rehearsal verified only | F3 QA + DB | [#82](https://github.com/Satsetx4/karturt/issues/82) | PR #96 exact head `25752cf693d7a35d83f8b5882a59f6c9ba5b2a0a`, based on PR #93 SHA `b8bc74a…`; run #40040538488 Gate A #120710301979 and disposable PostgreSQL 17 job #120712263310 both SUCCESS; 15 offline scenarios prepared. No verified synthetic staging or real PG18 role/payment/retry/concurrency UAT |
| NO-GO | F4 Release | [#83](https://github.com/Satsetx4/karturt/issues/83) | PR #95 current head [`b68335f7bd1a670b6a1d34fd08a4ef89b785ea28`](https://github.com/Satsetx4/karturt/commit/b68335f7bd1a670b6a1d34fd08a4ef89b785ea28), based on #93 SHA `b8bc74a…`; exact Gate A run #40047461528 was IN_PROGRESS at this snapshot. Prior head #40045072037 had Gate A and disposable PostgreSQL 17 concurrency SUCCESS; results do not transfer. Independent review of the prior head identified three P2 freshness gaps, now edited on this head; re-review pending. Dependency, staging, Preview, and current-target recovery blockers remain; no production GO |
| DEFERRED V1.1 | Solo Owner custom ledger/Viewer | [#75](https://github.com/Satsetx4/karturt/issues/75), [#77](https://github.com/Satsetx4/karturt/issues/77) | Preserve security artifacts without V1 release blocking; never declare historical gate PASS |
| NOT AUTHORIZED | Production F5 | [#78](https://github.com/Satsetx4/karturt/issues/78) | Owner's explicit final GO only after F4 PASS |

## Original six roadmap lanes

| State | Lane | Current evidence |
|---|---|---|
| PASS — candidate only | [#86 Annual resident card + paid receipts](https://github.com/Satsetx4/karturt/issues/86) | PR #93 exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`; run #40040334501 Gate A #120709660348 and disposable PG17 concurrency #120712264849 both SUCCESS; reviewed with no P0/P1/P2; unmerged |
| PASS — candidate only | [#87 Arrears + reports](https://github.com/Satsetx4/karturt/issues/87) | PR #93 exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`; run #40040334501 Gate A #120709660348 and disposable PG17 concurrency #120712264849 both SUCCESS; reviewed with no P0/P1/P2; unmerged |
| PASS — candidate only | [#88 Cash + idempotency](https://github.com/Satsetx4/karturt/issues/88) | PR #93 exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`; run #40040334501 Gate A #120709660348 and disposable PG17 concurrency #120712264849 both SUCCESS; reviewed with no P0/P1/P2; unmerged |
| BLOCKED before database access | [#81 Staging identity + isolation](https://github.com/Satsetx4/karturt/issues/81) | PR #94 exact head `2882b177e674fe577643b792e0ca3566d52ef754`; Gate A #40037337893 attempt 2 SUCCESS; concurrency SKIPPED. All six KartuRT candidates report `parent-data` and omit parent IDs. The active project permission is ADMIN, public connections are enabled, IP allowlist empty, and no scoped runner is proven. Current Vercel readback has 0 deployments/domains and no plan value. Synthetic contents, production separation, least privilege, and TLS remain UNKNOWN |
| BLOCKED | [#82 Staging E2E/UAT](https://github.com/Satsetx4/karturt/issues/82) | PR #96 exact head `25752cf693d7a35d83f8b5882a59f6c9ba5b2a0a`; Gate A #40040538488 and disposable PG17 concurrency both SUCCESS, independent review no findings. No live staging or PostgreSQL 18 UAT has run on a verified isolated target |
| NO-GO | [#83 Release readiness](https://github.com/Satsetx4/karturt/issues/83) | PR #95 current head `b68335f7bd1a670b6a1d34fd08a4ef89b785ea28`; exact run #40047461528 was IN_PROGRESS at this snapshot. Its changes correct the stale review, F2 evidence, and CI references identified by independent review of prior head `5b532553…`. Wait for current exact-head Gate A, independent job, and re-review before marking the packet current. Dependency, staging, Preview, and recovery blockers remain |

## Proposed next task queue (atomic; Codex coordinator picks these without further routine approval)

| Priority | Issue / phase | Workstream | Independent safe starting action |
|---|---|---|---|
| P0 | F2 #81 | Owner + Coordinator | One bundled packet: authoritative synthetic-only root lineage and production separation; scoped non-admin PG18/TLS identity; Vercel Hobby and staging Preview evidence; approved npm artifact route. No database access or paid plan |
| P1 | F3 #82 | QA + DB | Offline scenario preparation is candidate PASS; resume real PG18 staging UAT/concurrency only after F2 identity and lineage gates pass |
| P1 | F4 #83 | Release | Revisit dependency remediation only when npm policy permits an approved artifact; verify current-target recovery and Vercel Preview after F2 gates pass |
| P2 | F1 #80 | Coordinator | Preserve #93 as candidate PASS; do not merge protected main without separate authorization |
| P2 | F2→F4 | Coordinator | Advance only on objective DoD evidence; consolidate any owner action into one packet |

## Work-in-progress and branch policy

- Keep independently edited scopes on isolated branches; one agent owns each file group, no parallel writes to same path.
- Avoid duplicating a task merely because two issue checklists mention related tests.
- All PRs start DRAFT. Exact-SHA CI is necessary but not sufficient: environment and real PG proof are separate.
- Coordinator updates issue checkbox only when related DoD evidence is linked; a green screenshot/mock alone is not enough.
- Refresh this file when an acceptance gate materially changes; GitHub Issues comments hold the live audit history.
- If GitHub Projects kanban mutation tooling becomes available, the coordinator may mirror these columns after ensuring it does not create paid services, but not claim an actual Project board exists now.

## Current six-stage summary

1. Inventory/CI **PASS for F0 planning/read-only baseline; F1 candidate PASS** — PR #93 exact head `b8bc74a4202225d9a54728d2c10be247dec8318f` has Gate A #40040334501 and disposable PostgreSQL 17 CI success. PR #84 pre-refresh head `c0e08393599ccfcdc75480e97e1dd2413eb5b7f6` passed Gate A #40045988775; docs-branch concurrency was skipped. This Kanban edit creates a new #84 head; its exact CI will be recorded in issue #79. Neither PR is merged.
2. Solo Owner Gate **DEFERRED for V1** — not PASS and not erased.
3. Staging Identity/Isolation **BLOCKED** — all six KartuRT project roots report `parent-data` with no parent ID; none proves synthetic-only contents or production separation. Active project permissions still read ADMIN. No database access.
4. PostgreSQL18/migration **BLOCKED** — target-bound identity, TLS and content preflight not authorized/proven; no migration or seed.
5. Staging UAT/RC **BLOCKED** — real PG18 concurrency and end-to-end UAT have not run on a verified isolated target.
6. Preview/Production **NO-GO** — latest Vercel API readback has no deployment or project domains, no usable `live` value, and no plan field; Hobby/Preview and recovery remain unverified. Production always requires a separate owner GO after F4.

**Owner involvement target:** 1 consolidated access/authorization packet if a genuine external blocker exists; 1 final production GO/NO-GO decision. No guarantee that platform security verification can be automated.
