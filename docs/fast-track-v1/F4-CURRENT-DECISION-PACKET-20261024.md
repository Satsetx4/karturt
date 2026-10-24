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

Latest read-only control-plane evidence is in [issue #81 comment #6379708129](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6379708129). A refreshed inventory checked six KartuRT PostgreSQL 18/Singapore staging candidates; all six roots report init_source=parent-data and expose no parent ID, so none proves synthetic-only lineage or production separation. Neon Free is confirmed for the satset organization, but the project with the newest staging name remains an ADMIN-scoped, publicly reachable candidate and is not an approved connection target. A clean project-create preflight was rejected because Neon does not support disabling password storage; no project was created. The separate credential authorization is pending. No database connection, SQL, migration, seed, backup, restore, or provider mutation occurred.

| Evidence | Status | Current readback / gap |
|---|---|---|
| Neon projects and Free plan | PARTIAL | Organization satset reports Free. Six existing KartuRT candidates are PostgreSQL 18 in Singapore; their root branches all report init_source=parent-data, with no parent ID exposed. See issue #81 comment #6379708129. None is approved as a connection target. |
| Production separation and synthetic-only lineage | UNKNOWN | All six candidate roots report init_source=parent-data; the parent is not identified. Their project names, Free labels, and zero-write counters do not prove contents or production separation. A fresh project was not created because Neon rejected the request to disable default password storage; no alternative lineage proof exists. |
| Effective least-privilege staging identity | BLOCKED | Existing candidate readbacks show effective project permission ADMIN; no target-scoped non-admin UAT identity or effective grants are proven. |
| Network/TLS identity | UNKNOWN | Existing candidate settings show public connections enabled and an empty IP allowlist. No approved target or target-bound TLS certificate/hostname verification exists. Any future clean project must remain inaccessible until scoped identity, network rules, and verify-full TLS evidence are authorized and verified. |
| Schema/journal/migration result | PARTIAL | Source CI verifies Drizzle journal/schema consistency on PR #93. No connection was made to compare the provider schema or run an authorized migration. |
| Backup/restore and recovery | NOT RUN | No verified target exists for an approved current-target backup/restore drill. |
| Vercel Hobby and Preview | CONDITIONAL OWNER APPROVAL; READINESS UNKNOWN | Owner selected sekawan/karturt-review-staging-20261012 as a candidate Preview only. Read-only recheck ([issue #83 comment #6379775936](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6379775936)) confirms the project is under the connected sekawan team, but no Hobby tier was returned; live=false, zero deployments and custom environments, and the verified default domain has no branch or custom-environment binding. A default domain is not Preview evidence. No deployment or secret/environment change is authorized. |

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
| Preview workflow/deployment/smoke | NOT RUN | The owner selected a candidate Preview project, subject to verification of Hobby entitlement, ownership, branch/environment binding, and staging-only isolation. No deployment or smoke ran; the owner approval does not authorize deployment or secret/environment changes. |
| Production-scoped credentials or secrets | NOT USED | No production credential, database connection, or deployment occurred. This is an activity record, not a separate secrets-scanner attestation. |
| Current-target backup/restore and rollback | NOT RUN | Runbook describes the required steps, but no verified staging target or recovery drill exists. |
| Release scope/migration compatibility | PARTIAL | PR #93 has no migration file and Drizzle source checks pass; provider schema/backup compatibility remain unverified. |

Current Vercel metadata, owner decisions, and dependency-route QA are consolidated in [issue #83 comment #6379775936](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6379775936); refreshed Neon lineage and the credential gate are in [issue #81 comment #6379708129](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6379708129). The dependency audit itself remains tied to PR #97 candidate SHA 6b39d13da0d5217e01f91d2697c68e1cf73ffa87; zero findings and package checks do not transfer to another source SHA.

## 6. Open risks and limitations

| Risk / severity | Evidence | Mitigation | Residual risk / owner |
|---|---|---|---|
| Dependency advisories on PR #93 baseline | Baseline audit reported 7 findings | PR #97 is an unmerged candidate with 0 audit findings and exact Gate A/concurrency pass on its own SHA; independent package-route QA passed with a historical-provenance limitation; do not transfer candidate status to another SHA | PR #97 candidate only; combined PR #95 verification remains open; protected main unchanged |
| Staging provenance/content unknown | All six KartuRT candidate roots report init_source=parent-data and omit parent ID; content and production separation remain unknown; effective access is ADMIN | No database session; obtain separately scoped approval for any clean-project creation and establish root lineage, synthetic-only contents, then least-privilege identity | Unresolved; Neon/project owner |
| TLS/least privilege unknown | No scoped UAT runner or certificate identity evidence; existing candidates allow public connections | Establish a target-bound non-admin identity and validated TLS after the credential/network gate passes | Unresolved; staging owner |
| No real staging UAT/concurrency | No verified PG18 target; offline PG17 is not equivalent | Run F3 only after F2 evidence and authorization pass | Unresolved; staging/QA owners |
| No Preview or verified recovery drill | Vercel Hobby entitlement and branch/environment binding are not exposed by current metadata; no Preview deployment or current-target recovery drill exists | Verify the owner-selected project scope and recovery target after F2 | Unresolved; release/platform owner |

## 7. Verdict and owner decision

- **F1 verdict:** `PASS — integrated unmerged candidate only` at PR #93 SHA `b8bc74a4202225d9a54728d2c10be247dec8318f`.
- **F2 verdict:** `BLOCKED — do not connect or mutate`.
- **F3 verdict:** `BLOCKED — offline preparation only; no real PG18 UAT`.
- **F4 verdict:** NO-GO — F2/F3 staging evidence, verified Preview scope and smoke, and current-target recovery drill remain incomplete. Preceding PR #95 packet head `bce72e48351dc79713a8c89154fefee557c39ad9` passed exact CI and independent review; that result does not transfer to later source. The live PR #95 checks identify the current packet SHA and its exact-head result.
- **Overall release verdict:** **NO-GO**. No combined promotable release candidate exists.
- **Owner production GO:** `NOT GIVEN` and not requested until F1–F4 objectively pass on a recorded candidate/environment.
- **Production deployment, credentials, database writes, migration, backup/restore, and cutover:** `NOT AUTHORIZED`.

### One bundled owner action packet

1. Resolve the Neon credential gate: the Free organization is confirmed, all six existing roots remain unverified, and Neon rejected project creation with password storage disabled. Approve the default owner-password storage for a new isolated project without retrieving or using that password, or provide an owner-approved credential-free creation method. No database session or provider mutation may precede that decision.
2. Verify Hobby entitlement, project ownership, branch/environment binding, and staging-only isolation for the selected Vercel project. Current metadata confirms team ownership only; it does not establish Hobby or Preview readiness. Deployment and secret/environment changes remain separately unauthorized.
3. Package-route QA passed with the historical npm 11.19.0 lock-generation provenance limitation documented above. No additional owner action is needed unless a direct invocation/process record is required to remove that limitation.

The owner selected the Vercel candidate and conditionally accepted the package route in [issue #83 comment #6379549869](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6379549869). The latest readback and QA checkpoint is [comment #6379775936](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6379775936). A distinct production GO is required only after technical gates pass.
Do not provide secrets or raw catalogs in this packet. Historical failures and skipped checks remain visible and do not inherit a passing result from another SHA, resource, or environment.
