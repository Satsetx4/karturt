# KartuRT V1 Fast Track — Current Release Decision Packet

**Decision date:** 2026-10-24 (Asia/Bangkok)  
**Verdict:** **NO-GO — staging and integrated release evidence remain outstanding**
**Release target after all gates pass:** `PRODUCTION READY — AWAITING OWNER GO`

This is the current evidence-based decision packet. It records work completed and blockers found; it does not authorize a production action. Fast Track PRs #84, #85, and #93–#97 remain OPEN/DRAFT. `main` remains unchanged at `96c84588ae0c13f68a17cffd997a3e583fb7da82`.

## 1. Candidate identity and source evidence

There is **no verified staging/release candidate ready for promotion**. The previous PR #95 documentation head `ce9067482937393f7ce41094506d7ec1a0544e6f` passed its exact-source checks; this packet refresh needs its own exact-head checks. F2 is not cleared, F3 has no real staging UAT, and no verified Preview or recovery drill exists. PR #97 has zero npm audit findings on its unmerged candidate; the lock-generation artifact route remains unverified.

| Item | Current evidence |
|---|---|
| Application candidate | [PR #93](https://github.com/Satsetx4/karturt/pull/93), OPEN/DRAFT, exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`, based on protected `main` `96c84588ae0c13f68a17cffd997a3e583fb7da82` |
| F2 source-guard candidate | [PR #94](https://github.com/Satsetx4/karturt/pull/94), OPEN/DRAFT, exact head `2882b177e674fe577643b792e0ca3566d52ef754`; based on protected `main` |
| F3 offline rehearsal | [PR #96](https://github.com/Satsetx4/karturt/pull/96), OPEN/DRAFT, exact head `865659fdf952b90ea0f44f8fcb5ec39e8697f78e`; based on PR #93 head `b8bc74a…` |
| Dependency remediation | [PR #97](https://github.com/Satsetx4/karturt/pull/97), OPEN/DRAFT, exact head `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; dependency-only candidate based on PR #93 |
| F4 documents and this packet | [PR #95](https://github.com/Satsetx4/karturt/pull/95), OPEN/DRAFT; carries the dependency patch from PR #97. Its current source SHA, exact-head CI and review are tracked on PR #95 and issue #83. |
| Planning/Kanban | [PR #84](https://github.com/Satsetx4/karturt/pull/84), OPEN/DRAFT, exact head `468ed839041fc83481e21eb61eebbb055b1d88f5`; Gate A run #40048183786 attempt 2 passed and documentation-branch concurrency was skipped |
| Candidate migration files | PR #93 adds no migration file. Provider schema and migration state were not inspected through a database session. |
| Independent review | PR #93 exact head and previous PR #95 head `ce9067482937393f7ce41094506d7ec1a0544e6f`: no P0/P1/P2 findings. PR #96 exact commit `865659fdf952b90ea0f44f8fcb5ec39e8697f78e`: no P0/P1/P2 content findings. |

### Exact-head CI evidence

| Source SHA / PR | Run and attempt | Gate A | Independent PostgreSQL job | Meaning |
|---|---|---|---|---|
| PR #93 `b8bc74a…` | [#40040334501](https://github.com/Satsetx4/karturt/actions/runs/40040334501), attempt 1 | #120709660348 SUCCESS | #120712264849 SUCCESS, disposable PG17 | F1 candidate CI only; not staging PG18 |
| PR #94 `2882b17…` | [#40037337893](https://github.com/Satsetx4/karturt/actions/runs/40037337893), attempt 2 | #120701070602 SUCCESS | #120704030518 SKIPPED | Source guard checks only; concurrency unverified |
| PR #96 `865659f…` | [#40059492827](https://github.com/Satsetx4/karturt/actions/runs/40059492827), attempt 1 | #120769702033 SUCCESS | #120771496144 SUCCESS, disposable PG17 | 20 offline scenarios and source regression evidence only; not real staging PG18 |
| PR #97 `6b39d13…` | [#40056147121](https://github.com/Satsetx4/karturt/actions/runs/40056147121), attempt 1 | #120759456983 SUCCESS | #120761361103 SUCCESS, disposable PG17 | Dependency candidate only; not combined F4 packet or staging PG18 |
| PR #95 previous packet head `ce906748…` | [#40057250480](https://github.com/Satsetx4/karturt/actions/runs/40057250480), attempt 1 | #120762834917 SUCCESS | #120764701575 SUCCESS, disposable PG17 | Passed before this packet refresh; refreshed source SHA and results are tracked on PR #95 and issue #83 |
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

F1 is **not merged**. Its PG17 CI job is not proof of F3 PostgreSQL 18 staging behavior.

## 3. F2 staging identity, isolation, and recovery — BLOCKED

Latest read-only control-plane evidence is on [issue #81 comment #6379371513](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6379371513). It refreshes the current candidate project/root and confirms that lineage/content, scoped access, and network isolation remain unproven. The earlier six-project inventory at comment #6379021627 is historical and is not treated as current-target evidence. No database connection, SQL, migration, seed, backup, restore, or provider mutation was performed.

| Evidence | Status | Current readback / gap |
|---|---|---|
| Neon project/branch and Free plan | PARTIAL | Latest metadata identifies the Free organization and current candidate project ancient-sound-84300774 (karturt-v1-fast-track-staging-20261024), PostgreSQL 18/Singapore, root br-young-bonus-ao4jqzo3 (karturt-staging-root-20261024). This is not an approved connection target; metadata counters do not prove its contents or production separation. |
| Production separation and synthetic-only lineage | UNKNOWN | The current candidate root reports init_source=parent-data and no parent ID is exposed. This means the parent is unidentified; neither synthetic-only content nor production separation is established. A Free-plan label, zero-write counter, or project name does not prove isolation. |
| Effective least-privilege staging identity | BLOCKED | Current readback shows effective project permission ADMIN; no target-scoped non-admin UAT identity or effective grants are proven. |
| Network/TLS identity | UNKNOWN | Current project settings show block_public_connections=false and an empty allowed-IP list. No target-bound TLS certificate/hostname verification evidence exists. |
| Schema/journal/migration result | PARTIAL | Source CI verifies Drizzle journal/schema consistency on PR #93. No connection was made to compare the provider schema or run an authorized migration. |
| Backup/restore and recovery | NOT RUN | No verified target exists for an approved current-target backup/restore drill. |
| Vercel Hobby and Preview | UNKNOWN | Latest [issue #83 refresh](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6379371715) reports that the team response has no plan/tier field. Project karturt-review-staging-20261012 is live=false with no latest deployment and zero deployments; no branch/custom environment is bound. Hobby eligibility, a Preview target and smoke remain UNKNOWN/NOT RUN. |

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
| Exact-head docs CI and production build | PASS on previous PR #95 SHA; refreshed source checks pending | Run #40057250480 attempt 1: Gate A #120762834917 and disposable PostgreSQL 17 concurrency #120764701575 both SUCCESS on `ce9067482937393f7ce41094506d7ec1a0544e6f`. The refresh gets its own exact-head run; exact candidate checks do not replace staging acceptance. |
| Dependency risk review | PASS — PR #97 candidate only | The PR #93 baseline lockfile reported 7 findings (2 moderate, 4 high, 1 critical). PR #97 updates Next/eslint-config-next to 16.4.3, Zod to 4.6.6, Vitest to 5.0.5, and patched transitive Vite/Sharp/source-map-js packages. Fresh `npm audit --json` after clean install reports 0 findings. The direct audit and local-suite evidence is in [PR #97 comment #6379091869](https://github.com/Satsetx4/karturt/pull/97#issuecomment-6379091869). Exact dependency-candidate CI [#40056147121](https://github.com/Satsetx4/karturt/actions/runs/40056147121) passed Gate A and disposable PG17 concurrency on PR #97 SHA `6b39d13da0d5217e01f91d2697c68e1cf73ffa87`; this does not verify the combined PR #95 candidate. PR #97 remains open and unmerged. |
| Dependency artifact route | UNVERIFIED — package-policy decision pending | npm 12 retained `allow-remote=none`; its `--package-lock-only` attempt returned `EALLOWREMOTE`. A temporary npm 11.19.0 CLI was installed through the ordinary npm registry path and used to generate the candidate lockfile. No explicit `allow-remote` override or persistent npm configuration change was made. Clean `npm ci` passed locally and in CI on Node 24, with lockfile registry hosts at `registry.npmjs.org`. These facts do not establish that using another CLI after the npm 12 policy rejection is approved; owner confirmation or an approved artifact route is still required. |
| Preview workflow/deployment/smoke | NOT RUN | The Vercel project/domain exist, but team plan and Preview target/deployment are unproven; no smoke ran |
| Production-scoped credentials or secrets | NOT USED | No production credential, database connection, or deployment occurred. This is an activity record, not a separate secrets-scanner attestation. |
| Current-target backup/restore and rollback | NOT RUN | Runbook describes the required steps, but no verified staging target or recovery drill exists. |
| Release scope/migration compatibility | PARTIAL | PR #93 has no migration file and Drizzle source checks pass; provider schema/backup compatibility remain unverified. |

The [latest issue #83 provider and owner-action update](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6379543637) records current Vercel/Neon evidence and links the consolidated owner packet. The dependency audit and local-suite evidence is in [PR #97 comment #6379091869](https://github.com/Satsetx4/karturt/pull/97#issuecomment-6379091869). The listed advisories applied to the PR #93 baseline; the unmerged PR #97 candidate audit reports zero findings on its own source. The npm artifact route remains unverified, and no evidence transfers to another source SHA.

## 6. Open risks and limitations

| Risk / severity | Evidence | Mitigation | Residual risk / owner |
|---|---|---|---|
| Dependency advisories on PR #93 baseline | Baseline audit reported 7 findings | PR #97 is an unmerged candidate with 0 audit findings and exact Gate A/concurrency pass on its own SHA; do not transfer candidate status to another SHA | PR #97 candidate only; artifact route decision and combined PR #95 verification remain open; protected `main` unchanged |
| Staging provenance/content unknown | Current candidate root says init_source=parent-data and omits parent_id; project content and production separation remain unknown; effective project access is ADMIN | No database session; prove root lineage and synthetic-only contents, then establish scoped identity | Unresolved; Neon/project owner |
| TLS/least privilege unknown | No scoped UAT runner or certificate identity evidence; public connections enabled | Establish a target-bound non-admin identity and validated TLS before access | Unresolved; staging owner |
| No real staging UAT/concurrency | No verified PG18 target; offline PG17 is not equivalent | Run F3 only after F2 evidence and authorization pass | Unresolved; staging/QA owners |
| No Preview or verified recovery drill | Vercel plan/deployment unknown; no approved target for backup/restore | Verify Hobby/Preview and recovery target after F2 | Unresolved; release/platform owner |

## 7. Verdict and owner decision

- **F1 verdict:** `PASS — integrated unmerged candidate only` at PR #93 SHA `b8bc74a4202225d9a54728d2c10be247dec8318f`.
- **F2 verdict:** `BLOCKED — do not connect or mutate`.
- **F3 verdict:** `BLOCKED — offline preparation only; no real PG18 UAT`.
- **F4 verdict:** NO-GO — F2/F3 staging evidence, Preview smoke, current-target recovery drill, and package-policy decision incomplete. Previous PR #95 source `ce9067482937393f7ce41094506d7ec1a0544e6f` passed exact candidate CI before this refresh; updated-head checks are tracked on PR #95 and issue #83.
- **Overall release verdict:** **NO-GO**. No combined promotable release candidate exists.
- **Owner production GO:** `NOT GIVEN` and not requested until F1–F4 objectively pass on a recorded candidate/environment.
- **Production deployment, credentials, database writes, migration, backup/restore, and cutover:** `NOT AUTHORIZED`.

### One bundled owner action packet

1. For current candidate ancient-sound-84300774 / br-young-bonus-ao4jqzo3, prove production-independent synthetic-only lineage or identify a verified clean Free target; approve target-scoped private access and PostgreSQL 18 TLS/certificate validation.
2. Confirm Vercel Hobby eligibility and a staging-only Preview target.
3. Approve the npm 11.19.0 lock-generation route used by PR #97 or specify an approved artifact route; npm 12 returned EALLOWREMOTE and no persistent override was made.
The bundled owner-action packet is in issue #83 comment #6379505294. A distinct production GO is required only after technical gates pass.
Do not provide secrets or raw catalogs in this packet. Historical failures and skipped checks remain visible and do not inherit a passing result from another SHA, resource, or environment.
