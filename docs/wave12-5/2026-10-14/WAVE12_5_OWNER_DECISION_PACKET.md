# KartuRT V1 Wave 12.5 — Owner Decision Packet

Date prepared: 2026-10-14
Status: OWNER INPUT REQUIRED — no option selected, no exception accepted, and no future operation authorized.
Wave 13 migration: NOT AUTHORIZED.

Use this form to record owner decisions after reviewing the four supporting Wave 12.5 reports. Blank checkboxes are intentionally unselected. A recommendation is not approval.

## 1. Evidence and current boundary

Application source reviewed: Satsetx4/karturt, branch codex/wave12-3-pg18-rehearsal-20261014, exact SHA 3bc69c83265dce3a6a0863cbfceea188f40f6168, tree f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9.

Documentation base: docs/wave12-4-staging-readiness-20261014 at SHA bea05d7f4f2346645b7354c32b6cd748654aaf05.

Wave 12.4’s 26/26 read-only catalog inspection established only SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE. It did not establish physical emptiness, absence of rows, parent provenance, recovery readiness, or migration readiness. The current source guard remains stagingIsolationVerifiedEmpty=false.

Exact existing target recorded in the prior scoped evidence:

- Organization: satset, ID org-ancient-boat-57106549, Free.
- Project: karturt-v1-staging, ID wild-art-99835126, PostgreSQL 18, aws-ap-southeast-1.
- Branch: staging, ID br-hidden-cake-a1ge5xqp, primary/default, init_source=parent-data; parent and source point unknown.
- Database: karturt_staging, ID 42079960; owner role karturt_staging_owner.
- Endpoint: ep-snowy-meadow-a10304d9; read_write; passwordless_access=true.

A fresh metadata-only branch description exposed a public.show_db_tree function tree entry, unexplained by the fixed Wave 12.4 inventory. It was not SQL-verified in Wave 12.5. It remains unresolved and must be classified by a separately authorized safe method before relying on the existing target. Wave 12.4 found no snapshot; the Wave 12.5 metadata readback also found no snapshot and an empty schedule. The six-hour history setting is not a pinned recovery point or a restore rehearsal.

Accepting unknown lineage is a risk decision, not evidence of emptiness. It does not resolve public.show_db_tree and does not authorize changing stagingIsolationVerifiedEmpty=false.

## 2. Choose the target

Select exactly one:

- [ ] Existing target — use only after the existing-target prerequisites below are satisfied.
- [ ] New independent staging project — exact new identifiers and no-copy baseline must be read back before any later action.
- [ ] Neither — stop and prepare a new proposal.

Coordinator candidate recommendation: a new independent project with documented origin and no copied/restored data from the current target, subject to separate creation authorization and verified Free-plan quota/cost. This is not a preselected answer. A child branch from the existing parent-data target would not resolve lineage uncertainty.

### If existing target is selected

Select one statement:

- [ ] I affirm that no operational contents or real resident data in this exact target need preservation, and I accept the risk of unknown inherited contents.
- [ ] I cannot affirm that statement; do not migrate, reset, or connect an application to this target.

This affirmation is a non-preservation decision only. It is not a claim that the target is empty or lineage-proven. The unexplained public.show_db_tree signal, access posture, and recovery gates still require resolution.

### If a new target is selected

Record the approved scope after a separate resource proposal and exact readback:

- Organization ID and plan: ______________________________________
- Project name and ID: ___________________________________________
- Branch name and ID; root/parent lineage: ________________________
- Database name and ID: _________________________________________
- Migration role and verified grants: _____________________________
- Runtime role and verified grants, if later approved: _____________
- Endpoint ID/hostname and region: _______________________________
- PostgreSQL version: ____________________________________________
- Origin and evidence that no external data was copied/restored: ____
- Free quota, storage, branch, compute headroom and cost evidence: __

Existing target disposition if a new target is chosen:

- [ ] Preserve the existing target untouched and blocked for later review.
- [ ] Request a separate future retirement review; this does not authorize deletion or reset.

## 3. Choose a recovery design for a future proposal

Select one; each provider operation needs its own approval.

- [ ] Option 1 — disposal/rebuild from a separately approved, provably clean baseline. Record its origin and proof, exact resources to create, and no-copy boundary. Do not delete or reset the old target under this selection alone.
- [ ] Option 2 — create a pre-migration snapshot and rehearse multi-step restore into a separate disposable branch. Record exact source branch, snapshot, destination, validation, quota, and cost.
- [ ] Neither; stop until a new recovery proposal is prepared.

The existing target’s snapshot list and schedule were empty in the readbacks. A snapshot, restore branch, compute attachment, read-only SQL validation, cleanup, and migration are distinct future permissions. The Free plan listing or history window does not prove that this project has an available recovery point, remaining quota, or a zero-cost operation. Do not upgrade or incur cost without a separate owner decision.

