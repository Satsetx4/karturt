# KARTUR — CODEX CONTINUATION PLAN V2: Staging Closure, Runtime Acceptance & Controlled Merge

**Execution position:** Gate 1 (readiness) is BLOCKED as of 2026-10-12 03:22 UTC.
**Repository:** Satsetx4/karturt; default branch main.
**Verified baseline:** main at 96c84588ae0c13f68a17cffd997a3e583fb7da82.
**Candidate:** PR #23, OPEN/DRAFT, head 344952c0a41342dea77989d5b9aa6fdb503a78e6.
**Durable tracker:** docs/codex/staging-closure-tracker.md.
**Kanban source:** GitHub issue #17. Keep its status prefixes and the three-card WIP limit authoritative.

## Owner authorization and parallel execution amendment — 12 October 2026 (WIB)

**Supersedes the previous all-or-nothing Gate 1 dependency for non-production staging.** Owner explicitly authorized: at most **one NEW Neon project on Free** and **one NEW Vercel project on Hobby**, zero incremental cost hard stop, staging-only credentials, official versioned Drizzle migrations, clearly synthetic test data, runtime/browser checks, and cleanup **only** of manifest-listed records/assets the agents themselves create. Never alter, copy, delete, or reuse production, historic demo, F3/UAT resources/data/secrets. Existing repo PUBLIC choice remains unchanged. Real Android/iPhone acceptance is reserved for the owner after READY preview. Production deployment/real pilot/F5 are *not* authorized.

**Two independent tracks, both must close before any merge:**

- **Track S — Authorized isolated staging:** S0 validate exact team/org Hobby/Free, project counts and no billed-upgrade/on-demand behavior using account and vendor readback; create **at most one each** dedicated NEW staging resources with distinct names/IDs, no Git auto-deploy from main, protected SSO, staging-only branch-scoped secrets, cheapest/free compute within service limits. Provider quota exhaustion is a STOP (no upgrade, trial, payment method, overage, paid add-on). Record newly created IDs without secrets. Then run canonical versioned migrations and DB check only against new isolated database with explicit `APP_ENV=staging`/`DATABASE_ENV=staging` and positively verified target ID, create synthetic-only manifest-backed fixtures and exact PR #23 HEAD protected Preview. READY and live smoke are separate evidence gates, not assumed from deployment request. Do not use direct SQL to reconstruct migration history. If safe migrations/browser tools are unavailable, mark the stage as PROVISIONED/NOT READY and hand a narrowly scoped remaining executor task to Codex; do not claim PASS.
- **Track R — Release governance:** independently repair/verify ruleset target `refs/heads/main`, required PR and `Gate A local verification` (plus independent concurrency where applicable), conversation resolution, no force/delete. Audit both historical linked Vercel projects' `main` triggers and prevent unapproved production deployments; retain SSO, demo/F3 untouched. The new staging project's intended deploys must be preview-only. Record authoritative readback; if GitHub admin access missing, provide owner-only settings steps, not a fake PASS.

**Critical synchronization:** Track S may provision/test without waiting for Track R's `main` protection. **Track R and Track S and physical-device acceptance must all PASS before PR #23 merge**. No independent runtime/mobile PASS from code/CI alone. Existing PR #24 remains docs-only, unmerged; main unchanged. Any new Git-linked project must not automatically build/deploy `main`: start unlinked/protected, then explicitly configure safe preview-only source and inspect impact before any deployment. If UI/provider cannot prove a step harmless/cost-free, stop that step and document BLOCKED.

## Direction for future agents

Read this plan, its tracker, issue #17, and the linked blocker issues before acting. Re-read the exact GitHub refs, issue/PR states, check runs, and provider state immediately before every write. Preserve unrelated worktrees and evidence. Do not treat a status comment, prior audit, ignored build, static review, or CI result as staging or device acceptance.

Only record PASS when the required behavior was actually observed on the exact candidate SHA and in the named environment. For provider and device work, retain safe URLs, IDs, timestamps, device versions, and redacted evidence; never include credentials, cookies, PINs, database URLs, personal data, or real WhatsApp destinations.

## Objective and boundaries

Close the objective gates for isolated staging and runtime acceptance of the combined KRT-07 candidate, then merge only PR #23 if every required gate passes. Do not merge component PRs #18, #20, or #21. Keep production rollout and the real F4 pilot outside this plan; each needs a separate owner GO.

This is an execution continuation, not permission to skip gates. The owner’s existing merge consent is conditional on objective acceptance. No branch-rule bypass, double merge, or early merge is allowed.

## Verified starting state

Fresh GitHub reads on 2026-10-12 confirm:

