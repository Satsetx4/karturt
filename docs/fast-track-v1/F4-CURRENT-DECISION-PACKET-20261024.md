# KartuRT V1 Fast Track — Current Release Decision Packet

**Decision date:** 2026-10-24 (Asia/Bangkok)  
**Verdict:** **NO-GO — staging and integrated release evidence remain outstanding**
**Release target after all gates pass:** `PRODUCTION READY — AWAITING OWNER GO`

This is the current evidence-based decision packet. It records work completed and blockers found; it does not authorize a production action. Fast Track PRs #84, #85, and #93–#97 remain OPEN/DRAFT. `main` remains unchanged at `96c84588ae0c13f68a17cffd997a3e583fb7da82`.

## 1. Candidate identity and source evidence

There is **no verified staging/release candidate ready for promotion**. PR #95's preceding packet head `bce72e48351dc79713a8c89154fefee557c39ad9` passed exact run #40061915764 attempt 1: Gate A #120777072143 and independent disposable PostgreSQL 17 concurrency #120778181422 both SUCCESS. Independent review found no P0/P1 content findings; it identified stale exact-head status in the packet/PR/issue records, which this refresh corrects. This is candidate CI/review only, not staging PostgreSQL 18 UAT. Check PR #95 for the current packet source SHA and its exact-head run; results never transfer to later source changes. F2 is not cleared, F3 has no real staging UAT, and no verified Preview or recovery drill exists. PR #97 has zero npm audit findings on its unmerged candidate; its conditional lock-generation route has passed independent QA with a documented provenance limit.

