# Wave 13B.0 — Fixed Read-Only Preflight SQL Reference

Status: **DESIGN ONLY. Do not execute from this document.** This file is an inert Markdown review artifact, not a script. A later D1 decision must explicitly approve the exact statement text and tool contract below. Any change requires a new owner review. This reference authorizes no connection, compute wake, SQL, provider change, role change, key operation, migration, runtime use, or deployment.

The design supports [Agent B's SQL preflight report](WAVE13B_0_AGENT_B_SQL_PREFLIGHT.md) and the [Owner Approval Packet](WAVE13B_0_OWNER_APPROVAL_PACKET.md).

## Exact call scope required for a future D1

Before a future call, perform a fresh metadata-only readback that does not wake compute and compare all identifiers. Submit one ordered statement array to `run_sql_transaction` with every argument explicit:

| Argument | Exact value |
|---|---|
| `project_id` | `falling-bread-33359184` |
| `branch_id` | `br-muddy-frost-azot13fb` |
| `compute_id` | `ep-silent-butterfly-azrflu40` |
| `database_name` | `karturt_staging` |
| `role_name` | `karturt_staging_owner` |

The corresponding organization is `org-ancient-boat-57106549`; expected database ID is `702718`; expected endpoint host is `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech`. The SQL session cannot attest to those control-plane IDs. The future operator must bind the explicit tool arguments and fresh metadata to that exact mapping. Do not use defaults, `run_sql`, direct drivers, another role, another branch/database/endpoint, or old staging.

The connector descriptor says an ordered array runs “as one transaction”, but it does not guarantee one server session, session affinity, stop-on-error behavior, or whether the endpoint remains idle. D1 must explicitly allow the possibility that making the call starts/uses compute. Stop before catalog inspection if the connector cannot establish one server transaction/session and abort-on-error semantics. The first SQL statement must be the transaction mode statement below; if it fails, do not continue.

## Ordered fixed statement set

Submit these statements in the listed order, in one call and one server transaction. The wrapper must open the transaction before statement 1. Do not prepend `BEGIN`, use nested transactions, or split the list into calls.

### 1. Set transaction read-only

```sql
SET TRANSACTION READ ONLY;
```

If this statement errors or the connector cannot prove it ran in the transaction used for every later statement, stop. Do not try another tool or connection path.

### 2. Immediate server-side mode and identity guard

```sql
SELECT CASE
  WHEN pg_catalog.current_setting('transaction_read_only') = 'on'
   AND pg_catalog.current_database() = 'karturt_staging'
   AND current_user = 'karturt_staging_owner'
   AND pg_catalog.current_setting('server_version_num')::integer >= 180000
   AND pg_catalog.current_setting('server_version_num')::integer < 190000
  THEN 1
  ELSE 1 / (
    pg_catalog.length(pg_catalog.current_setting('transaction_read_only'))
    - pg_catalog.length(pg_catalog.current_setting('transaction_read_only'))
  )
END AS preflight_guard;
```

Expected result: one row, `preflight_guard=1`. The false branch is a run-time division by zero whose divisor depends on the non-constant transaction setting; it is not a planner-foldable `1/0` literal. Any false identity/mode condition therefore errors. The transaction tool must stop or leave the transaction aborted before the next query. If the error is swallowed, later items use another session, or transaction abort behavior is uncertain, the run is `UNKNOWN` and stops.

### 3. Auditable read-only confirmation

```sql
SHOW transaction_read_only;
```

Expected result: `on`. If not exactly `on`, stop. This is a confirmation after the first mode-setting statement; `SHOW` alone is not a safety control.

### 4. Session identity and server version

```sql
SELECT
  pg_catalog.current_database() AS database_name,
  current_user AS role_name,
  pg_catalog.current_setting('server_version') AS server_version,
  pg_catalog.current_setting('server_version_num')::integer AS server_version_num,
  pg_catalog.current_setting('transaction_read_only') AS transaction_read_only;
```

Expected: exact database and role above, PostgreSQL major 18, and `transaction_read_only=on`. Project, branch, endpoint ID, host, and organization are checked against the exact call arguments and fresh metadata, not inferred from SQL.

### 5. Effective role membership and attributes

```sql
SELECT
  r.rolname,
  r.rolcanlogin,
  r.rolsuper,
  r.rolinherit,
  r.rolcreaterole,
  r.rolcreatedb,
  r.rolreplication,
  r.rolbypassrls,
  pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER') AS effective_member,
  pg_catalog.pg_has_role(current_user, r.oid, 'USAGE') AS effective_privilege_usage,
  pg_catalog.pg_has_role(current_user, r.oid, 'SET') AS can_set_role
FROM pg_catalog.pg_roles AS r
WHERE r.rolname = current_user
   OR pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')
ORDER BY r.rolname;
```

```sql
SELECT
  pg_catalog.current_database() AS database_name,
  pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CONNECT') AS can_connect,
  pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CREATE') AS can_create_schema,
  pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'TEMP') AS can_create_temp;
```

These return role attributes, memberships, and effective database privileges only. Any superuser, `BYPASSRLS`, replication/file/program capability, unexpected membership, or unreviewed administrative privilege is recorded as a D2 security hold. A read-only transaction does not mean the role itself is least-privileged.

### 6. Non-system schemas and effective schema privileges

```sql
SELECT
  n.nspname AS schema_name,
  pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE') AS can_use,
  pg_catalog.has_schema_privilege(current_user, n.oid, 'CREATE') AS can_create
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY n.nspname;
```

Expected schema inventory is only `public`. Every other namespace is retained and must be classified; do not filter arbitrary `pg_*` names.

### 7. Extensions

```sql
SELECT
  e.extname,
  e.extversion,
  n.nspname AS extension_schema
FROM pg_catalog.pg_extension AS e
JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
ORDER BY e.extname;
```

Expected extension allowlist is `plpgsql` in `pg_catalog`. Do not invoke extension functions. Any additional extension is an unapproved object and stops the clean classification.

### 8. Relation inventory and effective relation privileges

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relkind,
  c.relpersistence,
  c.relrowsecurity,
  c.relforcerowsecurity
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY n.nspname, c.relname, c.relkind;
```

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relkind,
  pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
  pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
  pg_catalog.has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
  pg_catalog.has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
  pg_catalog.has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
  pg_catalog.has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_reference,
  pg_catalog.has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_trigger
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY n.nspname, c.relname;
```

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS sequence_name,
  pg_catalog.has_sequence_privilege(current_user, c.oid, 'USAGE') AS can_use,
  pg_catalog.has_sequence_privilege(current_user, c.oid, 'SELECT') AS can_select,
  pg_catalog.has_sequence_privilege(current_user, c.oid, 'UPDATE') AS can_update
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind = 'S'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY n.nspname, c.relname;
```

The expected non-system relation inventory is empty before migration. These catalog queries do not select rows from any application relation.

### 9. Types, routines, triggers, constraints, indexes, and policies

```sql
SELECT n.nspname AS schema_name, t.typname AS type_name, t.typtype, t.typcategory
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY n.nspname, t.typname;
```

```sql
SELECT
  n.nspname AS schema_name,
  p.proname AS routine_name,
  p.prokind,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prosecdef,
  p.proleakproof,
  pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE') AS can_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY n.nspname, p.proname, identity_arguments;
```

```sql
SELECT n.nspname AS schema_name, c.relname AS relation_name, t.tgname, t.tgenabled, t.tgtype
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY n.nspname, c.relname, t.tgname;
```

```sql
SELECT
  con.conname,
  con.contype,
  con.convalidated,
  con.condeferrable,
  con.condeferred,
  COALESCE(cn.nspname, tn.nspname) AS object_schema,
  COALESCE(c.relname, t.typname) AS object_name
FROM pg_catalog.pg_constraint AS con
LEFT JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
LEFT JOIN pg_catalog.pg_namespace AS cn ON cn.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_type AS t ON t.oid = con.contypid
LEFT JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace
WHERE (c.oid IS NOT NULL AND cn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND cn.nspname !~ '^pg_(temp|toast_temp)_')
   OR (t.oid IS NOT NULL AND tn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND tn.nspname !~ '^pg_(temp|toast_temp)_')
ORDER BY object_schema, object_name, con.conname;
```

```sql
SELECT
  ns.nspname AS schema_name,
  idx.relname AS index_name,
  tbl.relname AS table_name,
  i.indisunique,
  i.indisprimary,
  i.indisvalid,
  i.indisready,
  i.indislive
FROM pg_catalog.pg_index AS i
JOIN pg_catalog.pg_class AS idx ON idx.oid = i.indexrelid
JOIN pg_catalog.pg_class AS tbl ON tbl.oid = i.indrelid
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = idx.relnamespace
WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND ns.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY ns.nspname, idx.relname;
```

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  p.polname,
  p.polcmd,
  p.polpermissive,
  p.polroles
FROM pg_catalog.pg_policy AS p
JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY n.nspname, c.relname, p.polname;
```

```sql
SELECT inventory.object_kind, inventory.object_schema, inventory.object_name
FROM (
  SELECT 'operator'::text AS object_kind, n.nspname::text AS object_schema, o.oprname::text AS object_name
  FROM pg_catalog.pg_operator AS o JOIN pg_catalog.pg_namespace AS n ON n.oid = o.oprnamespace
  UNION ALL
  SELECT 'collation', n.nspname::text, c.collname::text
  FROM pg_catalog.pg_collation AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.collnamespace
  UNION ALL
  SELECT 'conversion', n.nspname::text, c.conname::text
  FROM pg_catalog.pg_conversion AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.connamespace
  UNION ALL
  SELECT 'operator_class', n.nspname::text, c.opcname::text
  FROM pg_catalog.pg_opclass AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.opcnamespace
  UNION ALL
  SELECT 'operator_family', n.nspname::text, f.opfname::text
  FROM pg_catalog.pg_opfamily AS f JOIN pg_catalog.pg_namespace AS n ON n.oid = f.opfnamespace
  UNION ALL
  SELECT 'text_search_configuration', n.nspname::text, c.cfgname::text
  FROM pg_catalog.pg_ts_config AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.cfgnamespace
  UNION ALL
  SELECT 'text_search_dictionary', n.nspname::text, d.dictname::text
  FROM pg_catalog.pg_ts_dict AS d JOIN pg_catalog.pg_namespace AS n ON n.oid = d.dictnamespace
  UNION ALL
  SELECT 'text_search_parser', n.nspname::text, p.prsname::text
  FROM pg_catalog.pg_ts_parser AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.prsnamespace
  UNION ALL
  SELECT 'text_search_template', n.nspname::text, t.tmplname::text
  FROM pg_catalog.pg_ts_template AS t JOIN pg_catalog.pg_namespace AS n ON n.oid = t.tmplnamespace
) AS inventory
WHERE inventory.object_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND inventory.object_schema !~ '^pg_(temp|toast_temp)_'
ORDER BY inventory.object_kind, inventory.object_schema, inventory.object_name;
```

```sql
SELECT n.nspname AS schema_name, c.relname AS relation_name, r.rulename AS rule_name
FROM pg_catalog.pg_rewrite AS r
JOIN pg_catalog.pg_class AS c ON c.oid = r.ev_class
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(temp|toast_temp)_'
ORDER BY n.nspname, c.relname, r.rulename;
```

```sql
SELECT
  owner_role.rolname AS owner_role,
  COALESCE(n.nspname, '(global)') AS schema_name,
  d.defaclobjtype AS object_type,
  CASE WHEN acl.grantor = 0 THEN 'PUBLIC' ELSE grantor_role.rolname END AS grantor,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_default_acl AS d
JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = d.defaclrole
LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantor_role ON grantor_role.oid = acl.grantor
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
ORDER BY owner_role.rolname, schema_name, object_type, grantee, acl.privilege_type;
```

No routine source, view definition, index expression, check expression, policy expression, trigger function body, or application data is selected. `pg_get_function_identity_arguments` is a PostgreSQL catalog-formatting function; the query does not call any user routine.

### 10. Event triggers and foreign-object inventory

```sql
SELECT evtname, evtevent, evtenabled
FROM pg_catalog.pg_event_trigger
ORDER BY evtname;
```

```sql
SELECT lanname AS language_name, lanpltrusted AS trusted_language
FROM pg_catalog.pg_language
ORDER BY lanname;
```

```sql
SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete, pubtruncate
FROM pg_catalog.pg_publication
ORDER BY pubname;
```

```sql
SELECT s.subname, r.rolname AS owner_role, s.subenabled, s.subslotname, s.subsynccommit
FROM pg_catalog.pg_subscription AS s
JOIN pg_catalog.pg_roles AS r ON r.oid = s.subowner
ORDER BY s.subname;
```

```sql
SELECT fdwname
FROM pg_catalog.pg_foreign_data_wrapper
ORDER BY fdwname;
```

```sql
SELECT f.fdwname, s.srvname, s.srvtype, s.srvversion
FROM pg_catalog.pg_foreign_server AS s
JOIN pg_catalog.pg_foreign_data_wrapper AS f ON f.oid = s.srvfdw
ORDER BY f.fdwname, s.srvname;
```

```sql
SELECT
  s.srvname,
  CASE WHEN m.umuser = 0 THEN 'PUBLIC' ELSE r.rolname END AS mapped_role
FROM pg_catalog.pg_user_mapping AS m
JOIN pg_catalog.pg_foreign_server AS s ON s.oid = m.umserver
LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = m.umuser
ORDER BY s.srvname, mapped_role;
```

Do not select foreign-server or user-mapping option fields; they can contain credentials or connection details. Any foreign object is unapproved and stops the clean classification.

### 11. Exact Drizzle ledger object and large-object metadata

```sql
SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = '__drizzle_migrations';
```

Expected: zero rows. The pre-migration preflight does not read ledger rows. Any object with this exact name is an unapproved prior migration state, even if it is empty.

```sql
SELECT pg_catalog.count(*)::bigint AS large_object_metadata_count
FROM pg_catalog.pg_largeobject_metadata;
```

Expected: zero. This reads metadata count only, never large-object contents. A permission error or incomplete result is `UNKNOWN`, not zero.

## Classification and output boundary

Expected pre-migration result is only `public` schema, only the allowlisted `plpgsql` extension in `pg_catalog`, no non-system relation/type/routine/trigger/constraint/index/policy/event-trigger/foreign objects, no `public.__drizzle_migrations`, zero large-object metadata, PostgreSQL 18, exact session database/role, and `transaction_read_only=on`. The effective privilege inventory is returned even if the catalog is clean and is reviewed separately at D2.

Classify as `CLEAN_CATALOG_PREFLIGHT` only if the exact target mapping is freshly confirmed, both guard and `SHOW` pass, every expected result group is present, the exact allowlist matches, and role privileges are completely reported. Classify `UNCLEAN` for any unapproved object, ledger, large object, or rejected privilege profile. Classify `UNKNOWN` for identity mismatch, transaction/session uncertainty, missing groups, permissions errors, timeout, or any unclassifiable output. All three outcomes stop the current action; only a clean catalog classification may return to owner review.

Even a clean result proves only the reported catalog state at the time of that one transaction. It cannot establish physical storage emptiness, absence of removed prior contents, complete branch lineage, or future isolation. It must not change `stagingIsolationVerifiedEmpty=false` by itself. No row content, large-object content, secret, raw connection string, or unredacted connector error may be placed in the result record.
