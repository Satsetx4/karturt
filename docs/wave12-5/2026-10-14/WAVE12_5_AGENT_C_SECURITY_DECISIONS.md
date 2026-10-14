# KartuRT V1 Wave 12.5 — Security and Governance Decisions

**Date:** 2026-10-14 (Asia/Bangkok)
**Lane:** W12.5-C01–C09 — security classification and owner decision packet
**Lane result:** **PARTIAL — decision packet prepared; owner selections and later authorizations remain outstanding.**
**Wave effect:** Documentation and analysis only. This report does not authorize database access, staging connectivity, migration, or source changes.

## Baselines and evidence boundary

| Item | Verified value |
|---|---|
| Repository | Satsetx4/karturt |
| Source checkout | D:\!AGY\karturt-wave12-5-agent-c-20261014, detached at the assigned source SHA |
| Source SHA / tree | 3bc69c83265dce3a6a0863cbfceea188f40f6168 / f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9 |
| Historical source branch label | codex/wave12-3-pg18-rehearsal-20261014 |
| Documentation reference | D:\!AGY\karturt-wave12-4-coordinator-20261014 |
| Documentation branch and SHA / tree | docs/wave12-4-staging-readiness-20261014, bea05d7f4f2346645b7354c32b6cd748654aaf05 / c6beb5ab46c8428887d152019d5aa590907b1cf2 |

The source SHA and tree matched the assigned baseline, and the source checkout was clean before this report was created. The documentation reference was at the stated Wave 12.4 SHA. I read all five Wave 12.4 reports and the relevant Wave 12.1–12.3 security, owner-decision, and PostgreSQL rehearsal evidence. This report is a static review of that evidence and the exact source tree.

No Neon SQL, metadata call, database connection, compute wake, snapshot, restore, migration, DDL/DML, role or credential operation, Vercel operation, test, source patch, commit, or push was performed by this lane. No credential value or resident data was accessed or included.

## Target and evidence status carried forward

Wave 12.4 reports these metadata identities for the approved staging target:

- Organization satset, ID org-ancient-boat-57106549, Free plan.
- Project karturt-v1-staging, ID wild-art-99835126, PostgreSQL 18, region aws-ap-southeast-1.
- Branch staging, ID br-hidden-cake-a1ge5xqp; primary/default; init_source=parent-data. Parent identity and source point remain unknown.
- Database karturt_staging, ID 42079960; owner role karturt_staging_owner.
- Endpoint ep-snowy-meadow-a10304d9; read_write; passwordless_access=true.

The 26-statement Wave 12.4 inspection was reported successful in a server-enforced read-only transaction with exact target and role assertions. Its classification is **SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE**: public was the only non-system namespace; the enumerated relation, policy, routine, Drizzle-ledger, and other catalog families returned no user objects; plpgsql was the only reported extension. That result does not prove row absence, physical emptiness, inherited parent contents, branch lineage, grants, or migration readiness. Wave 12.4 also reported no snapshot or scheduled snapshot and no Neon restore rehearsal.

A separate fresh describe_branch metadata output surfaced the label **public.show_db_tree**. That item was not one of the 26 fixed SQL statements and is unexplained by the Wave 12.4 audit. This lane does not classify it as a table, helper, harmless metadata, or evidence of user data. It must remain an unresolved signal until a separately authorized, safe review explains its source and meaning. Do not use the catalog result to silently dismiss it.

The exact source still sets **stagingIsolationVerifiedEmpty=false** and blocks staging access in src/lib/staging-database-target.ts. Owner acceptance of unknown lineage is a decision to tolerate a provenance risk for a disposable target; it is not evidence that the database is empty, does not resolve public.show_db_tree, does not authorize changing this flag, and does not authorize SQL or migration.

## Security and governance classification

“Must fix” below means the condition is a gate before the named use. A bounded staging exception is a written, time-limited risk acceptance with the listed controls; it is not a general waiver. No exception is currently approved.