- main is still 96c84588ae0c13f68a17cffd997a3e583fb7da82.
- PR #23 is OPEN/DRAFT at 344952c0a41342dea77989d5b9aa6fdb503a78e6, based on that main SHA. Its Gate A and independent PostgreSQL concurrency jobs succeeded on both push run #38197224318 and PR run #38197227481. The Vercel status contexts say success for ignored builds; the linked deployments were canceled, so neither is staging acceptance.
- PRs #18, #20, and #21 remain OPEN/DRAFT and unmerged. Their individual Gate A runs passed, but their Vercel preview statuses do not prove runtime acceptance.
- GitHub reports main protected=false. Active ruleset Protect #24900928 exposes only deletion and non-fast-forward rules; its ref-name include/exclude lists are empty. Effective main targeting and required PR/check enforcement are not proven.
- Issue #19 remains BLOCKED: no isolated, synthetic, READY-capable route with a verified Rp0 cost has been established. Existing demo and F3 staging databases are excluded from reuse.
- Issue #9 remains BACKLOG. Android and iPhone availability is recorded, but no physical device test has run.

Links and the detailed evidence snapshot are in the tracker.

## Gate model

### Gate 1 — governance and staging readiness (C01–C08)

**Revised:** C01/C05 per-account Free/Hobby identity and safe-cost checks plus explicit owner staging approval form **Gate S0** for creating the dedicated new staging-only resources, independently of GitHub main ruleset (C02) and historical production trigger audits (C04). C02/C03/C04 release governance is **Gate R** and may run in parallel with staging. C07/C08 preparation may run simultaneously. Missing release protection still blocks MERGE, not approved isolated staging. Do not use demo/F3/production as staging.

| Card | Work and exit evidence |
| --- | --- |
| C01 | Recheck AGENTS.md, issues #17/#19/#22/#12/#7/#9 and PRs #18/#20/#21/#23. Commit this plan and tracker on a documentation branch, push a PR that tracks (does not close) #17, and link that PR from #17. |
| C02 | Verify from an authorized GitHub readback that the active ruleset targets main. Record effective branch scope and exact rules. BLOCKED until demonstrated. Do not change admin settings through a bypass. |
| C03 | Verify exact-head PR #23 checks and distinguish required checks from observed checks. The two Gate A and two PostgreSQL concurrency runs passed at the current head. Governance enforcement remains blocked until C02 passes. |
| C04 | Read Vercel Git integration, production branch, environment, and deployment-trigger settings. Prove what merging PR #23 would deploy and that no prohibited production deployment or mutation can occur. Current merge effect is UNVERIFIED. |
| C05 | Verify actual Vercel and Neon plans, current consumption, remaining free capacity, and estimated incremental cost. Require a documented Rp0 route, not merely published plan limits. STOP if Rp0 cannot be proven. |
| C06 | Verify the selected isolated staging route, branch-scoped settings, SSO/deployment protection, and ignored-build behavior by readback. An ignored build reporting success is not a deployed artifact. Do not disable SSO or weaken APP_ENV/DATABASE_ENV guards. |
| C07 | Prepare the synthetic fixture manifest and browser/runtime test matrix below. No records are created before Gate 1. |
| C08 | Prepare the Android Chrome and iPhone Safari physical-device guide below. Device availability alone is not a PASS. |

**Gate S0 exit:** owner approval (given), Free/Hobby plan/provisioning verified, count <=1 new Neon and <=1 new Vercel, and no billed use or existing resource reuse. C09–C11 may then advance within the scoped staging environment even while C02/C04 are blocked. **Gate R exit:** C02–C04 verify enforceable main protection and safe merge-trigger effects. C12–C15 need READY preview. C16–C17 need BOTH tracks, all runtime, physical-device and rollback gates PASS.

### Gate 2 — isolated staging closure (C09–C11)

Start only after Gate 1 passes.

| Card | Work and exit evidence |
| --- | --- |
| C09 | Select a dedicated staging route whose current cost and isolation are proven. Do not reuse the historical demo or F3/UAT database or its credentials. |
| C10 | Provision only within the verified Rp0 allowance, using staging-only credentials and branch-scoped protected settings. Record resource identity without secrets. If any cost is possible or unknown, stop before creation. |
| C11 | Apply the repository’s versioned migrations to that isolated database using the canonical migration workflow; verify journal/schema state, environment guards, and exact PR #23 deployment. Require an actual Vercel READY Preview URL, preserved SSO, and database identity proof. Do not use ad-hoc SQL, direct ledger inserts, or an ignored/canceled deployment. |

### Gate 3 — browser/runtime acceptance (C12–C14)

Use only synthetic identities and the exact candidate SHA on the verified READY Preview. Never send WhatsApp messages; inspect generated URLs without opening a send flow.

| Card | Work and exit evidence |
| --- | --- |
| C12 | Auth and tenant: verify sign-in/out, expiry/re-authentication, role limits, same-tenant access, and cross-tenant denial. Confirm no private session or tenant data leaks between accounts. |
| C13 | Finance and WhatsApp: use canonical app flows for pending, verified, unpaid, and reversed states; verify current Jakarta month/year boundaries, future-period rejection, idempotency, persisted amount/period wording, and reconciliation. Confirm pending-only same-RT CTA, URL encoding, and fail-closed invalid/missing contact behavior. No automatic or manual WhatsApp send. |
| C14 | PWA/runtime: verify manifest JSON, MIME, scope/start URL, icon responses and dimensions, install/standalone behavior, and online-only auth/finance. With network disabled, prove that private data, session tokens, and stale balances are not served from a private cache. |

