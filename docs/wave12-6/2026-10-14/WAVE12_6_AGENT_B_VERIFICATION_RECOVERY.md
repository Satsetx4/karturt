# KartuRT V1 Wave 12.6A — Initial-State Verification and Recovery Proposal

**Date:** 2026-10-14 (Asia/Bangkok)

**Lane:** W12.6-B01–B09

**Disposition:** DOCUMENTATION PREPARED — no target exists yet, and no Neon inspection or SQL was performed.
**Authorization boundary:** This is a proposal only. It does not authorize Wave 12.6B project creation, metadata access, compute wake, SQL, roles/access changes, source changes, migration, rebuild, deletion, or deployment. Wave 13 remains NOT AUTHORIZED.

## 1. Baselines reviewed

| Item | Verified value |
|---|---|
| Repository | Satsetx4/karturt |
| Source branch and SHA | codex/wave12-3-pg18-rehearsal-20261014 at 3bc69c83265dce3a6a0863cbfceea188f40f6168 |
| Source tree | f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9 |
| Documentation base | docs/wave12-5-recovery-decision-20261014 at 01a3e532b258efb1813630cea610f6ab10a14410 |
| Documentation tree | 9c57dbade44b77a72053e3481483a4ba37778a27 |
| Assigned worktree | D:\!AGY\karturt-wave12-6a-agent-b-20261014, branch codex/wave12-6-agent-b-20261014; clean before this file |

The source and documentation commits resolve locally to the exact SHA/tree values above. I read all five Wave 12.5 reports and the relevant Wave 12.1–12.4 inspection, recovery, and PostgreSQL 18 rehearsal reports:

- Wave 12.5: Agent A target decision, Agent B recovery runbook, Agent C security decisions, Coordinator report, and Owner decision packet.
- Wave 12.1 Agent B Neon read-only preflight; Wave 12.2 Agent B database inspection; Wave 12.3 Agent B PG18 rehearsal and Coordinator report; Wave 12.4 Agent B Neon read-only inspection, Agent C recovery/security, and Coordinator report.

The prior reports are linked in the repository: [Wave 12.5](../../wave12-5/2026-10-14/), [Wave 12.1 Agent B](../../wave12-1/2026-10-13/WAVE12_1_AGENT_B_NEON_READONLY.md), [Wave 12.2 Agent B](../../wave12-2/2026-10-14/WAVE12_2_AGENT_B_DATABASE_INSPECTION.md), [Wave 12.3 Agent B](../../wave12-3/2026-10-14/WAVE12_3_AGENT_B_PG18_REHEARSAL.md), [Wave 12.3 Coordinator](../../wave12-3/2026-10-14/WAVE12_3_COORDINATOR_REPORT.md), [Wave 12.4 Agent B](../../wave12-4/2026-10-14/WAVE12_4_AGENT_B_NEON_READONLY.md), [Wave 12.4 Agent C](../../wave12-4/2026-10-14/WAVE12_4_AGENT_C_RECOVERY_SECURITY.md), and [Wave 12.4 Coordinator](../../wave12-4/2026-10-14/WAVE12_4_COORDINATOR_REPORT.md).

### Evidence carried forward

- Exact-source GitHub Actions run 38503239173 passed a disposable PostgreSQL 18.6 rehearsal at source SHA 3bc69c83265dce3a6a0863cbfceea188f40f6168. The rehearsal reported migrations 0000–0013, 14 ledger entries, 27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums, plus synthetic failure and dump/restore cases. It is not Neon evidence.
- Wave 12.4 completed one authorized 26-result, server-enforced read-only transaction on the existing target. Its result was SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE. That bounded catalog result did not prove row absence, physical emptiness, lineage, or migration readiness.
- The existing branch reported init_source=parent-data. A later metadata tree listing exposed public.show_db_tree, unexplained and not SQL-verified. Do not investigate or access it under this proposal.
- Source guard stagingIsolationVerifiedEmpty remains false.

## 2. Locked target and preservation boundary

The future candidate is a **new independent Neon project** in organization satset, ID org-ancient-boat-57106549, with proposed project name karturt-v1-staging-clean, PostgreSQL 18, region aws-ap-southeast-1, and Free plan. A root branch named staging and database karturt_staging are proposed names only. New IDs, roles, endpoint, hostname, origin, quota, and costs are unknown until a later, separately authorized operation and exact readback.

