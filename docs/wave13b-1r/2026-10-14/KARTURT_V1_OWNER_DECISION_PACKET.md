# KartuRT V1 — Single RT Owner Decision Packet

Prepared: 2026-10-14

Status: **PREPARATION ONLY — NO PRODUCTION GO**

Scope: one operational RT for V1. Multi-RT customer onboarding and switching remain V2. This packet asks only for the product and operations choices still needed for a production decision; it does not request resident data in GitHub and does not authorize deployment, migration, pilot, DNS, WhatsApp sends, or production data use.

## Recommendation

Keep V1 to one RT; preserve strict household/RT isolation and synthetic-only staging. Hold all financial settings, real identities, contact details, historical balances, domain changes, and spending above Rp0 until the owner chooses them through a secure channel. Keep online transfer requests limited to current/past periods; keep Treasurer cash advances oldest-unpaid-through-target; do not introduce manual allocation or demo accounts.

## Owner decision table

| Decision | Options to consider | Recommendation | Owner answer still needed |
|---|---|---|---|
| RT identity and cohort | Existing operational RT; another named RT; defer until cohort is defined | Keep exactly one RT in V1; use a non-sensitive internal label in technical evidence | Exact RT identity, operational area, eligible household cohort, and accountable RT representative through a secure channel |
| Tariff, dates, and prior history | Confirm current approved monthly rate and effective date; begin with a future cycle; import verified historical balances | Do not invent an amount or fabricate history. Require an owner-reviewed source and reconciliation before any import | Rate in IDR, start/due date, year coverage, waiver rules, and whether any prior balance/receipt history should be imported |
| Treasurer and Chairman access | Individually named accounts with role-based access; defer real onboarding | Separate, least-privilege accounts; no shared credentials; retain synthetic accounts only in tests | Authorized role holders, onboarding/verification method, recovery contact, and who may reverse or adjust a ledger entry |
| WhatsApp and resident notices | Disabled; manual drafts only; later owner-approved sending with consent | Keep real sends disabled until sender identity, recipients, message purpose, and consent are established | Official number/provider, permitted message types, consent process, opt-out process, and authorized sender |
| Privacy and retention | Minimum record retention required by operations/law; owner-defined longer period | Collect the minimum; keep PII out of GitHub and synthetic QA; define retention before real-data launch | Privacy contact, retention duration, access-review cadence, deletion/archival policy, and incident escalation contact |
| Backup and recovery | Owner-operated encrypted backup; documented provider backup; both | Require tested recovery for both source and database before real data | Backup owner, frequency, retention, acceptable recovery point/time, restore approver, and where recovery evidence is held |
| Domain and URL | Existing owner-controlled domain/subdomain; defer domain work | Defer DNS and domain purchase/changes until staging and release gates pass; no purchase is authorized | Exact domain, owner account, intended host, DNS approver, and whether any existing domain is approved |
| Budget | Strict Rp0; or an explicitly named maximum ceiling | Keep the current strict **Rp0** hard stop; no paid tier or overage | Confirm Rp0/no-overage controls and account usage evidence, or provide a separate exact ceiling and approval before any spend |

Do not place names, phone numbers, addresses, credentials, household lists, balances, or private receipts in this repository or a GitHub issue. Provide sensitive operational details only through an owner-controlled secure input method.

## Evidence and gate status

- Repository: `Satsetx4/karturt`; historical `main` remains `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- PR #23 remains OPEN/DRAFT at `344952c0a41342dea77989d5b9aa6fdb503a78e6`; PR #48 remains OPEN/DRAFT at `12539d83b8537d845015a2b0030d47162dae0203`, stacked on #23. Neither is merged.
- PR #48 exact-SHA GitHub run `38225424975` passed Gate A and independent PostgreSQL concurrency. Local verification at that same base SHA passed lint (0 errors, 2 existing warnings), typecheck, and the full suite (67 files / 427 tests). These results do not establish staging, browser/device acceptance, production safety, or a deployment.
- A D5 month-based arrears mismatch was identified in report aggregation. A separate corrective branch `codex/v1-d5-report-arrears-20261014` has been prepared from the exact PR #48 head for implementation and independent verification; it is not yet release evidence.
- D1v2 staging SQL was **not executed**: local `psql`, trusted CA, and secure credential path are absent. See [D1v2 execution report](WAVE13B_1R_D1V2_EXECUTION_REPORT.md) and [next-gate packet](WAVE13B_1R_NEXT_GATE_PACKET.md).
- Staging lineage is still `parent-data`; physical emptiness is unproved; `stagingIsolationVerifiedEmpty=false`; migration approval public key is unset. No migration or staging readiness claim is made.
- Vercel readback exposed only the unlinked staging project `karturt-review-staging-20261012` (ID `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`) with zero deployments. The legacy main-to-production trigger risk and account-wide Rp0/no-overage evidence remain unresolved.
- Spend delta observed in this execution: **Rp0**. No production, old demo/F3, DNS, provider, real-data, or deployment mutation occurred.

## Outstanding owner choices

1. Confirm the one RT identity and the household cohort through the secure input path.
2. Approve a tariff/effective date and the source/reconciliation rules for any prior-year balances.
3. Name the role holders and approve the secure onboarding and recovery method.
4. Decide whether V1 may send any WhatsApp message; otherwise keep real sends disabled.
5. Set retention, backup/restore, and incident response owners and targets.
6. Identify an already-owned domain only if needed; no domain purchase/change is authorized.
7. Reconfirm strict Rp0/no-overage, or submit a separate exact spending ceiling before any spend.

## Release decision

Current disposition: **NO-GO for staging migration, protected Preview, merge to `main`, production, pilot, rollout, WhatsApp send, or DNS change.** Preparation and local code review may continue. A new owner GO must name the exact action, source SHA, target, evidence, and operating boundary.
