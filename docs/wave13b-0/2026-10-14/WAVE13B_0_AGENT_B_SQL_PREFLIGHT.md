# KartuRT V1 Wave 13B.0 — Agent B SQL Preflight Design

**Date:** 2026-10-14 (Asia/Bangkok)
**Lane status:** **DESIGN COMPLETE; SQL NOT EXECUTED; NEON NOT CONNECTED.**
**Documentation checkout:** `b30597abef9375435ea8524b093690375e4824e1`
**Source SHA to bind in any future approval:** `48b92abbe93fbd499448b6c885d3042cb49c2128`

## Scope and evidence boundary

This report designs one fixed, server-enforced read-only preflight for a later, separately authorized D1. It does not request or imply permission to connect, wake compute, execute SQL, inspect live rows, change a Neon resource, set the source isolation flag, or run migrations. No database connector, SQL, connection string, credential, or Neon resource inspection was used in this lane.

The source SHA above is the accepted Wave 13A.2 source baseline. Static review at that exact commit confirms that `src/lib/staging-database-target.ts` maps the approved new target below and explicitly keeps `stagingIsolationVerifiedEmpty=false`. That source mapping is an identity guard, not live provider or contents evidence. It remains unchanged by this documentation-only lane.

| Resource | Exact expected identity for a future D1 |
|---|---|
| Organization | `satset` / `org-ancient-boat-57106549` |
| Project | `karturt-v1-staging-clean` / `falling-bread-33359184` |
| Branch | `staging` / `br-muddy-frost-azot13fb` |
| Region / major version | `aws-ap-southeast-1` / PostgreSQL 18 |
| Database | `karturt_staging` / ID `702718` |
| Role | `karturt_staging_owner` |
| Endpoint / host | `ep-silent-butterfly-azrflu40` / `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech` |

The prior Wave 12.2 transaction evidence belongs to a different project, branch, database, and endpoint. There, one transaction returned `transaction_read_only=on`, passed an identity guard, and found no matching objects in its bounded catalog filters. Its `init_source=parent-data` lineage remained unresolved and its database was still **NOT VERIFIED**. That observation is evidence that the prior tool call behaved as a transaction once; it does not establish the new target's identity, contents, lineage, connector selection, or migration readiness. The old project `wild-art-99835126` is not a fallback target.

## Transaction contract and fail-closed method

The current `run_sql_transaction` tool descriptor says it executes an ordered SQL statement array “as one transaction.” Its inputs can explicitly name `project_id`, `branch_id`, `compute_id`, `database_name`, and `role_name`; `compute_id` is described as the compute/endpoint ID. It also says the tool resolves credentials internally and does not return them. The descriptor has no separate read-only option and does not specify session-affinity or exactly what happens to later array items after an earlier SQL error. `run_sql` accepts one statement and cannot replace this transaction.

If a later D1 explicitly authorizes one preflight, first obtain a fresh metadata-only readback of the exact allowlisted resource mapping without waking compute. Then use only `run_sql_transaction` with every argument explicit: project `falling-bread-33359184`, branch `br-muddy-frost-azot13fb`, compute `ep-silent-butterfly-azrflu40`, database `karturt_staging`, and role `karturt_staging_owner`. Do not rely on defaults, a hostname inferred from a URL, the old staging project, or a provider credential lookup.

The submitted statement array must begin with `SET TRANSACTION READ ONLY`. The wrapper contract already says it opens one transaction, so do not prepend a nested `BEGIN`; if the implementation does not have an active transaction for this statement, it must fail before any catalog inspection. Immediately next, run a server-side guard that requires `current_setting('transaction_read_only') = 'on'`, `current_database() = 'karturt_staging'`, `current_user = 'karturt_staging_owner'`, and `server_version_num` in PostgreSQL 18. The guard must raise a SQL error on any false condition, causing the transaction to abort before inventory statements. Use an erroring expression whose false branch is evaluated at execution (not a planner-foldable constant error). Follow the guard with `SHOW transaction_read_only` for auditable `on` output, then the fixed identity projection.

PostgreSQL documents that `SET TRANSACTION` changes the current transaction's access mode, that read-only mode disallows ordinary database DDL/DML, and that it is a high-level restriction that does not prevent every disk write. Accordingly, the method also prohibits non-catalog reads, user-defined function calls, dynamic SQL, extension execution, `EXPLAIN ANALYZE`, `COPY`, and statements other than the listed fixed `SELECT`s. [PostgreSQL 18 `SET TRANSACTION`](https://www.postgresql.org/docs/18/sql-set-transaction.html), [PostgreSQL 18 `SHOW`](https://www.postgresql.org/docs/18/sql-show.html), [PostgreSQL 18 `current_setting`](https://www.postgresql.org/docs/18/functions-admin.html).

