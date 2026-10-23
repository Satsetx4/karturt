# KartuRT V1 — Autonomous Fast Track F0–F4

**Owner decision:** APPROVED in ChatGPT on 2026-10-24 (Asia/Jakarta).  
**This file's status:** proposal on a separate planning branch; it becomes the normative repository plan **only when reviewed and merged**. The owner's product/security policy decision is already recorded here, but this document is **not** evidence that any technical gate passed.  
**Target:** `PRODUCTION READY — AWAITING OWNER GO` after F0–F4 are independently proven. Production deploy, cutover and production-data mutations are outside this mandate.  
**Operating mode:** SINGLE-RT; GitHub Free, Neon Free and Vercel Hobby only; no paid upgrade; minimize owner interactions.

## Product acceptance — V1 invariants

1. One operational RT. Preserve existing `rt_unit_id`, tenant isolation, database constraints and authorization tests; do not remove foundational tenant guards merely because multi-RT UI is deferred.
2. Residents can see all twelve annual billing periods; future periods are **not yet due** and never counted as overdue.
3. Online/transfer requests are allowed **only for current and overdue periods**. Never submit future-period requests.
4. A treasurer may verify cash/offline settlement for future periods. Allocation of cash is deterministic from the **oldest unpaid period** through the target period according to the product contract.
5. Paid monthly cards display a small receipt with actual payment amount and treasurer verification date/time in Jakarta time, with a traceable canonical record.
6. Authorization correctly separates Resident, Treasurer, Chairman/Admin roles; no cross-resident read/write, tenant spoof, double processing or unauthorized refunds.
7. Retry, double-submit, and parallel verification cannot create duplicate settlement; true PostgreSQL transaction/concurrency evidence required.
8. Core workflows remain functional on mobile; no new nonessential V1 features.

## Decisive change relative to old route

- The mandatory **Trusted Neon Viewer effective-principal proof** is **SUPERSEDED FOR V1** by a simpler **Staging Identity & Isolation Check**; do not label the historical Viewer task as PASS.
- GitHub App Ledger Writer and Solo Owner A4-04/A4-05 live race/replay and custom one-time ticket wiring are **DEFERRED from the V1 critical path**, not removed or declared secure/proven. Preserve ledger repo, installed App, tag ruleset and all audit history. No creation/deletion/update of live spent-ticket refs or app credential use.
- For release, use a human owner GO decision with GitHub protections and exact-SHA release evidence, plus least-privilege access. Do **not** silently turn off branch/environment protection or elevate token scopes; if the existing gate blocks the approved path, propose its **minimal reviewed replacement** and get any required platform/account authorization before changes.
- Historical Wave13B.2 **F2 FAILED** stays immutable; Fast Track **F2 below is a new phase name**, **not** a retry of the legacy F2 SQL script nor a relabeling of its failed evidence.
- Earlier historical `PRODUCTION READY` reports were bound to their own dated source, staging and SHA. Re-evaluate current target, current source and required V1 invariants; do not import an old PASS into a new release candidate.

## Single delegation, phase gates, parallel work

A single coordinator tracks F0→F4 and delegates small nonoverlapping tasks to Application, Database/Staging, QA/Security and Release workstreams. A workstream may investigate, code, test, open/update draft PRs and record evidence without additional owner confirmation for routine, safe tasks within the approved scope. Staging read/write is permitted **only** after proven synthetic-only isolation and authorization/guard checks; credentials are handled solely by protected account mechanisms, never PR-controlled code. No automatic production mutation. Independent tasks may progress in parallel; acceptance is sequential and evidence-based.

### F0 — Policy transition + current baseline

**Objective:** reconcile old issue/PR chains and produce one actionable backlog.

