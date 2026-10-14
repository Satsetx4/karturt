# Wave 12.4 Agent B — Neon Read-Only Inspection Result

Status: EXECUTED ONCE — after explicit coordinator GO, exactly one `mcp__neon__run_sql_transaction` call ran with the reviewed 26-statement array. No retry or fallback was made.

## Assigned checkout evidence

- Worktree: `D:/!AGY/karturt-wave12-4-agent-b-20261014`
- Application HEAD: `3bc69c83265dce3a6a0863cbfceea188f40f6168`
- Application tree: `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9` (matches assigned baseline)
- The worktree was detached and clean when inspected; no source files were changed.
- `src/lib/staging-database-target.ts` still has `stagingIsolationVerifiedEmpty = false`. Leave it false.
- `drizzle.config.ts` uses the default Drizzle migration metadata schema/table; `src/db/migrate.ts` points at `./drizzle`. The catalog check below checks only `drizzle.__drizzle_migrations` existence and kind; it never reads journal rows.

## Executed single tool call

Selected tool: `mcp__neon__run_sql_transaction`.

Exact arguments used:

```json
{
  "project_id": "wild-art-99835126",
  "branch_id": "br-hidden-cake-a1ge5xqp",
  "database_name": "karturt_staging",
  "compute_id": "ep-snowy-meadow-a10304d9",
  "role_name": "karturt_staging_owner",
  "sql_statements": [
    "SET TRANSACTION READ ONLY;",
    "SHOW transaction_read_only;",
    "SELECT CASE WHEN pg_catalog.current_setting('transaction_read_only') = 'on' AND pg_catalog.current_database() = 'karturt_staging' AND current_user = 'karturt_staging_owner' THEN 1 ELSE pg_catalog.current_setting('transaction_read_only')::integer END AS wave124_guard;",
    "SELECT pg_catalog.current_database() AS database_name, current_user AS role_name, pg_catalog.current_setting('transaction_read_only') AS transaction_read_only;",
    "SELECT n.nspname AS schema_name FROM pg_catalog.pg_namespace AS n WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY n.nspname;",
    "SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind, c.relpersistence, c.relispartition, c.relrowsecurity, c.relforcerowsecurity FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY n.nspname, c.relname;",
    "SELECT ns.nspname AS constraint_schema, c.relname AS relation_name, tn.nspname AS domain_schema, t.typname AS domain_name, rns.nspname AS referenced_schema, rc.relname AS referenced_relation, con.conname AS constraint_name, con.contype, con.convalidated, con.condeferrable, con.condeferred FROM pg_catalog.pg_constraint AS con JOIN pg_catalog.pg_namespace AS ns ON ns.oid = con.connamespace LEFT JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid LEFT JOIN pg_catalog.pg_type AS t ON t.oid = con.contypid LEFT JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace LEFT JOIN pg_catalog.pg_class AS rc ON rc.oid = con.confrelid LEFT JOIN pg_catalog.pg_namespace AS rns ON rns.oid = rc.relnamespace WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND ns.nspname !~ '^pg_temp_[0-9]+$' AND ns.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY ns.nspname, c.relname, t.typname, con.conname;",
    "SELECT ni.nspname AS index_schema, ci.relname AS index_name, nt.nspname AS table_schema, ct.relname AS table_name, i.indisunique, i.indisprimary, i.indisvalid, i.indisready, i.indislive, i.indnkeyatts, i.indnatts FROM pg_catalog.pg_index AS i JOIN pg_catalog.pg_class AS ci ON ci.oid = i.indexrelid JOIN pg_catalog.pg_namespace AS ni ON ni.oid = ci.relnamespace JOIN pg_catalog.pg_class AS ct ON ct.oid = i.indrelid JOIN pg_catalog.pg_namespace AS nt ON nt.oid = ct.relnamespace WHERE ni.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND ni.nspname !~ '^pg_temp_[0-9]+$' AND ni.nspname !~ '^pg_toast_temp_[0-9]+$' AND nt.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND nt.nspname !~ '^pg_temp_[0-9]+$' AND nt.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY ni.nspname, ci.relname;",
    "SELECT n.nspname AS schema_name, c.relname AS sequence_name, s.seqtypid, s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle FROM pg_catalog.pg_sequence AS s JOIN pg_catalog.pg_class AS c ON c.oid = s.seqrelid JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY n.nspname, c.relname;",
    "SELECT n.nspname AS type_schema, t.typname AS type_name, t.typtype, t.typcategory, t.typisdefined, t.typnotnull, (t.typrelid <> 0) AS is_relation_row_type, (t.typelem <> 0) AS has_element_type, bn.nspname AS domain_base_schema, bt.typname AS domain_base_type FROM pg_catalog.pg_type AS t JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace LEFT JOIN pg_catalog.pg_type AS bt ON bt.oid = t.typbasetype AND t.typbasetype <> 0 LEFT JOIN pg_catalog.pg_namespace AS bn ON bn.oid = bt.typnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY n.nspname, t.typname;",
    "SELECT n.nspname AS type_schema, t.typname AS enum_type, e.enumlabel AS enum_label, e.enumsortorder FROM pg_catalog.pg_enum AS e JOIN pg_catalog.pg_type AS t ON t.oid = e.enumtypid JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY n.nspname, t.typname, e.enumsortorder;",
    "SELECT rn.nspname AS range_schema, rt.typname AS range_type, sn.nspname AS subtype_schema, st.typname AS subtype_name, mn.nspname AS multirange_schema, mt.typname AS multirange_type, rg.rngcollation, rg.rngsubopc, rg.rngcanonical, rg.rngsubdiff FROM pg_catalog.pg_range AS rg JOIN pg_catalog.pg_type AS rt ON rt.oid = rg.rngtypid JOIN pg_catalog.pg_namespace AS rn ON rn.oid = rt.typnamespace LEFT JOIN pg_catalog.pg_type AS st ON st.oid = rg.rngsubtype LEFT JOIN pg_catalog.pg_namespace AS sn ON sn.oid = st.typnamespace LEFT JOIN pg_catalog.pg_type AS mt ON mt.oid = rg.rngmultitypid AND rg.rngmultitypid <> 0 LEFT JOIN pg_catalog.pg_namespace AS mn ON mn.oid = mt.typnamespace WHERE rn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND rn.nspname !~ '^pg_temp_[0-9]+$' AND rn.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY rn.nspname, rt.typname;",
    "SELECT n.nspname AS routine_schema, p.proname AS routine_name, p.oid::pg_catalog.regprocedure AS routine_signature, p.prokind, p.pronargs, rtn.nspname AS return_type_schema, rt.typname AS return_type, owner.rolname AS owner_role, l.lanname AS routine_language, p.prosecdef, p.provolatile FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang JOIN pg_catalog.pg_type AS rt ON rt.oid = p.prorettype JOIN pg_catalog.pg_namespace AS rtn ON rtn.oid = rt.typnamespace JOIN pg_catalog.pg_roles AS owner ON owner.oid = p.proowner WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY n.nspname, p.proname, p.prokind, p.pronargs;",
    "SELECT e.extname AS extension_name, n.nspname AS extension_schema, e.extversion, e.extrelocatable FROM pg_catalog.pg_extension AS e JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace ORDER BY n.nspname, e.extname;",
    "SELECT n.nspname AS relation_schema, c.relname AS relation_name, t.tgname AS trigger_name, t.tgenabled, t.tgisinternal, pn.nspname AS trigger_routine_schema, p.proname AS trigger_routine_name FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace AS pn ON pn.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY n.nspname, c.relname, t.tgname;",
    "SELECT e.evtname AS event_trigger_name, e.evtevent, e.evtenabled, (e.evtfoid <> 0) AS has_handler FROM pg_catalog.pg_event_trigger AS e ORDER BY e.evtname;",
    "SELECT n.nspname AS relation_schema, c.relname AS relation_name, p.polname AS policy_name, p.polcmd, p.polpermissive, p.polroles, (p.polqual IS NOT NULL) AS has_using_expression, (p.polwithcheck IS NOT NULL) AS has_check_expression FROM pg_catalog.pg_policy AS p JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY n.nspname, c.relname, p.polname;",
    "SELECT f.fdwname AS foreign_data_wrapper, (f.fdwhandler <> 0) AS has_handler, (f.fdwvalidator <> 0) AS has_validator FROM pg_catalog.pg_foreign_data_wrapper AS f ORDER BY f.fdwname;",
    "SELECT s.srvname AS foreign_server, f.fdwname AS foreign_data_wrapper, s.srvtype, s.srvversion FROM pg_catalog.pg_foreign_server AS s JOIN pg_catalog.pg_foreign_data_wrapper AS f ON f.oid = s.srvfdw ORDER BY s.srvname;",
    "SELECT n.nspname AS table_schema, c.relname AS foreign_table, s.srvname AS foreign_server FROM pg_catalog.pg_foreign_table AS ft JOIN pg_catalog.pg_class AS c ON c.oid = ft.ftrelid JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace JOIN pg_catalog.pg_foreign_server AS s ON s.oid = ft.ftserver WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY n.nspname, c.relname;",
    "SELECT s.srvname AS foreign_server, (m.umuser = 0) AS is_public_mapping FROM pg_catalog.pg_user_mapping AS m JOIN pg_catalog.pg_foreign_server AS s ON s.oid = m.umserver ORDER BY s.srvname, is_public_mapping;",
    "SELECT p.pubname AS publication_name, p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate, p.pubviaroot, p.pubgencols FROM pg_catalog.pg_publication AS p ORDER BY p.pubname;",
    "SELECT p.pubname AS publication_name, n.nspname AS table_schema, c.relname AS table_name FROM pg_catalog.pg_publication_rel AS pr JOIN pg_catalog.pg_publication AS p ON p.oid = pr.prpubid JOIN pg_catalog.pg_class AS c ON c.oid = pr.prrelid JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY p.pubname, n.nspname, c.relname;",
    "SELECT p.pubname AS publication_name, n.nspname AS schema_name FROM pg_catalog.pg_publication_namespace AS pn JOIN pg_catalog.pg_publication AS p ON p.oid = pn.pnpubid JOIN pg_catalog.pg_namespace AS n ON n.oid = pn.pnnspid WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_temp_[0-9]+$' AND n.nspname !~ '^pg_toast_temp_[0-9]+$' ORDER BY p.pubname, n.nspname;",
    "SELECT s.subdbid, s.subname AS subscription_name, s.subenabled FROM pg_catalog.pg_subscription AS s WHERE s.subdbid = (SELECT d.oid FROM pg_catalog.pg_database AS d WHERE d.datname = pg_catalog.current_database()) ORDER BY s.subname;",
    "SELECT n.nspname AS schema_name, c.relname AS migration_journal_relation, c.relkind FROM pg_catalog.pg_namespace AS n JOIN pg_catalog.pg_class AS c ON c.relnamespace = n.oid WHERE n.nspname = 'drizzle' AND c.relname = '__drizzle_migrations';"
  ]
}
```