The future operator must stop before any catalog statement if the connector cannot establish all of these properties: one ordered array, one server transaction/session, a successful read-only setting in that transaction, and abort-on-error before later items. A split-query implementation or missing session affinity has no safe multi-call workaround. Do not fall back to `run_sql`, a direct driver, another role, or a second transaction. The prior Wave 12.2 result is useful history, not a substitute for the current connector contract. The exact endpoint ID must be passed as `compute_id`; if the connector cannot honor or verify that mapping, classify the attempt as **UNKNOWN** and stop. The descriptor also does not promise that starting a query leaves an idle endpoint asleep. A later owner decision must explicitly cover the possible compute start; if it does not, stop before calling the tool.

## Fixed catalog-only inventory plan

The exact inert SQL statement sequence for owner review is in the [fixed read-only preflight SQL reference](WAVE13B_0_READ_ONLY_PREFLIGHT_SQL_REFERENCE.md). That file is documentation only and must not be executed from this wave.

After the immediate mode/identity guard, use a pre-reviewed, immutable list of `SELECT` statements against `pg_catalog` and the current database only. No statement reads application table rows. All object lists return identifiers and safe metadata only; do not return SQL definitions, foreign-server options, ACL secrets, credential values, or exception text that may contain a connection detail.

| Order after guard | Fixed inspection | Expected signal |
|---|---|---|
| 1 | Identity: `current_database()`, `current_user`, `server_version`, `server_version_num`, and `current_setting('transaction_read_only')`. | Exact database and role; major version 18; read-only `on`. Endpoint/project/branch identity comes from exact call arguments plus fresh provider metadata, because SQL cannot report those control-plane IDs. |
| 2 | Current role attributes from `pg_roles` and role memberships from `pg_auth_members`; effective database/schema/object privileges using built-in `has_database_privilege`, `has_schema_privilege`, `has_table_privilege`, `has_sequence_privilege`, and `has_function_privilege`. Include database `CONNECT/CREATE/TEMP`, schema `USAGE/CREATE`, and object privilege flags. | Complete, sanitized privilege profile. Never infer that the role is inherently read-only from the transaction setting. Superuser, `BYPASSRLS`, replication/file/program privileges, or broad data-role membership are a security hold for D2 review. Normal ownership/DDL capabilities, if present, are recorded for D2; read-only transaction mode does not erase them. |
| 3 | Non-system schemas from `pg_namespace`; extensions from `pg_extension`; relation inventory from `pg_class` covering tables, partitioned tables, views, materialized views, sequences, foreign tables, indexes, and other non-system relation kinds. | Only the expected `public` application namespace; the exact extension allowlist is `plpgsql` in `pg_catalog`. Any additional extension must be documented and owner-approved before D1. The current migration set contains no `CREATE EXTENSION`; no non-system relations are expected. |
| 4 | User-defined types/domains/enums from `pg_type`; routines by identity/name/kind from `pg_proc` (no body/source); non-internal triggers from `pg_trigger`; constraints/indexes from their catalogs; RLS policies from `pg_policy`; event triggers; foreign data wrappers/servers/mappings by names only, without options. | No unexpected non-system database objects. Inventory completeness is required; permission denial or omitted result groups means **UNKNOWN**, not zero. |
| 5 | Exact catalog presence of `public.__drizzle_migrations`, plus ledger-name matches in the all-schema relation inventory. Do not select ledger rows in this pre-migration screen. | Ledger table absent. Any ledger object is an unapproved prior migration state, even if it might contain zero rows; stop. |
| 6 | Count metadata rows in `pg_largeobject_metadata`; do not select large-object contents. | Zero large objects. Query failure means **UNKNOWN**. |

All schema filters must exclude only PostgreSQL's system namespaces (`pg_catalog`, `information_schema`, `pg_toast`, and `pg_temp_*`/`pg_toast_temp_*` namespaces), while retaining every other schema so unexpected schemas cannot disappear from the report. Do not query another database or any external schema. The catalog plan uses only PostgreSQL built-ins and catalogs; it invokes no application or user-defined function.

The linked fixed statement reference also inventories namespace-scoped operators, collations, conversions, operator classes/families, text-search objects, rewrite rules, default ACL entries, procedural languages, publications, and subscription metadata. It deliberately omits foreign-server and subscription connection options. Any custom or unapproved result is surfaced for owner review; incomplete catalog visibility is `UNKNOWN`.

The Drizzle ledger check intentionally tests the exact catalog object, not its row contents. The clean preflight expectation is no ledger table. If it exists, the preflight stops without reading it; a later, separately approved post-migration verification may read only the migration ledger metadata. Likewise, any application relation means the pre-migration database is not catalog-clean; do not issue a follow-up `COUNT(*)` against it. This preserves the no-row-content boundary and avoids conditionally constructing SQL.

## Expected result manifest and classification

The result record for a future single transaction must include the explicit target arguments, fresh metadata readback references, ordered result-group count, `preflight_guard=1`, `SHOW transaction_read_only=on`, exact database/role, exact server version and major, sanitized role/effective privilege inventory, all discovered schemas/extensions/object identifiers, ledger presence, large-object count, and an explicit note that no application rows or definitions were selected. Do not persist credentials, raw provider secrets, or unredacted connector errors.

