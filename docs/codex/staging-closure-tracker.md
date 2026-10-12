# KARTURT — STAGING CLOSURE TRACKER

**As-of:** 2026-10-12 03:22 UTC (10:22 WIB).
**Repo:** Satsetx4/karturt. **Default branch:** main.
**Current main:** 96c84588ae0c13f68a17cffd997a3e583fb7da82.
**Candidate PR #23:** OPEN/DRAFT, head 344952c0a41342dea77989d5b9aa6fdb503a78e6, base main at 96c84588ae0c13f68a17cffd997a3e583fb7da82.
**Current verdict:** V1 scope is now SINGLE operational RT, multi-RT deferred to V2; release Track R still BLOCKED on main→Vercel production effect; isolated staging Track S is PROVISIONED (new Free/Hobby resources + preview secrets), but NOT READY (no migrations/deployment). No runtime/device gate has run. PR #23 is not eligible to merge.

Status meanings: PASS = directly evidenced acceptance; PREPARED = checklist or test packet exists but was not executed; UNVERIFIED = evidence unavailable or inconclusive; BLOCKED = a prerequisite prevents progress; LOCKED = do not start until the listed gate passes; IN PROGRESS = current task being prepared.

## C01 — source recheck and durable documents

**Status: PASS for requested publication and issue linkage; docs PR checks pending.** Fresh reads were completed for the repo AGENTS.md, issues #17/#19/#22/#12/#7/#9, PRs #18/#20/#21/#23, main, ruleset #24900928, and exact-head checks. A clean docs worktree was created from origin/main at 96c84588; the original dirty checkout remains untouched. Plan and tracker are published on branch docs/staging-closure-plan in [PR #24](https://github.com/Satsetx4/karturt/pull/24). The current issue #17 checkpoint is [linked here](https://github.com/Satsetx4/karturt/issues/17#issuecomment-6117234123).

## Fresh GitHub reference snapshot

- Repo Satsetx4/karturt is PUBLIC; default branch is main.
- main SHA: 96c84588ae0c13f68a17cffd997a3e583fb7da82.
- PR #18: OPEN/DRAFT, head 41b044077d287361b18fad87c96975a638e527f0, base main. Gate A run #38138499719 succeeded; no stage or runtime acceptance.
- PR #20: OPEN/DRAFT, head 08a4173a2687a6b9f9302c05cf664065a64a0bf5, base main. Gate A run #38139749697 succeeded; no stage or runtime acceptance.
- PR #21: OPEN/DRAFT, head 105df9636614949d050b104b93587ab2c9bf0258, base main. Gate A run #38139885448 succeeded; no stage or device acceptance.
- PR #23: OPEN/DRAFT, head 344952c0a41342dea77989d5b9aa6fdb503a78e6, base main. MergeState CLEAN; no APPROVED review is recorded.
- Documentation PR #24: OPEN on docs/staging-closure-plan, base main; its Gate A check was running when first read. It tracks #17 without closing the issue.
- #23 push run #38197224318: Gate A SUCCESS; independent PostgreSQL concurrency job #114643885904 SUCCESS.
- #23 PR run #38197227481: Gate A SUCCESS; independent PostgreSQL concurrency job #114644014877 SUCCESS.
- The two Vercel status contexts appear successful because the projects ignored the build. For exact #23, F3 staging deployment dpl_F43BPEJxHAD5czZcTjCgSySQow6c and legacy demo deployment dpl_Aw7dPKGUn5PyXs78ygGRHFsPC8YX were CANCELED. These are not READY deployments or runtime tests.
- Issue #7 is REVIEW/VERIFY; #19 and #22 are BLOCKED; #12 remains a conditional owner gate; #9 is BACKLOG. Owner availability of Android and iPhone is recorded, but there is no physical acceptance evidence.
- PRs #18/#20/#21/#23 remain OPEN/DRAFT and unmerged. Only PR #23 may be merged, and only after all gates pass.

