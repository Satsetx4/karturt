# KartuRT V1 — Single RT Production Readiness (Owner Scope Freeze)

**Owner decision:** 12 October 2026 (Asia/Jakarta). **Status:** APPROVED V1 SCOPE, technical gates pending.
**Repo:** `Satsetx4/karturt`; **source of truth:** issue #17, combined candidate PR #23, V2 staging tracker in PR #24.
**Original baseline:** `docs/mvp-single-rt-scope-freeze.md` already APPROVED. This document refreshes delivery gates without changing the tenant-safety architecture.

## Product goal and exact boundary

**V1 = ONE operational RT per production deployment.** One actual RT identity, one set of residents/households, and officials for that RT. No operator-facing RT selector, multi-RT customer signup/onboarding, switching RTs, cross-RT dashboards, tenant-management UI, or testing these as positive V1 features. The System Admin role remains subject to documented least-privilege and MFA controls; do not build/enable tenant-spanning operational features for V1.

**Preserve security invariants:** keep `rtUnitId` and cross-RT foreign keys, exact-session tenant scope, household scope, payment ledger and audit integrity, denial of forged/cross-RT requests and *automated* negative tenant-isolation tests. A second **automated negative-test-only synthetic tenant** may be instantiated inside an approved disposable test harness if essential to prove isolation; it is not a second operational/customer RT, not a positive UAT flow, and must never require multi-RT production UX. The primary staging UAT runs with exactly **one operational synthetic RT** and resident/treasurer/chairman/test-admin roles. Never reuse production, demo, or F3 UAT records.

**V1 feature minimum:** resident private login, six-digit PIN security and recoverability, membership/household status, annual/current-month dues and prior unpaid months, safe resident payment request, canonical treasurer verification/rejection/cancel/cash/reversal as already implemented, ledger/history/audit, chairman reports and permissions, manually opened same-RT WhatsApp CTA for pending requests only, and mobile-first PWA icon/manifest and safe online-only finance/auth behavior. Scope acceptance is based on existing implemented features, not on inventing new capabilities. Features previously deferred beyond MVP (export F14, audit UI F15, official lifecycle UI F16, broad admin tooling F17, notifications F19, broad UX studies and optimization) remain **DEFERRED** unless a security, financial-integrity, or hard production readiness defect requires a narrowly scoped fix.

**Important exception:** The earlier MVP scope freeze deferred *full* PWA as post-launch. Owner's later KRT-08 decision and combined PR #23 already make the lightweight installable **PWA shell (without offline finance data caching)** part of V1. No advanced push/offline capabilities in V1.

## Delivery order — maintain separate tracks

### Track S — Single RT isolated staging (may progress before GitHub merge)

- **S1** Read back dedicated NEW Neon Free project `ancient-smoke-51787007`, branch `br-dry-block-b3fsqjo3` and database `karturt_stage`; new Vercel Hobby project `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`. Owner-approved quota is **1/1 each already consumed**. Free/Hobby and incremental **Rp0 hard stop**.
- **S2** Inspect new staging Preview-only env labels `APP_ENV=staging`, `DATABASE_ENV=staging`, encrypted staging `DATABASE_URL` and `BETTER_AUTH_SECRET` without revealing contents. Determine stable exact HTTPS origin before setting `NEXT_PUBLIC_APP_URL`; keep SSO enabled and Git-linked deployment targets preview-only, not main production.
- **S3** Use repository's canonical `npm run db:migrate` and `npm run db:check`, verify 14 reviewed migrations (0000–0013) + migration journal/schema against the **new staging project identity only**. Do not replay handwritten SQL or change legacy databases.
- **S4** Bootstrap **one synthetic RT** with synthetic house/household, resident, treasurer, chairman, admin (where needed); create manifest listing all agent-created test records and staging resources. No real WhatsApp sends, production credentials, PII, or live transactions.
- **S5** Deploy exact verified PR #23 head as a protected **Preview**, require Vercel `READY` and exact commit SHA. Run credential-safe anonymous access protection test; never classify ignored/canceled build as READY.
- **S6** Run canonical single-RT end-to-end browser acceptance: resident dues/current/future-month rules; pending requests, history, idempotency; Treasurer verification/reject/cash/reversal; Chairman reports and ledger reconciliation; same-RT WhatsApp CTA pending-only (inspect but do not send); session/rate-limit/CSRF/role isolation; PWA manifest/icons, responsive mobile and privacy/offline behavior. Run *negative* tenant-spoof/isolation regression in automated harness; **no positive multi-RT browser/UAT acceptance**.
- **S7** Backups/restore on isolated synthetic targets where allowed and proven free, finance invariants/migration consistency, redacted evidence and rollback rehearsal. Do not create extra Neon/Vercel projects; no production mutations.

### Track R — Release and production-safety governance (parallel with S)

