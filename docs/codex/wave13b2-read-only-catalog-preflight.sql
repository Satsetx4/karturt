\set ON_ERROR_STOP on
\if :{?owner_signed_query_approval_verified}
\else
\echo F2_FAIL OWNER_APPROVAL_VERIFICATION_REQUIRED
\echo F2_STOP QUERY_NOT_STARTED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP OWNER_APPROVAL_VERIFICATION_REQUIRED'; END $f2_stop$;
\endif
\if :owner_signed_query_approval_verified
\else
\echo F2_FAIL OWNER_APPROVAL_NOT_CONFIRMED
\echo F2_STOP QUERY_NOT_STARTED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP OWNER_APPROVAL_NOT_CONFIRMED'; END $f2_stop$;
\endif
\if :{?target_project_id}
\else
\echo F2_FAIL TARGET_PROJECT_ID_MISSING
\echo F2_STOP QUERY_NOT_STARTED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP TARGET_PROJECT_ID_MISSING'; END $f2_stop$;
\endif
\if :{?target_branch_id}
\else
\echo F2_FAIL TARGET_BRANCH_ID_MISSING
\echo F2_STOP QUERY_NOT_STARTED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP TARGET_BRANCH_ID_MISSING'; END $f2_stop$;
\endif
\if :{?target_endpoint_id}
\else
\echo F2_FAIL TARGET_ENDPOINT_ID_MISSING
\echo F2_STOP QUERY_NOT_STARTED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP TARGET_ENDPOINT_ID_MISSING'; END $f2_stop$;
\endif
\if :{?approved_source_sha}
\else
\echo F2_FAIL APPROVED_SOURCE_SHA_MISSING
\echo F2_STOP QUERY_NOT_STARTED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP APPROVED_SOURCE_SHA_MISSING'; END $f2_stop$;
\endif
\if :{?query_packet_sha256}
\else
\echo F2_FAIL QUERY_PACKET_SHA256_MISSING
\echo F2_STOP QUERY_NOT_STARTED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP QUERY_PACKET_SHA256_MISSING'; END $f2_stop$;
\endif
\if :{?expected_database}
\else
\echo F2_FAIL EXPECTED_DATABASE_MISSING
\echo F2_STOP QUERY_NOT_STARTED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP EXPECTED_DATABASE_MISSING'; END $f2_stop$;
\endif
\if :{?expected_owner_role}
\else
\echo F2_FAIL EXPECTED_OWNER_ROLE_MISSING
\echo F2_STOP QUERY_NOT_STARTED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP EXPECTED_OWNER_ROLE_MISSING'; END $f2_stop$;
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '15s';

WITH f2_connection_checks AS (
  SELECT
    :'target_project_id' = 'broad-star-40451875' AS target_project_id_matches,
    :'target_branch_id' = 'br-orange-recipe-azed9f78' AS target_branch_id_matches,
    :'target_endpoint_id' = 'ep-mute-firefly-azjcru4h' AS target_endpoint_id_matches,
    :'query_packet_sha256' ~ '^[a-f0-9]{64}$' AS query_packet_sha256_format_valid,
    :'approved_source_sha' ~ '^[a-f0-9]{40}$' AS approved_source_sha_format_valid,
    current_database() = :'expected_database' AS database_name_matches,
    current_user = :'expected_owner_role' AS owner_role_matches,
    current_setting('server_version_num')::integer / 10000 = 18 AS postgres_major_is_18,
    current_setting('transaction_read_only') = 'on' AS transaction_is_read_only,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_ssl AS ssl
      WHERE ssl.pid = pg_catalog.pg_backend_pid()
        AND ssl.ssl
    ) AS tls_is_active
)
SELECT
  target_project_id_matches AS f2_target_project_id_matches,
  target_branch_id_matches AS f2_target_branch_id_matches,
  target_endpoint_id_matches AS f2_target_endpoint_id_matches,
  query_packet_sha256_format_valid AS f2_query_packet_sha256_format_valid,
  approved_source_sha_format_valid AS f2_approved_source_sha_format_valid,
  database_name_matches AS f2_database_name_matches,
  owner_role_matches AS f2_owner_role_matches,
  postgres_major_is_18 AS f2_postgres_major_is_18,
  transaction_is_read_only AS f2_transaction_is_read_only,
  tls_is_active AS f2_tls_is_active
