# KartuRT V1 Fast Track — Current Release Decision Packet

**Decision date:** 2026-10-24 (Asia/Bangkok)  
**Verdict:** **NO-GO — remediation and staging evidence remain outstanding**  
**Release target after all gates pass:** `PRODUCTION READY — AWAITING OWNER GO`

This is the current evidence-based decision packet. It records work completed and blockers found; it does not authorize a production action. Fast Track PRs #84, #85, and #93–#96 remain OPEN/DRAFT. `main` remains unchanged at `96c84588ae0c13f68a17cffd997a3e583fb7da82`.

## 1. Candidate identity and source evidence

There is **no combined F1–F4 release candidate**. The application candidate below is verified as an unmerged source candidate only. F2 is not cleared, F3 has no real staging UAT, dependencies have unresolved advisories, and no Preview or recovery drill exists.

| Item | Current evidence |
|---|---|
| Application candidate | [PR #93](https://github.com/Satsetx4/karturt/pull/93), OPEN/DRAFT, exact head `b8bc74a4202225d9a54728d2c10be247dec8318f`, based on protected `main` `96c84588ae0c13f68a17cffd997a3e583fb7da82` |
| F2 source-guard candidate | [PR #94](https://github.com/Satsetx4/karturt/pull/94), OPEN/DRAFT, exact head `2882b177e674fe577643b792e0ca3566d52ef754`; based on protected `main` |
| F3 offline rehearsal | [PR #96](https://github.com/Satsetx4/karturt/pull/96), OPEN/DRAFT, exact head `ef9fc2377d1f183cec8576b5b2d0996f3a56101a`; based on PR #93 head `b8bc74a…` |
| F4 documents and this packet | [PR #95](https://github.com/Satsetx4/karturt/pull/95), OPEN/DRAFT. Immediately before this packet refresh, head `b68335f7bd1a670b6a1d34fd08a4ef89b785ea28` passed exact-head checks in run #40047461528. This revision creates a new source SHA; its exact SHA, CI and review are tracked on PR #95 and issue #83. |
| Planning/Kanban | [PR #84](https://github.com/Satsetx4/karturt/pull/84), OPEN/DRAFT, exact head `468ed839041fc83481e21eb61eebbb055b1d88f5`; Gate A run #40048183786 attempt 2 passed and documentation-branch concurrency was skipped |
| Candidate migration files | PR #93 adds no migration file. Provider schema and migration state were not inspected through a database session. |
| Independent review | PR #93 exact head: no P0/P1/P2 findings. Review of PR #95 head `b68335f7bd1a670b6a1d34fd08a4ef89b785ea28` found no P0/P1/P2 findings. A new review of the source SHA created by this packet refresh is required and will be recorded in issue #83. |

### Exact-head CI evidence

| Source SHA / PR | Run and attempt | Gate A | Independent PostgreSQL job | Meaning |
|---|---|---|---|---|
| PR #93 `b8bc74a…` | [#40040334501](https://github.com/Satsetx4/karturt/actions/runs/40040334501), attempt 1 | #120709660348 SUCCESS | #120712264849 SUCCESS, disposable PG17 | F1 candidate CI only; not staging PG18 |
| PR #94 `2882b17…` | [#40037337893](https://github.com/Satsetx4/karturt/actions/runs/40037337893), attempt 2 | #120701070602 SUCCESS | #120704030518 SKIPPED | Source guard checks only; concurrency unverified |
| PR #96 `ef9fc23…` | [#40050978509](https://github.com/Satsetx4/karturt/actions/runs/40050978509), attempt 1 | #120743357702 SUCCESS | #120745434142 SUCCESS, disposable PG17 | 19 offline scenarios and source regression evidence only; not real staging PG18 |
| PR #95 previous head `2f7ab4e…` | [#40041547299](https://github.com/Satsetx4/karturt/actions/runs/40041547299), retry attempt 2 | #120714648846 SUCCESS | #120717077129 SUCCESS, disposable PG17 | F4 docs head before this packet edit |
| PR #95 packet head `a93625f…` | [#40044385581](https://github.com/Satsetx4/karturt/actions/runs/40044385581), attempt 1 | #120722617994 SUCCESS | #120724424270 SUCCESS, disposable PG17 | Packet head before the evidence-link correction in this revision |
| PR #95 immediately previous head `b68335f…` | [#40047461528](https://github.com/Satsetx4/karturt/actions/runs/40047461528), attempt 1 | #120732350539 SUCCESS | #120734614250 SUCCESS, disposable PG17 | Checks passed on the source SHA before this documentation refresh; they do not transfer to the new packet SHA |
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

Latest read-only control-plane evidence is on [issue #81 comment #6378492571](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6378492571); the `parent-data` interpretation is clarified in [comment #6378531717](https://github.com/Satsetx4/karturt/issues/81#issuecomment-6378531717). All six project/root-branch candidates were re-read. No database connection, SQL, migration, seed, backup, restore, or provider mutation was performed.

| Evidence | Status | Current readback / gap |
|---|---|---|
| Neon project/branch and Free plan | PARTIAL | Read-only metadata identifies six PG18 projects in `aws-ap-southeast-1` with owner `subscription_type=free_v3`. The new Fast Track project `ancient-sound-84300774` / `karturt-v1-fast-track-staging-20261024` has root `br-young-bonus-ao4jqzo3` / `karturt-staging-root-20261024`; it is not yet an approved connection target. The five other project/branch IDs and names are listed in issue #81 comment #6378492571. Provider metadata alone does not prove environment isolation. |
| Production separation and synthetic-only lineage | UNKNOWN | All six roots report `init_source=parent-data`, which Neon [documents as copying schema and data from a parent branch](https://neon.com/docs/reference/api/branches/create-project-branch). Branch-list responses omit `parent_id`, so the specific parent is unknown; nothing establishes whether it was synthetic-only or production-derived. The matching 31,686,656-byte logical-size metadata does not classify contents. Do not infer emptiness or choose a target by project name. |
| Effective least-privilege staging identity | BLOCKED | Current readbacks show effective connector permission `ADMIN` on all six projects; no target-scoped non-admin UAT runner or effective grants are proven. |
| Network/TLS identity | UNKNOWN | Public connections are enabled and IP allowlists are empty on all six projects. No target-bound TLS certificate/hostname verification evidence exists. |
| Schema/journal/migration result | PARTIAL | Source CI verifies Drizzle journal/schema consistency on PR #93. No connection was made to compare the provider schema or run an authorized migration. |
| Backup/restore and recovery | NOT RUN | No verified target exists for an approved current-target backup/restore drill. |
| Vercel Hobby and Preview | UNKNOWN | Current [issue #83 readback](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6378508336) for `karturt-review-staging-20261012` (`prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`, team `sekawan`) reports `live=false`, `latestDeployment=null`, 0 deployments and 0 project domains. Team metadata does not expose a plan. Hobby eligibility, a Preview target and smoke remain UNKNOWN/NOT RUN. |

The source guard PR #94 has an empty target allowlist. Its Gate A passed; the independent concurrency job was skipped. Source guards do not prove provider identity or data provenance.

## 4. F3 real staging UAT — BLOCKED

PR #96 contains 19 offline scenarios and passed exact-head Gate A plus disposable PG17 CI on `ef9fc2377d1f183cec8576b5b2d0996f3a56101a`: run #40050978509 attempt 1, Gate A #120743357702 SUCCESS and independent disposable PostgreSQL 17 concurrency #120745434142 SUCCESS. Its plan-only path does not load a live database/provider/app-server adapter, and the execute option has no live path; these checks do not establish F3 staging acceptance.

| Staging scenario | Status | Evidence |
|---|---|---|
| Resident annual cards, due/future state, paid receipts | NOT RUN on staging | No approved isolated target |
| Current/overdue online requests and future denial | NOT RUN on staging | No approved isolated target |
| Treasurer future cash, oldest-first allocation, idempotent retry | NOT RUN on staging | No approved isolated target |
| Role/tenant denial, duplicate/reversal, financial integrity | NOT RUN on staging | No approved isolated target |
| Real PostgreSQL 18 session concurrency | NOT RUN | PG17 disposable CI is separate evidence |
| Candidate Preview HTTPS smoke | NOT RUN | Vercel Hobby/Preview project and deployment not proven |

## 5. F4 release and recovery — NO-GO

| Requirement | Status | Evidence / limitation |
|---|---|---|
| Release notes reviewed against candidate diff | PASS — internal draft | PR #95; exact F1 SHA/results recorded; not approved for publication |
| Exact-head docs CI and production build | PASS — on immediately previous head only | PR #95 source `b68335f7bd1a670b6a1d34fd08a4ef89b785ea28`; run #40047461528 attempt 1, Gate A #120732350539 and disposable PG17 job #120734614250 passed. This packet edit creates a new source head; its exact-head results and fresh review must be read from PR #95 and issue #83 before treating this revision as verified. |
| Dependency risk review | FAIL / BLOCKER | [Issue #83 audit evidence](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6377426252): current read-only `npm audit` on the lockfile matching PR #93 SHA `b8bc74a…`: 7 findings (2 moderate, 4 high, 1 critical). Locked versions: Next.js 16.3.6 (direct, critical), Zod 4.6.5 (direct, high), Vitest 5.0.1 (direct, moderate), Vite 8.3.1, sharp 0.35.4, source-map-js 1.2.1, and @vitest/mocker 5.0.1. Audit reports fixes available, including Next.js 16.4.3. |
| Dependency remediation route | BLOCKED by package policy | [Issue #83 audit evidence](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6377426252): `npm audit fix --dry-run --json` returned `EALLOWREMOTE`: remote package fetches are disabled and it refused the `@tailwindcss/oxide-wasm32-wasi@4.3.3` tarball. No lockfile change was made and no policy bypass was attempted. An approved local/internal artifact route or policy decision is required before remediation. |
| Preview workflow/deployment/smoke | NOT RUN | No confirmed Vercel Hobby project/deployment or Preview smoke |
| Production-scoped credentials or secrets | NOT USED | No production credential, database connection, or deployment occurred. This is an activity record, not a separate secrets-scanner attestation. |
| Current-target backup/restore and rollback | NOT RUN | Runbook describes the required steps, but no verified staging target or recovery drill exists. |
| Release scope/migration compatibility | PARTIAL | PR #93 has no migration file and Drizzle source checks pass; provider schema/backup compatibility remain unverified. |

The package audit advisories include [Next.js critical advisory GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [Zod high advisory GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), and [Vitest advisory GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8). The [issue #83 audit record](https://github.com/Satsetx4/karturt/issues/83#issuecomment-6377426252) contains the current report summary; no package artifact was fetched or installed for remediation.

## 6. Open risks and limitations

| Risk / severity | Evidence | Mitigation | Residual risk / owner |
|---|---|---|---|
| Critical direct dependency advisory | Next.js 16.3.6 is in the affected range; npm audit marks `next` critical | Keep production release NO-GO; remediate only through a policy-approved artifact path and rerun exact-head checks | Unresolved; package/artifact policy owner |
| Additional dependency advisories | npm audit reports 4 high and 2 moderate across direct/transitive dependencies | No dependency changes until approved fetch route; then review exact diff and run Gate A | Unresolved; package/artifact policy owner |
| Staging provenance/content unknown | All six roots say `parent-data` (schema/data copied from a parent); branch metadata omits `parent_id`; effective connector permission is ADMIN | No database session; identify the parent and independently prove production separation and synthetic-only lineage, then establish scoped identity | Unresolved; Neon/project owner |
| TLS/least privilege unknown | No scoped UAT runner or certificate identity evidence; public connections enabled | Establish a target-bound non-admin identity and validated TLS before access | Unresolved; staging owner |
| No real staging UAT/concurrency | No verified PG18 target; offline PG17 is not equivalent | Run F3 only after F2 evidence and authorization pass | Unresolved; staging/QA owners |
| No Preview or verified recovery drill | Vercel plan/deployment unknown; no approved target for backup/restore | Verify Hobby/Preview and recovery target after F2 | Unresolved; release/platform owner |

## 7. Verdict and owner decision

- **F1 verdict:** `PASS — integrated unmerged candidate only` at PR #93 SHA `b8bc74a4202225d9a54728d2c10be247dec8318f`.
- **F2 verdict:** `BLOCKED — do not connect or mutate`.
- **F3 verdict:** `BLOCKED — offline preparation only; no real PG18 UAT`.
- **F4 verdict:** `NO-GO — dependency remediation, Preview, recovery, and real staging evidence incomplete`.
- **Overall release verdict:** **NO-GO**. No combined promotable release candidate exists.
- **Owner production GO:** `NOT GIVEN` and not requested until F1–F4 objectively pass on a recorded candidate/environment.
- **Production deployment, credentials, database writes, migration, backup/restore, and cutover:** `NOT AUTHORIZED`.

### One bundled owner action packet

1. Identify the parent behind each selected `parent-data` root, then prove exact project/root-branch provenance, production separation, and synthetic-only contents before any session. `parent_id` is omitted from the current branch readbacks, so this identity is unresolved.
2. Establish target-scoped non-admin staging access and validate PostgreSQL 18 TLS/certificate identity for the exact resource before any session.
3. Confirm Vercel Hobby eligibility and the staging-only Preview project/deployment target.
4. Provide an approved local/internal npm artifact route or explicit package-policy decision that permits remediation without bypassing `EALLOWREMOTE`.

Do not provide secrets or raw catalogs in this packet. Historical failures and skipped checks remain visible and do not inherit a passing result from another SHA, resource, or environment.