| Classification | Rule | Consequence |
|---|---|---|
| `CLEAN_CATALOG_PREFLIGHT` | Fresh metadata and explicit connector arguments map to the exact target; server guard and `SHOW` confirm read-only; database, role, and PostgreSQL 18 identity match; result groups are complete; the approved schema/extension allowlist matches; no non-system application objects, ledger, or large objects are found; role privileges are fully reported for D2 review. | This is a bounded catalog observation only. It does **not** prove physical storage emptiness, a clean ancestry, absence of previously removed data, or migration readiness. Keep `stagingIsolationVerifiedEmpty=false`. |
| `UNCLEAN` | The transaction is safely read-only and on the exact target, but the inventory finds any unapproved schema, extension, relation/type/routine/trigger/policy/foreign object, Drizzle ledger, or large object; or a required security review rejects the role profile. | Stop. Preserve the target unchanged. Do not query object contents, retry, clear, reset, recreate, or migrate. Send the finding to owner review. |
| `UNKNOWN` | Target mapping or role cannot be established; guard/`SHOW` is not `on`; server is not PostgreSQL 18; the connector transaction/session/abort behavior is uncertain; result groups are missing; a permission error, timeout, or other failure prevents complete classification. | Stop before more SQL. No retry, alternate tool, alternate target, or database rebuild. Request a separately scoped method decision if needed. |

Even `CLEAN_CATALOG_PREFLIGHT` is not positive proof of physical or historical emptiness. A catalog describes objects visible at inspection time, not pages or prior content removed before the snapshot. Separate positive lineage/content evidence must bind the branch to the approved independently created target and show there was no unreviewed parent-data path or import; provider labels, zero writes, estimated size, absent catalog objects, or a missing ledger alone are insufficient. Any still-unresolved lineage keeps isolation unverified.

## Source binding and 15-blob migration manifest

Any later migration authorization and any post-migration comparison must bind to source SHA `48b92abbe93fbd499448b6c885d3042cb49c2128`, not merely the documentation commit. At that SHA, `src/db/migration-manifest.ts` pins 14 SQL files (`drizzle/0000_…sql` through `drizzle/0013_…sql`) plus `drizzle/meta/_journal.json`. Wave 13A.2 reports 15/15 raw-blob SHA-256 matches at that source SHA and says none of those blobs changed in the accepted remediation. See [Wave 13A.2 Agent A evidence correction](../../wave13a-2/2026-10-14/WAVE13A_2_AGENT_A_EVIDENCE_CORRECTION.md) and [Wave 13A.2 owner next gate](../../wave13a-2/2026-10-14/WAVE13A_2_OWNER_NEXT_GATE.md).

For reproducible revalidation, at the exact approved source commit read each path as raw Git blob bytes (`git cat-file blob <source-sha>:<path>`), SHA-256 those bytes in memory, and compare the result to that commit's `APPROVED_MIGRATION_BLOB_SHA256` entry. This avoids Windows checkout line-ending conversion. The 15 paths are 14 SQL migration blobs plus the journal. This lane independently repeated that check against source SHA `48b92abbe93fbd499448b6c885d3042cb49c2128`: **15/15 raw-blob hashes matched**. Using the source implementation's sorted `[path, sha256]` entries serialized as JSON and SHA-256'd, the manifest fingerprint is `e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4`. Do not substitute Git's object ID (SHA-1), a working-tree file hash, or the Drizzle ledger hash without verifying the runner's exact hashing convention.

## Separately authorized post-migration verification

After a future D3 owner-approved migration, request a distinct read-only verification authorization. It must use the same exact target mapping and server-enforced transaction pattern; it must not be bundled into D3 as implicit query permission. Compare the Drizzle ledger in migration order to all 14 source migrations `0000`–`0013` and the pinned journal, checking every expected entry/hash with the pinned Drizzle runner's actual hash convention. Compare object names and definitions against the source migrations/schema as well as totals.

Wave 13A.2 records source-specific historical counts of **27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums**, with 14 ledger entries after the ordered migration chain. Treat these as expected checks for the named source SHA and its exact catalog counting rules, not PostgreSQL or Drizzle guarantees. Reconcile counting definitions (especially internal triggers, indexes, constraints, generated row types, and schema scope) before comparison. A count match alone is insufficient: compare the object identities, key definitions, enum labels, and migration ledger to the pinned source; never execute a user-defined routine as part of verification.

Any ledger/order/hash mismatch, extra object, missing object, changed definition, interrupted migration, timeout, or incomplete result is a hard stop. Preserve both current Neon projects and the failed state; do not retry, edit the ledger, roll back, clear data, rebuild, or recreate automatically. Recovery or rollback requires its own owner-approved method and scope.

## Lane conclusion

The fixed preflight design is ready for coordinator integration. This lane establishes no live provider, SQL, contents, lineage, grant, role, or migration fact. It authorizes no future query by itself. The only valid next action within this wave is owner review of the separate D1 decision; D1 approval must be explicit and bounded before anyone executes the designed preflight.
