\set ON_ERROR_STOP on
\if :{?owner_signed_query_approval_verified}
\else
\echo 'STOP: owner-signed target-specific read-only query approval has not been verified.'
\quit 3
\endif
\if :owner_signed_query_approval_verified
\else
\echo 'STOP: owner-signed query approval is not confirmed.'
\quit 3
\endif
\if :{?target_project_id}
\else
\echo 'STOP: exact project ID is missing.'
\quit 3
\endif
\if :{?target_branch_id}
\else
\echo 'STOP: exact branch ID is missing.'
\quit 3
\endif
\if :{?target_endpoint_id}
\else
\echo 'STOP: exact endpoint ID is missing.'
\quit 3
\endif
\if :{?approved_source_sha}
\else
\echo 'STOP: final source SHA is missing.'
\quit 3
\endif
\if :{?query_packet_sha256}
\else
\echo 'STOP: fixed packet hash is missing.'
\quit 3
\endif
\if :{?expected_database}
\else
\echo 'STOP: expected database name is missing.'
\quit 3
\endif
\if :{?expected_owner_role}
\else
\echo 'STOP: expected owner role is missing.'
\quit 3
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '15s';

SELECT 1 / CASE WHEN
  :'target_project_id' = 'broad-star-40451875'
  AND :'target_branch_id' = 'br-orange-recipe-azed9f78'
  AND :'target_endpoint_id' = 'ep-mute-firefly-azjcru4h'
  AND :'query_packet_sha256' ~ '^[a-f0-9]{64}$'
  AND :'approved_source_sha' ~ '^[a-f0-9]{40}$'
  AND current_database() = :'expected_database'
  AND current_user = :'expected_owner_role'
  AND current_setting('server_version_num')::integer / 10000 = 18
  AND current_setting('transaction_read_only') = 'on'
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_ssl AS ssl
    WHERE ssl.pid = pg_catalog.pg_backend_pid()
      AND ssl.ssl
  )
THEN 1 ELSE 0 END AS exact_target_and_connection_assertion;

SELECT
  current_database() AS observed_database_name,
  :'expected_database' AS expected_database_name,
  current_database() = :'expected_database' AS database_name_matches,
  current_user AS observed_role,
  :'expected_owner_role' AS expected_role,
  current_user = :'expected_owner_role' AS role_matches,
  current_setting('server_version') AS server_version,
  current_setting('server_version_num')::integer / 10000 AS server_major,
  current_setting('server_version_num')::integer / 10000 = 18 AS postgres_18,
  current_setting('transaction_read_only') AS transaction_read_only,
  current_setting('transaction_read_only') = 'on' AS read_only_is_active;

SELECT
  d.oid AS database_oid,
  d.datname AS database_name,
  pg_catalog.pg_get_userbyid(d.datdba) AS database_owner,
  d.datacl::text AS database_acl,
  d.datallowconn AS connections_allowed,
  d.datistemplate AS is_template
FROM pg_catalog.pg_database AS d
WHERE d.datname = current_database();

SELECT
  s.ssl AS tls_active,
  s.version AS tls_version,
  s.cipher AS tls_cipher,
  s.bits AS tls_bits
FROM pg_catalog.pg_stat_ssl AS s
WHERE s.pid = pg_catalog.pg_backend_pid();

SELECT
  r.rolname,
  r.rolcanlogin,
  r.rolsuper,
  r.rolinherit,
  r.rolcreaterole,
  r.rolcreatedb,
  r.rolreplication,
  r.rolbypassrls,
  r.rolconnlimit
FROM pg_catalog.pg_roles AS r
WHERE r.rolname = current_user;

SELECT 1 / CASE WHEN count(*) <= 100 THEN 1 ELSE 0 END AS membership_output_within_limit
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS member_role
  ON member_role.oid = membership.member
WHERE member_role.rolname = current_user;

SELECT
  parent_role.rolname AS membership_role,
  membership.admin_option
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS parent_role
  ON parent_role.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member_role
  ON member_role.oid = membership.member
WHERE member_role.rolname = current_user
ORDER BY parent_role.rolname
LIMIT 100;

SELECT
  count(*) AS non_system_schema_count,
  count(*) FILTER (WHERE n.nspname <> 'public') AS non_public_schema_count
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema';

SELECT 1 / CASE WHEN count(*) <= 200 THEN 1 ELSE 0 END AS schema_output_within_limit
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema';

SELECT
  n.nspname AS schema_name,
  pg_catalog.pg_get_userbyid(n.nspowner) AS schema_owner,
  n.nspacl::text AS explicit_acl
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
ORDER BY n.nspname
LIMIT 200;

SELECT
  count(*) AS non_system_relation_count,
  count(*) FILTER (WHERE c.relname = '__drizzle_migrations') AS drizzle_journal_relation_count,
  count(*) FILTER (WHERE pg_catalog.pg_get_userbyid(c.relowner) = current_user) AS current_role_owned_relation_count
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = c.relnamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r', 'p', 'f', 'v', 'm', 'S');

SELECT 1 / CASE WHEN count(*) <= 200 THEN 1 ELSE 0 END AS relation_output_within_limit
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = c.relnamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r', 'p', 'f', 'v', 'm', 'S');

SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned table'
    WHEN 'f' THEN 'foreign table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized view'
    WHEN 'S' THEN 'sequence'
    ELSE c.relkind::text
  END AS relation_kind,
  pg_catalog.pg_get_userbyid(c.relowner) AS relation_owner,
  c.relname = '__drizzle_migrations' AS is_drizzle_journal_candidate,
  c.relacl::text AS explicit_acl
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = c.relnamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')
ORDER BY n.nspname, c.relname
LIMIT 200;

SELECT
  count(*) AS non_system_type_object_count
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = t.typnamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema';

SELECT 1 / CASE WHEN count(*) <= 200 THEN 1 ELSE 0 END AS type_output_within_limit
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = t.typnamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema';

SELECT
  n.nspname AS schema_name,
  t.typname AS type_name,
  CASE t.typtype
    WHEN 'b' THEN 'base'
    WHEN 'c' THEN 'composite'
    WHEN 'd' THEN 'domain'
    WHEN 'e' THEN 'enum'
    WHEN 'm' THEN 'multirange'
    WHEN 'p' THEN 'pseudo'
    WHEN 'r' THEN 'range'
    ELSE t.typtype::text
  END AS type_kind,
  t.typcategory AS postgres_type_category,
  t.typcategory = 'A' AS is_array_type,
  CASE WHEN t.typelem <> 0 THEN pg_catalog.format_type(t.typelem, NULL) END AS array_element_type,
  CASE
    WHEN extension_dependency.extension_names IS NOT NULL THEN 'extension-owned'
    WHEN t.typcategory = 'A' AND t.typelem <> 0 THEN 'array-companion'
    WHEN t.typtype = 'c' AND row_relation.relkind = 'c' THEN 'standalone-composite'
    WHEN t.typtype = 'c' AND row_relation.relkind IN ('r', 'p', 'f', 'v', 'm') THEN 'implicit-relation-row'
    ELSE 'user-defined'
  END AS type_origin,
  row_relation.relkind AS associated_relation_kind,
  row_relation.relname AS associated_relation_name,
  extension_dependency.extension_names AS owning_extensions,
  pg_catalog.pg_get_userbyid(t.typowner) AS type_owner,
  t.typacl::text AS explicit_acl
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_class AS row_relation
  ON row_relation.oid = t.typrelid
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT e.extname, ', ' ORDER BY e.extname) AS extension_names
  FROM pg_catalog.pg_depend AS dependency
  JOIN pg_catalog.pg_extension AS e
    ON e.oid = dependency.refobjid
  WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
    AND dependency.objid = t.oid
    AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
    AND dependency.deptype = 'e'
) AS extension_dependency ON true
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
ORDER BY n.nspname, t.typname
LIMIT 200;

SELECT count(*) AS standalone_application_type_count
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_class AS row_relation
  ON row_relation.oid = t.typrelid
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
  AND NOT (t.typcategory = 'A' AND t.typelem <> 0)
  AND NOT (
    t.typtype = 'c'
    AND t.typrelid <> 0
    AND row_relation.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_depend AS dependency
    JOIN pg_catalog.pg_extension AS e
      ON e.oid = dependency.refobjid
    WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
      AND dependency.objid = t.oid
      AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
      AND dependency.deptype = 'e'
  );

SELECT 1 / CASE WHEN count(*) = 0 THEN 1 ELSE 0 END AS no_standalone_application_types_for_empty_baseline
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_class AS row_relation
  ON row_relation.oid = t.typrelid
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
  AND NOT (t.typcategory = 'A' AND t.typelem <> 0)
  AND NOT (
    t.typtype = 'c'
    AND t.typrelid <> 0
    AND row_relation.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_depend AS dependency
    JOIN pg_catalog.pg_extension AS e
      ON e.oid = dependency.refobjid
    WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
      AND dependency.objid = t.oid
      AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
      AND dependency.deptype = 'e'
  );

SELECT
  count(*) AS non_system_routine_count
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = p.pronamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema';

SELECT 1 / CASE WHEN count(*) <= 200 THEN 1 ELSE 0 END AS routine_output_within_limit
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = p.pronamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema';

SELECT
  n.nspname AS schema_name,
  p.proname AS routine_name,
  p.prokind AS routine_kind,
  pg_catalog.pg_get_userbyid(p.proowner) AS routine_owner,
  p.proacl::text AS explicit_acl
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = p.pronamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
ORDER BY n.nspname, p.proname
LIMIT 200;

SELECT 1 / CASE WHEN count(*) <= 100 THEN 1 ELSE 0 END AS extension_output_within_limit
FROM pg_catalog.pg_extension;

SELECT
  e.extname AS extension_name,
  e.extversion AS extension_version,
  n.nspname AS extension_schema,
  pg_catalog.pg_get_userbyid(e.extowner) AS extension_owner
FROM pg_catalog.pg_extension AS e
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = e.extnamespace
ORDER BY e.extname
LIMIT 100;

SELECT 1 / CASE WHEN count(*) <= 100 THEN 1 ELSE 0 END AS default_acl_output_within_limit
FROM pg_catalog.pg_default_acl;

SELECT
  pg_catalog.pg_get_userbyid(d.defaclrole) AS grantor_role,
  n.nspname AS schema_name,
  d.defaclobjtype AS object_type,
  d.defaclacl::text AS default_acl
FROM pg_catalog.pg_default_acl AS d
LEFT JOIN pg_catalog.pg_namespace AS n
  ON n.oid = d.defaclnamespace
ORDER BY grantor_role, schema_name, object_type
LIMIT 100;

COMMIT;
\echo 'Catalog metadata read complete in one read-only transaction; no application rows selected.'
