# KartuRT V1 Fast Track — Current Release Decision Packet

**Decision date:** 2026-10-24 (Asia/Bangkok)  
**Verdict:** **NO-GO — staging and integrated release evidence remain outstanding**
**Release target after all gates pass:** `PRODUCTION READY — AWAITING OWNER GO`

This is the current evidence-based decision packet. It records work completed and blockers found; it does not authorize a production action. Fast Track PRs #84, #85, and #93–#97 remain OPEN/DRAFT. `main` remains unchanged at `96c84588ae0c13f68a17cffd997a3e583fb7da82`.

## 1. Candidate identity and source evidence

There is **no verified staging/release candidate ready for promotion**. The immediately preceding PR #95 head `5ac931b48efb781d3e7a10b1a360496beabbbafe` passed exact run [#40071118229](https://github.com/Satsetx4/karturt/actions/runs/40071118229), attempt 1, with Gate A #120804565777 and disposable PostgreSQL 17 concurrency #120805614522 SUCCESS. This is historical source CI only; it does not transfer to the current packet revision or establish staging PostgreSQL 18 UAT. Current PR #95 head and exact-head CI are recorded in the live PR and issue #83. Every result remains SHA-bound. F2 is not cleared, F3 has no real staging UAT, and no verified Preview or recovery drill exists. PR #97 has zero npm audit findings on its unmerged candidate. Fresh npm 11.19.0 QA passed registry/tarball integrity, clean install, engine compatibility, package-tree checks, unchanged lock hash, and audit with `allow-remote=none`; lock generation under that safeguard failed with `EALLOWREMOTE`. QA did not retry or relax the safeguard, so the conditional artifact route remains UNVERIFIED.