| Finding | Before staging migration | Before staging app connectivity | Before production | May be accepted for bounded disposable staging? |
|---|---|---|---|---|
| Unknown parent lineage and unexplained public.show_db_tree | **BLOCKED pending decision and classification.** Either establish an approved provenance/clean baseline, or obtain the explicit non-preservation decision described below and resolve the unexplained metadata item under a future approved method. Any migration still needs a separate authorization and recovery plan. | **BLOCKED** until the target state is explained and app data is synthetic-only. | **MUST FIX.** Production data origin and contents must be known. | The owner may accept unknown ancestry as a disposal/provenance risk only after signing that no operational or real resident data needs preservation. That acceptance does not turn unknown into empty or change the source guard. |
| passwordless_access=true on a read_write endpoint | **MUST RESOLVE before a connection.** Verify the exact authentication model, which identities can obtain access, how access is controlled, and the approved operator. The metadata flag alone does not prove unauthenticated access. | **MUST FIX or verify controls first.** A runtime app role and server-only credential path must be distinct from the owner role; no client-side database credential. | **MUST FIX** through verified, controlled authentication and access policy. | Only if a future reviewer verifies operator-only access controls and the owner expressly accepts the temporary exposure. Merely accepting the metadata label is insufficient. |
| Database owner role plus read_write endpoint; grants not independently attested | **MUST VERIFY.** Name the migration principal and exact grants. If owner privileges are required for DDL, require an explicitly authorized operator, short execution window, isolated disposable target, and stop/recovery authority. | **MUST FIX.** Never use karturt_staging_owner as an application runtime identity; use a separate least-privilege app principal. | **MUST FIX.** Separate and least-privilege migration and runtime roles; verify grants and credential rotation. | A temporary owner-role migration may be accepted only for a disposable target with explicit, one-time scope. No such permission is granted here. |
| App-layer RT authorization with no database-native RLS in checked-in schema | Application checks are not a substitute for classifying the target or authorizing the migration. No RLS policy was found in the checked-in schema/migrations; Wave 12.4 found no relations or policies in its bounded catalog scope. | **MUST FIX for real/shared data.** A disposable synthetic-only app evaluation may proceed only with a written exception, server-side access, no direct client DB connections, and exact-source cross-RT negative tests. | **MUST FIX** with database-native tenant enforcement or an independently reviewed equivalent DB boundary, plus runtime cross-RT evidence. | **Potentially**, only for synthetic-only data in an isolated staging environment after the compensating controls are evidenced and accepted. |
| Tenant cross-RT authorization | A migration itself does not establish authorization correctness; preserve the database boundary and avoid using live resident rows. | Static source checks bind RT-scoped permissions to the principal RT and resident actions to matching RT/household. Prior focused tests were reported on an earlier source SHA, not rerun here. Before any app connection, test exact-SHA cross-RT denials for representative reads and writes; do not claim no exploit from static review. | **MUST FIX any identified cross-RT failure** and establish exact-SHA runtime coverage; absent RLS remains a separate production gate. | Only as the bounded app-layer exception above, and only with synthetic data and passing exact-SHA cross-RT checks. |
| Five HIGH development-dependency advisories; production-only audit reported zero | Not a database-state or SQL permission. Record whether the migration operator/toolchain uses affected packages; do not treat the finding as resolved. | A temporary exception may be considered only for isolated evaluation with controlled CI/developer access and no unnecessary secrets. Refresh the exact lockfile audit before use. | **MUST FIX or obtain a documented security disposition before production release.** The zero production-dependency findings do not close development/CI exposure. | **Potentially**, time-limited and scoped to the development toolchain; it is not an automatic acceptance. Findings were reported for eslint-config-next, @next/eslint-plugin-next, braces, fast-glob, and micromatch. |
| Six smoke scripts invoke Next CLI outside the shared environment-file wrapper | Not a migration gate if those scripts are not used to connect to the database. Do not use them with staging credentials before the guard gap is addressed. | **MUST FIX before running the affected scripts in a staging-credentialed checkout.** Next may load .env files before application configuration. If staging app validation uses these scripts, patch and verify this first. | **MUST FIX before using them for production/release verification**, or prove the unguarded scripts cannot run in the credentialed release environment. | **Potentially**, only if these scripts are not run, no relevant .env files/secrets are present, and the exception is time-limited. |
| Credential custody and access lifecycle are unverified | **MUST VERIFY** the credential issuer, permitted operator, storage channel, access duration, rotation/revocation owner, and secret-safe logs before any later connection. Do not put secret values in this form. | **MUST FIX** with server-side secret storage, separate runtime principal, restricted access, and rotation/revocation process. | **MUST FIX** with production-grade secret lifecycle and least privilege. | No exception based only on an owner assertion. An explicitly controlled temporary operator path may be considered only after its controls are evidenced. |