The starting point must be an independently created root with no parent/source branch, snapshot restore, clone, import, dump restore, or copy from any existing project. Use synthetic data only. Record the provider creation response and provenance so that no-copy can be audited. A project’s new name or a clean catalog alone does not establish no-copy or physical emptiness.

Preserve the existing staging project and every resource unchanged:

| Resource | Existing identifier |
|---|---|
| Project | wild-art-99835126 |
| Branch | br-hidden-cake-a1ge5xqp |
| Database | karturt_staging, ID 42079960 |
| Owner role | karturt_staging_owner |
| Endpoint | ep-snowy-meadow-a10304d9 |

Do not query, connect to, wake, migrate, copy from, clean up, reset, replace, or delete any of these. Do not create a child branch from this project. The unresolved public.show_db_tree metadata signal remains a reason to avoid inheriting this target; this lane does not recheck or classify it.

## 3. Proposed PostgreSQL 18 initial-state contract

This contract applies only after project creation and a separate read-only metadata authorization. It is not yet evidence about a live database.

### Provider identity and provenance gate

Before any future SQL permission is considered, a separately approved metadata read must establish all of the following for the newly created project only:

1. Organization ID/name match the approved organization.
2. Project ID/name match the creation response and the approved manifest; region is aws-ap-southeast-1; PostgreSQL major version is 18.
3. The branch is the intended root/default branch with no parent branch and no restore/clone/import origin.
4. Database ID/name, owner-role name, endpoint ID/hostname, endpoint-to-branch mapping, and access state match the provider response.
5. The project origin record confirms that no data, branch, snapshot, dump, or backup from the existing staging project or another project was copied or restored.
6. Free plan capability, actual remaining project/resource quota, and expected operation cost are independently verified. If quota, cost, or any potential overage is unknown, classify QUOTA/COST NOT VERIFIED and stop. A Free label alone is not Rp0 evidence.

Project and branch IDs cannot be proven by querying PostgreSQL catalogs. The exact provider-returned IDs must be checked against the metadata and the future SQL tool arguments. Any mismatch or missing identifier is a stop before connection.

### Expected initial state

- PostgreSQL reports major version 18. Record the full server version returned; do not assume a minor version.
- PostgreSQL built-in namespaces such as pg_catalog, information_schema, pg_toast, and generated temporary schemas are system state. Do not exclude all names beginning with pg_; any other namespace must be reported.
- The default public namespace may exist, but it must contain no application or user-created objects.
- User relations, views, materialized views, sequences, foreign tables, user-defined types/domains/enums/ranges, routines, triggers, event triggers, policies, publications/subscriptions, foreign-data objects, and unexpected extensions are not part of an accepted clean baseline.
- The default Neon/PostgreSQL extension baseline must be observed and documented from this new project. Wave 12.4 found plpgsql in pg_catalog on the old project; that does not prove the new project has the same baseline. Unknown extensions or objects stop acceptance.
- The default Drizzle journal relation drizzle.__drizzle_migrations must be absent. Treat any matching journal relation in another schema as unexpected initialization.
- No application row query is proposed. No user routine is called. No table row counts, sequence values, routine bodies, secrets, or resident data are read.

Catalog inspection can classify only its enumerated object families. It cannot prove physical emptiness, copied-data absence, hidden/uninventoried state, parent provenance, or full ACL/dependency completeness. No-copy is established through the independent creation path and provider provenance evidence, not inferred from SQL.

## 4. Fixed transaction-level read-only SQL proposal — DO NOT EXECUTE

This sequence is for a future, separate owner authorization naming the exact new project, branch, database, role, endpoint, statement array, and execution window. It was not run in Wave 12.6A. Revalidate the connector contract at that time: it must send the ordered array as one server-side transaction and enforce transaction read-only. If it cannot guarantee one ordered transaction, if it might wake compute without explicit permission, or if statement results may be omitted/truncated, STOP BEFORE QUERY. No direct-client fallback and no retry.

Fill database and role literals only from the independently read-back new-project metadata, then freeze and review the full statement array before permission. The provider IDs are checked in metadata and tool arguments; SQL cannot attest them.

