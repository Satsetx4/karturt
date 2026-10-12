# KartuRT V1 Single RT — Codex Master Execution Plan v1.0

**Dated:** 2026-10-12 (WIB). **State:** PLANNING + TRACKER READY; CODE EXECUTION NOT YET DELEGATED IN THIS DOCUMENT.  
**Repository:** [Satsetx4/karturt](https://github.com/Satsetx4/karturt), branch `docs/staging-closure-plan`, [documentation PR #24](https://github.com/Satsetx4/karturt/pull/24).  
**Live V1 Kanban:** [GitHub #25](https://github.com/Satsetx4/karturt/issues/25); [compact tracker](v1-execution-kanban.md). **Legacy master:** [#17](https://github.com/Satsetx4/karturt/issues/17), with existing issues #7/#9/#11/#12/#13/#14/#15/#16/#19/#22 retained as companion milestones.  
**Planning source:** [Owner-approved Single RT freeze](v1-single-rt-production-readiness.md) and [Original MVP freeze](../mvp-single-rt-scope-freeze.md). New issues V1-101–V1-122 are SMALL EXECUTION CARDS for Codex; not replacements for historical Kanban cards.

## 1. Scope and success criteria

**Final goal:** a secure, stable, production-ready KartuRT V1 for exactly **ONE operational RT**, including resident administration, dues, payment request, canonical Treasurer verification/rejection/cash/reversal, ledger/audit and Chairman reporting, manual WA CTA for pending requests, mobile-first installable PWA (online finance only), single-RT production pilot/full rollout, role training and ongoing monitoring.

**Explicit V2 deferred:** user-facing or administrator-facing multi-RT selection/switching, onboarding, dashboards, tenant management, export and wider optional modules unless objectively needed for V1 integrity. Do not remove `rtUnitId`, cross-RT FK/database constraints, server tenant/household guards, or AUTOMATED NEGATIVE tenant spoof/cross-RT deny regression. Operational staging UAT = one synthetic RT only; a second RT may be used **only** within disposable automated negative security harness, not customer staging, multi-RT live UI or positive acceptance.

**Definition of production-ready:** full V1 functional/privacy/security/financial acceptance and physical device evidence, safe deployment with recoverable backups/monitoring/operator responsibilities, owner production GO and pilot success as specified below. **CI green or a merged PR is NOT the final goal.**

## 2. Verified reference snapshot, re-read at kickoff

- `main`: `96c84588ae0c13f68a17cffd997a3e583fb7da82`, protected. GitHub ruleset Protect #24900928 active, targets default branch; mandatory PR, required `Gate A local verification` and review conversation resolution; zero bypass.
- [Combined PR #23](https://github.com/Satsetx4/karturt/pull/23): OPEN/DRAFT, head `344952c0a41342dea77989d5b9aa6fdb503a78e6`. Exact-head two Gate A + independent PostgreSQL concurrency runs previously PASS: [push 38197224318](https://github.com/Satsetx4/karturt/actions/runs/38197224318), [PR 38197227481](https://github.com/Satsetx4/karturt/actions/runs/38197227481).
- [Docs PR #24](https://github.com/Satsetx4/karturt/pull/24): OPEN; planning branch, **not merged**. Its ongoing checks are not guaranteed to remain PASS after new pushes; verify the newest SHA.
- New isolated Neon Free project `ancient-smoke-51787007`, NEW branch `br-dry-block-b3fsqjo3`, `karturt_stage` DB, PostgreSQL 18 Singapore, max 0.25 CU; no canonical 14 migrations executed yet.
- New Vercel Hobby project `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`, SSO for all, Git UNLINKED, no deployments; Preview-only staging APP_ENV/DATABASE_ENV + encrypted new dedicated DATABASE_URL and BETTER_AUTH_SECRET. `NEXT_PUBLIC_APP_URL` unset pending real stable protected Preview origin.
- Old Vercel F3 project had a `main` target=production deployment CANCELED; production merge-trigger risk UNVERIFIED, separate blocker even for a docs merge.
- No real Android/iPhone acceptance; no runtime staging financial/browser PASS and no main merge. No new resources beyond 1/1 owner authorized.

**Every agent must re-read actual refs/CI/project state before action, not assume the snapshot is still current.**

## 3. Authority, cost and no-go boundaries

**Owner authorization available NOW:** NEW isolated 1 Neon Free + 1 Vercel Hobby have ALREADY been created (quota consumed). Only synthetic fixture creation/migration/live Preview testing on these resources, manifest-scoped agent-created test cleanup, and repository branch/PR work. Hard spending delta Rp0, stop on account quota exhaustion, upgrades, payment prompts or trial. Repository stays PUBLIC; no new project or product paid addon.

**NOT AUTHORIZED:** historical demo/F3 UAT/prod DB or project mutation, cloning legacy data/credentials, DNS changes, owner/private secrets in GitHub/CI logs, real resident PII, actual WA sends, financial data offline caching, automatic production deploy, direct `main` push, PR merge before independent gates, production/real pilot/F5 rollout before separate explicit owner GO. If existing Vercel production auto-deploy cannot be proven harmless, BLOCK MERGE. Never circumvent SSO, env guards or required GitHub checks.

**Owner manual tasks:** physical Android Chrome and iPhone Safari real-device testing ONLY AFTER protected staging READY + QA PASS; later decisions for actual RT, dues tariff/start/history, real officials/WA contact, resident consent, retention/data controller, budget/domain/backup, PRODUCTION GO, separate F4 pilot GO and later F5 rollout GO. Do not ask owner to repeat previously decided staging approval.

## 4. Multi-agent work allocation and waves

**Coordinator** reads AGENTS.md, Next.js 16 local `node_modules/next/dist/docs/` before editing Next.js source, checks for existing dirty worktrees/overlapping PR heads, orchestrates no more than **3 IN PROGRESS tasks across all agents**, writes exact links to #25/#17 and does not independently approve their own unverified work.

| Wave | Release/Security Agent A | Staging/DB Agent B | QA/Fixtures Agent C | Exit |
| --- | --- | --- | --- | --- |
| W0 | [V1-101](https://github.com/Satsetx4/karturt/issues/26) merge side-effects | [V1-102](https://github.com/Satsetx4/karturt/issues/27) Preview preflight | [V1-105](https://github.com/Satsetx4/karturt/issues/30) one-RT fixture preparation | Read-only/prepare, no production or live test |
| W1 | [V1-104](https://github.com/Satsetx4/karturt/issues/29) diff+security | [V1-103](https://github.com/Satsetx4/karturt/issues/28) canonical migrations preflight | [V1-106](https://github.com/Satsetx4/karturt/issues/31) physical-device checklist | Every immediate risk/runner gap has an evidence packet |
| W2 | [V1-118](https://github.com/Satsetx4/karturt/issues/43) owner decision packet | [V1-107](https://github.com/Satsetx4/karturt/issues/32) canonical migrations | Prepare V1-108 actual fixture after migrations | 14/14 journal + stage DB check |
| W3 | Review stage evidence | [V1-109](https://github.com/Satsetx4/karturt/issues/34) protected READY Preview | [V1-108](https://github.com/Satsetx4/karturt/issues/33) ONE synthetic RT fixture | Preview READY + real seeded staging data |
| W4 | Read-only negative/security checks support | [V1-113](https://github.com/Satsetx4/karturt/issues/38) backup and restore safety | [V1-110](https://github.com/Satsetx4/karturt/issues/35), [V1-111](https://github.com/Satsetx4/karturt/issues/36), [V1-112](https://github.com/Satsetx4/karturt/issues/37) sequential/safely isolated QA runs | All runtime and finance gates PASS |
| W5 | [V1-116](https://github.com/Satsetx4/karturt/issues/41) final release/rollback | Support owner device access; no secret exposure | Owner [V1-114](https://github.com/Satsetx4/karturt/issues/39), [V1-115](https://github.com/Satsetx4/karturt/issues/40) | Real Android and iPhone PASS |
| W6 | [V1-117](https://github.com/Satsetx4/karturt/issues/42) controlled conditional merge | Verify no production changes | Repo closeout | Code-integrated to main only if all release gates PASS |
| W7–W9 | [V1-118](https://github.com/Satsetx4/karturt/issues/43) decision packet / operation sign-off | [V1-119](https://github.com/Satsetx4/karturt/issues/44) production only after explicit GO | [V1-120](https://github.com/Satsetx4/karturt/issues/45) pilot, [V1-121](https://github.com/Satsetx4/karturt/issues/46) single-RT rollout, [V1-122](https://github.com/Satsetx4/karturt/issues/47) final operations | Separate production, pilot and F5 owner GO, then final acceptance |

Parallel work does **not** mean concurrent writes against the same synthetic financial records; reset fixture within manifest or serialize transactional tests. No task can be IN PROGRESS without clear owner and file/resource write scope.

## 5. Gate sequence

| Gate | Entry conditions | PASS evidence | Failure action |
| --- | --- | --- | --- |
| G0 Scope frozen | Single-RT approved, docs and Kanban published | Scope file and #25 task index | Stay planning |
| S0 Isolation | 1/1 approved Free/Hobby resources, new DB empty, all secrets Preview only | Resource IDs, SSO, APP_ENV=DATABASE_ENV=staging | STOP if charged or wrong project |
| S1 Schema | Migration preflight, positively verified new DB connection | Canonical migration files 0000–0013, 14 Drizzle journal entries, `db:check` | No manual SQL or unrelated DB |
| S2 App | One synthetic operational RT + protected Preview source | Exact #23 SHA, Vercel READY, HTTPS correct NEXT_PUBLIC_APP_URL, authentication protected | CANCELED/ignored/unready = BLOCK |
| S3 Runtime | S2 PASS, valid synthetic identities and manifest | Role/CSRF/tenant deny, correct balance/payments, WA manual/pending, PWA/privacy, ledger audit | Critical/high = NO-GO |
| S4 Recovery | Recovery script/backups on allowed staging/local disposable target | Restore aggregates and rollback packet, RPO/RTO assumptions | Block production readiness |
| M0 Code merge | Release trigger audit + CI/Postgres + S2–S4 + physical Android and iPhone + no critical open blockers | Fully signed SHA-specific release packet + ruleset PASS | NO MERGE on any unknown |
| P0 Production | Code merge (if allowed) + explicitly new owner PRODUCTION GO incl privacy/hosting/finance/backup | Production access controls, backup/recovery, monitoring/safe data and approved rollout | NO PRODUCTION MUTATION |
| P1 Pilot | P0 PASS + separately explicit F4 GO and 5–10 informed consenting homes | Ledger/role/incident pilot evidence + owner acceptance | Do not scale |
| P2 Full single-RT rollout | P1 PASS + separately explicit F5 GO | Full single-RT resident acceptance and financial reconciliation | No wider rollout |
| P3 Final V1 | F6 training and F7 observability, backup drills, SOP and support accepted | Owner final signoff | V1 remains in operations review |

**PR #24 docs merge has same M0 production-auto-deploy safety precondition** even though it changes documentation only. PR #18/#20/#21 must not be independently merged; supersede only after successfully verifying their changes in #23 merged main.

## 6. Detailed executable task cards

The following 22 issues are real GitHub work cards, not hypothetical tasks. Change a title/status only after its evidence matches the gate.

### V1-101 — Audit dampak merge main ke Vercel lama
**Kanban:** [#26](https://github.com/Satsetx4/karturt/issues/26) · **Initial:** READY · **Owner:** Release A. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Inspect old demo/F3 Vercel Git link, production branch, ignored builds, automatic deployment/alias and recorded main-target production builds; read-only only.

**Safety:** Document exact project IDs, branch→target behavior and no-production-merge option. DO NOT change old project settings.

**Accept when:** Actual API/dashboard evidence for both legacy projects; safe merge decision PASS or BLOCKED without guessing.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-102 — Preflight jalur staging Preview & HTTPS origin
**Kanban:** [#27](https://github.com/Satsetx4/karturt/issues/27) · **Initial:** READY · **Owner:** Infrastructure B. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Read back newly created Neon and Vercel project, encrypted preview env names, SSO and no Git link; determine safe Preview-only source strategy and stable HTTPS origin for NEXT_PUBLIC_APP_URL.

**Safety:** Use ONLY previously provisioned new project IDs. Never create another project or trigger main production.

**Accept when:** Verified project ID, preview configuration plan and precise safe origin rule; no deploy claim.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-103 — Siapkan eksekusi CLI migrasi yang aman
**Kanban:** [#28](https://github.com/Satsetx4/karturt/issues/28) · **Initial:** READY · **Owner:** Infrastructure B. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Read checked-in Drizzle files 0000–0013, script src/db/migrate.ts and check-db.ts, env guards, connection identity; prepare isolated runner with secret redaction.

**Safety:** No SQL hand-replay, no existing DB; staging DB identity must match ancient-smoke-51787007 and branch br-dry-block-b3fsqjo3.

**Accept when:** Command plan and positive environment/identity checks; exact 14 migration/journal acceptance recorded.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-104 — Review keamanan PR integrasi & latest CI
**Kanban:** [#29](https://github.com/Satsetx4/karturt/issues/29) · **Initial:** READY · **Owner:** Release A. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Audit PR #23 exact head vs main for auth/CSRF, financial ledger, payment request concurrency, WA, PWA privacy, staging env; verify Gate A and real PostgreSQL concurrency on exact SHA.

**Safety:** No merge or production write; do not dismiss major defects without code/CI evidence.

**Accept when:** Threat/financial review matrix, regression findings, test links and blockers.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-105 — Siapkan fixture satu RT + manifest sintetis
**Kanban:** [#30](https://github.com/Satsetx4/karturt/issues/30) · **Initial:** READY · **Owner:** QA C. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Design synthetic RT/house/household, residents, Treasurer, Chairman and optional admin, dues/payment/lifecycle cases, negative access probes; prepare repeatable script and cleanup manifest.

**Safety:** ONE operational staging RT only; second RT allowed solely as isolated negative security-test harness. No actual DB writes yet.

**Accept when:** Deterministic fixture spec, expected outcomes, non-PII test identifiers, manifest schema.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-106 — Siapkan paket uji Android & iPhone pemilik
**Kanban:** [#31](https://github.com/Satsetx4/karturt/issues/31) · **Initial:** READY · **Owner:** QA C. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Write real-device Android Chrome/iPhone Safari PWA acceptance steps, role/finance/WA/no-offline-PII matrix, capture sheet of browser/OS/SHA/screenshots.

**Safety:** No device execution or PASS claim until owner actually tests READY Preview.

**Accept when:** Owner can execute on handset with synthetic credentials shared privately and record pass/fail.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-107 — Migrasi 14 skema ke Neon staging baru
**Kanban:** [#32](https://github.com/Satsetx4/karturt/issues/32) · **Initial:** BLOCKED · **Owner:** Infrastructure B. **Depends on:** 103. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 103. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Execute repo-native npm run db:migrate then npm run db:check on verified new Neon staging only, inspect journal 14 records and drift.

**Safety:** Use APP_ENV=DATABASE_ENV=staging; no other DB, no direct migration SQL, budget Rp0.

**Accept when:** 14/14 journal, db:check PASS, redacted DB identity and exact SHA.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-108 — Bootstrap satu RT sintetis secara resmi
**Kanban:** [#33](https://github.com/Satsetx4/karturt/issues/33) · **Initial:** BLOCKED · **Owner:** QA C. **Depends on:** 105,107. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 105,107. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Use canonical bootstrap/provision workflows to create one synthetic RT, households, resident and official roles, dues/pending cases, audit baseline.

**Safety:** Only new staging; agent-created manifest with cleanup scope; no real names, accounts, phone number or WhatsApp sends.

**Accept when:** Single operational tenant and predictable test-state counts; no PII; manifest and reconciliation summary.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-109 — Deploy PR #23 ke Preview SSO hingga READY
**Kanban:** [#34](https://github.com/Satsetx4/karturt/issues/34) · **Initial:** BLOCKED · **Owner:** Infrastructure B. **Depends on:** 102,107. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 102,107. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Configure protected staging-only Preview origin, NEXT_PUBLIC_APP_URL, safe Git source/exact SHA and deployment (not production target), inspect build logs.

**Safety:** New Vercel project only; no automatic production deploy; don't disable SSO or invent URL.

**Accept when:** Vercel READY with exact candidate SHA and HTTPS URL, SSO verified; cancellation/ignored=FAIL.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-110 — Uji browser auth, role dan tenant DENY
**Kanban:** [#35](https://github.com/Satsetx4/karturt/issues/35) · **Initial:** BLOCKED · **Owner:** QA C. **Depends on:** 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Smoke single RT login/logout, session/CSRF, resident PIN lockout, role permissions, admin MFA as applicable, household boundaries; run negative cross-RT tests in isolated automated harness.

**Safety:** No positive multi-RT UX or second live operational RT. Redact auth/PII.

**Accept when:** Executable results on exact Preview URL/SHA, unauthorized operations denied, zero critical leakage.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-111 — Uji billing, pembayaran dan ledger nyata di staging
**Kanban:** [#36](https://github.com/Satsetx4/karturt/issues/36) · **Initial:** BLOCKED · **Owner:** QA C. **Depends on:** 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Run current/future Jakarta billing, idempotent pending requests, Treasurer verification/reject/cash/reversal, balance/reconciliation and audit trails.

**Safety:** Synthetic staging transactions ONLY. No production money or resident records.

**Accept when:** Finance invariant checks, route/browser evidence, zero negative/duplicate or cross-household anomalies.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-112 — Uji WhatsApp manual, PWA dan responsivitas
**Kanban:** [#37](https://github.com/Satsetx4/karturt/issues/37) · **Initial:** BLOCKED · **Owner:** QA C. **Depends on:** 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Inspect pending-only WA link targeting same-RT Treasurer, invalid-number fail closed and no auto-send; manifest/icons MIME and installability; no offline private cache; mobile viewports.

**Safety:** Do NOT send WhatsApp or store credentials/financial data offline.

**Accept when:** Redacted browser evidence and negative privacy tests PASS on exact SHA.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-113 — Latihan backup/restore sintetis & rollback DB
**Kanban:** [#38](https://github.com/Satsetx4/karturt/issues/38) · **Initial:** BLOCKED · **Owner:** Infrastructure B. **Depends on:** 107,108. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 107,108. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Record synthetic staging backup/restore rehearsal permitted within same new Neon project or ephemeral local DB/PGlite; verify migration/ledger consistency and rollback plan.

**Safety:** No extra Neon/Vercel projects, no historic DB. Stop if extra charge or destructive cleanup required.

**Accept when:** Document RPO/RTO assumptions, recoverable artifact, restored aggregate counts and evidence.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-114 — Android Chrome — uji perangkat fisik pemilik
**Kanban:** [#39](https://github.com/Satsetx4/karturt/issues/39) · **Initial:** BLOCKED · **Owner:** Owner. **Depends on:** 106,110,111,112. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 106,110,111,112. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Owner installs/opens real staging PWA on physical Android Chrome, tests one RT login, dues, pending WA, logout, offline privacy/reconnection and UI.

**Safety:** Cannot be marked PASS by Codex simulator or screenshots alone.

**Accept when:** Owner-provided OS/browser/SHA/URL, redacted screenshots, test checklist PASS.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-115 — iPhone Safari — uji perangkat fisik pemilik
**Kanban:** [#40](https://github.com/Satsetx4/karturt/issues/40) · **Initial:** BLOCKED · **Owner:** Owner. **Depends on:** 106,110,111,112. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 106,110,111,112. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Owner Add to Home Screen on physical iPhone Safari; test standalone app, roles, dues, pending WA, logout, privacy/reconnection.

**Safety:** Cannot be marked PASS by Codex simulator or automated emulation.

**Accept when:** Owner-provided iOS/browser/SHA/URL, redacted screenshots, checklist PASS.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-116 — Final pre-merge gate dan rollback packet
**Kanban:** [#41](https://github.com/Satsetx4/karturt/issues/41) · **Initial:** BLOCKED · **Owner:** Release A. **Depends on:** 101,104,110,111,112,113,114,115. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 101,104,110,111,112,113,114,115. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Re-audit exact PR #23 SHA, check status Gate A/Postgres, protected ruleset, severity, staging READY evidence, device results, merge side-effects and rollback.

**Safety:** No merge on unproven production auto-deploy or non-PASS gates. Docs PR #24 also needs safe merge impact.

**Accept when:** Signed evidence matrix, all mandatory gates PASS or explicit NO-GO.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-117 — Merge terkendali hanya PR #23
**Kanban:** [#42](https://github.com/Satsetx4/karturt/issues/42) · **Initial:** BLOCKED · **Owner:** Integrator. **Depends on:** 116. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 116. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** If and only if every code-merge gate PASS and no production deployment side effect: mark reviewed, merge PR #23 once; verify main SHA/CI then supersede component PRs #18/#20/#21.

**Safety:** No force, bypass, premature merge, direct push, production changes or pilot launch.

**Accept when:** GitHub mergedAt/merge SHA, main CI success, rollback pointer and issue closeout.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-118 — Siapkan owner decision packet production Single RT
**Kanban:** [#43](https://github.com/Satsetx4/karturt/issues/43) · **Initial:** READY · **Owner:** Release A. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Prepare choices for RT identity/cohort, tariff/date/history, Treasurer/Chairman login and WA, consent/privacy/retention/backup/incident, domain & strict Rp0 or requested ceiling.

**Safety:** Preparation only; no request for real data in GitHub, no production deployment or implied GO.

**Accept when:** Decision table with options/recommendation, owner approvals that remain outstanding, secure input method.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-119 — Production setup setelah GO terpisah
**Kanban:** [#44](https://github.com/Satsetx4/karturt/issues/44) · **Initial:** BLOCKED · **Owner:** Infrastructure B. **Depends on:** 117,118,OWNER-PRODUCTION-GO. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 117,118,OWNER-PRODUCTION-GO. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** Only after written explicit GO: select isolated production hosting/data and secure secrets, migration, backup/restore, privacy/legal controls, DNS as separately authorized.

**Safety:** No production mutation until GO; never use demo/F3/test DB for real data; cost/budget separately agreed.

**Accept when:** Production-ready acceptance, ops rollback/monitoring, exact owner approval and cost evidence.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-120 — Pilot 5–10 rumah tangga dengan consent
**Kanban:** [#45](https://github.com/Satsetx4/karturt/issues/45) · **Initial:** BLOCKED · **Owner:** QA + Owner. **Depends on:** 119,OWNER-F4-GO. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. · **Dependency:** 119,OWNER-F4-GO. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2..

**Work:** After independent F4 GO recruit consenting single RT households, onboard secure accounts, run dues/payment/report flows and observe support/incident window.

**Safety:** No actual citizen onboarding, money or WhatsApp before GO; real data stays private.

**Accept when:** Pilot acceptance, reconciled ledger and incident/rollback outcomes, signed owner review.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-121 — Rollout satu RT penuh setelah pilot PASS
**Kanban:** [#46](https://github.com/Satsetx4/karturt/issues/46) · **Initial:** BLOCKED · **Owner:** QA + Owner. **Depends on:** 120,OWNER-F5-GO. **Scope:** V1 ONE operational RT. · **Dependency:** 120,OWNER-F5-GO. **Scope:** V1 ONE operational RT..

**Work:** After separate F5 GO onboard remaining members of SAME RT, financial rollout, communications, transition plan and incident monitoring.

**Safety:** Do not add multiple RT tenants; rollback threshold and helpdesk active.

**Accept when:** Full RT adoption/reconciliation acceptance and explicit owner signoff.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.

### V1-122 — Handover F6, monitoring F7 dan final acceptance
**Kanban:** [#47](https://github.com/Satsetx4/karturt/issues/47) · **Initial:** BLOCKED · **Owner:** Coordinator + Owner. **Depends on:** 119,120,121. **Scope:** V1 ONE operational RT. · **Dependency:** 119,120,121. **Scope:** V1 ONE operational RT..

**Work:** Finalize resident/treasurer/chairman guides, access management, patch/dependency monitoring, backup restoration drills, recurring finance integrity, support and incident runbooks.

**Safety:** No arbitrary completion claim; ongoing maintenance capability must be owned.

**Accept when:** Owner accepts security, financial, operational and maintenance checklist, KartuRT V1 COMPLETE.

**Evidence:** commit/branch/PR and exact SHA, commands/CI or deployment proof, redacted stage/environment identifiers, spend delta, no untouched-environment violations; post to issue then update #25/#17.


## 7. Evidence standard and audit protocol

No evidence, no DONE. Required fields for EVERY report:
```text
Task: V1-### / issue #...
Actor: Agent A|B|C|Owner
Input repo main SHA / PR HEAD / staging IDs:
Mutations: files / DB records / environment changed:
Commands executed and exact results:
CI / Vercel READY / browser / migrations proof URLs:
Synthetic manifest (when mutated) and rollback path:
PASS / FAIL / BLOCKED / REVIEW, reason:
New cost = Rp0 verified / exceeded? STOP:
Production, legacy demo, F3 UAT touched? NO:
Security/privacy findings or owner action:
Next unlocked task:
```

Evidence should be sanitized, deterministic, and linked directly from issue. Never store `DATABASE_URL`, auth secrets, login PIN/passwords, full WA PII, real resident names, or raw account cookies/tokens. All network access through authorized connectors/CLI. GitHub Actions success means only specified jobs ran; independent Postgres skipped is not PASS. Vercel Preview Comments success is not deployment READY.

## 8. Coordinator start command

1. Read this plan, [Kanban #25](https://github.com/Satsetx4/karturt/issues/25), [legacy #17](https://github.com/Satsetx4/karturt/issues/17), AGENTS.md, user single-RT freeze, #19 staging, #12 owner gates, PR #23/#24. Verify current exact SHA and actual Vercel/Neon metadata.
2. Audit the 22 card statuses against current evidence. **Never duplicate cards** or create more projects; no upfront speculative merges/deploys.
3. Assign and start the first W0 three cards [V1-101](https://github.com/Satsetx4/karturt/issues/26), [V1-102](https://github.com/Satsetx4/karturt/issues/27), [V1-105](https://github.com/Satsetx4/karturt/issues/30) to three Codex agents in separate safe write scopes. Mark IN PROGRESS only after actual agent dispatch. Parallel max 3.
4. After independent review, close W0, then start W1, update #25/#17 and PR #24 tracker; continue through W2–W6 while hard-stop and cross-environment rules remain binding.
5. If Work/Codex agent interface or CLI/database secret access is missing, finish all safe read-only/preparatory cards, label blocked item honestly with actionable packet. Do not claim delegation or runtime success based merely on a plan.
6. For manual Android/iPhone gates, hand a ready-to-run checklist/Preview synthetic test accounts privately to owner only after S3 PASS. Record owner-supplied PASS, never fake it.
7. For production and real pilot, stop at the owner-gated approvals P0/P1/P2. Do not interpret previous staging GO or conditional code merge as PRODUCTION GO.

**Closeout:** V1 is COMPLETE only after production launch, single-RT pilot, rollout, trained operators, backup and monitoring acceptance. Multi-RT remains V2 backlog and cannot delay this launch.