This is the exact `sql_statements` array used in the one authorized call, in order. The array was not split, changed, or retried. The live mcp__neon__run_sql_transaction declaration in this session exposes project_id, branch_id, database_name, compute_id, role_name, and sql_statements: Array<string>, and describes one transaction. Current upstream source at the readback commit maps the input array in order into one neon(...).transaction(...) call (https://github.com/neondatabase/mcp-server-neon/blob/c79875ec44eb0817eb98e86cd44cac3fa45315ae/mcp/tools/tools.ts#L99-L136). The current Neon serverless client preserves array order in one queries batch and throws on a failed HTTP/database response (https://github.com/neondatabase/serverless/blob/0a891faf84df29b363778aadc00ce0ea71d244eb/src/http/index.ts#L215-L247 and #L379-L390). This verifies client call shape, order, one transaction API call, and error propagation at the HTTP-client boundary. The deployed connector build SHA was not surfaced. Statement-error handling relies on the single transaction API plus PostgreSQL transaction-abort semantics; the client path has no statement retry/savepoint/continue loop. Any returned error is terminal and the one-time call must not be retried.

## Fresh metadata-only target reread

Read at 2026-10-14 04:20 UTC using Neon metadata APIs only; no SQL call, secret, connection string, or database row was requested.

- Organization: ID org-ancient-boat-57106549, name satset, plan Free — exact allowlist match.
- Project: ID wild-art-99835126, name karturt-v1-staging, organization ID matches, region aws-ap-southeast-1, PostgreSQL 18 — exact allowlist match.
- Branch: ID br-hidden-cake-a1ge5xqp, name staging, project ID matches, primary=true, default=true, state ready, init_source=parent-data — exact identity/status match. init_source does not establish inherited business data or emptiness.
- Endpoint inventory: exactly one endpoint returned. ID ep-snowy-meadow-a10304d9, hostname ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech, project/branch/region match, type read_write, passwordless_access=true — exact allowlist match.
- Database: name karturt_staging, ID 42079960, branch ID matches, owner karturt_staging_owner — exact allowlist match.
- Role: karturt_staging_owner exists on the exact branch; metadata says authentication_method=password — exact role-name match.
- Branch metadata includes logical_size=31686656 and written_data_bytes=0. Neither is evidence of logical or physical emptiness. No catalog content was inspected here.

Metadata-only identity result: PASS for every allowlisted ID/name/region/version/endpoint/role value. This confirms where a later one-time read-only transaction would be aimed; it does not clear lineage, emptiness, or migration readiness.

## Static safety review

- Statement 1 is the first SQL statement and makes the transaction read-only. Statement 2 records `transaction_read_only`. Statement 3 is a server-side `SELECT CASE` assertion: only the exact `on` / database / role match returns `1`; any mismatch evaluates the `ELSE` cast of the setting (`on` or `off`) to integer, which errors and aborts the PostgreSQL transaction. The cast depends on `current_setting`, so it is not a planner-folded constant. No application tables are read. PostgreSQL 18 documents conditional evaluation for `CASE`; its transaction guide notes that an error leaves a transaction block aborted until it is rolled back. [CASE](https://www.postgresql.org/docs/18/functions-conditional.html), [transactions](https://www.postgresql.org/docs/18/tutorial-transactions.html)
- Every subsequent data-reading statement is a static `SELECT` from explicitly qualified `pg_catalog` objects. There are no `INSERT`, `UPDATE`, `DELETE`, `MERGE`, DDL, `COPY`, `CALL`, transaction-control statements, dynamic SQL, `pg_get_functiondef`, `pg_get_expr`, user routine body/source, table rows, sequence current values, or table row counts.
- Schema filters exclude only pg_catalog, information_schema, pg_toast, and exactly generated numeric pg_temp_N / pg_toast_temp_N namespaces (anchored numeric-suffix checks); all other namespaces, including custom names beginning with pg_, remain in scope.
- Catalog reads return object names and limited structural flags only. Routine rows are metadata from `pg_proc`; they are not called. Trigger routines are named from metadata only. Policy expression text is not read. Foreign server/table/user-mapping options are omitted because options can contain endpoints or credentials. Subscription connection information is omitted because it can contain a plaintext password. The subscription check is limited to this database and selects only database OID, subscription name, and enabled flag. PostgreSQL 18 catalog docs confirm `pg_subscription` is cluster-shared and `subconninfo` can contain plaintext passwords. [pg_subscription](https://www.postgresql.org/docs/18/catalog-pg-subscription.html)
- Static field review against PostgreSQL 18 catalog documentation: selected fields were checked in pg_class (relation-kind, persistence, partition and RLS flags), pg_constraint (namespace, name, type, validation/deferral flags and relation/domain references), pg_index (uniqueness/primary/valid/ready/live and key/attribute counts), pg_sequence (type and parameters, never current values), pg_type (kind/category/defined/not-null/relation/element/domain-base metadata), pg_enum (type, label and sort order), pg_range (range/subtype/multirange linkage, collation/operator class and canonical/difference pg_catalog.regproc identifiers/names only, read as metadata and never invoked), pg_proc (name, kind, arg count, return type, owner, signature, language, security-definer and volatility), pg_language, pg_roles, pg_extension, pg_trigger, pg_event_trigger, pg_policy, pg_foreign_data_wrapper, pg_foreign_server, pg_foreign_table, pg_user_mapping, pg_publication, pg_publication_rel, pg_publication_namespace, pg_subscription, pg_namespace and pg_database. No function body, expression text, foreign options, mapping options, or subscription connection info is selected. PostgreSQL 18 field references: [pg_class](https://www.postgresql.org/docs/18/catalog-pg-class.html), [pg_constraint](https://www.postgresql.org/docs/18/catalog-pg-constraint.html), [pg_index](https://www.postgresql.org/docs/18/catalog-pg-index.html), [pg_sequence](https://www.postgresql.org/docs/18/catalog-pg-sequence.html), [pg_type](https://www.postgresql.org/docs/18/catalog-pg-type.html), [pg_enum](https://www.postgresql.org/docs/18/catalog-pg-enum.html), [pg_range](https://www.postgresql.org/docs/18/catalog-pg-range.html), [pg_proc](https://www.postgresql.org/docs/18/catalog-pg-proc.html), [pg_language](https://www.postgresql.org/docs/18/catalog-pg-language.html), [pg_roles](https://www.postgresql.org/docs/18/view-pg-roles.html), [pg_extension](https://www.postgresql.org/docs/18/catalog-pg-extension.html), [pg_trigger](https://www.postgresql.org/docs/18/catalog-pg-trigger.html), [pg_event_trigger](https://www.postgresql.org/docs/18/catalog-pg-event-trigger.html), [pg_policy](https://www.postgresql.org/docs/18/catalog-pg-policy.html), [pg_foreign_data_wrapper](https://www.postgresql.org/docs/18/catalog-pg-foreign-data-wrapper.html), [pg_foreign_server](https://www.postgresql.org/docs/18/catalog-pg-foreign-server.html), [pg_foreign_table](https://www.postgresql.org/docs/18/catalog-pg-foreign-table.html), [pg_user_mapping](https://www.postgresql.org/docs/18/catalog-pg-user-mapping.html), [pg_publication](https://www.postgresql.org/docs/18/catalog-pg-publication.html), [pg_publication_rel](https://www.postgresql.org/docs/18/catalog-pg-publication-rel.html), [pg_publication_namespace](https://www.postgresql.org/docs/18/catalog-pg-publication-namespace.html), [pg_subscription](https://www.postgresql.org/docs/18/catalog-pg-subscription.html), [pg_namespace](https://www.postgresql.org/docs/18/catalog-pg-namespace.html), and [pg_database](https://www.postgresql.org/docs/18/catalog-pg-database.html).
- The inspection does not select resident rows or infer their absence. Catalog names, relation existence, logical-size metadata, absent journal metadata, and `init_source=parent-data` cannot establish physical database emptiness or source lineage.
- No `LIMIT` is used. If the connector truncates a result, omits a statement result, a catalog query errors or lacks privilege (including subscriptions/user mappings), or the target/assertion evidence is missing, classify `INSPECTION INCOMPLETE` and make no fallback call.

## Result interpretation and stop rules

- Coverage boundary: SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE refers only to the enumerated inventory families in this report: non-system namespaces, relations and their listed flags, constraints, indexes, sequence definitions, types/domains, enum labels, range links, routine metadata, extensions, triggers/event triggers, policies, foreign-data objects, publication settings/table/schema mappings, current-database subscription names/enabled flags, and Drizzle journal presence. It does not certify data contents or physical emptiness, sequence state, ACLs/grants/default privileges/role membership, object dependency graphs, full routine argument/default/body definitions, view or rewrite-rule definitions, index or constraint expressions, partition/inheritance definitions, collations/operators/operator classes/casts, or other unenumerated catalog families.
- **SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE** only if the tool returns success for the entire one-transaction sequence, identity/read-only evidence and assertion pass, every result is complete and untruncated, the empty built-in public namespace is the only expected non-system namespace if present, and no non-system objects or Drizzle journal are listed. The public namespace row alone is expected; any object listed within public is a finding, assessed separately from the namespace row.
- **EXISTING NON-SYSTEM OBJECTS FOUND** if one or more non-system objects are listed, including objects in public; report those separately from the expected empty public namespace row and do not infer lineage.
- **UNEXPECTED APPLICATION STATE** if application-shaped objects, the Drizzle migration journal, or other evidence of prior initialization is present where a pre-migration clean target was expected. This classification is evidence about catalog state, not permission to inspect rows or modify the database.
- **INSPECTION INCOMPLETE** if a statement fails, results are truncated/omitted, subscription or catalog visibility is restricted, the exact identity is absent/mismatched, or read-only mode/assertion cannot be confirmed.
- **NOT VERIFIED** if preflight does not pass and the single transaction is not run, or if output cannot support one of the classifications above.
- Do not claim entire/physical emptiness, a fresh branch, or proven parent contents from this bounded inventory. Keep `stagingIsolationVerifiedEmpty=false` in every outcome. Do not migrate, seed, alter, tear down, change provider resources, retry SQL, or authorize Wave 13 from this report.

## Tool-call count and final status

- Selected tool: `mcp__neon__run_sql_transaction`.
- Neon SQL calls: **1 total**. This was the only SQL call; no retry, fallback, or second call occurred.
- Tool outcome: success, no error. The response contained **26 ordered result groups for 26 statements**. No truncation marker or omitted group was reported.

### Ordered result groups

1. `SET TRANSACTION READ ONLY` completed; no rows returned, as expected.
2. `SHOW transaction_read_only` returned `on`.
3. Server-side CASE assertion returned `wave124_guard=1`.
4. Identity readback returned database `karturt_staging`, role `karturt_staging_owner`, and `transaction_read_only=on`.
5. Namespace inventory returned only `public`.
6. Relation inventory: zero rows.
7. Constraint inventory: zero rows.
8. Index inventory: zero rows.
9. Sequence inventory: zero rows.
10. Type/domain inventory: zero rows.
11. Enum-label inventory: zero rows.
12. Range inventory: zero rows.
13. Routine metadata inventory: zero rows.
14. Extension inventory: one row, `plpgsql` in `pg_catalog`, version `1.0`, non-relocatable.
15. Trigger inventory: zero rows.
16. Event-trigger inventory: zero rows.
17. Policy inventory: zero rows.
18. Foreign-data-wrapper inventory: zero rows.
19. Foreign-server inventory: zero rows.
20. Foreign-table inventory: zero rows.
21. User-mapping inventory: zero rows.
22. Publication inventory: zero rows.
23. Publication-to-table mapping inventory: zero rows.
24. Publication-to-schema mapping inventory: zero rows.
25. Current-database subscription inventory: zero rows.
26. Drizzle journal relation check: zero rows; `drizzle.__drizzle_migrations` was not listed.

### Classification and limits

**SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE.** The expected `public` namespace was present, while each enumerated object inventory within non-system namespaces returned zero rows. The only extension row was the system `plpgsql` extension in `pg_catalog`. This classification is bounded to the catalog families listed in this report.

Resident-row absence, physical emptiness, source/parent contents or lineage, and migration readiness remain **NOT VERIFIED** by this inspection. `init_source=parent-data` is not lineage or emptiness proof. `src/lib/staging-database-target.ts` remains `stagingIsolationVerifiedEmpty = false`.

No further SQL, migration, DDL/DML, source modification, commit, or push was performed by this lane.