Statements 1–4 are the required transaction and identity prefix:

    1. SET TRANSACTION READ ONLY;
    2. SHOW transaction_read_only;
    3. SELECT CASE
         WHEN pg_catalog.current_setting('transaction_read_only') = 'on'
          AND pg_catalog.current_database() = '<actual returned database name>'
          AND current_user = '<actual returned role name>'
          AND session_user = '<actual returned role name>'
          AND pg_catalog.current_setting('server_version_num')::integer
                BETWEEN 180000 AND 189999
         THEN 1
         ELSE 0
       END AS wave126_guard;
    4. SELECT pg_catalog.current_database() AS database_name,
              current_user AS current_role,
              session_user AS session_role,
              pg_catalog.current_setting('server_version') AS server_version,
              pg_catalog.current_setting('server_version_num') AS server_version_num,
              pg_catalog.current_setting('transaction_read_only') AS transaction_read_only;

The guard must return exactly 1; statement 2 must return on; statement 4 must show the expected database and role identities, PostgreSQL major 18, and transaction read-only on. Any guard result other than exactly 1, SQL error, omitted output, or result mismatch fails the proposal and stops the inspection.

Statements 5–26 are one fixed catalog inventory, using the exact ordered SELECT definitions documented in the Wave 12.4 Agent B report, with no dynamic SQL. The full approved array must be attached to a future authorization; this section records its fixed order:

| Statement | Catalog-only result |
|---:|---|
| 5 | Non-system namespace names |
| 6 | Non-system relations, kinds, persistence, partition, and RLS flags |
| 7 | Non-system constraints and relation/domain references |
| 8 | Non-system indexes and validity flags |
| 9 | Non-system sequence definitions only; never current values |
| 10 | Non-system types/domains |
| 11 | Non-system enum labels |
| 12 | Non-system range-type links |
| 13 | Non-system routine metadata only; never invoke a routine or read its body |
| 14 | Extension names, schemas, and versions |
| 15 | Trigger metadata and routine names only |
| 16 | Event-trigger metadata |
| 17 | Policy metadata and expression-presence booleans only |
| 18 | Foreign-data wrapper names/flags only |
| 19 | Foreign-server metadata without options |
| 20 | Non-system foreign tables |
| 21 | User-mapping names/visibility only; no options |
| 22 | Publication metadata |
| 23 | Publication-to-table mappings |
| 24 | Publication-to-schema mappings |
| 25 | Current-database subscription names/enabled state only; never connection information |
| 26 | Presence and relation kind of drizzle.__drizzle_migrations; no ledger rows |

All inventory statements must read explicitly qualified pg_catalog catalogs, exclude only the built-in namespaces and numeric temporary schemas, and include every other namespace. Catalog family or field changes from the Wave 12.4 fixed array require fresh review; this report does not silently approve query substitutions. No user routines, DDL/DML, application tables, row data, credentials, foreign options, subscription connection details, or exports are allowed.

### Result classifications

- **EXPECTED INITIAL CATALOG — DEFINED SCOPE:** the entire one-transaction result is complete and untruncated; identity/read-only checks pass; only approved built-in namespaces and the empty public namespace appear; every inventoried user-object family is empty; the Drizzle journal is absent; and the observed extension baseline matches the separately recorded new-project baseline.
- **UNEXPECTED OBJECT / PRIOR INITIALIZATION:** any unapproved non-system namespace/object, extension, migration journal, or application-shaped object appears. Preserve the project and stop; do not inspect rows or modify it.
- **INSPECTION INCOMPLETE:** any statement errors, permission is insufficient, a result is missing/truncated, read-only status or identity is uncertain, or the connector cannot prove the exact transaction.
- **NO-COPY / PHYSICAL EMPTINESS:** not established by these catalog results. No-copy requires creation/provenance evidence; physical emptiness cannot be claimed from this bounded inventory.

Even a clean result is a bounded initial-state classification, not migration permission. Keep stagingIsolationVerifiedEmpty=false until a separately reviewed and authorized source change is supported by all required evidence.

## 5. Distinct Wave 13 preflight

Wave 13 requires a new explicit owner approval after Wave 12.6B, and before the migration process starts, covering the exact target and permitted operation. All rows below are required; any unknown, mismatch, or failed check is STOP.