## 4. Security and governance decisions

For each item, choose one disposition. A temporary exception must name an owner, compensating controls, evidence, expiry date, and re-review condition. “Accept” does not authorize a provider or source change.

| Finding | Fix before use | Temporary synthetic-only staging exception | Decline / stop | Owner, controls, evidence, expiry |
|---|---|---|---|---|
| Unknown parent lineage and unresolved public.show_db_tree | [ ] | [ ] | [ ] | |
| read_write endpoint and passwordless_access=true; authentication controls unverified | [ ] | [ ] | [ ] | |
| Owner role/grants not independently attested; runtime identity must be separate | [ ] | [ ] | [ ] | |
| No database-native RLS in checked-in schema; app-layer RT controls only | [ ] | [ ] | [ ] | |
| Exact-source cross-RT negative app tests before any app connection | [ ] | [ ] | [ ] | |
| Five historical HIGH development-dependency advisories; prod-only audit had zero | [ ] | [ ] | [ ] | |
| Six smoke scripts invoke Next outside shared environment-file wrapper | [ ] | [ ] | [ ] | |
| Credential custody, access duration, rotation/revocation, and operator are unverified | [ ] | [ ] | [ ] | |

The passwordless_access flag does not by itself prove unauthenticated access; verify the exact authentication model and who can obtain access. Do not use the owner role as an application runtime identity. No real resident data is permitted for a disposable-stage exception. Database-native tenant enforcement or an independently reviewed equivalent boundary remains a production gate.

The six-script guard correction is a future source proposal only. Do not run those scripts from a staging-credentialed checkout until the shared preflight gap is fixed and verified. Five HIGH development advisories remain a development/CI exposure even though the historical production-only audit reported zero. Refresh the exact lockfile audit before future use.

## 5. Freeze the exact migration inputs for any later proposal

These hashes identify the reviewed source files only. Recompute and compare them to an owner-approved manifest immediately before any future migration. A changed source, migration, or journal invalidates this evidence.

Application source SHA/tree: 3bc69c83265dce3a6a0863cbfceea188f40f6168 / f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9
Drizzle journal file: drizzle/meta/_journal.json
Drizzle journal SHA-256: d468de22e03afa8598e5a9502d6a287309a07b4a7e949d90cd98224fb8d453db

| Order | Migration file | SHA-256 |
|---:|---|---|
| 0000 | 0000_messy_menace.sql | 1e87505b8543171ab85a98fc2b9ff565952fc31d92c9aabcb063973ca1189af9 |
| 0001 | 0001_classy_ricochet.sql | f644351e359305b4f696a8e60ef9241706d2e1a751adfd906110e519ecc80b93 |
| 0002 | 0002_monthly_due_period_guard.sql | 466ddc6ef468d086800b52929889ed752f3df5ed362beb6739265868bfed9ead |
| 0003 | 0003_due_auth_audit_domain.sql | a0880ae7daeb81d8d47e736fbae0f925237655f7f216713692041a8b5cbf4994 |
| 0004 | 0004_phase_5_payment_request.sql | 459150e411f0fb7386f4803616cc92684ed30c6cf4dfbb9c0787b483b5b47304 |
| 0005 | 0005_phase_5_1_payment_request_items_immutable.sql | e92659078ea43f77e6ca91fefe0d0711edc7580753b73070d62428556ff4bf5b |
| 0006 | 0006_phase_6_treasurer_payment_ledger.sql | f1e902ddb4b7f2cb7a6cde56e9955835a07c3153ab2a04fe93e435cc18aed674 |
| 0007 | 0007_phase_7_reject_cancel.sql | f8be881f41d2f2c1b1520ba51cb1d6f9a2474539c122f0fe7fef3886962b7de2 |
| 0008 | 0008_phase_7_1_post_resolution_lifecycle.sql | c321c7b82a05082d87b9c5182f28ac9abf18ec16884dfa5a089e1fdc1fa29b11 |
| 0009 | 0009_phase_8_cash_payment.sql | d86b48e55cf0135015ce7a013d95994f62c62e7d3e341012fcc19350c217fbf6 |
| 0010 | 0010_phase_9_payment_reversal.sql | 63038e8a4e7fe29a007cb80704ab8f2cadaaf15f57238af1579980ab9710a209 |
| 0011 | 0011_phase_10_waiver.sql | c3826aea7c0c837e07b4152e780d065fbbc6592744b3326af29b1cca44c5a119 |
| 0012 | 0012_phase_11_tariff_adjustment.sql | 131c058f819fa1192dd7fea12b7ba7d45c1f6a967e494a6cbab7e7f4b2dff86a |
| 0013 | 0013_phase_12_household_management.sql | a707f54fb504999323fd65860cfeea247288e20940d1319094195d067f30ab2c |