| Item | Current evidence |
|---|---|
| Application candidate | [PR #93](https://github.com/Satsetx4/karturt/pull/93), OPEN/DRAFT, exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`, based on protected `main` `96c84588ae0c13f68a17cffd997a3e583fb7da82` |
| F2 source-guard candidate | [PR #94](https://github.com/Satsetx4/karturt/pull/94), OPEN/DRAFT, exact head `2882b177e674fe577643b792e0ca3566d52ef754`; based on protected `main` |
| F3 offline rehearsal | [PR #96](https://github.com/Satsetx4/karturt/pull/96), OPEN/DRAFT, exact head `865659fdf952b90ea0f44f8fcb5ec39e8697f78e`; based on PR #93 head `b8bc74a…` |
| Dependency remediation | [PR #97](https://github.com/Satsetx4/karturt/pull/97), OPEN/DRAFT, exact head `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; dependency-only candidate based on PR #93 |
| F4 documents and this packet | [PR #95](https://github.com/Satsetx4/karturt/pull/95), OPEN/DRAFT. Preceding packet head `bce72e48351dc79713a8c89154fefee557c39ad9` passed exact run #40061915764 (Gate A #120777072143 and independent PostgreSQL concurrency #120778181422). This packet refresh is a later source revision; its exact-head result is listed in the live PR checks. |
| Planning/Kanban | [PR #84](https://github.com/Satsetx4/karturt/pull/84), OPEN/DRAFT, exact head `468ed839041fc83481e21eb61eebbb055b1d88f5`; Gate A run #40048183786 attempt 2 passed and documentation-branch concurrency was skipped |
| Candidate migration files | PR #93 adds no migration file. Provider schema and migration state were not inspected through a database session. |
| Independent review | PR #93 exact head and previous PR #95 head `ce9067482937393f7ce41094506d7ec1a0544e6f`: no P0/P1/P2 findings. PR #96 exact commit `865659fdf952b90ea0f44f8fcb5ec39e8697f78e`: no P0/P1/P2 content findings. PR #95 head `e3aad9ee6b9998e9a0869370a5786ca6268c00d4`: no P0/P1/P2 findings. Review of `bce72e48351dc79713a8c89154fefee557c39ad9` found no P0/P1 content findings; the P2 was stale exact-head status across records and is addressed by this refresh and the live PR/issue checkpoints. |

### Exact-head CI evidence

| Source SHA / PR | Run and attempt | Gate A | Independent PostgreSQL job | Meaning |
|---|---|---|---|---|
| PR #93 `b8bc74a…` | [#40040334501](https://github.com/Satsetx4/karturt/actions/runs/40040334501), attempt 1 | #120709660348 SUCCESS | #120712264849 SUCCESS, disposable PG17 | F1 candidate CI only; not staging PG18 |
| PR #94 `2882b17…` | [#40037337893](https://github.com/Satsetx4/karturt/actions/runs/40037337893), attempt 2 | #120701070602 SUCCESS | #120704030518 SKIPPED | Source guard checks only; concurrency unverified |
| PR #96 `865659f…` | [#40059492827](https://github.com/Satsetx4/karturt/actions/runs/40059492827), attempt 1 | #120769702033 SUCCESS | #120771496144 SUCCESS, disposable PG17 | 20 offline scenarios and source regression evidence only; not real staging PG18 |
| PR #97 `6b39d13…` | [#40056147121](https://github.com/Satsetx4/karturt/actions/runs/40056147121), attempt 1 | #120759456983 SUCCESS | #120761361103 SUCCESS, disposable PG17 | Dependency candidate only; not combined F4 packet or staging PG18 |
| PR #95 previous packet head `ce906748…` | [#40057250480](https://github.com/Satsetx4/karturt/actions/runs/40057250480), attempt 1 | #120762834917 SUCCESS | #120764701575 SUCCESS, disposable PG17 | Passed before this packet refresh; refreshed source SHA and results are tracked on PR #95 and issue #83 |
| PR #95 packet head e3aad9ee | [#40060899632](https://github.com/Satsetx4/karturt/actions/runs/40060899632), attempt 1 | #120773959773 SUCCESS | #120775867585 SUCCESS, disposable PostgreSQL | Exact packet-candidate source checks only; not staging PostgreSQL 18 UAT |
| PR #95 preceding packet head `bce72e4…` | [#40061915764](https://github.com/Satsetx4/karturt/actions/runs/40061915764), attempt 1 | #120777072143 SUCCESS | #120778181422 SUCCESS, disposable PG17 | Exact checks for that packet revision only; this later refresh must be checked separately |
| PR #95 previous head `2f7ab4e…` | [#40041547299](https://github.com/Satsetx4/karturt/actions/runs/40041547299), retry attempt 2 | #120714648846 SUCCESS | #120717077129 SUCCESS, disposable PG17 | F4 docs head before this packet edit |
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

Fresh read-only control-plane evidence is recorded in [issue #81 comment #6380028858](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6380028858). The owner authorized exactly one new Neon Free project with `store_passwords=true` in [comment #6379985949](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6379985949); the creation is recorded in [#6380002029](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6380002029). The new project `flat-cloud-57657711` is PG18/Singapore and has READY root `br-sparkling-flower-azordm9k`, active endpoint `ep-red-boat-azzqyf45`, database `karturt_staging`, and only the password-authenticated owner role. The root exposes no `parent_id` but reports `init_source=parent-data`; the creation record says no production or prior-project source/copy was supplied. Neither field nor project creation verifies catalog contents or production separation. Effective permission is ADMIN, public connections are enabled, and the IP allowlist is empty. No DB session, SQL, migration, seed, backup, restore, or additional provider mutation occurred. F2 remains BLOCKED before DB access.

| Evidence | Status | Current readback / gap |
|---|---|---|
| Neon project and Free plan | PARTIAL | Organization `satset` reports Free. The owner-approved new project is `flat-cloud-57657711`, PG18/Singapore; root `br-sparkling-flower-azordm9k` is READY/default/primary and endpoint `ep-red-boat-azzqyf45` is ACTIVE/read-write/non-pooled. The database is `karturt_staging` (ID `747782`). Fresh readback: issue #81 comment #6380028858. |
| Production separation and synthetic-only lineage | UNKNOWN | Creation record #6380002029 says no production or prior-project source/copy was supplied. The new root has no `parent_id`, but reports `init_source=parent-data`; Neon’s own branch example uses this value on an unparented root, so it does not identify a source. No DB catalog check or independent production-project reconciliation was performed. The project name, zero reported writes, and separate project ID do not prove synthetic-only contents. |
| Effective least-privilege staging identity | BLOCKED | Only listed role is `karturt_staging_owner` with password authentication; effective project permission is ADMIN. No target-scoped non-admin runtime identity or effective grants are proven. |
| Network/TLS identity | BLOCKED | Project metadata reports public connections enabled and an empty IP allowlist; endpoint metadata reports `passwordless_access=true`, but no database authentication was exercised. No `sslmode=verify-full` or certificate/hostname verification exists. |
| Schema/journal/migration result | PARTIAL | Source CI verifies Drizzle journal/schema consistency on PR #93. No connection was made to compare the provider schema or run an authorized migration. |
| Backup/restore and recovery | NOT RUN | No verified target exists for an approved current-target backup/restore drill. |
| Vercel Hobby and Preview | HOBBY CONFIRMED; PREVIEW NOT READY/NOT RUN | Fresh connected-team deployment context reports `sekawan` is Hobby. Project `karturt-review-staging-20261012` is owned by that team, but has `live=false`, no latest deployment, zero deployment records, one verified default domain with no branch binding, and zero custom environments. Current metadata does not establish a Git binding or staging-only Preview target. No Preview deployment or smoke occurred. |

The source guard PR #94 has an empty target allowlist and rejects unverified staging labels before pool creation. Its Gate A passed and independent concurrency was skipped. Independent review found no staging bypass; its production-label caveat is a separate production-operation concern, not production authorization.

## 4. F3 real staging UAT — BLOCKED

PR #96 contains 20 offline scenarios and passed exact-head Gate A plus disposable PG17 CI on `865659fdf952b90ea0f44f8fcb5ec39e8697f78e`: run #40059492827 attempt 1, Gate A #120769702033 SUCCESS and independent disposable PostgreSQL 17 concurrency #120771496144 SUCCESS. Its plan-only path does not load a live database/provider/app-server adapter, and the execute option has no live path; these checks do not establish F3 staging acceptance.

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
| Exact-head docs CI and production build | Each packet source requires its own exact-head result | Prior packet run #40061915764 attempt 1: Gate A #120777072143 and disposable PostgreSQL 17 concurrency #120778181422 both SUCCESS on `bce72e48351dc79713a8c89154fefee557c39ad9`. The present refresh is later source; its current exact-head result is on PR #95 and is not inferred from prior runs. These checks do not replace staging acceptance. |
| Dependency risk review | PASS — PR #97 candidate only | The PR #93 baseline lockfile reported 7 findings (2 moderate, 4 high, 1 critical). PR #97 updates Next/eslint-config-next to 16.4.3, Zod to 4.6.6, Vitest to 5.0.5, and patched transitive Vite/Sharp/source-map-js packages. Fresh `npm audit --json` after clean install reports 0 findings. The direct audit and local-suite evidence is in [PR #97 comment #6379091869](https://github.com/Satsetx4/karturt/pull/97#issuecomment-6379091869). Exact dependency-candidate CI [#40056147121](https://github.com/Satsetx4/karturt/actions/runs/40056147121) passed Gate A and disposable PG17 concurrency on PR #97 SHA `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; this does not verify the combined PR #95 candidate. PR #97 remains open and unmerged. |
| Dependency artifact route | PASS WITH PROVENANCE LIMIT | Independent QA passed registry origin, package/lock specification and integrity, clean npm ci reproducibility, engine compatibility, and EALLOWREMOTE/allow-remote safeguards on PR #97 SHA 6b39d13da0d5217e01f91d2697c68e1cf73ffa87. QA used Node 24.19.0/npm 12.0.2 with allow-remote=none; clean install audited 441 packages with 0 vulnerabilities. The temporary npm 11.19.0 lock-generation route is supported by the supplied execution record, but its historical invocation/process logs were not independently reconstructed. npm warned that user-level .npmrc allow-scripts=esbuild is ignored in favor of the existing project-level allowScripts list; no tracked npm configuration or persistent override changed. |
| Preview workflow/deployment/smoke | NOT RUN | Hobby entitlement and project ownership are now confirmed. The project has no returned deployment, Git branch binding, or custom environment; a staging-only Preview target and smoke are not established. No deployment or secret/environment change occurred. |
| Production-scoped credentials or secrets | NOT USED | No production credential, database connection, or deployment occurred. This is an activity record, not a separate secrets-scanner attestation. |
| Current-target backup/restore and rollback | NOT RUN | Runbook describes the required steps, but no verified staging target or recovery drill exists. |
| Release scope/migration compatibility | PARTIAL | PR #93 has no migration file and Drizzle source checks pass; provider schema/backup compatibility remain unverified. |

Current Vercel and Neon metadata are recorded in [issue #83 comment #6380051907](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6380051907) and [issue #81 comment #6380028858](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6380028858). The dependency audit itself remains tied to PR #97 candidate SHA `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; zero findings and package checks do not transfer to another source SHA.

## 6. Open risks and limitations

| Risk / severity | Evidence | Mitigation | Residual risk / owner |
|---|---|---|---|
| Dependency advisories on PR #93 baseline | Baseline audit reported 7 findings | PR #97 is an unmerged candidate with 0 audit findings and exact Gate A/concurrency pass on its own SHA; independent package-route QA passed with a historical-provenance limitation; do not transfer candidate status to another SHA | PR #97 candidate only; combined PR #95 verification remains open; protected main unchanged |
| Staging provenance/content unknown | New project `flat-cloud-57657711` is a separate owner-approved Free PG18 project; creation record says no existing project source/copy was supplied. Catalog contents and production separation remain unverified; root field `init_source=parent-data` is not conclusive. Effective access is ADMIN. | Obtain target-scoped approval for any catalog/provenance check and role/network change; preserve no-owner-password handling | Unresolved; Neon/project owner |
| TLS/least privilege unknown | Only owner role exists; public connections enabled, allowlist empty; no certificate identity proof | Obtain a scoped non-admin identity and prove `verify-full` TLS before any session | Unresolved; staging owner |
| No real staging UAT/concurrency | No verified PG18 target; offline PG17 is not equivalent | Run F3 only after F2 evidence and authorization pass | Unresolved; staging/QA owners |
| No Preview or verified recovery drill | Vercel Hobby entitlement and team ownership are confirmed, but branch/source binding, a Preview deployment, and a current-target recovery drill are not established | Verify the owner-selected project scope and recovery target after F2 | Unresolved; release/platform owner |

## 7. Verdict and owner decision

- **F1 verdict:** `PASS — integrated unmerged candidate only` at PR #93 SHA `b8bc74a4202225d9a54728d2c10be247dec8318f`.
- **F2 verdict:** `BLOCKED — do not connect or mutate`.
- **F3 verdict:** `BLOCKED — offline preparation only; no real PG18 UAT`.
- **F4 verdict:** NO-GO — F2/F3 staging evidence, verified Preview scope and smoke, and current-target recovery drill remain incomplete. Preceding PR #95 packet head `bce72e48351dc79713a8c89154fefee557c39ad9` passed exact CI and independent review; that result does not transfer to later source. The live PR #95 checks identify the current packet SHA and its exact-head result.
- **Overall release verdict:** **NO-GO**. No combined promotable release candidate exists.
- **Owner production GO:** `NOT GIVEN` and not requested until F1–F4 objectively pass on a recorded candidate/environment.
- **Production deployment, credentials, database writes, migration, backup/restore, and cutover:** `NOT AUTHORIZED`.

### One bundled owner action packet

1. Neon project creation is complete under the exact authorization in #81 comment #6379985949. Before further F2 work, authorize the exact target-scoped operations required to establish initial-catalog provenance, create/configure a non-admin role and safe credential path, and set/verify network restrictions and `verify-full` TLS. The existing authorization forbids any database session/SQL or role/permission/secret/network change until that separate target-scoped approval is recorded; do not retrieve or use the owner password.
2. Vercel team Hobby and project ownership are verified. The selected project still has no deployment, Git branch binding, or custom environment. Decide whether to authorize a clearly scoped, non-production Preview deployment for a named source SHA using no production credentials and no environment/secret mutation; until then, keep Preview smoke NOT RUN.
3. Package-route QA passed with the historical npm 11.19.0 lock-generation provenance limitation documented above. No additional owner action is needed unless a direct invocation/process record is required to remove that limitation.

The owner selected the Vercel candidate and conditionally accepted the package route in [issue #83 comment #6379549869](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6379549869). The latest readback is [comment #6380051907](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6380051907). A distinct production GO is required only after technical gates pass.
Do not provide secrets or raw catalogs in this packet. Historical failures and skipped checks remain visible and do not inherit a passing result from another SHA, resource, or environment.
