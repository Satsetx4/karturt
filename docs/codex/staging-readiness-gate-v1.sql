\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off
\pset null NULL

-- This is a read-only catalog precheck for the pinned synthetic staging target.
-- The PowerShell runner enforces direct-host identity, verify-full TLS,
-- channel_binding=require, and checks the psql connection TLS protocol and cipher.
-- No DDL, DML, role changes, writes, or migration statements belong here.

\conninfo
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '15s';

SELECT pg_catalog.json_build_object(
  'kind', 'identity',
  'session_id', current_setting('application_name'),
  'backend_pid', pg_catalog.pg_backend_pid()::bigint,
  'database', current_database(),
  'current_user', current_user,
  'session_user', session_user,
  'server_version_num', current_setting('server_version_num')::integer,
  'transaction_read_only', current_setting('transaction_read_only'),
  'application_name', current_setting('application_name')
)::text;

WITH user_relations AS (
  SELECT relation.oid, relation.relname, relation.relowner
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname !~ '^pg_'
    AND namespace.nspname <> 'information_schema'
    AND relation.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')
), standalone_application_types AS (
  SELECT type.oid
  FROM pg_catalog.pg_type AS type
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = type.typnamespace
  LEFT JOIN pg_catalog.pg_class AS row_relation
    ON row_relation.oid = type.typrelid
  WHERE namespace.nspname !~ '^pg_'
    AND namespace.nspname <> 'information_schema'
    AND NOT (type.typcategory = 'A' AND type.typelem <> 0)
    AND NOT (
      type.typtype = 'c'
      AND type.typrelid <> 0
      AND row_relation.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_depend AS dependency
      JOIN pg_catalog.pg_extension AS extension
        ON extension.oid = dependency.refobjid
      WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
        AND dependency.objid = type.oid
        AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
        AND dependency.deptype = 'e'
    )
)
SELECT pg_catalog.json_build_object(
  'kind', 'catalog_counts',
  'session_id', current_setting('application_name'),
  'backend_pid', pg_catalog.pg_backend_pid()::bigint,
  'non_system_schema_count', (
    SELECT count(*)::bigint
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname !~ '^pg_'
      AND namespace.nspname <> 'information_schema'
  ),
  'non_system_schema_names', COALESCE((
    SELECT pg_catalog.json_agg(namespace.nspname ORDER BY namespace.nspname)::jsonb
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname !~ '^pg_'
      AND namespace.nspname <> 'information_schema'
  ), '[]'::jsonb),
  'application_relation_count', (SELECT count(*)::bigint FROM user_relations),
  'application_owned_relation_count', (
    SELECT count(*)::bigint
    FROM user_relations AS relation
    WHERE pg_catalog.pg_get_userbyid(relation.relowner) = current_user
  ),
  'standalone_application_type_count', (
    SELECT count(*)::bigint FROM standalone_application_types
  ),
  'drizzle_journal_count', (
    SELECT count(*)::bigint
    FROM user_relations AS relation
    WHERE relation.relname = '__drizzle_migrations'
  ),
  'non_system_routine_count', (
    SELECT count(*)::bigint
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname !~ '^pg_'
      AND namespace.nspname <> 'information_schema'
  ),
  'extension_count', (SELECT count(*)::bigint FROM pg_catalog.pg_extension),
  'extension_names', COALESCE((
    SELECT pg_catalog.json_agg(extension.extname ORDER BY extension.extname)::jsonb
    FROM pg_catalog.pg_extension AS extension
  ), '[]'::jsonb),
  'role_membership_count', (
    -- This is scoped to the current target database role, not a global role inventory.
    SELECT count(*)::bigint
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    WHERE member_role.rolname = current_user
  ),
  'default_acl_count', (SELECT count(*)::bigint FROM pg_catalog.pg_default_acl),
  'pg_stat_ssl_diagnostic', (
    SELECT pg_catalog.json_build_object(
      'ssl', ssl.ssl,
      'protocol', ssl.version,
      'cipher', ssl.cipher,
      'bits', ssl.bits
    )
    FROM pg_catalog.pg_stat_ssl AS ssl
    WHERE ssl.pid = pg_catalog.pg_backend_pid()
  )
)::text;

COMMIT;