### Gate 4 — physical devices and merge decision (C15–C18)

| Card | Work and exit evidence |
| --- | --- |
| C15 | On physical Android Chrome and iPhone Safari, run the approved flow on the READY Preview. Record model, OS/browser versions, exact URL/SHA, date/time, steps, outcomes, and redacted synthetic-only screenshots. Both device platforms must pass. |
| C16 | Review the final exact diff, all objective evidence, ruleset readback, deployment effect, and rollback steps. No force-push, reset, branch-rule bypass, or production database action. If any evidence is stale or scope changes, stop and re-review. |
| C17 | Immediately re-read main SHA, PR #23 state/head/base, required checks, and all gate evidence. Merge only PR #23 if every gate is PASS and the branch remains based on the verified main. Never merge #18/#20/#21 as well. If the checks or protections cannot be satisfied normally, do not merge. |
| C18 | Record the final exact merge or blocked state in #17, #7, #19, #22, #12, and #9 as applicable. If #23 merges, verify mergedAt and the exact resulting main SHA, then close component PRs only as superseded. Hand over the evidence, remaining owner decisions, and explicit stop boundary. |

## Synthetic fixture and acceptance packet

The future staging fixture must be unmistakably synthetic and disposable, isolated from production, the legacy demo, and F3/UAT. Suggested minimum: two separate RT tenants; for each, one synthetic Treasurer and two synthetic Residents in separate households. Use credentials generated only for the isolated staging environment and never put them in GitHub. Use a non-routable or disabled WhatsApp destination; inspect the generated URL only. If a safe destination cannot be configured, verify that the CTA fails closed.

Create financial states through canonical application flows, not direct database inserts: current and prior-month dues, future-period rejection, unpaid dues, pending request, verified payment, and reversed payment. Use the injected business-date mechanism for Jakarta month/year boundary cases. Do not copy names, phone numbers, or rows from any workbook or real household list.

Browser/runtime cases:

- Authentication, logout, expiry, role access, and fresh authentication after reconnect.
- Tenant isolation for profiles, dues, requests, payment history, and Treasurer contact; cross-tenant requests must be denied.
- Current-month visibility at Jakarta date boundaries; future-period requests rejected by the server.
- Canonical totals and periods persisted on requests; replay is idempotent; state changes return a safe conflict.
- WhatsApp CTA appears only for eligible pending requests and a valid same-RT contact; values are URL-encoded and described as unverified; invalid/missing/ambiguous contact hides the CTA without hiding history. Inspect only; never send.
- Manifest and icon routes return the expected content type and dimensions; start URL is public; no service worker/private offline cache is introduced.
- Network-off behavior does not expose cached private data or claim a stale financial result; reconnect requires safe re-authentication.
- Responsive checks at 360–420 px, tablet, and desktop; no horizontal overflow, overlap, clipped controls, or primary targets below 44 px.

Physical-device guide:

1. Open the exact verified Preview URL on a physical Android phone in Chrome and a physical iPhone in Safari. Record device model, OS/browser versions, date/time, and candidate SHA.
2. Sign in with a synthetic Resident. Check the current-month dues view, create the eligible pending request using the canonical flow, inspect the WhatsApp URL without sending, return to the app, and sign out.
3. Install from the public start page (Android install/Add to Home Screen; iPhone Share → Add to Home Screen). Verify app icon, standalone launch, navigation, and authentication after relaunch.
4. Repeat relevant Official login/role and expiry checks with synthetic credentials. Rotate viewport, test 360–420 px layouts and touch targets, then disable network and confirm private state is not served offline.
5. Save only redacted evidence containing synthetic data. Record exact result and failure steps separately for each platform. Owner/device acceptance is not inferred from browser emulation.

## Rollback and stop rules

- Before merge, a failed or uncertain staging test means stop and preserve evidence; do not merge or mutate production.
- Staging resources and database credentials must be identifiable as staging-only. Do not use production, demo, or F3/UAT resources as rollback targets.
- Prepare the source rollback as a reviewed revert of the exact merged PR #23 commit through the repository’s normal PR path; never reset or force-push main. Do not run a production deployment as part of rollback.
- No production Vercel/Neon/DNS/real-pilot mutations; no real resident data; no deletion of demo data; no weakening APP_ENV/DATABASE_ENV; no copying secrets/PII; no WhatsApp sends; no offline private cache; no ruleset bypass; no premature or double merge.
- A merge to main is not production, F4 pilot, or F5 rollout approval. Those remain separate owner decisions.