References:
- [#17 master Kanban](https://github.com/Satsetx4/karturt/issues/17)
- [#19 staging gate](https://github.com/Satsetx4/karturt/issues/19)
- [#22 main protection gate](https://github.com/Satsetx4/karturt/issues/22)
- [#12 owner merge/pilot gate](https://github.com/Satsetx4/karturt/issues/12)
- [#7 combined integration](https://github.com/Satsetx4/karturt/issues/7)
- [#9 Android/iOS acceptance](https://github.com/Satsetx4/karturt/issues/9)
- [PR #23 candidate](https://github.com/Satsetx4/karturt/pull/23)
- [Documentation PR #24](https://github.com/Satsetx4/karturt/pull/24)
- [#17 V2 checkpoint comment](https://github.com/Satsetx4/karturt/issues/17#issuecomment-6117234123)
- [Gate A and concurrency PR run](https://github.com/Satsetx4/karturt/actions/runs/38197227481)
- [Gate A and concurrency push run](https://github.com/Satsetx4/karturt/actions/runs/38197224318)

## OWNER PRODUCT DIRECTIVE — V1 ONLY: SINGLE OPERATIONAL RT (12 Oct 2026 WIB)

- **V1 goal:** one production deployment serves exactly **one RT**. Full [approved scope/acceptance + V1-01–V1-10 execution tasks](v1-single-rt-production-readiness.md); original [MVP Single-RT freeze](../mvp-single-rt-scope-freeze.md) already said APPROVED. User reiterates: finish V1 production-ready first, V2 only later enables multi-RT.
- **Exclude from V1 acceptance:** RT selection/switching, onboarding multiple customer RTs, multi-RT UI and admin management; do not delay V1 for these. Minimal installable PWA shell included because PR #23 already implements it, but no offline finance cache, push notifications or advanced offline behaviors.
- **RETAIN:** `rtUnitId`, all tenant/household constraints and server-side guards, *automated negative cross-RT denial* tests as permanent security invariants. **Operational staging fixtures: one synthetic RT only** (Treasurer, Chairman, Resident and necessary System Admin roles); any second RT solely in disposable security-only negative test harness if strictly needed. This is a correction to earlier V2 plan's two-RT positive staging test suggestion.
- **Release state unchanged:** PR #23 remains draft and unmerged; new resource staging is PROVISIONED **NOT READY**, no 14 migrations, Preview URL, synthetic live QA or device tests. GitHub #22 ruleset PASS, main-merge Vercel production side-effect still unverified, so no merges.
- **Immediate task queue:** V1-01 doc scope (done on this branch), V1-02 release trigger audit, V1-03 preview-only staging hookup + stable origin, V1-04 canonical staging migrations, V1-05 single-RT fixtures, V1-06 exact-head protected Preview READY, V1-07 single-RT runtime/security/finance QA, V1-08 owner physical Android/iPhone checks, V1-09 conditional safe merge, V1-10 separate production/pilot/handover GO. Keep staging vs release tracks parallel, at most 3 in progress; no re-provision.

## Release Track R — main protection independently verified (12 October 2026)

- **C02 PASS and KRT-18 #22 DONE/CLOSED.** GitHub now returns `main.protected=true`. Ruleset [Protect #24900928](https://github.com/Satsetx4/karturt/rules/24900928): target `~DEFAULT_BRANCH` = main; active; `pull_request` required, required GitHub Actions check `Gate A local verification` (integration ID 15368), review conversation resolution required, required approval count 0 (solo maintainer), deletion and force-push prohibited, no bypass actors. `strict_required_status_checks_policy=false` so branch-up-to-date enforcement is **not** claimed.
- **C03 CI PASS** for exact PR #23 candidate `344952c` on two Gate A + independent PostgreSQL concurrency runs, with required check now formally enforced on main; CI at docs PR #24 latest head must still complete before any docs merge.
- **C04 remains BLOCKED/UNVERIFIED:** historical F3 Vercel project has a branch `main` deployment targeted at Vercel `production` which was CANCELED; prove and isolate effects of any future main merge before merges #24 or #23. A newly created, Git-unlinked staging project does not resolve old project's merge trigger.
- **C09/C10 staging PROVISIONED/PARTIAL**, canonical migrations and stable PREVIEW target pending. This track can run parallel to C04; both must finish before merge.

## Approved isolated staging provisioned — 12 October 2026 (WIB)

**Resource creation PASS (only once per vendor, within owner limit). Neither is a READY application:**

| Resource | Identity / evidence | Safety readback |
| --- | --- | --- |
| Neon | New **Free** org `satset`, project `karturt-review-staging-20261012` (`ancient-smoke-51787007`), branch `staging-empty` (`br-dry-block-b3fsqjo3`), database `karturt_stage` | New project, no parent-data clone, PostgreSQL 18, Singapore region; 0.25 CU maximum. Default compute suspend interval used, as customized suspend timeout is not permitted on this Free account. No demo/F3/prod branch/data copied. |
| Vercel | New **Hobby** team `sekawan`, project `karturt-review-staging-20261012` (`prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`) | SSO enabled for **all** deployment targets. Git NOT linked; 0 deployments; no automatic production/main build. No previous demo/F3 project settings modified. |

**Staging Vercel Preview env metadata readback (values intentionally NOT disclosed):** `APP_ENV=staging` and `DATABASE_ENV=staging` (preview-only plain labels); `DATABASE_URL` (new Neon DB credential, encrypted and preview-only); `BETTER_AUTH_SECRET` (fresh random staging-only secret, encrypted and preview-only). `NEXT_PUBLIC_APP_URL` is **not configured yet**: it must be set to the actual protected stable HTTPS origin serving the staging deployment, without path or query, **before** running build/auth/browser smoke. Do not assume the historic demo or F3 URL, and do not hardcode a random preview hostname before readback.

**No app deployment or migrations performed:** schema remains uninitialized until the repository's canonical `npm run db:migrate` then `npm run db:check` run against positively verified project `ancient-smoke-51787007` only; acquire credentials from staging secret manager without putting them in shell logs/artifacts/issues, and verify `APP_ENV=DATABASE_ENV=staging`. Auth runtime and finance/tenant smoke require actual Vercel READY preview and manifest-backed synthetic fixture, so remain BLOCKED. If CLI migrations cannot be safely run with available tools, delegate the narrowly scoped CLI step to Codex rather than ad-hoc SQL replays.

**Next safe steps:** release track R (owner GitHub effective main PR/check protection and old linked project production-trigger audit) runs independently. Staging track S continues with safe preview-only Git source hookup (not main production), canonical migrations, stable protected HTTPS URL, set `NEXT_PUBLIC_APP_URL` to that exact origin, and redeploy exact verified #23 SHA. Never disable SSO, trigger a prod target, or mutate any old KartuRT demo/F3/database. Free tiers impose quota limits; stop on quota exhaustion, never add paid billing/trial.

**Result:** Staging provisioning **PROVISIONED**, application **NOT READY**, runtime/device **NOT TESTED**, merge **NOT ELIGIBLE**; incremental paid resources/upgrades **none**. Count under this owner approval: **1/1 Neon project**, **1/1 Vercel project**; no further projects without fresh owner GO.

## Owner-approved parallel staging decision — 12 October 2026 WIB

- **Owner GO:** create at most **one NEW Neon Free** and **one NEW Vercel Hobby** project for isolated KartuRT staging, only while incremental cost stays **Rp0**. Synthetic-only fixtures, canonical migrations, staged runtime tests, and only agent-created manifest-recorded cleanup are approved. No production/demo/F3 UAT reads-for-reuse, writes, clones, deletes, DNS, or auth changes. Real devices by owner later.
- **Dependency revision:** Track S (new staging) and Track R (main protections and automatic deployment audit) run **in parallel**. Release-protection blocking **does NOT** block approved newly isolated staging; it blocks PR #23 **MERGE**. User cannot be asked to approve the same staging scope again; additional cost or resource count requires fresh owner decision and a hard stop.
- **Evidence for zero-cost tier:** direct Vercel team `sekawan` Hobby; direct Neon org `satset` Free; Vercel limits up to 200 Hobby projects, Neon new Free announcement 100 projects at 1 GB/project. Existing account inventory before staging creation: 22 Vercel projects, 6 Neon in satset. No paid add-ons, upgrade or trial authorized; utilization throttling on Free tiers accepted rather than billing. Actual runtime quota remaining must be monitored; if resource creation is rejected, stop. Source: https://vercel.com/docs/plans/hobby ; https://vercel.com/docs/plans ; https://neon.com/blog/neon-free-plan-1-gb-per-project .
- **Next S steps:** select distinct project identifiers, verify none preexists, provision once; verify created org/team and type; protect Vercel staging by SSO, keep Git disconnected until safe source preview setup; get new Neon credentials privately, never log them; set staging-only env labels, migrate via canonical CLI, then deploy exact reviewed SHA as preview and test. No staging READY claim until URL and actual runtime proof.
- **Next R steps:** verify GitHub Protect ruleset targets `main` and requires PR+CI; verify all Git-linked main → Vercel production triggers. No settings modifications to existing F3/demo/production without distinct approval. Do not merge PR #24 or #23 until impact is understood.

## C01–C08 — Gate 1 audit and readiness

| Card | Status | Evidence and blocker |
| --- | --- | --- |
| C01 | PASS for publication/link; docs CI pending | Fresh repo/issue/PR read completed. The docs-only branch is based on exact origin/main SHA. PR #24 is open and linked from #17; it does not close the issue. |
| C02 | PASS — 12 Oct updated readback | Active Protect #24900928 now targets DEFAULT_BRANCH/main; main.protected=true, required PR/CI and conversation resolution enforced, no bypass. #22 DONE. [Ruleset](https://github.com/Satsetx4/karturt/rules/24900928) |
| C03 | PASS — exact candidate CI and main required-check config | Both Gate A jobs and both independent PostgreSQL concurrency jobs passed on exact #23 head, via runs #38197224318 and #38197227481; ruleset now requires Gate A local verification on main. Docs PR #24 latest push must re-run its own check. Vercel ignored-build status is not deployment READY. |
| C04 | UNVERIFIED / BLOCKED | Vercel read showed F3 main deployment dpl_4EhE94BV5P8p2r3Btb1znPqJH55B targeted the Vercel production environment but was CANCELED; latest feature deployments are canceled. Project Git integration/production-branch settings did not establish what a GitHub merge of #23 would trigger. Do not merge until this is read back and the no-production-mutation boundary is met. |
| C05 | BLOCKED — Rp0 not proven | Published Vercel Hobby limits are documented: 6,000 build execution minutes/month, one concurrent build, 100 deployments/day, 45 minutes/deployment. The current Vercel team plan, account headroom, and zero incremental cost are not proven by the available readback. Neon org/project reads do not expose current free quota remaining or a no-charge guarantee. Official Neon sources differ: the Free FAQ says 0.5 GB/project; an Oct 2 vendor post announces 1 GB/project. Actual eligibility, usage, and remaining allowance are UNVERIFIED. STOP before provisioning if Rp0 is not proven. |
| C06 | UNVERIFIED | GitHub’s Vercel statuses say “Canceled by Ignored Build Step”; the ignored-build configuration itself was not independently read back. No repo ignoreCommand was found. F3 staging SSO is enabled for all except custom domains; legacy demo SSO is enabled for all. A settings flag is not an anonymous/browser auth test. Preserve SSO. |
| C07 | PREPARED | Earlier Agent C prepared a two-tenant matrix, now superseded for **positive operational UAT** by V1 SINGLE RT directive. Keep only an isolated automated security negative tenant fixture if required; no account, dataset, migration, test, deployment, or database write was made. See Plan V2. |
| C08 | PREPARED | Agent C supplied physical Android Chrome and iPhone Safari steps. Device availability is known; no handset was used and no PASS is claimed. See Plan V2 and issue #9. |

### Delegation record

Three bounded Codex agents completed read-only assignments, within the requested maximum of three:

- **Agent A — Governance/Release (C02–C04):** confirmed current main/ruleset, exact-head PR checks, Vercel deployment state, and the unresolved main-target and merge-trigger questions.
- **Agent B — Infrastructure (C05–C06):** audited published Hobby/Free plan documentation and available Neon project inventory; could not prove current free headroom, Rp0, Vercel ignored-build configuration, or runtime SSO behavior.
- **Agent C — QA (C07–C08):** prepared isolated synthetic data shape, browser/runtime cases, and Android+iPhone physical test instructions.

No agent edited repo files, posted comments, created resources, ran tests, deployed, changed settings, wrote database data, or sent messages. The selected model was gpt-6-luna; independent runtime model/Fast Mode attestation is unavailable, so none is claimed.

### C05/C06 source detail

Plan-level documents and capabilities are not account-specific cost proof:

- [Vercel Hobby plans](https://vercel.com/docs/plans/hobby) and [Vercel limits](https://vercel.com/docs/limits)
- [Vercel ignored build configuration](https://vercel.com/docs/project-configuration/project-settings) and [vercel.json ignoreCommand](https://vercel.com/docs/project-configuration/vercel-json)
- [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
- [Neon Free-plan limits FAQ](https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md) and [Oct 2 Free storage announcement](https://neon.com/blog/neon-free-plan-1-gb-per-project)

Visible Neon project inventory included legacy demo project silent-lake-27332079 and F3 staging project wispy-sky-99637283. Their existence proves neither remaining quota nor permission to reuse them. Both are excluded by this plan; no account-level no-charge calculation was available.

## Gate 1 result

**REVISED:** Track R remains BLOCKED by C04 merge/auto-production deployment effects; C02 main protection is now PASS. The prior C05/C06 staging audit was inconclusive. Owner has now explicitly approved one new project on each Free/Hobby provider under Rp0 hard stop. Track S can proceed through C09–C11 once free-tier evidence and safe new-project isolation are verified, without waiting for R. Neither track alone enables a merge. C07/C08 remain PREPARED, not tested.

## C09–C18 — locked follow-on work

| Cards | Status | Start condition / acceptance |
| --- | --- | --- |
| C09–C11 | PARTIAL: resources PROVISIONED | New Neon Free `ancient-smoke-51787007` and new Vercel Hobby `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq` created once each. Preview staging DB/auth secrets stored encrypted and explicit labels staged. Pending stable HTTPS origin, Git preview-only setup, canonical migrations, READY deployment and runtime acceptance. Release Track R remains independent. |
| C12–C14 | LOCKED | C09–C11 PASS on exact PR #23 SHA; execute auth/tenant, finance/WhatsApp, and PWA/network-off runtime matrix. Never send WhatsApp. |
| C15 | LOCKED | Verified READY Preview and runtime suite pass; physical Android Chrome and iPhone Safari evidence required. |
| C16 | LOCKED | All objective gates pass; independently recheck exact refs, changes, ruleset, deployment effect, and reversible rollback plan. |
| C17 | BLOCKED / NOT ELIGIBLE | Merge only PR #23 after every gate PASS. Current C02/C04/C05/C06/device/staging blockers prohibit merge. Never bypass rules or merge component PRs. |
| C18 | LOCKED for final reconciliation | This docs handoff is recorded under C01. After later acceptance/merge, synchronize #17/#7/#19/#22/#12/#9 and verify mergedAt plus resulting main SHA. Production and pilot remain separate GO decisions. |

## Hard stops and current non-actions

No production Vercel/Neon/DNS/real-pilot mutation; no paid resource or build while cost is uncertain; no demo or F3-UAT database reuse; no deletion of demo data; no weakening APP_ENV/DATABASE_ENV; no secrets or PII in GitHub; no WhatsApp send; no offline private cache; no ruleset bypass; no premature or double merge.

The only mutations in this checkpoint are the requested documentation branch/PR and issue #17 link. No tests were run in this checkpoint. The original dirty phase-9 checkout and its existing evidence files were preserved.