| Gate | Required evidence |
|---|---|
| Target | Exact organization, new project, root branch, database, migration role, endpoint and hostname IDs/names; PostgreSQL 18; Singapore region; provider metadata tied to the independent creation record. No old-target ID may be used. |
| Provenance | Root has no parent; creation used no clone, branch-from-existing, snapshot, restore, import, dump, or external data; synthetic-only provenance record is complete. |
| Initial state | Separately authorized transaction-level read-only result is complete, identity-bound, and classified EXPECTED INITIAL CATALOG — DEFINED SCOPE. No unexpected objects or Drizzle journal. |
| Source | Exact reviewed source branch/SHA/tree is 3bc69c83265dce3a6a0863cbfceea188f40f6168 / f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9, unless a new source is separately reviewed and authorized. |
| Migration inputs | All 14 ordered SQL SHA-256 values and the Drizzle journal SHA-256 below match the owner-approved manifest immediately before start. Any change invalidates rehearsal evidence. |
| Application traffic | Staging application connections and writes are disabled for the migration window. No user traffic, scheduled worker, or other writer may reach the target. |
| Roles/access | Migration identity, exact grants, authentication, credential custody, operator, and stop authority are verified. Any later app runtime role is separate and least-privilege. No credential value is stored in this report or browser storage. |
| Costs/quota | Current Free capacity and all resource/compute/storage costs are verified for the named target and window; expected added cost is Rp0 with no possible overage or paid tier. If a read-only SQL check could wake/attach compute or cost is uncertain, do not proceed. |
| Guard/security | Source guard remains closed until a separately reviewed and authorized source change; no app connection is approved by this preflight. App-layer RT checks do not establish database-native RLS. |
| Consent | A new owner decision explicitly authorizes migrations 0000–0013, exact source and hashes, exact target IDs, operator/window, synthetic-only validation, stop conditions, and recovery authority. Wave 12.6A/12.6B alone cannot authorize migrations. |

### Exact source migration manifest

SHA-256 values below were recomputed from the immutable source worktree. The journal file has its own hash; these hashes do not prove a migration has run.

| Order | File | SHA-256 |
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

Drizzle journal: drizzle/meta/_journal.json — SHA-256 d468de22e03afa8598e5a9502d6a287309a07b4a7e949d90cd98224fb8d453db.

## 6. Fail-stop disposable rebuild runbook

1. **Before any migration:** if identity, provenance, initial state, source hash, role, traffic isolation, quota/cost, recovery decision, or owner consent is missing or mismatched, do not start. Preserve the new project for review.
2. **Creation timeout or ambiguous provider response:** do not retry project creation blindly. A later read-only metadata lookup must be separately authorized and scoped to the proposed project name/organization. Preserve the result; do not create a duplicate based on a timeout.
3. **Any SQL preflight error, mismatch, omitted result, or truncation:** stop the single inspection attempt. Do not retry or fall back to another connector. Keep the new target untouched and retain sanitized error/result metadata only.
4. **Before migration 0000:** verify the full preflight again, ensure application traffic is off, identify the stop authority and recovery decision-maker, and record a sanitized start manifest. If any gate fails, do not launch the runner.
5. **Failure during 0000, 0001, or 0002:** stop the runner before the next file. Assume partial DDL until proven otherwise. Preserve the failed instance and sanitized logs. Do not replay the failed file.
6. **Failure in 0003 enum/data conversion:** stop immediately. Do not reverse-convert values, rewrite due rows, remove constraints, or make real data resemble the synthetic rehearsal. Preserve evidence and await an owner-approved recovery decision.
7. **Failure during 0004–0009 structural/payment changes:** stop before the next migration, preserve the exact database and log state, and do not infer that a failed command rolled itself back.
8. **Failure in 0010 payment settlement backfill:** stop. Do not rerun or edit payment, allocation, due, settlement, or reversal rows. A new owner-approved integrity review and recovery decision is required.
9. **Failure in 0011–0013 preflight or DDL:** stop the chain. Do not synthesize waiver history, create missing settlement ownership, rewrite household periods, bypass preflights, or proceed to a later migration.
10. **Journal mismatch, partial DDL, or ambiguous migration timeout:** preserve the possibly modified target and sanitized logs. Do not retry, continue, hand-edit the Drizzle journal, drop/reset objects, restore automatically, or create a replacement automatically. A fresh read-only assessment itself requires separate permission.
11. **Disposable rebuild decision:** a failed new target is preserved by default. Creating a replacement requires a new explicit owner authorization naming the exact old failed instance, the new project and its clean source, allowed resource effects, quota/cost evidence, and no-copy proof. Rebuild permission does not authorize deletion of the failed instance or the existing staging project.
12. **Existing target:** the project wild-art-99835126 and its branch/database/role/endpoint are never deleted or reset under this plan. Any future retirement request must be separately reviewed and explicitly authorize the exact resource operation.