The Wave 12.3 run 38503239173 is a successful disposable PostgreSQL 18.6 rehearsal on this application SHA. It is not Neon staging evidence and does not authorize executing these hashes against any database.

## 6. Name every future permission separately

Check only actions explicitly authorized by a later owner decision. Blank boxes grant no authority.

- [ ] Read-only metadata for the exact named Neon project/branch/database/endpoint only.
- [ ] Create one manual snapshot for the exact named root branch after current quota/cost readback.
- [ ] Restore the named snapshot into the named disposable branch using the multi-step path; preserve the original.
- [ ] Create the named new Free-plan project/branch/database/endpoint after quota and cost evidence; no external data copy.
- [ ] Attach compute or wake an endpoint for the named purpose and window.
- [ ] Run an exact, reviewed, server-enforced read-only SQL preflight against the named target.
- [ ] Change roles, credentials, access policy, or endpoint configuration as itemized below.
- [ ] Apply a reviewed source guard or CLI wrapper patch on a separately named branch and exact SHA.
- [ ] Connect the app to the named staging endpoint using a separate runtime identity.
- [ ] Run only migrations 0000–0013 with the exact manifest and stop/recovery rules above.
- [ ] Create or delete a resource, snapshot, branch, database, endpoint, or project. Name each exact item and operation.
- [ ] Deploy or change Vercel/GitHub settings. Name exact project and setting.
- [ ] Other specifically scoped action: ______________________________________

Target IDs and permitted action details: _____________________________________
Execution window and timezone: ____________________________________________
Named operator: ____________________  Stop authority: ______________________
Recovery decision-maker: ___________  Stop contacts: _______________________
Current plan/quota/cost evidence reference: ________________________________

A previous owner waiver of organization-wide MFA and a detailed Rp0 usage audit as V1 blockers does not authorize charges, plan upgrades, or an unverified-cost operation. Verify current quota and any applicable cost before a snapshot, restore, compute, or resource action.

## 7. Required gates and stop conditions

Before a later migration can even be proposed for approval, require exact target identity and root/parent lineage readback; resolve public.show_db_tree; prove the chosen baseline and no-copy boundary; establish owner data-preservation decision; verify authentication and role separation; validate quota/cost; obtain a recovery point and separately authorized restore rehearsal or approve a proven clean rebuild; freeze source/tree/journal/migration hashes; and provide exact-SHA preflight and cross-RT evidence as required by the selected use.

If any migration command has begun and errors or times out, assume partial state. Stop the runner and app writes; do not retry, edit the Drizzle journal, drop objects, rewrite rows, or restore automatically. Preserve sanitized diagnostics and obtain a new explicitly authorized read-only assessment followed by an owner-selected recovery action. For 0003 enum/conversion behavior, 0010 settlement backfill, and 0011–0013 data preflights, never transform real resident data to force a pass.

Stop on target mismatch, real/operational data that may need preservation, an unexpected or unexplained object, incomplete or truncated inspection, lineage presented as known without evidence, uncontrolled access, failed recovery, unverified cost/quota, missing owner exception, or any attempt to treat the disposable PG18 rehearsal as Neon proof.

After any separately authorized migration, acceptance requires exact target/source readback; one ordered execution with the approved 14 journal entries and matching hashes; expected schema and financial/household invariants; resolved unexpected objects; sanitized evidence; and explicit owner acceptance. App connectivity, deployment, production readiness, changing the isolation guard, and cleanup remain distinct decisions.

## 8. Owner decision record

Target selected: ___________________________
Recovery option selected: __________________
Security exceptions approved (attach evidence and expiry): __________________
Separately authorized actions and exact targets: _____________________________
Decision date/time and timezone: __________________________________________
Owner name/signature: ____________________________________________________

I understand that this packet records decisions only. It does not itself perform or authorize any unchecked operation. No unchecked permission is implied by the Wave 12.5 publication.

## Supporting Wave 12.5 reports

- [Coordinator report](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_COORDINATOR_REPORT.md)
- [Agent A target decision](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_AGENT_A_TARGET_DECISION.md)
- [Agent B recovery runbook](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_AGENT_B_RECOVERY_RUNBOOK.md)
- [Agent C security decisions](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_AGENT_C_SECURITY_DECISIONS.md)

## Official Neon references

- [Neon pricing](https://neon.com/pricing)
- [Neon backup and restore](https://neon.com/docs/guides/backup-restore)
- [Neon instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore)
- [Neon history window](https://neon.com/docs/postgres/backup-restore/history-window)