FROM f2_connection_checks
\gset
\set f2_connection_gate_failed false
\if :f2_target_project_id_matches
\echo 'F2_CHECK TARGET_PROJECT_ID PASS'
\else
\echo 'F2_FAIL TARGET_PROJECT_ID_MISMATCH'
\set f2_connection_gate_failed true
\endif
\if :f2_target_branch_id_matches
\echo 'F2_CHECK TARGET_BRANCH_ID PASS'
\else
\echo 'F2_FAIL TARGET_BRANCH_ID_MISMATCH'
\set f2_connection_gate_failed true
\endif
\if :f2_target_endpoint_id_matches
\echo 'F2_CHECK TARGET_ENDPOINT_ID PASS'
\else
\echo 'F2_FAIL TARGET_ENDPOINT_ID_MISMATCH'
\set f2_connection_gate_failed true
\endif
\if :f2_query_packet_sha256_format_valid
\echo 'F2_CHECK QUERY_PACKET_SHA256_FORMAT PASS'
\else
\echo 'F2_FAIL QUERY_PACKET_SHA256_FORMAT_INVALID'
\set f2_connection_gate_failed true
\endif
\if :f2_approved_source_sha_format_valid
\echo 'F2_CHECK APPROVED_SOURCE_SHA_FORMAT PASS'
\else
\echo 'F2_FAIL APPROVED_SOURCE_SHA_FORMAT_INVALID'
\set f2_connection_gate_failed true
\endif
\if :f2_database_name_matches
\echo 'F2_CHECK DATABASE_NAME PASS'
\else
\echo 'F2_FAIL DATABASE_NAME_MISMATCH'
\set f2_connection_gate_failed true
\endif
\if :f2_owner_role_matches
\echo 'F2_CHECK OWNER_ROLE PASS'
\else
\echo 'F2_FAIL OWNER_ROLE_MISMATCH'
\set f2_connection_gate_failed true
\endif
\if :f2_postgres_major_is_18
\echo 'F2_CHECK POSTGRES_MAJOR PASS'
\else
\echo 'F2_FAIL POSTGRES_MAJOR_NOT_18'
\set f2_connection_gate_failed true
\endif
\if :f2_transaction_is_read_only
\echo 'F2_CHECK TRANSACTION_READ_ONLY PASS'
\else
\echo 'F2_FAIL TRANSACTION_NOT_READ_ONLY'
\set f2_connection_gate_failed true
\endif
\if :f2_tls_is_active
\echo 'F2_CHECK TLS_ACTIVE PASS'
\else
\echo 'F2_FAIL TLS_NOT_ACTIVE'
\set f2_connection_gate_failed true
\endif
\if :f2_connection_gate_failed
\echo 'F2_STOP CONNECTION_GUARD_FAILED CATALOG_QUERIES_SKIPPED'
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP CONNECTION_GUARD_FAILED'; END $f2_stop$;
\endif

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

\echo F2_CATALOG_READ MEMBERSHIP_LIMIT_COUNT
SELECT
  count(*) AS f2_membership_count,
  count(*) <= 100 AS f2_membership_output_allowed
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS member_role
  ON member_role.oid = membership.member
WHERE member_role.rolname = current_user
\gset
\echo F2_CHECK ROLE_MEMBERSHIP_OUTPUT_LIMIT count=:f2_membership_count limit=100
\if :f2_membership_output_allowed
\else
\echo F2_FAIL ROLE_MEMBERSHIP_OUTPUT_LIMIT_EXCEEDED
\echo F2_STOP CATALOG_QUERIES_SKIPPED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP ROLE_MEMBERSHIP_OUTPUT_LIMIT_EXCEEDED'; END $f2_stop$;
\endif

\echo F2_CATALOG_READ ROLE_MEMBERSHIP_INVENTORY
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

\echo F2_CATALOG_READ SCHEMA_DIAGNOSTIC_COUNT
SELECT
  count(*) AS non_system_schema_count,
  count(*) FILTER (WHERE n.nspname <> 'public') AS non_public_schema_count
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema';

\echo F2_CATALOG_READ SCHEMA_LIMIT_COUNT
SELECT
  count(*) AS f2_schema_count,
  count(*) <= 200 AS f2_schema_output_allowed
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
\gset
\echo F2_CHECK SCHEMA_OUTPUT_LIMIT count=:f2_schema_count limit=200
\if :f2_schema_output_allowed
\else
\echo F2_FAIL SCHEMA_OUTPUT_LIMIT_EXCEEDED
\echo F2_STOP CATALOG_QUERIES_SKIPPED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP SCHEMA_OUTPUT_LIMIT_EXCEEDED'; END $f2_stop$;
\endif

\echo F2_CATALOG_READ SCHEMA_INVENTORY
SELECT
  n.nspname AS schema_name,
  pg_catalog.pg_get_userbyid(n.nspowner) AS schema_owner,
  n.nspacl::text AS explicit_acl
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
ORDER BY n.nspname
LIMIT 200;

\echo F2_CATALOG_READ RELATION_DIAGNOSTIC_COUNT
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