- F0-01 Verify current `main`, repository/branch topology, existing PRs, CI jobs (including SKIPPED), and deployment/Neon control-plane metadata.
- F0-02 Reconcile V1 scope and identify which features are in `main` versus stacked, unmerged or obsolete branches; do not assume a green PR means code is released.
- F0-03 Record this owner-approved transition; link historical issues without erasing failure records. Categorize as `V1 required`, `deferred V1.1`, `historical evidence`, or `blocked access`.
- F0-04 Build per-task Kanban/backlog and dependencies, assign independent workstreams, identify one minimal owner-action packet if a necessary provider UI or secret cannot be accessed.
- F0-05 Ensure proposed changes are reviewed through draft PR and tested against the correct SHA.

**PASS only if:** documented verified baseline, active critical path, issue/PR dependency map, plan committed in a traceable branch; owner policy remains separate from PR merge. A GitHub issue saying 'ready' is not itself F0 PASS.

### F1 — Application stabilization

**Objective:** all V1 billing, authorization and role flows implemented and regression-tested on an integrated candidate.

- F1-01 Inventory current `main` and historical draft PRs for billing, cash allocation, receipts, access and mobile UI.
- F1-02 Select the smallest safe integration strategy, avoid blanket merges of obsolete stacked branches; conflicts need targeted reviewed patches.
- F1-03 Enforce annual future-vs-overdue and online-request eligibility, Jakarta month boundaries.
- F1-04 Enforce treasurer cash future-month eligibility and oldest-unpaid-through-target allocation, paid-card canonical receipt contents.
- F1-05 Validate Resident/Treasurer/Chairman/Admin permissions, CSRF/session, inputs, and cross-tenant guards.
- F1-06 Add focused unit/integration tests, run lint/typecheck/unit/integration/authorization/constraints/security checks and production build at an exact source SHA.

**PASS only if:** required features verified on integrated candidate, no P0/P1 defects, deterministic business tests PASS, exact-SHA CI complete; skipped critical tests explicitly BLOCK rather than being glossed over.

### F2 — Staging Identity & Isolation + PostgreSQL 18

**Objective:** isolate a real synthetic-only test environment and prove migration safety, without requiring Neon Viewer effective token proof.

- F2-01 Independently read authenticated Neon control-plane metadata and Vercel project scope to identify exact target(s). Historical candidate `super-band-12770762 / br-solitary-king-a1qdsiln / ep-falling-mountain-a1hlzrdb` is a *lead*, not current approval or provenance proof.
- F2-02 Confirm Free/Hobby quotas, correct project/branch/endpoint/database, region, direct connection, no shared production resource, and trustworthy creation/lineage or equivalent evidence establishing no production-derived content. Provider metadata alone may leave lineage UNKNOWN.
- F2-03 Verify pinned connection identity, TLS server certificate and encrypted transport; PostgreSQL major 18 via an approved least-privilege staging database session, not merely control-plane metadata.
- F2-04 Verify journal/schema drift and migration order. Establish non-destructive backup/restore or safe disposable rollback strategy for synthetic staging.
- F2-05 Only **after PASS of guard and access authority**, run Drizzle migrations on exact synthetic staging (not production), seed synthetic fixtures, independently verify constraints/integrity and sanitize evidence.
- F2-06 If lineage, data isolation or credential origin is ambiguous, use a **fresh, clearly empty, disposable Free staging resource** only after the relevant platform operation is authorized and limits allow it; never silently reuse an unknown target.

**PASS only if:** independent current identity/isolation/provenance + TLS/PG18 + successful, auditable staging migrations and synthetic fixtures. Legacy SQL/F2 failure is not silently 'fixed' by rename.

### F3 — Real staging UAT + PostgreSQL concurrency

**Objective:** prove user-visible and transactional V1 behavior on a real, isolated PG18 staging environment.

- F3-01 Resident annual cards, current/overdue/future display and request restrictions.
- F3-02 Treasurer transfer verification, cash future payment and deterministic oldest-period allocation.
- F3-03 Receipt amount, timestamp, durable state, reversal/cancel where supported by product contract.
- F3-04 Role authorization and cross-resident/cross-tenant negative scenarios.
- F3-05 Double submit, replay, retry, transactional/idempotency cases and **real PostgreSQL concurrency execution** (not an Actions job SKIPPED by branch filter).
- F3-06 Full regression and mobile UAT; preserve sanitized logs with commit SHA, actual environment identity, testing timestamps and negative-case results.