| Item | Current evidence |
|---|---|
| Application candidate | [PR #93](https://github.com/Satsetx4/karturt/pull/93), OPEN/DRAFT, exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`, based on protected `main` `96c84588ae0c13f68a17cffd997a3e583fb7da82` |
| F2 source-guard candidate | [PR #94](https://github.com/Satsetx4/karturt/pull/94), OPEN/DRAFT, exact head `711eb80e73ec733173306a0aa50e1e6966ecb9d7`; run #40069661571 Gate A SUCCESS, independent PostgreSQL job SKIPPED; source guard only |
| F3 offline rehearsal | [PR #96](https://github.com/Satsetx4/karturt/pull/96), OPEN/DRAFT, exact head `477a0fe199debec67de071376d9338f956f9dc79`; run #40070054841 Gate A and disposable PG17 concurrency SUCCESS; based on PR #93 head `b8bc74a…` |
| Dependency remediation | [PR #97](https://github.com/Satsetx4/karturt/pull/97), OPEN/DRAFT, exact head `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; dependency-only candidate based on PR #93 |
| F4 documents and this packet | [PR #95](https://github.com/Satsetx4/karturt/pull/95), OPEN/DRAFT. The immediately preceding head `5ac931b48efb781d3e7a10b1a360496beabbbafe` passed run #40071118229 (Gate A #120804565777 and disposable PG17 #120805614522). This is predecessor-only evidence; the exact-head status for the current packet revision is recorded in the live PR #95 body and issue #83. |
| Planning/Kanban | [PR #84](https://github.com/Satsetx4/karturt/pull/84), OPEN/DRAFT. At this packet snapshot it was at head `e3869d0f765e105d38a3eeb87f09207c9e0af829`; exact run [#40078138256](https://github.com/Satsetx4/karturt/actions/runs/40078138256) was IN_PROGRESS at Gate A job #120825846035 (Integration and migration tests), with no documentation-branch concurrency result. The live current head and run are maintained in PR #84 and issues #78/#79. |
| Candidate migration files | PR #93 adds no migration file. Provider schema and migration state were not inspected through a database session. |
| Independent review | PR #93 and PR #96 reviews remain scoped to their cited SHAs. Review of PR #95 head `6d759e54f2d44364c7e0b3ad1c5650e8a7e2ca0b` and PR #84 head `ad2447dbada8cb37e7181cd4fad44c3ac4ca4d17` found P2 stale status references in the packet and Kanban. This packet and Kanban revisions correct those references; each resulting source head needs its own exact-head CI and review evidence. |

### Exact-head CI evidence

| Source SHA / PR | Run and attempt | Gate A | Independent PostgreSQL job | Meaning |
|---|---|---|---|---|
| PR #93 `b8bc74a…` | [#40040334501](https://github.com/Satsetx4/karturt/actions/runs/40040334501), attempt 1 | #120709660348 SUCCESS | #120712264849 SUCCESS, disposable PG17 | F1 candidate CI only; not staging PG18 |
| PR #94 `2882b17…` | [#40037337893](https://github.com/Satsetx4/karturt/actions/runs/40037337893), attempt 2 | #120701070602 SUCCESS | #120704030518 SKIPPED | Source guard checks only; concurrency unverified |
| PR #96 `865659f…` | [#40059492827](https://github.com/Satsetx4/karturt/actions/runs/40059492827), attempt 1 | #120769702033 SUCCESS | #120771496144 SUCCESS, disposable PG17 | 20 offline scenarios and source regression evidence only; not real staging PG18 |
| PR #97 `6b39d13…` | [#40056147121](https://github.com/Satsetx4/karturt/actions/runs/40056147121), attempt 1 | #120759456983 SUCCESS | #120761361103 SUCCESS, disposable PG17 | Dependency candidate only; not combined F4 packet or staging PG18 |
| PR #95 previous packet head `ce906748…` | [#40057250480](https://github.com/Satsetx4/karturt/actions/runs/40057250480), attempt 1 | #120762834917 SUCCESS | #120764701575 SUCCESS, disposable PG17 | Passed before this packet refresh; refreshed source SHA and results are tracked on PR #95 and issue #83 |
| PR #95 packet head e3aad9ee | [#40060899632](https://github.com/Satsetx4/karturt/actions/runs/40060899632), attempt 1 | #120773959773 SUCCESS | #120775867585 SUCCESS, disposable PostgreSQL | Exact packet-candidate source checks only; not staging PostgreSQL 18 UAT |
| PR #95 preceding packet head `bce72e4…` | [#40061915764](https://github.com/Satsetx4/karturt/actions/runs/40061915764), attempt 1 | #120777072143 SUCCESS | #120778181422 SUCCESS, disposable PG17 | Exact checks for that packet revision only; later revisions have separate exact-head runs |
| PR #95 previous head `2f7ab4e…` | [#40041547299](https://github.com/Satsetx4/karturt/actions/runs/40041547299), retry attempt 2 | #120714648846 SUCCESS | #120717077129 SUCCESS, disposable PG17 | F4 docs head before this packet edit |
| PR #95 previous packet head `852bc89…` | [#40064485272](https://github.com/Satsetx4/karturt/actions/runs/40064485272), attempt 1 | #120784756371 SUCCESS | #120786519581 SUCCESS, disposable PG17 | Exact checks for that packet SHA only; later revisions have separate checks |
| PR #95 immediately preceding packet head `08a06a2…` | [#40065754051](https://github.com/Satsetx4/karturt/actions/runs/40065754051), attempt 1 | #120788537629 SUCCESS | #120790342876 SUCCESS, disposable PG17 | Exact checks for that source SHA only; later packet revisions do not inherit them |
| PR #95 packet head `097f8eef…` | [#40067231392](https://github.com/Satsetx4/karturt/actions/runs/40067231392), attempt 1 | #120792923778 SUCCESS | #120794222398 SUCCESS, disposable PG17 | Exact checks for the packet immediately before this document refresh; not staging PG18 UAT |
| PR #95 packet head `a93625f…` | [#40044385581](https://github.com/Satsetx4/karturt/actions/runs/40044385581), attempt 1 | #120722617994 SUCCESS | #120724424270 SUCCESS, disposable PG17 | Packet head before the evidence-link correction in this revision |
| PR #95 historical head `b68335f…` | [#40047461528](https://github.com/Satsetx4/karturt/actions/runs/40047461528), attempt 1 | #120732350539 SUCCESS | #120734614250 SUCCESS, disposable PG17 | Historical source checks only; they do not transfer to later packet SHAs |
| PR #84 current head `468ed839…` | [#40048183786](https://github.com/Satsetx4/karturt/actions/runs/40048183786), attempt 2 | #120737498258 SUCCESS | #120739206441 SKIPPED | Planning/Kanban docs CI only; concurrency is unverified |

For PR #95, attempt 1 at the same source SHA failed in browser integration with `Chrome DevTools did not start` (34/35 integration files and 192/193 tests passed); its concurrency job was skipped. The failure is preserved. Retry attempt 2 passed. PR #84 had the same Chrome startup failure on attempt 1 (34/35 files, 189/190 tests passed); its retry passed and docs-branch concurrency remained skipped. No failed or skipped job is relabeled as passing.

## 2. F1 application acceptance — PASS for candidate only

Evidence is tied to PR #93 exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`:

| Acceptance item | Status | Evidence |
|---|---|---|
| Twelve annual periods; future periods are upcoming and excluded from arrears | PASS — candidate | PR #93; local full suite 411/411 and exact Gate A run #40040334501 |
| Online requests accept only current and overdue periods, including server-side future denial | PASS — candidate | PR #93 code/tests; exact Gate A run #40040334501 |
| Treasurer can verify future cash; allocation is oldest unpaid through target | PASS — candidate | PR #93 code/tests; exact Gate A run #40040334501 and disposable PG17 job |
| Paid receipt shows canonical amount and Asia/Jakarta verification time | PASS — candidate | PR #93 code/tests; exact Gate A run #40040334501 |
| Resident/Treasurer/Chairman/Admin authorization and tenant negatives | PASS — candidate | Exact-head authorization/security/full-suite CI; independent source review |
| Retry, duplicate, reversal, and payment integrity | PASS — candidate | PR #93 regressions; exact Gate A and disposable PG17 concurrency |
| Mobile and desktop smoke | PASS — candidate | 360×800, 390×844, 768×1024, 1440×900; no horizontal overflow |

F1 is **not merged**. Without database verification, whether every existing paid row has an active canonical allocation remains UNKNOWN. Its PG17 CI job is not proof of F3 PostgreSQL 18 staging behavior.

## 3. F2 staging identity, isolation, and recovery — BLOCKED

The latest target-specific stop and owner-approved role cleanup are recorded in [issue #81 comment #6381863981](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6381863981). The sole canonical staging target is Neon Free project `flat-cloud-57657711`, PG18/Singapore, branch `br-sparkling-flower-azordm9k`, endpoint `ep-red-boat-azzqyf45`, database `karturt_staging`. Current project metadata reports `store_passwords=true`; the owner has confirmed this default behavior. The Neon password was not retrieved, displayed, or used. No other or duplicate Neon project is an approved target or fallback.

Current metadata reports the root branch has no `parent_id` but still carries `init_source=parent-data`; effective project permission is ADMIN, public connections are enabled, and the IP allowlist is empty. These control-plane facts do not establish production separation or synthetic-only contents. The target-specific role attempt returned LOGIN, CREATEDB, CREATEROLE, REPLICATION, and BYPASSRLS. The owner approved deletion of only that role; it was deleted on the exact target and a fresh role listing confirmed it absent. The earlier role-scoped read-only catalog query found no non-system tables/routines but reported `pg_stat_ssl.ssl=false`. That result is not accepted as provenance evidence and does not prove client `sslmode=verify-full` or hostname/certificate verification.

**F2 verdict: STOP/BLOCKED.** No further SQL, role changes, migrations, seed, UAT, PostgreSQL concurrency, backup/restore, staging secrets/environment, Preview, or deployment is authorized until every F2 gate has fresh PASS evidence and the owner directly authorizes resumption. No migration, seed, UAT, real concurrency, recovery drill, or deployment has occurred.

| Evidence | Status | Current readback / gap |
|---|---|---|
| Neon project and Free plan | PARTIAL | Canonical project is Free (`free_v3`), PG18/Singapore, with zero current usage counters and published Free pricing of $0. These are time-bounded metadata and do not guarantee future quota/cost. Project identity: `flat-cloud-57657711`; branch `br-sparkling-flower-azordm9k`; endpoint `ep-red-boat-azzqyf45`. |
| Production separation and synthetic-only lineage | UNKNOWN | Root has no `parent_id` but reports `init_source=parent-data`; no independent ancestry/source proof or accepted catalog provenance. Project creation metadata, zero writes, and an empty prior catalog observation do not prove synthetic-only contents or production separation. |
| Effective least-privilege staging identity | BLOCKED | Project permission is ADMIN. The one target role attempt had CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS and was deleted with owner approval; a fresh listing confirmed absence. No acceptable non-admin runtime role/effective grants are proven. |
| Network/TLS identity | BLOCKED | `block_public_connections=false`, IP allowlist empty, and the prior session reported `pg_stat_ssl.ssl=false`; `sslmode=verify-full` and certificate/hostname validation remain unproven. Free support for IP restriction is also unverified. |
| Schema/journal/migration result | PARTIAL | PR #93 source CI verifies Drizzle journal/schema consistency. Provider schema was not compared and no migration was applied. |
| Backup/restore and recovery | NOT RUN | No current-target backup/restore or rollback drill occurred. |
| Vercel Hobby and Preview | HOBBY CONFIRMED; PREVIEW NOT READY/NOT RUN | The selected project has no deployment/source binding or smoke evidence in the latest readback. No deployment, secret, or environment change occurred. |

The source-guard PR #94 remains OPEN/DRAFT at `711eb80e73ec733173306a0aa50e1e6966ecb9d7`; exact run #40069661571 Gate A #120800163236 passed and independent PostgreSQL concurrency #120801284254 was SKIPPED. This validates only source guards. Provider identity, lineage, staging TLS, and catalog isolation remain unresolved.

## 4. F3 real staging UAT — BLOCKED

PR #96 remains OPEN/DRAFT at `477a0fe199debec67de071376d9338f956f9dc79`; exact run #40070054841 attempt 1 passed Gate A #120801347072 and disposable PostgreSQL 17 concurrency #120803138389. Focused tests are 14/14 PASS and the offline plan prints 21 scenarios; independent review found no P0–P2 source issue. This plan-only path does not load a live database/provider/app-server adapter; no real PostgreSQL 18 staging UAT/concurrency or HTTPS Preview smoke has run.

| Staging scenario | Status | Evidence |
|---|---|---|
| Resident annual cards, due/future state, paid receipts | NOT RUN on staging | No approved isolated target |
| Current/overdue online requests and future denial | NOT RUN on staging | No approved isolated target |
| Treasurer future cash, oldest-first allocation, idempotent retry | NOT RUN on staging | No approved isolated target |
| Role/tenant denial, duplicate/reversal, financial integrity | NOT RUN on staging | No approved isolated target |
| Real PostgreSQL 18 session concurrency | NOT RUN | PG17 disposable CI is separate evidence |
| Candidate Preview HTTPS smoke | NOT RUN | No confirmed Hobby-eligible Preview deployment or smoke result |

## 5. F4 release and recovery — NO-GO

| Requirement | Status | Evidence / limitation |
|---|---|---|
| Release notes reviewed against candidate diff | PASS — internal draft | PR #95; exact F1 SHA/results recorded; not approved for publication |
| Exact-head docs CI and production build | Previous source checks passed; current revision is separately tracked | The preceding PR #95 head `5ac931b48efb781d3e7a10b1a360496beabbbafe` passed run #40071118229 (Gate A #120804565777 and disposable PG17 #120805614522). That result does not transfer to the current packet revision. See the live PR #95 body and issue #83 for exact-head checks. Source CI does not replace staging acceptance. |
| Dependency risk review | PASS — PR #97 candidate only | The PR #93 baseline lockfile reported 7 findings (2 moderate, 4 high, 1 critical). PR #97 updates Next/eslint-config-next to 16.4.3, Zod to 4.6.6, Vitest to 5.0.5, and patched transitive Vite/Sharp/source-map-js packages. Fresh `npm audit --json` after clean install reports 0 findings. The direct audit and local-suite evidence is in [PR #97 comment #6379091869](https://github.com/Satsetx4/karturt/pull/97#issuecomment-6379091869). Exact dependency-candidate CI [#40056147121](https://github.com/Satsetx4/karturt/actions/runs/40056147121) passed Gate A and disposable PG17 concurrency on PR #97 SHA `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; this does not verify the combined PR #95 candidate. PR #97 remains open and unmerged. |
| Dependency artifact route | UNVERIFIED — conditional approval gate open | Owner comment #6379549869 conditionally allowed npm 11.19.0 only for lockfile generation after QA verified registry origin, package/lock integrity, clean `npm ci`, engine compatibility, and policy safeguards. Fresh QA on PR #97 verified npm/tarball SHA-512 integrity, all 620 lock resolutions against `registry.npmjs.org` with integrity, Node 24.19.0, clean install of 440 packages, `npm ls`, unchanged lock hash, zero audit findings, and `allow-remote=none`. Fresh `npm install --package-lock-only --ignore-scripts --engine-strict` under that safeguard failed with `EALLOWREMOTE`; QA did not retry or relax the safeguard. The conditional route remains UNVERIFIED and requires an approved alternative artifact route or a separate owner decision. Evidence: issue #83 comment #6380370363. |
| Preview workflow/deployment/smoke | NOT RUN | Hobby entitlement and project ownership are now confirmed. The project has no returned deployment, Git branch binding, or custom environment; a staging-only Preview target and smoke are not established. No deployment or secret/environment change occurred. |
| Production-scoped credentials or secrets | NOT USED | No production credential, database connection, or deployment occurred. This is an activity record, not a separate secrets-scanner attestation. |
| Current-target backup/restore and rollback | NOT RUN | Runbook describes the required steps, but no verified staging target or recovery drill exists. |
| Release scope/migration compatibility | PARTIAL | PR #93 has no migration file and Drizzle source checks pass; provider schema/backup compatibility remain unverified. |

Current Vercel and Neon metadata are recorded in [issue #83 comment #6381962416](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6381962416) and [issue #81 comment #6381962231](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6381962231). PR #95 prior head `d112c918af0924a595057aef120e2e52f67925af` contained dependency commit `0c84a32`; its `package.json` and `package-lock.json` blobs exactly match PR #97 SHA `6b39d13da0d5217e01f91d2697c68e1cf73ffa87` (`795bef48f9bd3f76950ac6e226c2c87c7ba41321` and `d8ee7ab268b81cee7c2a84e99fe330310333a4ae`). PR #95 exact-head checks must be recorded per source revision; no historical result transfers, and the conditional artifact policy gate remains UNVERIFIED.

## 6. Open risks and limitations

| Risk / severity | Evidence | Mitigation | Residual risk / owner |
|---|---|---|---|
| Dependency advisories on PR #93 baseline | Baseline audit reported 7 findings | PR #97 reports 0 findings on its exact package candidate; PR #95 carries identical package and lockfile blobs. Preceding packet SHA `097f8eef…` passed run #40067231392 Gate A and disposable PG17 concurrency; each new document SHA requires its own check, logged in the live PR and master checkpoint. The conditional artifact policy gate remains UNVERIFIED. | No audited dependency changes on protected main; owner decision or approved artifact route still required |
| Staging provenance/content unknown | Canonical project `flat-cloud-57657711` is Free PG18; root `init_source=parent-data` and missing `parent_id` leave lineage and synthetic-only contents unknown. Effective project permission is ADMIN. | Obtain independent source/isolation proof and a fresh owner-authorized next-step packet; no further SQL or provider mutation meanwhile | Unresolved; Neon/project owner |
| TLS/least privilege unknown | The overprivileged target role was owner-approved for deletion and its absence was verified. Public connections remain enabled, allowlist empty, prior session reported `pg_stat_ssl.ssl=false`, and no client certificate/hostname `verify-full` proof exists. | Do not change roles or run SQL; require fresh least-privilege and TLS/network PASS evidence plus direct owner authorization before resuming | Unresolved; staging owner |
| No real staging UAT/concurrency | No verified PG18 target; offline PG17 is not equivalent | Run F3 only after F2 evidence and authorization pass | Unresolved; staging/QA owners |
| No Preview or verified recovery drill | Vercel Hobby entitlement and team ownership are confirmed, but branch/source binding, a Preview deployment, and a current-target recovery drill are not established | Verify the owner-selected project scope and recovery target after F2 | Unresolved; release/platform owner |

## 7. Verdict and owner decision

- **F1 verdict:** `PASS — integrated unmerged candidate only` at PR #93 SHA `b8bc74a4202225d9a54728d2c10be247dec8318f`.
- **F2 verdict:** `BLOCKED — do not connect or mutate`.
- **F3 verdict:** `BLOCKED — offline preparation only; no real PG18 UAT`.
- **F4 verdict:** NO-GO — F2/F3 staging evidence, verified Preview scope and smoke, current-target recovery drill, and the conditional dependency artifact policy gate remain incomplete. PR #95 predecessor head `5ac931b48efb781d3e7a10b1a360496beabbbafe` passed run #40071118229 including disposable PG17 concurrency; those results apply only to that SHA. The current packet revision's exact-head checks are tracked in the live PR #95 and issue #83. No historical pass establishes staging acceptance.
- **Overall release verdict:** **NO-GO**. No combined release candidate is currently verified as promotable.
- **Owner production GO:** `NOT GIVEN` and not requested until F1–F4 objectively pass on a recorded candidate/environment.
- **Production deployment, credentials, database writes, migration, backup/restore, and cutover:** `NOT AUTHORIZED`.

### One bundled owner action packet

1. The canonical project already has `store_passwords=true`, which the owner has confirmed as the Neon default; its password was not retrieved, displayed, or used. The overprivileged target role disposition is closed: the owner approved deletion of only `karturt_f2_catalog_ro_20261024`, and a fresh role listing confirmed it absent. F2 remains stopped. To resume, the owner must directly provide or accept independent synthetic-only lineage/isolation, acceptable least-privilege identity, and PostgreSQL 18 client `sslmode=verify-full`/network evidence, then explicitly authorize the bounded next step. Until then, no SQL, role change, migration, seed, UAT, recovery, secret/environment, Preview, or deployment action.
2. The current mandate authorizes a non-production Preview smoke in the owner-selected Hobby project after F2 establishes a verified staging target and source/environment binding. The project currently has no deployment, Git branch binding, or custom environment; no Preview is safe to run yet. Use a named source SHA, no production credentials, and no environment/secret mutation.
3. Resolve the conditional npm 11.19.0 artifact route in comment #6379549869: choose an approved artifact route that passes lock generation with `allow-remote=none`, or record a separate owner decision that addresses the observed `EALLOWREMOTE` failure. The existing gate remains open; do not disable the safeguard or retry the failed command.

The owner selected the Vercel candidate and conditionally accepted the package route in [issue #83 comment #6379549869](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6379549869). The latest Vercel readback is [comment #6380430905](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6380430905). A distinct production GO is required only after technical gates pass.
Do not provide secrets or raw catalogs in this packet. Historical failures and skipped checks remain visible and do not inherit a passing result from another SHA, resource, or environment.