### Supporting source review

At the exact source SHA, src/lib/auth/principal.ts resolves authenticated principals, rejects inactive accounts, binds residents to active person/household membership within the account RT, and binds official assignments to their RT. src/lib/auth/permissions.ts requires matching RT scope for RT-scoped permissions and matching RT plus household for resident permissions. These are useful application-layer controls, not DB-native policy enforcement.

A static search of src/db/schema.ts and drizzle/*.sql found no CREATE POLICY, ENABLE ROW LEVEL SECURITY, or FORCE ROW LEVEL SECURITY. The Wave 12.4 catalog scope returned no public relations or policies, so it did not establish policy coverage for an application schema that was absent. No deployed application-connected database state or runtime tenant test was established by this lane.

Prior Wave 12.2 evidence reports 209 focused authorization, environment, and PGlite-backed tests on source SHA d4fc471a988c070ca2118e12ddbb0b363daa6541. That is earlier-source evidence. Wave 12.3’s exact-SHA PG18.6 rehearsal at 3bc69c83265dce3a6a0863cbfceea188f40f6168 passed synthetic migration and a negative cross-RT database-constraint case; that is not application authorization testing and does not characterize Neon. No tests were run for this lane.

The Next command wrapper in scripts/lib/next-command.ts applies an environment-file preflight for package dev/build/start scripts. Six smoke scripts directly spawn node_modules/next/dist/bin/next: scripts/phase-6-treasurer-verification-http-smoke.ts, scripts/phase-8-cash-payment-http-smoke.ts, scripts/phase-9-payment-reversal-http-smoke.ts, scripts/phase-10-waiver-http-smoke.ts, scripts/phase-11-tariff-adjustment-http-smoke.ts, and scripts/phase-12-household-browser-smoke.ts. This is a tooling-preflight gap. It does not by itself prove a database-target-guard bypass or an exploit.

### Proposed minimal future patch — not implemented

Keep the correction inside the existing Next-command safety boundary. Extract an exported shared environment-policy check from scripts/lib/next-command.ts, or add a lifecycle-aware guarded spawn helper there. Call it immediately before each of the six smoke scripts starts Next, using the same project directory and environment that the child process receives. A shared async spawn helper should preserve the smoke scripts’ process tracking and cleanup; the current synchronous runNextCommand helper blocks and is not a drop-in replacement for scripts that manage a server process. The guard must run before launching Next because Next can load .env files before next.config is evaluated. In a future separately authorized source wave, add focused checks for each smoke launch path and for disallowed project environment files. This report makes no source patch recommendation beyond that bounded proposal and changes no files outside this report.

## Owner decision packet — complete before any future staging operation

**Current decision state:** Owner input required. No option is selected, no exception is accepted, and no future operation is authorized by this packet.

### 1. Choose the target

Select exactly one after reviewing the target decision report:

- [ ] **Existing target** — project wild-art-99835126, branch br-hidden-cake-a1ge5xqp, database karturt_staging (ID 42079960), role karturt_staging_owner, endpoint ep-snowy-meadow-a10304d9.
- [ ] **New isolated staging target** — exact organization, project, branch, database, role, and endpoint IDs are not known yet. They must be independently read back and approved before a later operation; creation is a separate permission.

For the existing target, the owner must choose one:

- [ ] I affirm no operational database contents or real resident data in the existing target need preservation, and I accept the possibility that unknown inherited contents may exist.
- [ ] I cannot affirm that statement. **Stop using the existing target; do not migrate, reset, or connect an app.**

I understand that this is a non-preservation decision, not proof of emptiness or lineage. The separate public.show_db_tree metadata signal still requires explanation. This choice does not authorize changing stagingIsolationVerifiedEmpty=false.

If the new-target option is chosen, select the future disposition of the existing target:

- [ ] Leave it untouched and blocked; preserve it for later review. This is the default until a separate authorization says otherwise.
- [ ] Request a separate future review of retirement. No delete or cleanup permission is granted by this report.

### 2. Choose one recovery design for a future proposal

- [ ] **Option 1 — disposal/rebuild from a provably clean approved baseline.** Identify the clean source and provenance, confirm no data needs preservation, and name every resource that a future operation would create, replace, or dispose of. Resource creation/deletion and any reset require separate explicit permission.
- [ ] **Option 2 — pre-migration snapshot and separate disposable restore rehearsal.** Name the snapshot, restore target, and validation steps. Snapshot creation and restore/branch creation are separate provider permissions. Wave 12.4 found no current snapshot or schedule; its Free-plan history metadata is not a pinned backup or restore test.
- [ ] Neither option is accepted; stop.

The recovery decision must include the migration partial-failure plan: preserve failed state and sanitized logs, obtain a new authorized read-only assessment, and require an owner-approved restore or versioned repair plan. No blind retry, drop of partial objects, or manual Drizzle ledger editing.

### 3. Decide each bounded security exception

For every row, select **fix before use**, **accept temporarily for disposable staging**, or **decline/stop**. Acceptance requires a named owner, compensating control, evidence reference, expiry date, and re-review condition. Blank rows mean no exception.

| Risk | Fix before use | Temporary disposable-stage acceptance | Decline / stop | Owner, controls, expiry, evidence |
|---|---:|---:|---:|---|
| Unknown lineage / parent-data initialization | [ ] | [ ] | [ ] | |
| Unexplained public.show_db_tree metadata | [ ] | [ ] | [ ] | |
| passwordless_access=true / read_write endpoint | [ ] | [ ] | [ ] | |
| Owner role and unverified grants | [ ] | [ ] | [ ] | |
| No DB-native RLS in checked-in schema | [ ] | [ ] | [ ] | |
| Tenant cross-RT risk / exact-SHA test gap | [ ] | [ ] | [ ] | |
| Five HIGH development advisories | [ ] | [ ] | [ ] | |
| Six direct Next CLI smoke-script calls | [ ] | [ ] | [ ] | |
| Credential custody and revocation | [ ] | [ ] | [ ] | |

No owner exception can alter factual evidence. In particular, accepting unknown lineage never allows the report to claim the database is verified empty and never permits changing stagingIsolationVerifiedEmpty=false.

### 4. Lock source and migration files

Any later migration request must name this immutable source candidate or provide a new reviewed source candidate with newly computed hashes. The values below are SHA-256 checksums of the exact SQL files in the assigned source tree. They are file-integrity values, not Drizzle journal hashes and not proof that a migration has run.

**Source SHA:** 3bc69c83265dce3a6a0863cbfceea188f40f6168
**Source tree:** f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9

| Migration file | SHA-256 |
|---|---|
| 0000_messy_menace.sql | 1e87505b8543171ab85a98fc2b9ff565952fc31d92c9aabcb063973ca1189af9 |
| 0001_classy_ricochet.sql | f644351e359305b4f696a8e60ef9241706d2e1a751adfd906110e519ecc80b93 |
| 0002_monthly_due_period_guard.sql | 466ddc6ef468d086800b52929889ed752f3df5ed362beb6739265868bfed9ead |
| 0003_due_auth_audit_domain.sql | a0880ae7daeb81d8d47e736fbae0f925237655f7f216713692041a8b5cbf4994 |
| 0004_phase_5_payment_request.sql | 459150e411f0fb7386f4803616cc92684ed30c6cf4dfbb9c0787b483b5b47304 |
| 0005_phase_5_1_payment_request_items_immutable.sql | e92659078ea43f77e6ca91fefe0d0711edc7580753b73070d62428556ff4bf5b |
| 0006_phase_6_treasurer_payment_ledger.sql | f1e902ddb4b7f2cb7a6cde56e9955835a07c3153ab2a04fe93e435cc18aed674 |
| 0007_phase_7_reject_cancel.sql | f8be881f41d2f2c1b1520ba51cb1d6f9a2474539c122f0fe7fef3886962b7de2 |
| 0008_phase_7_1_post_resolution_lifecycle.sql | c321c7b82a05082d87b9c5182f28ac9abf18ec16884dfa5a089e1fdc1fa29b11 |
| 0009_phase_8_cash_payment.sql | d86b48e55cf0135015ce7a013d95994f62c62e7d3e341012fcc19350c217fbf6 |
| 0010_phase_9_payment_reversal.sql | 63038e8a4e7fe29a007cb80704ab8f2cadaaf15f57238af1579980ab9710a209 |
| 0011_phase_10_waiver.sql | c3826aea7c0c837e07b4152e780d065fbbc6592744b3326af29b1cca44c5a119 |
| 0012_phase_11_tariff_adjustment.sql | 131c058f819fa1192dd7fea12b7ba7d45c1f6a967e494a6cbab7e7f4b2dff86a |
| 0013_phase_12_household_management.sql | a707f54fb504999323fd65860cfeea247288e20940d1319094195d067f30ab2c |

Before permission, independently verify exact source SHA, file paths, all 14 SHA-256 values, migration order, and the separate Drizzle migration metadata. If any value differs, stop and review the new candidate; do not edit a journal to force a match.

### 5. Name target, permission, operator, and execution window

For a future request, fill every applicable field. Never put passwords, tokens, connection strings, personal data, or resident information in this document.

- Selected target: [ ] existing [ ] new
- Organization / ID:
- Project / ID:
- Region / PostgreSQL version:
- Branch / ID and known parent/source point:
- Database / ID:
- Migration role / verified grants:
- Endpoint / ID / access mode / authentication model:
- App runtime role (if app connectivity is requested):
- Secret storage reference only (no secret value):
- Permitted actions, each checked separately:
  - [ ] Read-only provider metadata for the named project/branch only.
  - [ ] One reviewed server-enforced read-only SQL transaction for the named database and role. This does not authorize staging migrations or reuse the spent Wave 12.4 permission.
  - [ ] Create the named pre-migration snapshot.
  - [ ] Restore that snapshot to the named disposable target.
  - [ ] Create the named project/branch/database/endpoint.
  - [ ] Delete or replace the named resource.
  - [ ] Change the named role, credential, or access policy.
  - [ ] Connect the staging app using the named non-owner runtime principal.
  - [ ] Execute the exact 0000–0013 migration chain at the source/checksums above.
  - [ ] Seed only the specifically described synthetic fixture.
  - [ ] Modify source guard or other source files in a separately named wave.
  - [ ] Other, with exact scope:
- Execution start and stop time, including Asia/Bangkok timezone:
- Named owner authorizer:
- Named operator:
- Independent reviewer / observer:
- Recovery decision authority:
- Manual owner steps completed before start:
- Sanitized evidence location and readback owner:

No Vercel settings, deployment, production access, real resident data, paid-plan change, unrelated Neon project, or broader resource permission is included. Each would require a separate decision and is outside this Wave 12.5 lane.

### 6. Stop conditions and owner acknowledgement

Stop before connecting or changing anything if any of these occurs:

1. Any project, branch, database, role, endpoint, region, authentication, or source-hash mismatch.
2. The public.show_db_tree signal remains unexplained, the catalog output is incomplete, or any unexpected object, ledger, user data, resident data, or lineage evidence appears.
3. The owner cannot affirm the required non-preservation statement for an existing disposable target.
4. The migration role, credential path, access principal, or endpoint semantics are not verified.
5. An operation, file checksum, migration order, or permitted action is outside the signed scope.
6. Any migration fails, partially commits, or reports unexpected preflight state. Preserve state and sanitized diagnostics; do not retry, edit the ledger, or improvise a repair.
7. The recovery point is missing, invalid, outside the approved target, or cannot be restored in the separately approved rehearsal.
8. A cost, quota, or paid-service requirement is unclear. Stop; do not upgrade or incur a charge.

Owner acknowledgement:

- [ ] I selected one target and one recovery approach, or I decline both and require work to stop.
- [ ] If choosing the existing target, I have made the explicit non-preservation assertion above.
- [ ] I understand lineage remains factually unknown unless separately established, and owner acceptance does not mean verified empty.
- [ ] I understand stagingIsolationVerifiedEmpty remains false; this form does not authorize changing source.
- [ ] I selected and scoped each security exception; blank or unsigned items are not accepted.
- [ ] I authorize only the separately checked action(s), target, source SHA, migration checksums, operator, and execution window above.
- [ ] I understand that snapshot, restore, resource, role/access, app-connection, migration, source-change, and deployment permissions are distinct.

Owner name and signature:
Decision date/time and timezone:
Decision expiry / re-review date:
Independent reviewer:

## Lane disposition

**Agent C result: PARTIAL.** Security facts are classified and an owner decision form is prepared, but no owner decisions or security exceptions exist yet. The current target remains not ready for migration or app connectivity. Wave 13 migration remains **NOT AUTHORIZED**. Keep stagingIsolationVerifiedEmpty=false. This lane performed documentation work only and stopped at the assigned boundary.