- **R1 PASS as of 12 October 2026:** GitHub `main.protected=true`, Protect ruleset #24900928 targets DEFAULT_BRANCH; PR and `Gate A local verification` required, discussion resolution required; no bypass.
- **R2** Audit how merges to `main` might trigger deployments in **existing historic** Vercel projects (at least F3 staging's old `target=production` run); prove NO production rollout side-effect before merging **either** PR #24 or #23. Do not mutate existing projects as part of mere audit.
- **R3** Review exact combined PR #23 code and evidence: Gate A, independent PostgreSQL concurrency, finance invariants, password/MFA/security, permissions and no exposed credentials. Re-run on changed SHA. Keep component PR #18/#20/#21 unmerged.
- **R4** Prepare reversible source rollback and a secure operations handover; document backup/restore, monitoring, audit trails, incident contact and data safety. Do not require advanced multi-RT control tooling for V1.

### Track H — Owner-only physical device and real-production decisions

- **H1** Once protected Preview READY and browser tests pass: owner manually tests real Android Chrome and iPhone Safari/Add to Home Screen using synthetic identities. Record OS/browser, exact preview URL/SHA, screenshots redacted and PASS/FAIL. Simulator does not substitute.
- **H2** Before any actual production deployment/DB operations: owner separately approves production environment, RT identity, tariff and monthly billing policy, consent/retention, named Treasurer/Chairman, WhatsApp destination, privacy/data controller, budget, domain and backup incident owners. Production GO remains **NOT AUTHORIZED**.
- **H3** F4 limited real pilot of 5–10 consenting households requires separate explicit owner GO. F5 wider single-RT rollout requires separate GO after pilot PASS. F6 training and F7 monitoring complete final production readiness.

## Objective V1 gates (strict)

- [ ] Only one operational RT exposed in V1; no RT selector/multi-RT onboarding/switching required; none of those interfaces introduced by this change.
- [ ] All V1 billing, payment, finance and audit paths pass and match canonical ledger, with Jakarta business date handling.
- [ ] Role/session/rate-limit/MFA guardrails, CSRF and **automated cross-RT DENY** tests PASS.
- [ ] Existing current PR #23 exact-head Gate A + PostgreSQL concurrency SUCCESS and no critical/high blocker.
- [ ] Dedicated new isolated Rp0 staging has 14 canonical migrations + db:check, synthetic fixture manifest, protected Vercel `READY` Preview and browser UAT evidence.
- [ ] Android Chrome and iPhone Safari physical tests PASS using owner-provided evidence.
- [ ] Release auto-deploy side-effects on `main` proven safe; rollback/test evidence and GitHub ruleset PASS.
- [ ] PR #23 (only) eligible for merge after all code-merge gates; no silent production deployment. PR #24 documentation merge also needs proven safe main effects.
- [ ] Distinct explicit production GO before deployment/production migrations/real records, F4 pilot GO before real pilot, F5 rollout GO afterward.
- [ ] F6 operations handover and F7 monitoring/backup drills accepted before declaring operational product complete.

## Scope control and STOP rules

- Keep app usage and production onboarding SINGLE RT. Multi-RT is a **V2 BACKLOG**, not a V1 blocker.
- Never remove schema tenant identifiers, cross-RT FKs, security checks or negative tests merely because V1 serves one RT.
- No new architecture, multi-RT UX, new paid resource, plan upgrade, additional Neon/Vercel projects, historical demo/F3/prod mutations, secret/PII exposure, WhatsApp sends or unapproved production deployment.
- Existing staging projects remain the only permitted resources. Stop if the provider requires paid upgrade, unavailable CLI, missing stable origin, or access rights; report exact impediment and smallest actionable next step.
- This document changes **product scope and task dependencies only**, not current readiness claims or previously recorded technical PASS/FAIL outcomes.

## Small next-task handoff (Codex)

1. **V1-01 / Docs** — publish this exact scope and update Plan V2/tracker + issue #17; no multi-RT positive acceptance, no V1 tenant refactor.
2. **V1-02 / Release** — inspect historical Vercel main triggers and document safe code merge/no automatic production mutation. Read-only first.
3. **V1-03 / Staging** — identity-check NEW Neon/Vercel resources, validate existing preview envs and decide stable protected HTTPS Preview origin with no main production deployment.
4. **V1-04 / Database** — canonical `npm run db:migrate`/`db:check` only against NEW Neon staging DB; 14 migrations, exact evidence; if CLI unavailable mark BLOCKED without ad-hoc SQL.
5. **V1-05 / Fixture** — bootstrap one operational synthetic RT and build complete fixture/cleanup manifest with canonical scripts (no historical copy).
6. **V1-06 / Preview** — deploy PR #23 HEAD protected Preview only; verify READY and exact SHA.
7. **V1-07 / Browser QA** — resident, Treasurer, Chairman, finance/ledger/WA/PWA on single RT and automated cross-RT deny; evidence.
8. **V1-08 / Owner device** — hand over precise real Android+iPhone checklist only once Preview READY and browser QA PASS.
9. **V1-09 / Merge gate** — verify protection, CI, side-effects, rollback and all device tests; conditional PR #23 merge only; no production.
10. **V1-10 / Production GO** — request separate real-RT financial/privacy/hosting approval and pilot GO; prepare F4–F7 single-RT rollout/operations and independent F5 GO.

Coordinator uses **at most three parallel IN PROGRESS tasks**, maintains evidence by exact SHA in master #17 and PR #24, and never claims PASS from preparation alone.