**PASS only if:** all critical E2E checks, real PG concurrency, security negatives and regression PASS with traceable evidence. Mock/PGlite-only claims are insufficient.

### F4 — Release candidate + owner decision packet

**Objective:** produce release candidate evidence for GO/NO-GO without production launch.

- F4-01 Final independent security/release review of actual candidate diff and provider configurations; no unresolved P0/P1.
- F4-02 Complete full CI for exact release-candidate SHA, explicitly record FAIL and SKIPPED. Re-run critical tests on correct target when skipped.
- F4-03 Test a non-production Vercel Preview using isolated staging credentials, verify HTTPS, workflows and mobile smoke.
- F4-04 Prove non-production backup/restore drill and realistic production backup/rollback *procedure*, plan migrations without mutating production.
- F4-05 Document runbook, risk register, scope, recovery, release notes, environment inventory, and explicit owner GO/NO-GO packet.

**PASS only if:** production-ready candidate has exact-SHA evidence, real staging tests, verified recovery path, safe secrets and no blocker. **FINAL STATUS:** `PRODUCTION READY — AWAITING OWNER GO`. Production still NO-GO until explicit owner GO on the exact candidate/environment.

## Owner interaction ceiling

Routine task-specific approval is not required inside F0–F4. Coordinator consolidates exceptional requests into **one owner-action packet**, specifying exact proposed resource, action, risks, rollback, and required account confirmation; no raw secrets. Human action is required if provider authentication, protected secrets or an account UI refuses automation. Final owner GO applies only to production. Do not promise zero interaction or bypass platform security.

## Hard stops

- Never touch production data, domain, credentials or deployment under F0–F4.
- No spending, plan upgrades, broad token grants, bypassing main branch protection, silent GitHub Environment changes, secret exports or arbitrary deletes.
- Staging mutations require target-isolation PASS and correct scoped authorization; stop on UNKNOWN/FAIL.
- Do not merge to protected main by default; use draft PRs. If integration to main becomes essential for trusted release workflow, gather explicit controlled merge approval.
- No fake proof of Viewer, TLS, real concurrency or read/write effect; historical report ≠ live proof.
- Don't conflate the term 'F2' in this plan with the original failed F2 diagnostic script.
- Preserve historical issue bodies, comments, failing artifacts and branch evidence.

## Evidence and reports

For each task: state `TODO/IN_PROGRESS/PASS/BLOCKED/DEFERRED`, owner workstream, source branch/SHA, PR, Actions URL and attempt, environment IDs where safe, negative tests, skipped tests, risk, next step. Continue independent tasks even when another workstream is blocked. Every update ends with the **six original roadmap lanes** plus Fast Track phase state; never claim a phase PASS without auditable DoD evidence.

## Current baseline to re-verify

- `main` observed `96c84588ae0c13f68a17cffd997a3e583fb7da82`, protected.
- Draft stacked PR #67 → #73 → #74; #74 head `377d2c17aba4460cd52c2f00c93ad0f84b74ef16`, Gate A run #39878766542 attempt 2 SUCCESS, independent PostgreSQL concurrency SKIPPED.
- Other older draft PRs carry annual billing and future-cash work: audit actual merged state before selecting any.
- Prior dated `docs/delivery-readiness-report.md` claims historical readiness with a different staging resource/SHA; do not treat as current 2026-10-24 release verdict.
- Ledger App/Ruleset/issue #75/#77 evidence kept as deferred for V1, not destroyed or silently activated.

**Master tracking issue:** to be linked after creation. **This plan's PR must be reviewed/merged before being treated as protected-main instructions; use owner-approved policy as the interim mandate.**