### Post-migration acceptance checklist for a later authorized wave

These are expected reference values from the disposable PostgreSQL 18.6 rehearsal at exact source SHA 3bc69c83265dce3a6a0863cbfceea188f40f6168; they are not current staging results and counts alone are insufficient.

- [ ] Exact target IDs, PostgreSQL 18 version, source SHA/tree, and ordered migration checksums match the approved manifest.
- [ ] One ordered execution completed; Drizzle ledger has exactly 14 expected entries with the reviewed names and checksums.
- [ ] Exact expected schema is reviewed: 27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums; investigate every unexpected or missing object.
- [ ] Cross-RT invalid synthetic relationships are rejected; tenant-scoped references cannot cross RT boundaries.
- [ ] Migration 0003 converts only the approved synthetic legacy fixture to NOT_DUE with the expected zero amount and no legacy waiver residue.
- [ ] Migration 0010 settlement ownership matches synthetic payment/allocation/due/RT/household/amount invariants: paid dues map to exactly one valid settlement; non-paid dues map to none.
- [ ] Migrations 0011–0013 enforce waiver history, settlement ownership, and non-overlapping household-period preconditions.
- [ ] No real resident or operational data was copied or introduced; any fixture is synthetic and documented. No user row, secret, dump, or credential is included in evidence.
- [ ] No migration error, journal drift, unexplained object, failed post-check, or unintended data write remains.
- [ ] Sanitized logs, exact target/source manifest, and owner decision are retained. Cleanup, runtime connection, source guard change, app test, and deployment remain separate approvals.

## 7. Permissions matrix

Every row below is a distinct future permission. None is granted by Wave 12.6A.

| Action | Required future authorization | Wave 12.6A state |
|---|---|---|
| Create one new Free Neon project and its automatic branch/database/role/endpoint | Explicit owner approval naming organization, proposed project/configuration, automatic provider side effects, verified quota/cost, no-copy origin, and stop behavior | NOT AUTHORIZED |
| Read metadata for the new project | Separate read-only scope naming the exact organization/project and allowed fields | NOT PERFORMED |
| Run the fixed read-only SQL proposal | Separate approval naming exact new IDs/role/statements, one server-enforced transaction, and whether any compute wake is allowed | NOT AUTHORIZED |
| Create or change migration/runtime roles, credentials, grants, endpoint access | Separate approval for exact role/access changes and secret-handling scope | NOT AUTHORIZED |
| Change source guard or other application source | Separate source wave, reviewed patch, branch, and exact SHA | NOT AUTHORIZED; guard remains false |
| Execute migrations 0000–0013 | New Wave 13 owner approval naming exact source/checksums, target IDs, operator/window, synthetic validation, and stop/recovery authority | NOT AUTHORIZED |
| Rebuild by creating a replacement project | New explicit approval naming the failed target, replacement origin/resources, cost/quota, and preservation terms | NOT AUTHORIZED |
| Delete/reset the failed new project or any other resource | Separate explicit approval naming exact resource and destructive action | NOT AUTHORIZED |
| Delete/reset/retire existing staging project or any listed component | Separate exact owner authorization and preservation review; no permission is implied here | PROHIBITED BY CURRENT DECISION |
| Connect the application, enable traffic, or use a runtime role | Separate source/access approval after security and cross-RT validation | NOT AUTHORIZED |
| Change Vercel/GitHub settings or deploy | Separate approval naming exact project/setting/deployment | NOT AUTHORIZED |

## 8. Action record and stop

- Neon tools or API: NOT USED.
- SQL, connection, compute wake, database inspection, or data access: NOT PERFORMED.
- Resource creation, alteration, reset, cleanup, migration, or deletion: NOT PERFORMED.
- Source, Drizzle, migration, guard, workflow, and provider settings: NOT CHANGED.
- Wave 12.6B project creation and Wave 13 migrations: NOT AUTHORIZED.
- Existing staging: preserve unchanged.
- stagingIsolationVerifiedEmpty: remains false.

**Agent B disposition:** DOCUMENTATION PREPARED — initial-state proposal, Wave 13 gates, checksum manifest, and fail-stop recovery path are ready for Coordinator and independent owner review. No live baseline verification is claimed.