\echo F2_CATALOG_READ RELATION_LIMIT_COUNT
SELECT
  count(*) AS f2_relation_count,
  count(*) <= 200 AS f2_relation_output_allowed
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = c.relnamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')
\gset
\echo F2_CHECK RELATION_OUTPUT_LIMIT count=:f2_relation_count limit=200
\if :f2_relation_output_allowed
\else
\echo F2_FAIL RELATION_OUTPUT_LIMIT_EXCEEDED
\echo F2_STOP CATALOG_QUERIES_SKIPPED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP RELATION_OUTPUT_LIMIT_EXCEEDED'; END $f2_stop$;
\endif

\echo F2_CATALOG_READ RELATION_INVENTORY
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

\echo F2_CATALOG_READ TYPE_DIAGNOSTIC_COUNT
SELECT
  count(*) AS non_system_type_object_count
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = t.typnamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema';

\echo F2_CATALOG_READ TYPE_LIMIT_COUNT
SELECT
  count(*) AS f2_type_count,
  count(*) <= 200 AS f2_type_output_allowed
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = t.typnamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
\gset
\echo F2_CHECK TYPE_OUTPUT_LIMIT count=:f2_type_count limit=200
\if :f2_type_output_allowed
\else
\echo F2_FAIL TYPE_OUTPUT_LIMIT_EXCEEDED
\echo F2_STOP CATALOG_QUERIES_SKIPPED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP TYPE_OUTPUT_LIMIT_EXCEEDED'; END $f2_stop$;
\endif

\echo F2_CATALOG_READ STANDALONE_APPLICATION_TYPE_COUNT
SELECT
  count(*) AS f2_standalone_application_type_count,
  count(*) = 0 AS f2_empty_baseline_types_allowed
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
  )
\gset
\echo F2_CHECK EMPTY_BASELINE_STANDALONE_TYPES count=:f2_standalone_application_type_count expected=0
\if :f2_empty_baseline_types_allowed
\else
\echo F2_FAIL UNEXPECTED_STANDALONE_APPLICATION_TYPES
\echo F2_STOP CATALOG_QUERIES_SKIPPED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP UNEXPECTED_STANDALONE_APPLICATION_TYPES'; END $f2_stop$;
\endif

\echo F2_CATALOG_READ STANDALONE_APPLICATION_TYPE_INVENTORY
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

\echo F2_CATALOG_READ ROUTINE_DIAGNOSTIC_COUNT
SELECT
  count(*) AS non_system_routine_count
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = p.pronamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema';

\echo F2_CATALOG_READ ROUTINE_LIMIT_COUNT
SELECT
  count(*) AS f2_routine_count,
  count(*) <= 200 AS f2_routine_output_allowed
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n
  ON n.oid = p.pronamespace
WHERE n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'
\gset
\echo F2_CHECK ROUTINE_OUTPUT_LIMIT count=:f2_routine_count limit=200
\if :f2_routine_output_allowed
\else
\echo F2_FAIL ROUTINE_OUTPUT_LIMIT_EXCEEDED
\echo F2_STOP CATALOG_QUERIES_SKIPPED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP ROUTINE_OUTPUT_LIMIT_EXCEEDED'; END $f2_stop$;
\endif

\echo F2_CATALOG_READ ROUTINE_INVENTORY
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

\echo F2_CATALOG_READ EXTENSION_LIMIT_COUNT
SELECT
  count(*) AS f2_extension_count,
  count(*) <= 100 AS f2_extension_output_allowed
FROM pg_catalog.pg_extension
\gset
\echo F2_CHECK EXTENSION_OUTPUT_LIMIT count=:f2_extension_count limit=100
\if :f2_extension_output_allowed
\else
\echo F2_FAIL EXTENSION_OUTPUT_LIMIT_EXCEEDED
\echo F2_STOP CATALOG_QUERIES_SKIPPED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP EXTENSION_OUTPUT_LIMIT_EXCEEDED'; END $f2_stop$;
\endif

\echo F2_CATALOG_READ EXTENSION_INVENTORY
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

\echo F2_CATALOG_READ DEFAULT_ACL_LIMIT_COUNT
SELECT
  count(*) AS f2_default_acl_count,
  count(*) <= 100 AS f2_default_acl_output_allowed
FROM pg_catalog.pg_default_acl
\gset
\echo F2_CHECK DEFAULT_ACL_OUTPUT_LIMIT count=:f2_default_acl_count limit=100
\if :f2_default_acl_output_allowed
\else
\echo F2_FAIL DEFAULT_ACL_OUTPUT_LIMIT_EXCEEDED
\echo F2_STOP CATALOG_QUERIES_SKIPPED
DO $f2_stop$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'F2_STOP DEFAULT_ACL_OUTPUT_LIMIT_EXCEEDED'; END $f2_stop$;
\endif

\echo F2_CATALOG_READ DEFAULT_ACL_INVENTORY
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
\echo F2_DONE PASS source=:approved_source_sha query=:query_packet_sha256
