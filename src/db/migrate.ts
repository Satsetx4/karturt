import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabasePool, isVerifiedNodeTlsSocket } from "@/db/pool";
import { relationalSchema } from "@/db/schema";
import { stagingDatabaseTarget } from "@/db/staging-target";
import { officialMigrationCount, officialMigrationHeadTag, officialMigrationTags } from "@/db/migration-chain";
import {
  assertPreviewConnectionTarget,
  parsePreviewMigrationMode,
  parsePreviewTargetIdentity,
  previewDatabaseTarget,
  type PreviewTargetIdentity,
} from "@/db/preview-target";
import {
  hasNoStagingMigrationGrantOptions,
  hasRequiredMigrationPublicSchemaPrivileges,
  parseStagingMigrationAuthorization,
  parseStagingPreflightAuthorization,
} from "@/db/migration-role-policy";
import { parseStagingMigrationMode } from "@/db/staging-migration-mode";
import { getEnvironment, requireDatabaseEnvironment } from "@/lib/env";

function safeErrorSummary(error: unknown) {
  if (typeof error !== "object" || error === null) return { name: "UnknownError" };
  const value = error as { name?: unknown; code?: unknown };
  return {
    name: typeof value.name === "string" ? value.name : "Error",
    ...(typeof value.code === "string" ? { code: value.code } : {}),
  };
}

type StagingMigrationEvidence = {
  databaseName: string;
  effectiveRole: string;
  sessionRole: string;
  serverVersionNum: number;
  tlsActive: boolean;
  tlsCertificateAndHostnameVerified: true;
  runtimeRoleSafe: true;
  migrationRoleFlagsSafe: true;
  migrationPrivilegesSafe: true;
  runtimeConnectionVerified: true;
  runtimeTlsCertificateAndHostnameVerified: true;
  emptyPreMigrationRelationCatalog: true;
  emptyPreMigrationRoutineCatalog: true;
  databaseTemporaryPrivilegeDenied: true;
};

type RuntimeConnectionEvidence = {
  databaseName: string;
  effectiveRole: string;
  sessionRole: string;
  serverVersionNum: number;
  tlsActive: boolean;
  tlsEvidenceSource?: "postgres_pg_stat_ssl" | "node_tls_socket";
  postgresReportedTlsActive?: boolean;
};

const nonSystemNamespace = `
  schema.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND schema.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
`;

const previewRuntimeTriggerFunctionSignatures = [
  "public.due_active_received_phase11_v1(uuid)",
  "public.due_effective_target_phase11_v1(uuid)",
  "public.phase12_can_reconcile_future_due_v1(public.monthly_dues, public.monthly_dues)",
] as const;

function readCheckedOutReleaseSha() {
  try {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    });
    const hasUnexpectedChanges = status
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => !line.startsWith("?? .vc/"));
    if (hasUnexpectedChanges) return undefined;

    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    }).trim().toLowerCase();
  } catch {
    return undefined;
  }
}

async function assertRuntimeConnection(
  pool: ReturnType<typeof createDatabasePool>,
  expected: { database: string; runtimeRole: string; environmentName: string },
  tlsEvidenceSource: "postgres_pg_stat_ssl" | "node_tls_socket" = "postgres_pg_stat_ssl",
): Promise<RuntimeConnectionEvidence> {
  const client = await pool.connect();
  try {
    const result = await client.query<
      RuntimeConnectionEvidence & {
        role_can_login: boolean;
        role_is_superuser: boolean;
        role_can_create_db: boolean;
        role_can_create_role: boolean;
        role_can_replicate: boolean;
        role_bypasses_rls: boolean;
        role_inherits: boolean;
        role_membership_count: number;
        database_owned_by_runtime: boolean;
        database_create_effective: boolean;
        database_temp_effective: boolean;
        public_usage_effective: boolean;
        public_create_effective: boolean;
        drizzle_owned_by_runtime: boolean;
        drizzle_usage_effective: boolean;
        drizzle_create_effective: boolean;
        custom_schemas_owned_by_runtime: number;
        custom_schemas_with_create: number;
      }>(`
    SELECT
      current_database() AS "databaseName",
      current_user AS "effectiveRole",
      session_user AS "sessionRole",
      current_setting('server_version_num')::int AS "serverVersionNum",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_ssl
        WHERE pid = pg_catalog.pg_backend_pid() AND ssl
      ) AS "tlsActive",
      role.rolcanlogin AS role_can_login,
      role.rolsuper AS role_is_superuser,
      role.rolcreatedb AS role_can_create_db,
      role.rolcreaterole AS role_can_create_role,
      role.rolreplication AS role_can_replicate,
      role.rolbypassrls AS role_bypasses_rls,
      role.rolinherit AS role_inherits,
      (SELECT count(*)::int FROM pg_catalog.pg_auth_members WHERE member = role.oid) AS role_membership_count,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_database AS database
        WHERE database.datname = current_database() AND database.datdba = role.oid
      ) AS database_owned_by_runtime,
      pg_catalog.has_database_privilege(role.oid, current_database(), 'CREATE') AS database_create_effective,
      pg_catalog.has_database_privilege(role.oid, current_database(), 'TEMPORARY') AS database_temp_effective,
      pg_catalog.has_schema_privilege(role.oid, 'public', 'USAGE') AS public_usage_effective,
      pg_catalog.has_schema_privilege(role.oid, 'public', 'CREATE') AS public_create_effective,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace AS schema
        WHERE schema.nspname = 'drizzle' AND schema.nspowner = role.oid
      ) AS drizzle_owned_by_runtime,
      CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
        THEN pg_catalog.has_schema_privilege(role.oid, 'drizzle', 'USAGE') ELSE false END AS drizzle_usage_effective,
      CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
        THEN pg_catalog.has_schema_privilege(role.oid, 'drizzle', 'CREATE') ELSE false END AS drizzle_create_effective,
      (
        SELECT count(*)::int FROM pg_catalog.pg_namespace AS schema
        WHERE ${nonSystemNamespace} AND schema.nspowner = role.oid
      ) AS custom_schemas_owned_by_runtime,
      (
        SELECT count(*)::int FROM pg_catalog.pg_namespace AS schema
        WHERE ${nonSystemNamespace} AND pg_catalog.has_schema_privilege(role.oid, schema.oid, 'CREATE')
      ) AS custom_schemas_with_create
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user
    `);

    const row = result.rows[0];
    const tlsActive = tlsEvidenceSource === "node_tls_socket"
      ? isVerifiedNodeTlsSocket(client.connection.stream)
      : row?.tlsActive === true;
    if (
      !row ||
      row.databaseName !== expected.database ||
      row.effectiveRole !== expected.runtimeRole ||
      row.sessionRole !== expected.runtimeRole ||
      Math.floor(row.serverVersionNum / 10_000) !== 18 ||
      !tlsActive ||
      !row.role_can_login ||
      row.role_is_superuser ||
      row.role_can_create_db ||
      row.role_can_create_role ||
      row.role_can_replicate ||
      row.role_bypasses_rls ||
      row.role_inherits ||
      row.role_membership_count !== 0 ||
      row.database_owned_by_runtime ||
      row.database_create_effective ||
      row.database_temp_effective ||
      !row.public_usage_effective ||
      row.public_create_effective ||
      row.drizzle_owned_by_runtime ||
      row.drizzle_usage_effective ||
      row.drizzle_create_effective ||
      row.custom_schemas_owned_by_runtime !== 0 ||
      row.custom_schemas_with_create !== 0
    ) {
      throw new Error(`${expected.environmentName} runtime connection preflight failed.`);
    }

    return {
      databaseName: row.databaseName,
      effectiveRole: row.effectiveRole,
      sessionRole: row.sessionRole,
      serverVersionNum: row.serverVersionNum,
      tlsActive,
      tlsEvidenceSource,
      ...(tlsEvidenceSource === "node_tls_socket" ? { postgresReportedTlsActive: row.tlsActive } : {}),
    };
  } finally {
    client.release();
  }
}

async function assertPreviewMigrationConnection(
  pool: ReturnType<typeof createDatabasePool>,
  target: PreviewTargetIdentity,
): Promise<RuntimeConnectionEvidence> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      database_name: string;
      effective_role: string;
      session_role: string;
      server_version_num: number;
      tls_active: boolean;
      role_can_login: boolean;
      role_is_superuser: boolean;
      role_can_create_db: boolean;
      role_can_create_role: boolean;
      role_can_replicate: boolean;
      role_bypasses_rls: boolean;
      role_inherits: boolean;
      role_membership_count: number;
      database_owned_by_migration: boolean;
      database_create_effective: boolean;
      database_temp_public: boolean;
      database_temp_effective: boolean;
      public_usage_effective: boolean;
      public_create_effective: boolean;
      drizzle_schema_exists: boolean;
      drizzle_usage_effective: boolean;
      drizzle_create_effective: boolean;
    }>(`
    SELECT
      current_database() AS database_name,
      current_user AS effective_role,
      session_user AS session_role,
      current_setting('server_version_num')::int AS server_version_num,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_ssl
        WHERE pid = pg_catalog.pg_backend_pid() AND ssl
      ) AS tls_active,
      role.rolcanlogin AS role_can_login,
      role.rolsuper AS role_is_superuser,
      role.rolcreatedb AS role_can_create_db,
      role.rolcreaterole AS role_can_create_role,
      role.rolreplication AS role_can_replicate,
      role.rolbypassrls AS role_bypasses_rls,
      role.rolinherit AS role_inherits,
      (SELECT count(*)::int FROM pg_catalog.pg_auth_members WHERE member = role.oid) AS role_membership_count,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_database AS database
        WHERE database.datname = current_database() AND database.datdba = role.oid
      ) AS database_owned_by_migration,
      pg_catalog.has_database_privilege(role.oid, current_database(), 'CREATE') AS database_create_effective,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
        ) AS acl
        WHERE database.datname = current_database()
          AND acl.grantee = 0
          AND acl.privilege_type = 'TEMPORARY'
      ) AS database_temp_public,
      pg_catalog.has_database_privilege(role.oid, current_database(), 'TEMPORARY') AS database_temp_effective,
      pg_catalog.has_schema_privilege(role.oid, 'public', 'USAGE') AS public_usage_effective,
      pg_catalog.has_schema_privilege(role.oid, 'public', 'CREATE') AS public_create_effective,
      EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle') AS drizzle_schema_exists,
      CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
        THEN pg_catalog.has_schema_privilege(role.oid, 'drizzle', 'USAGE') ELSE false END AS drizzle_usage_effective,
      CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
        THEN pg_catalog.has_schema_privilege(role.oid, 'drizzle', 'CREATE') ELSE false END AS drizzle_create_effective
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user
    `);

    const row = result.rows[0];
    const tlsActive = isVerifiedNodeTlsSocket(client.connection.stream);
    if (
      !row ||
      row.database_name !== target.database ||
      row.effective_role !== previewDatabaseTarget.migrationRole ||
      row.session_role !== previewDatabaseTarget.migrationRole ||
      Math.floor(row.server_version_num / 10_000) !== 18 ||
      !tlsActive ||
      !row.role_can_login ||
      row.role_is_superuser ||
      row.role_can_create_db ||
      row.role_can_create_role ||
      row.role_can_replicate ||
      row.role_bypasses_rls ||
      row.role_inherits ||
      row.role_membership_count !== 0 ||
      row.database_owned_by_migration ||
      !row.database_create_effective ||
      row.database_temp_public ||
      row.database_temp_effective ||
      !row.public_usage_effective ||
      !row.public_create_effective ||
      (row.drizzle_schema_exists && (!row.drizzle_usage_effective || !row.drizzle_create_effective))
    ) {
      throw new Error("Preview migration connection failed the isolated PostgreSQL 18 and least-privilege preflight.");
    }
    return {
      databaseName: row.database_name,
      effectiveRole: row.effective_role,
      sessionRole: row.session_role,
      serverVersionNum: row.server_version_num,
      tlsActive,
      tlsEvidenceSource: "node_tls_socket",
      postgresReportedTlsActive: row.tls_active,
    };
  } finally {
    client.release();
  }
}

async function assertPreviewMigrationState(
  pool: ReturnType<typeof createDatabasePool>,
  expectedMigrations: Array<{ hash: string; folderMillis: number }>,
) {
  const state = await pool.query<{
    journal_exists: boolean;
    application_object_count: number;
    application_routine_count: number;
  }>(`
    SELECT
      pg_catalog.to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS journal_exists,
      (
        SELECT count(*)::int
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
        WHERE ${nonSystemNamespace}
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
          AND NOT (schema.nspname = 'drizzle' AND relation.relname = '__drizzle_migrations')
      ) AS application_object_count,
      (
        SELECT count(*)::int
        FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS schema ON schema.oid = routine.pronamespace
        WHERE ${nonSystemNamespace}
      ) AS application_routine_count
  `);
  const stateRow = state.rows[0];
  if (
    !stateRow ||
    (!stateRow.journal_exists && (stateRow.application_object_count !== 0 || stateRow.application_routine_count !== 0))
  ) {
    throw new Error("Preview migration requires an empty synthetic database or a matching official Drizzle migration prefix.");
  }
  if (!stateRow.journal_exists) return;

  const journal = await pool.query<{ hash: string; created_at: string }>(`
    SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC, id ASC
  `);
  const matchesOfficialPrefix = journal.rows.length <= expectedMigrations.length &&
    journal.rows.every((entry, index) => {
      const expected = expectedMigrations[index];
      return entry.hash.toLowerCase() === expected.hash.toLowerCase() && entry.created_at === String(expected.folderMillis);
    });
  if (!matchesOfficialPrefix || (journal.rows.length === 0 && stateRow.application_object_count !== 0)) {
    throw new Error("Preview migration journal is not an official prefix of Drizzle migrations 0000–0013.");
  }
}

async function assertStagingMigrationPreflight(
  pool: ReturnType<typeof createDatabasePool>,
): Promise<StagingMigrationEvidence> {
  const identity = await pool.query<{
    database_name: string;
    current_user: string;
    session_user: string;
    server_version_num: number;
    tls_active: boolean;
    role_can_login: boolean;
    role_is_superuser: boolean;
    role_can_create_db: boolean;
    role_can_create_role: boolean;
    role_can_replicate: boolean;
    role_bypasses_rls: boolean;
    role_inherits: boolean;
    role_membership_count: number;
    database_owned_by_migrator: boolean;
    database_create_direct: boolean;
    database_create_public: boolean;
    database_create_effective: boolean;
    database_temp_direct: boolean;
    database_temp_public: boolean;
    database_temp_effective: boolean;
    public_owned_by_migrator: boolean;
    public_usage_effective: boolean;
    public_create_direct: boolean;
    public_create_public: boolean;
    public_create_effective: boolean;
    staging_role_grant_option_count: number;
    drizzle_schema_exists: boolean;
    drizzle_owned_by_migrator: boolean;
    drizzle_usage_direct: boolean;
    drizzle_usage_public: boolean;
    drizzle_create_direct: boolean;
    drizzle_create_public: boolean;
    drizzle_create_effective: boolean;
    migration_schema_create_count: number;
    custom_schemas_owned_by_migrator: number;
    non_system_routine_count: number;
    other_schema_runtime_execute_default_count: number;
    runtime_role_safe: boolean;
  }>(`
    SELECT
      current_database() AS database_name,
      current_user AS current_user,
      session_user AS session_user,
      current_setting('server_version_num')::int AS server_version_num,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_ssl
        WHERE pid = pg_catalog.pg_backend_pid() AND ssl
      ) AS tls_active,
      role.rolcanlogin AS role_can_login,
      role.rolsuper AS role_is_superuser,
      role.rolcreatedb AS role_can_create_db,
      role.rolcreaterole AS role_can_create_role,
      role.rolreplication AS role_can_replicate,
      role.rolbypassrls AS role_bypasses_rls,
      role.rolinherit AS role_inherits,
      (SELECT count(*)::int FROM pg_catalog.pg_auth_members WHERE member = role.oid) AS role_membership_count,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_database AS database
        WHERE database.datname = current_database() AND database.datdba = role.oid
      ) AS database_owned_by_migrator,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
        ) AS acl
        WHERE database.datname = current_database()
          AND acl.grantee = role.oid
          AND acl.privilege_type = 'CREATE'
      ) AS database_create_direct,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
        ) AS acl
        WHERE database.datname = current_database()
          AND acl.grantee = 0
          AND acl.privilege_type = 'CREATE'
      ) AS database_create_public,
      pg_catalog.has_database_privilege(role.oid, current_database(), 'CREATE') AS database_create_effective,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
        ) AS acl
        WHERE database.datname = current_database()
          AND acl.grantee = role.oid
          AND acl.privilege_type = 'TEMPORARY'
      ) AS database_temp_direct,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
        ) AS acl
        WHERE database.datname = current_database()
          AND acl.grantee = 0
          AND acl.privilege_type = 'TEMPORARY'
      ) AS database_temp_public,
      pg_catalog.has_database_privilege(role.oid, current_database(), 'TEMPORARY') AS database_temp_effective,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace AS schema
        WHERE schema.nspname = 'public' AND schema.nspowner = role.oid
      ) AS public_owned_by_migrator,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS schema
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(schema.nspacl, pg_catalog.acldefault('n', schema.nspowner))
        ) AS acl
        WHERE schema.nspname = 'public'
          AND acl.grantee = role.oid
          AND acl.privilege_type = 'CREATE'
      ) AS public_create_direct,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS schema
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(schema.nspacl, pg_catalog.acldefault('n', schema.nspowner))
        ) AS acl
        WHERE schema.nspname = 'public'
          AND acl.grantee = 0
          AND acl.privilege_type = 'CREATE'
      ) AS public_create_public,
      pg_catalog.has_schema_privilege(role.oid, 'public', 'USAGE') AS public_usage_effective,
      pg_catalog.has_schema_privilege(role.oid, 'public', 'CREATE') AS public_create_effective,
      (
        SELECT count(*)::int
        FROM (
          SELECT acl.is_grantable
          FROM pg_catalog.pg_database AS database
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
          ) AS acl
          WHERE database.datname = current_database()
            AND acl.grantee IN (role.oid, 0)
          UNION ALL
          SELECT acl.is_grantable
          FROM pg_catalog.pg_namespace AS schema
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(schema.nspacl, pg_catalog.acldefault('n', schema.nspowner))
          ) AS acl
          WHERE schema.nspname IN ('public', 'drizzle')
            AND acl.grantee IN (role.oid, 0)
        ) AS migration_acl
        WHERE migration_acl.is_grantable
      ) AS staging_role_grant_option_count,
      EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle') AS drizzle_schema_exists,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace AS schema
        WHERE schema.nspname = 'drizzle' AND schema.nspowner = role.oid
      ) AS drizzle_owned_by_migrator,
      CASE
        WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
          THEN EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS schema
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              COALESCE(schema.nspacl, pg_catalog.acldefault('n', schema.nspowner))
            ) AS acl
            WHERE schema.nspname = 'drizzle'
              AND acl.grantee = role.oid
              AND acl.privilege_type = 'USAGE'
          )
        ELSE false
      END AS drizzle_usage_direct,
      CASE
        WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
          THEN EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS schema
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              COALESCE(schema.nspacl, pg_catalog.acldefault('n', schema.nspowner))
            ) AS acl
            WHERE schema.nspname = 'drizzle'
              AND acl.grantee = 0
              AND acl.privilege_type = 'USAGE'
          )
        ELSE false
      END AS drizzle_usage_public,
      CASE
        WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
          THEN EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS schema
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              COALESCE(schema.nspacl, pg_catalog.acldefault('n', schema.nspowner))
            ) AS acl
            WHERE schema.nspname = 'drizzle'
              AND acl.grantee = role.oid
              AND acl.privilege_type = 'CREATE'
          )
        ELSE false
      END AS drizzle_create_direct,
      CASE
        WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
          THEN EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS schema
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              COALESCE(schema.nspacl, pg_catalog.acldefault('n', schema.nspowner))
            ) AS acl
            WHERE schema.nspname = 'drizzle'
              AND acl.grantee = 0
              AND acl.privilege_type = 'CREATE'
          )
        ELSE false
      END AS drizzle_create_public,
      CASE
        WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
          THEN pg_catalog.has_schema_privilege(role.oid, 'drizzle', 'CREATE')
        ELSE false
      END AS drizzle_create_effective,
      (
        SELECT count(*)::int
        FROM pg_catalog.pg_namespace AS schema
        WHERE ${nonSystemNamespace}
          AND pg_catalog.has_schema_privilege(role.oid, schema.oid, 'CREATE')
      ) AS migration_schema_create_count,
      (
        SELECT count(*)::int
        FROM pg_catalog.pg_namespace AS schema
        WHERE ${nonSystemNamespace} AND schema.nspowner = role.oid
      ) AS custom_schemas_owned_by_migrator,
      (
        SELECT count(*)::int
        FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS schema ON schema.oid = routine.pronamespace
        WHERE ${nonSystemNamespace}
      ) AS non_system_routine_count,
      (
        SELECT count(*)::int
        FROM pg_catalog.pg_default_acl AS defaults
        JOIN pg_catalog.pg_namespace AS schema ON schema.oid = defaults.defaclnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
        WHERE defaults.defaclnamespace <> 0
          AND schema.nspname <> 'public'
          AND defaults.defaclrole = role.oid
          AND defaults.defaclobjtype = 'f'
          AND acl.grantee IN (
            0,
            (SELECT runtime.oid FROM pg_catalog.pg_roles AS runtime WHERE runtime.rolname = $1)
          )
          AND acl.privilege_type = 'EXECUTE'
      ) AS other_schema_runtime_execute_default_count,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS runtime
        WHERE runtime.rolname = $1
          AND runtime.rolcanlogin
          AND NOT runtime.rolsuper
          AND NOT runtime.rolcreatedb
          AND NOT runtime.rolcreaterole
          AND NOT runtime.rolreplication
          AND NOT runtime.rolbypassrls
          AND NOT runtime.rolinherit
          AND (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member = runtime.oid) = 0
          AND pg_catalog.has_database_privilege(runtime.oid, current_database(), 'CONNECT')
          AND NOT pg_catalog.has_database_privilege(runtime.oid, current_database(), 'CREATE')
          AND NOT pg_catalog.has_database_privilege(runtime.oid, current_database(), 'TEMPORARY')
          AND pg_catalog.has_schema_privilege(runtime.oid, 'public', 'USAGE')
          AND NOT pg_catalog.has_schema_privilege(runtime.oid, 'public', 'CREATE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_database AS database
            WHERE database.datname = current_database() AND database.datdba = runtime.oid
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS schema
            WHERE schema.nspname = 'drizzle'
              AND (
                schema.nspowner = runtime.oid
                OR pg_catalog.has_schema_privilege(runtime.oid, schema.oid, 'USAGE')
                OR pg_catalog.has_schema_privilege(runtime.oid, schema.oid, 'CREATE')
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS schema
            WHERE ${nonSystemNamespace}
              AND schema.nspowner = runtime.oid
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS schema
            WHERE ${nonSystemNamespace}
              AND pg_catalog.has_schema_privilege(runtime.oid, schema.oid, 'CREATE')
          )
      ) AS runtime_role_safe
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user
  `, [stagingDatabaseTarget.runtimeRole]);
  const row = identity.rows[0];
  if (
    !row ||
    row.database_name !== stagingDatabaseTarget.database ||
    row.current_user !== stagingDatabaseTarget.migrationRole ||
    row.session_user !== stagingDatabaseTarget.migrationRole ||
    Math.floor(row.server_version_num / 10_000) !== 18 ||
    !row.tls_active ||
    !row.role_can_login ||
    row.role_is_superuser ||
    row.role_can_create_db ||
    row.role_can_create_role ||
    row.role_can_replicate ||
    row.role_bypasses_rls ||
    row.role_inherits ||
    row.role_membership_count !== 0 ||
    row.database_owned_by_migrator ||
    !row.database_create_direct ||
    row.database_create_public ||
    !row.database_create_effective ||
    row.database_temp_direct ||
    row.database_temp_public ||
    row.database_temp_effective ||
    row.public_owned_by_migrator ||
    !row.public_create_direct ||
    row.public_create_public ||
    !hasRequiredMigrationPublicSchemaPrivileges({
      usage: row.public_usage_effective,
      create: row.public_create_effective,
    }) ||
    !hasNoStagingMigrationGrantOptions(row.staging_role_grant_option_count) ||
    !row.drizzle_schema_exists ||
    row.drizzle_owned_by_migrator ||
    !row.drizzle_usage_direct ||
    row.drizzle_usage_public ||
    !row.drizzle_create_direct ||
    row.drizzle_create_public ||
    !row.drizzle_create_effective ||
    row.migration_schema_create_count !== 2 ||
    row.custom_schemas_owned_by_migrator !== 0 ||
    row.non_system_routine_count !== 0 ||
    row.other_schema_runtime_execute_default_count !== 0 ||
    !row.runtime_role_safe
  ) {
    throw new Error("Staging migration preflight failed; no migration was started.");
  }

  const relations = await pool.query<{ relation_count: number }>(`
    SELECT count(*)::int AS relation_count
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
  `);
  if (relations.rows[0]?.relation_count !== 0) {
    throw new Error("Staging migration preflight found existing non-system relations; no migration was started.");
  }

  return {
    databaseName: row.database_name,
    effectiveRole: row.current_user,
    sessionRole: row.session_user,
    serverVersionNum: row.server_version_num,
    tlsActive: row.tls_active,
    tlsCertificateAndHostnameVerified: true,
    runtimeRoleSafe: true,
    migrationRoleFlagsSafe: true,
    migrationPrivilegesSafe: true,
    runtimeConnectionVerified: true,
    runtimeTlsCertificateAndHostnameVerified: true,
    emptyPreMigrationRelationCatalog: true,
    emptyPreMigrationRoutineCatalog: true,
    databaseTemporaryPrivilegeDenied: true,
  };
}

async function assertMigrationResult(
  pool: ReturnType<typeof createDatabasePool>,
  expectedMigrations: Array<{ hash: string; folderMillis: number }>,
  environmentName: string,
) {
  const result = await pool.query<{ hash: string; created_at: string }>(`
    SELECT
      hash,
      created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC, id ASC
  `);

  const matchesFrozenChain = result.rows.length === expectedMigrations.length &&
    result.rows.every((entry, index) => {
      const expected = expectedMigrations[index];
      return entry.hash.toLowerCase() === expected.hash.toLowerCase() && entry.created_at === String(expected.folderMillis);
    });
  if (!matchesFrozenChain) {
    throw new Error(`${environmentName} migration journal does not match the official Drizzle migration chain.`);
  }
}

async function assertRuntimePrivileges(
  pool: ReturnType<typeof createDatabasePool>,
  runtimeRole: string,
  previewRuntime = false,
) {
  const allowedRuntimeFunctions = previewRuntime
    ? previewRuntimeTriggerFunctionSignatures
      .map((signature) => `SELECT pg_catalog.to_regprocedure('${signature}')::oid AS oid`)
      .join(" UNION ALL ")
    : "SELECT NULL::oid AS oid WHERE false";
  const result = await pool.query<{
    table_count: number;
    tables_missing_select: number;
    tables_missing_insert: number;
    tables_missing_update: number;
    tables_missing_delete: number;
    tables_overprivileged: number;
    sequence_count: number;
    sequences_missing_usage: number;
    sequences_overprivileged: number;
    schemas_with_create: number;
    database_temp_effective: boolean;
    unexpected_routines_with_execute: number;
    allowlisted_routines_with_execute: number;
    allowlisted_routines_expected: number;
    drizzle_usage_effective: boolean;
    drizzle_create_effective: boolean;
    drizzle_journal_select_effective: boolean;
  }>(`
    WITH runtime AS (
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
    ),
    allowed_runtime_functions AS (
      ${allowedRuntimeFunctions}
    ),
    app_tables AS (
      SELECT relation.oid, relation.relowner, relation.relacl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
    ),
    app_sequences AS (
      SELECT relation.oid, relation.relowner, relation.relacl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'S'
    )
    SELECT
      (SELECT count(*)::int FROM app_tables) AS table_count,
      (SELECT count(*) FILTER (WHERE NOT pg_catalog.has_table_privilege($1, relation.oid, 'SELECT'))::int FROM app_tables AS relation) AS tables_missing_select,
      (SELECT count(*) FILTER (WHERE NOT pg_catalog.has_table_privilege($1, relation.oid, 'INSERT'))::int FROM app_tables AS relation) AS tables_missing_insert,
      (SELECT count(*) FILTER (WHERE NOT pg_catalog.has_table_privilege($1, relation.oid, 'UPDATE'))::int FROM app_tables AS relation) AS tables_missing_update,
      (SELECT count(*) FILTER (WHERE NOT pg_catalog.has_table_privilege($1, relation.oid, 'DELETE'))::int FROM app_tables AS relation) AS tables_missing_delete,
      (SELECT count(*) FILTER (
        WHERE relation.relowner = (SELECT oid FROM runtime)
          OR pg_catalog.has_table_privilege($1, relation.oid, 'TRUNCATE')
          OR pg_catalog.has_table_privilege($1, relation.oid, 'REFERENCES')
          OR pg_catalog.has_table_privilege($1, relation.oid, 'TRIGGER')
          OR pg_catalog.has_table_privilege($1, relation.oid, 'MAINTAIN')
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) AS acl
            WHERE acl.grantee = 0
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) AS acl
            WHERE acl.grantee = (SELECT oid FROM runtime) AND acl.is_grantable
          )
      )::int FROM app_tables AS relation) AS tables_overprivileged,
      (SELECT count(*)::int FROM app_sequences) AS sequence_count,
      (SELECT count(*) FILTER (WHERE NOT pg_catalog.has_sequence_privilege($1, relation.oid, 'USAGE'))::int FROM app_sequences AS relation) AS sequences_missing_usage,
      (SELECT count(*) FILTER (
        WHERE relation.relowner = (SELECT oid FROM runtime)
          OR pg_catalog.has_sequence_privilege($1, relation.oid, 'SELECT')
          OR pg_catalog.has_sequence_privilege($1, relation.oid, 'UPDATE')
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('s', relation.relowner))) AS acl
            WHERE acl.grantee = 0
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('s', relation.relowner))) AS acl
            WHERE acl.grantee = (SELECT oid FROM runtime) AND acl.is_grantable
          )
      )::int FROM app_sequences AS relation) AS sequences_overprivileged,
      (
        SELECT count(*)::int
        FROM pg_catalog.pg_namespace AS schema
        WHERE ${nonSystemNamespace}
          AND pg_catalog.has_schema_privilege($1, schema.oid, 'CREATE')
      ) AS schemas_with_create,
      pg_catalog.has_database_privilege($1, current_database(), 'TEMPORARY') AS database_temp_effective,
      (
        SELECT count(*) FILTER (
          WHERE pg_catalog.has_function_privilege($1, routine.oid, 'EXECUTE')
            AND NOT EXISTS (
              SELECT 1 FROM allowed_runtime_functions AS allowed WHERE allowed.oid = routine.oid
            )
        )::int
        FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS schema ON schema.oid = routine.pronamespace
        WHERE ${nonSystemNamespace}
      ) AS unexpected_routines_with_execute,
      (
        SELECT count(*) FILTER (
          WHERE allowed.oid IS NOT NULL AND pg_catalog.has_function_privilege($1, allowed.oid, 'EXECUTE')
        )::int
        FROM allowed_runtime_functions AS allowed
      ) AS allowlisted_routines_with_execute,
      (
        SELECT count(*) FILTER (WHERE allowed.oid IS NOT NULL)::int
        FROM allowed_runtime_functions AS allowed
      ) AS allowlisted_routines_expected,
      pg_catalog.has_schema_privilege($1, 'drizzle', 'USAGE') AS drizzle_usage_effective,
      pg_catalog.has_schema_privilege($1, 'drizzle', 'CREATE') AS drizzle_create_effective,
      pg_catalog.has_table_privilege($1, 'drizzle.__drizzle_migrations', 'SELECT') AS drizzle_journal_select_effective
  `, [runtimeRole]);

  const row = result.rows[0];
  if (
    !row ||
    row.table_count === 0 ||
    row.tables_missing_select !== 0 ||
    row.tables_missing_insert !== 0 ||
    row.tables_missing_update !== 0 ||
    row.tables_missing_delete !== 0 ||
    row.tables_overprivileged !== 0 ||
    row.sequences_missing_usage !== 0 ||
    row.sequences_overprivileged !== 0 ||
    row.schemas_with_create !== 0 ||
    row.database_temp_effective ||
    row.unexpected_routines_with_execute !== 0 ||
    row.allowlisted_routines_expected !== (previewRuntime ? previewRuntimeTriggerFunctionSignatures.length : 0) ||
    row.allowlisted_routines_with_execute !== (previewRuntime ? previewRuntimeTriggerFunctionSignatures.length : 0) ||
    row.drizzle_usage_effective ||
    row.drizzle_create_effective ||
    row.drizzle_journal_select_effective
  ) {
    throw new Error("Runtime database grants do not match the least-privilege requirement.");
  }

  return {
    tableCount: row.table_count,
    sequenceCount: row.sequence_count,
    allowlistedFunctionCount: row.allowlisted_routines_with_execute,
  };
}

function quoteRoleIdentifier(roleName: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(roleName)) {
    throw new Error("Database role name is invalid.");
  }
  return `"${roleName}"`;
}

async function grantRuntimePrivileges(pool: ReturnType<typeof createDatabasePool>, runtimeRole: string) {
  const quotedRuntimeRole = quoteRoleIdentifier(runtimeRole);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA public
      TO ${quotedRuntimeRole}
    `);
    await client.query(`
      GRANT USAGE
      ON ALL SEQUENCES IN SCHEMA public
      TO ${quotedRuntimeRole}
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function revokeCustomRoutineDefaultExecution(
  pool: ReturnType<typeof createDatabasePool>,
  migrationRole: string,
  runtimeRole: string,
) {
  const quotedMigrationRole = quoteRoleIdentifier(migrationRole);
  const quotedRuntimeRole = quoteRoleIdentifier(runtimeRole);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrationRole} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrationRole} REVOKE EXECUTE ON FUNCTIONS FROM ${quotedRuntimeRole}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrationRole} IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrationRole} IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM ${quotedRuntimeRole}`);
    const result = await client.query<{ runtime_execute_default_count: number }>(`
      SELECT count(*)::int AS runtime_execute_default_count
      FROM pg_catalog.pg_default_acl AS defaults
      CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
      WHERE defaults.defaclrole = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
        AND defaults.defaclobjtype = 'f'
        AND acl.grantee IN (
          0,
          (SELECT runtime.oid FROM pg_catalog.pg_roles AS runtime WHERE runtime.rolname = $1)
        )
        AND acl.privilege_type = 'EXECUTE'
    `, [runtimeRole]);
    if (result.rows[0]?.runtime_execute_default_count !== 0) {
      throw new Error("Routine defaults still allow runtime or PUBLIC EXECUTE in one or more schemas.");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function revokeRuntimeFunctionExecution(pool: ReturnType<typeof createDatabasePool>, runtimeRole: string) {
  const quotedRuntimeRole = quoteRoleIdentifier(runtimeRole);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC");
    await client.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM ${quotedRuntimeRole}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function grantPreviewRuntimeTriggerFunctionExecution(
  pool: ReturnType<typeof createDatabasePool>,
  runtimeRole: string,
) {
  const quotedRuntimeRole = quoteRoleIdentifier(runtimeRole);
  if (runtimeRole !== previewDatabaseTarget.runtimeRole) {
    throw new Error("The Preview trigger-function allowlist is restricted to the Preview runtime role.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const signature of previewRuntimeTriggerFunctionSignatures) {
      await client.query(`GRANT EXECUTE ON FUNCTION ${signature} TO ${quotedRuntimeRole}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function grantPreviewRuntimeDefaultPrivileges(pool: ReturnType<typeof createDatabasePool>) {
  const quotedMigrationRole = quoteRoleIdentifier(previewDatabaseTarget.migrationRole);
  const quotedRuntimeRole = quoteRoleIdentifier(previewDatabaseTarget.runtimeRole);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrationRole} IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRuntimeRole}
    `);
    await client.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrationRole} IN SCHEMA public
      GRANT USAGE ON SEQUENCES TO ${quotedRuntimeRole}
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function revokePreviewRuntimeDefaultPrivileges(pool: ReturnType<typeof createDatabasePool>) {
  const quotedMigrationRole = quoteRoleIdentifier(previewDatabaseTarget.migrationRole);
  const quotedRuntimeRole = quoteRoleIdentifier(previewDatabaseTarget.runtimeRole);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrationRole} IN SCHEMA public
      REVOKE ALL PRIVILEGES ON TABLES FROM ${quotedRuntimeRole}
    `);
    await client.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrationRole} IN SCHEMA public
      REVOKE ALL PRIVILEGES ON SEQUENCES FROM ${quotedRuntimeRole}
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function revokeRuntimePrivileges(pool: ReturnType<typeof createDatabasePool>, runtimeRole: string) {
  const quotedRuntimeRole = quoteRoleIdentifier(runtimeRole);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${quotedRuntimeRole}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${quotedRuntimeRole}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertRuntimePrivilegesRevoked(pool: ReturnType<typeof createDatabasePool>, runtimeRole: string) {
  const result = await pool.query<{
    tables_with_access: number;
    sequences_with_access: number;
    schemas_with_create: number;
    database_temp_effective: boolean;
    routines_with_execute: number;
    drizzle_usage_effective: boolean;
    drizzle_create_effective: boolean;
    drizzle_journal_select_effective: boolean;
  }>(`
    SELECT
      (
        SELECT count(*)::int
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
          AND (
            pg_catalog.has_table_privilege($1, relation.oid, 'SELECT')
            OR pg_catalog.has_table_privilege($1, relation.oid, 'INSERT')
            OR pg_catalog.has_table_privilege($1, relation.oid, 'UPDATE')
            OR pg_catalog.has_table_privilege($1, relation.oid, 'DELETE')
            OR pg_catalog.has_table_privilege($1, relation.oid, 'TRUNCATE')
            OR pg_catalog.has_table_privilege($1, relation.oid, 'REFERENCES')
            OR pg_catalog.has_table_privilege($1, relation.oid, 'TRIGGER')
            OR pg_catalog.has_table_privilege($1, relation.oid, 'MAINTAIN')
          )
      ) AS tables_with_access,
      (
        SELECT count(*)::int
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind = 'S'
          AND (
            pg_catalog.has_sequence_privilege($1, relation.oid, 'USAGE')
            OR pg_catalog.has_sequence_privilege($1, relation.oid, 'SELECT')
            OR pg_catalog.has_sequence_privilege($1, relation.oid, 'UPDATE')
          )
      ) AS sequences_with_access,
      pg_catalog.has_database_privilege($1, current_database(), 'TEMPORARY') AS database_temp_effective,
      (
        SELECT count(*) FILTER (
          WHERE pg_catalog.has_function_privilege($1, routine.oid, 'EXECUTE')
        )::int
        FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS schema ON schema.oid = routine.pronamespace
        WHERE ${nonSystemNamespace}
      ) AS routines_with_execute,
      (
        SELECT count(*)::int FROM pg_catalog.pg_namespace AS schema
        WHERE ${nonSystemNamespace} AND pg_catalog.has_schema_privilege($1, schema.oid, 'CREATE')
      ) AS schemas_with_create,
      pg_catalog.has_schema_privilege($1, 'drizzle', 'USAGE') AS drizzle_usage_effective,
      pg_catalog.has_schema_privilege($1, 'drizzle', 'CREATE') AS drizzle_create_effective,
      pg_catalog.has_table_privilege($1, 'drizzle.__drizzle_migrations', 'SELECT') AS drizzle_journal_select_effective
  `, [runtimeRole]);

  const row = result.rows[0];
  if (
    !row ||
    row.tables_with_access !== 0 ||
    row.sequences_with_access !== 0 ||
    row.schemas_with_create !== 0 ||
    row.database_temp_effective ||
    row.routines_with_execute !== 0 ||
    row.drizzle_usage_effective ||
    row.drizzle_create_effective ||
    row.drizzle_journal_select_effective
  ) {
    throw new Error("Runtime database access remains after failure cleanup.");
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  const detectedEnvironment = getEnvironment();
  const staging = detectedEnvironment.databaseEnv === "staging";
  const preview = detectedEnvironment.databaseEnv === "preview";
  const stagingMode = staging ? parseStagingMigrationMode(process.argv.slice(2)) : undefined;
  const previewMode = preview ? parsePreviewMigrationMode(process.argv.slice(2)) : undefined;
  const environment = staging ? detectedEnvironment : requireDatabaseEnvironment();
  const previewTarget = preview ? parsePreviewTargetIdentity(process.env) : undefined;
  const migrationUrl = staging || preview
    ? process.env.DATABASE_MIGRATION_URL
    : environment.databaseUrl;
  if (!migrationUrl) {
    if ((staging && stagingMode === "plan") || (preview && previewMode === "plan")) {
      // A plan must remain usable before credentials exist and must not create a pool.
    } else {
      throw new Error(staging
        ? "DATABASE_MIGRATION_URL is required for staging migrations."
        : "DATABASE_MIGRATION_URL is required for Preview migrations.");
    }
  }
  if (staging && stagingMode === "preflight" && !environment.databaseUrl) {
    throw new Error("DATABASE_URL is required for staging runtime TLS and role verification.");
  }
  if (preview) assertPreviewConnectionTarget(environment.databaseUrl!, "runtime", process.env);
  if (preview && previewMode === "apply") {
    assertPreviewConnectionTarget(migrationUrl!, "migration", process.env);
  }

  const migrationsFolder = resolve(process.cwd(), "drizzle");
  const migrationEntries = readMigrationFiles({ migrationsFolder });
  const journal = JSON.parse(readFileSync(resolve(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries?: Array<{ tag?: string }>;
  };
  const journalEntries = journal.entries ?? [];
  const releaseSha = process.env.KARTURT_RELEASE_SHA;
  const checkedOutReleaseSha = staging ? readCheckedOutReleaseSha() : undefined;
  const officialChainMismatch =
    migrationEntries.length !== officialMigrationCount ||
    journalEntries.length !== officialMigrationCount ||
    journalEntries.some((entry, index) => entry.tag !== officialMigrationTags[index]) ||
    journalEntries.at(-1)?.tag !== officialMigrationHeadTag;
  if (staging && (!releaseSha || !/^[0-9a-f]{40}$/i.test(releaseSha) || releaseSha.toLowerCase() !== checkedOutReleaseSha)) {
    throw new Error("Staging migration requires an exact release SHA.");
  }
  if ((staging || preview) && officialChainMismatch) {
    throw new Error("Staging and Preview migrations require the unchanged official Drizzle chain 0000–0013.");
  }
  const expectedHeadHash = migrationEntries.at(-1)?.hash;
  if (!expectedHeadHash) throw new Error("Migration chain is empty.");

  if (staging && stagingMode === "plan") {
    console.info(JSON.stringify({
      event: "database.migrations.plan",
      environment: "staging",
      releaseSha,
      migrationCount: migrationEntries.length,
      migrationHeadTag: journalEntries.at(-1)?.tag,
      target: {
        projectId: stagingDatabaseTarget.projectId,
        branchId: stagingDatabaseTarget.branchId,
        endpointId: stagingDatabaseTarget.endpointId,
        database: stagingDatabaseTarget.database,
      },
      databaseConnectionOpened: false,
      migrationStarted: false,
    }));
    return;
  }
  if (preview && previewMode === "plan") {
    console.info(JSON.stringify({
      event: "database.migrations.plan",
      environment: "preview",
      migrationCount: migrationEntries.length,
      migrationHeadTag: officialMigrationHeadTag,
      target: previewTarget,
      databaseConnectionOpened: false,
      migrationStarted: false,
    }));
    return;
  }

  const preflightAuthorization = staging && stagingMode === "preflight"
    ? parseStagingPreflightAuthorization(process.env, checkedOutReleaseSha!)
    : undefined;
  const migrationAuthorization = staging && stagingMode === "apply"
    ? parseStagingMigrationAuthorization(process.env, checkedOutReleaseSha!)
    : undefined;

  const pool = createDatabasePool(migrationUrl!, environment.databaseEnv, "migration", 1);
  const runtimePool = (staging && stagingMode === "preflight") || preview
    ? createDatabasePool(environment.databaseUrl!, environment.databaseEnv, "runtime", 1)
    : undefined;
  let runtimePrivilegesVerified = false;
  let migrationAttempted = false;
  let runtimeFunctionExecutionRevoked = false;
  try {
    const runtimeConnectionEvidence = runtimePool
      ? await assertRuntimeConnection(runtimePool, staging
        ? {
          database: stagingDatabaseTarget.database,
          runtimeRole: stagingDatabaseTarget.runtimeRole,
          environmentName: "Staging",
        }
        : {
          database: previewDatabaseTarget.database,
          runtimeRole: previewDatabaseTarget.runtimeRole,
          environmentName: "Preview",
        },
        preview ? "node_tls_socket" : "postgres_pg_stat_ssl",
      )
      : undefined;
    const previewMigrationEvidence = preview
      ? await assertPreviewMigrationConnection(pool, previewTarget!)
      : undefined;
    const stagingEvidence = staging ? await assertStagingMigrationPreflight(pool) : undefined;
    if (preview) await assertPreviewMigrationState(pool, migrationEntries);
    if (staging && stagingMode === "preflight") {
      console.info(JSON.stringify({
        event: "database.migrations.preflight",
        environment: "staging",
        releaseSha,
        migrationCount: migrationEntries.length,
        migrationHeadTag: journalEntries.at(-1)?.tag,
        target: {
          projectId: stagingDatabaseTarget.projectId,
          branchId: stagingDatabaseTarget.branchId,
          endpointId: stagingDatabaseTarget.endpointId,
          database: stagingDatabaseTarget.database,
        },
        migrationIdentity: {
          database: stagingEvidence?.databaseName,
          effectiveRole: stagingEvidence?.effectiveRole,
          sessionRole: stagingEvidence?.sessionRole,
          postgresMajorVersion: stagingEvidence ? Math.floor(stagingEvidence.serverVersionNum / 10_000) : undefined,
          tlsActive: stagingEvidence?.tlsActive,
          tlsCertificateAndHostnameVerified: stagingEvidence?.tlsCertificateAndHostnameVerified,
          migrationRoleFlagsSafe: stagingEvidence?.migrationRoleFlagsSafe,
          migrationPrivilegesSafe: stagingEvidence?.migrationPrivilegesSafe,
          emptyPreMigrationRelationCatalog: stagingEvidence?.emptyPreMigrationRelationCatalog,
          emptyPreMigrationRoutineCatalog: stagingEvidence?.emptyPreMigrationRoutineCatalog,
          databaseTemporaryPrivilegeDenied: stagingEvidence?.databaseTemporaryPrivilegeDenied,
        },
        runtimeIdentity: {
          database: runtimeConnectionEvidence?.databaseName,
          effectiveRole: runtimeConnectionEvidence?.effectiveRole,
          sessionRole: runtimeConnectionEvidence?.sessionRole,
          postgresMajorVersion: runtimeConnectionEvidence
            ? Math.floor(runtimeConnectionEvidence.serverVersionNum / 10_000)
            : undefined,
          tlsActive: runtimeConnectionEvidence?.tlsActive,
          tlsCertificateAndHostnameVerified: Boolean(runtimeConnectionEvidence),
          runtimeRoleSafe: true,
        },
        authorization: {
          ownerGoRef: preflightAuthorization?.authorizationRef,
          isolationEvidenceRef: preflightAuthorization?.isolationEvidenceRef,
        },
        databaseWritesStarted: false,
      }));
      return;
    }
    migrationAttempted = true;
    if (staging) {
      await revokeCustomRoutineDefaultExecution(
        pool,
        stagingDatabaseTarget.migrationRole,
        stagingDatabaseTarget.runtimeRole,
      );
    }
    if (preview) {
      await revokeCustomRoutineDefaultExecution(
        pool,
        previewDatabaseTarget.migrationRole,
        previewDatabaseTarget.runtimeRole,
      );
    }
    await migrate(drizzle({ client: pool, schema: relationalSchema }), { migrationsFolder });
    let runtimePrivilegeEvidence: { tableCount: number; sequenceCount: number; allowlistedFunctionCount: number } | undefined;
    if (staging) {
      await revokeRuntimeFunctionExecution(pool, stagingDatabaseTarget.runtimeRole);
      runtimeFunctionExecutionRevoked = true;
      await assertMigrationResult(pool, migrationEntries, "Staging");
      await grantRuntimePrivileges(pool, stagingDatabaseTarget.runtimeRole);
      runtimePrivilegeEvidence = await assertRuntimePrivileges(pool, stagingDatabaseTarget.runtimeRole);
      runtimePrivilegesVerified = true;
    }
    if (preview) {
      await assertMigrationResult(pool, migrationEntries, "Preview");
      await revokeCustomRoutineDefaultExecution(
        pool,
        previewDatabaseTarget.migrationRole,
        previewDatabaseTarget.runtimeRole,
      );
      await grantPreviewRuntimeDefaultPrivileges(pool);
      await grantRuntimePrivileges(pool, previewDatabaseTarget.runtimeRole);
      await revokeRuntimeFunctionExecution(pool, previewDatabaseTarget.runtimeRole);
      runtimeFunctionExecutionRevoked = true;
      await grantPreviewRuntimeTriggerFunctionExecution(pool, previewDatabaseTarget.runtimeRole);
      runtimeFunctionExecutionRevoked = false;
      runtimePrivilegeEvidence = await assertRuntimePrivileges(pool, previewDatabaseTarget.runtimeRole, true);
      runtimePrivilegesVerified = true;
    }

    console.info(JSON.stringify({
      event: "database.migrations.applied",
      environment: environment.databaseEnv,
      migrationCount: migrationEntries.length,
      migrationHeadHash: expectedHeadHash,
      ...(staging ? {
        releaseSha,
        target: {
          projectId: stagingDatabaseTarget.projectId,
          branchId: stagingDatabaseTarget.branchId,
          endpointId: stagingDatabaseTarget.endpointId,
          database: stagingEvidence?.databaseName,
        },
        postgresMajorVersion: stagingEvidence ? Math.floor(stagingEvidence.serverVersionNum / 10_000) : undefined,
        effectiveRole: stagingEvidence?.effectiveRole,
        sessionRole: stagingEvidence?.sessionRole,
        tlsActive: stagingEvidence?.tlsActive,
        tlsCertificateAndHostnameVerified: stagingEvidence?.tlsCertificateAndHostnameVerified,
        migrationRoleFlagsSafe: stagingEvidence?.migrationRoleFlagsSafe,
        migrationPrivilegesSafe: stagingEvidence?.migrationPrivilegesSafe,
        runtimeRoleSafe: stagingEvidence?.runtimeRoleSafe,
        runtimeConnectionVerified: Boolean(runtimeConnectionEvidence),
        runtimeDatabase: runtimeConnectionEvidence?.databaseName,
        runtimeEffectiveRole: runtimeConnectionEvidence?.effectiveRole,
        runtimeSessionRole: runtimeConnectionEvidence?.sessionRole,
        runtimePostgresMajorVersion: runtimeConnectionEvidence
          ? Math.floor(runtimeConnectionEvidence.serverVersionNum / 10_000)
          : undefined,
        runtimeTlsActive: runtimeConnectionEvidence?.tlsActive,
        runtimeTlsCertificateAndHostnameVerified: Boolean(runtimeConnectionEvidence),
        emptyPreMigrationRelationCatalog: stagingEvidence?.emptyPreMigrationRelationCatalog,
        emptyPreMigrationRoutineCatalog: stagingEvidence?.emptyPreMigrationRoutineCatalog,
        databaseTemporaryPrivilegeDenied: stagingEvidence?.databaseTemporaryPrivilegeDenied,
        customRoutineDefaultsRestrictedAndVerified: staging ? true : undefined,
        customRoutineExecuteRevokedAndVerified: runtimePrivilegeEvidence ? true : undefined,
        fullMigrationJournalVerified: true,
        runtimePrivilegesVerified: true,
        runtimeTablesVerified: runtimePrivilegeEvidence?.tableCount,
        runtimeSequencesVerified: runtimePrivilegeEvidence?.sequenceCount,
        ownerCleanupRequired: "Revoke migrator CREATE on public and drizzle, revoke migrator USAGE on drizzle, revoke temporary database CREATE, set migrator NOLOGIN, and verify all changes before app UAT.",
        authorization: {
          ownerGoRef: migrationAuthorization?.authorizationRef,
          preflightEvidenceRef: migrationAuthorization?.preflightEvidenceRef,
          isolationEvidenceRef: migrationAuthorization?.isolationEvidenceRef,
        },
      } : {}),
      ...(preview ? {
        target: previewTarget,
        postgresMajorVersion: previewMigrationEvidence
          ? Math.floor(previewMigrationEvidence.serverVersionNum / 10_000)
          : undefined,
        migrationRoleFlagsSafe: true,
        migrationPrivilegesSafe: true,
        tlsActive: previewMigrationEvidence?.tlsActive,
        tlsCertificateAndHostnameVerified: Boolean(previewMigrationEvidence),
        tlsEvidenceSource: previewMigrationEvidence?.tlsEvidenceSource,
        postgresReportedTlsActive: previewMigrationEvidence?.postgresReportedTlsActive,
        runtimeRoleSafe: true,
        runtimeConnectionVerified: Boolean(runtimeConnectionEvidence),
        runtimeTlsActive: runtimeConnectionEvidence?.tlsActive,
        runtimeTlsCertificateAndHostnameVerified: Boolean(runtimeConnectionEvidence),
        runtimeTlsEvidenceSource: runtimeConnectionEvidence?.tlsEvidenceSource,
        runtimePostgresReportedTlsActive: runtimeConnectionEvidence?.postgresReportedTlsActive,
        runtimeTablesVerified: runtimePrivilegeEvidence?.tableCount,
        runtimeSequencesVerified: runtimePrivilegeEvidence?.sequenceCount,
        runtimeFunctionsAllowlisted: runtimePrivilegeEvidence?.allowlistedFunctionCount,
        fullMigrationJournalVerified: true,
        runtimePrivilegesVerified: true,
      } : {}),
    }));
  } catch (error) {
    if ((staging || preview) && migrationAttempted && !runtimePrivilegesVerified) {
      try {
        const runtimeRole = preview ? previewDatabaseTarget.runtimeRole : stagingDatabaseTarget.runtimeRole;
        if (!runtimeFunctionExecutionRevoked) {
          await revokeRuntimeFunctionExecution(pool, runtimeRole);
          runtimeFunctionExecutionRevoked = true;
        }
        await revokeRuntimePrivileges(pool, runtimeRole);
        if (preview) await revokePreviewRuntimeDefaultPrivileges(pool);
        await assertRuntimePrivilegesRevoked(pool, runtimeRole);
        if (preview) {
          console.warn(JSON.stringify({
            event: "database.migrations.preview_runtime_access_revoked_after_failure",
            target: previewTarget,
            verified: true,
          }));
        } else {
          console.warn(JSON.stringify({
            event: "database.migrations.runtime_access_revoked_after_failure",
            target: {
              projectId: stagingDatabaseTarget.projectId,
              branchId: stagingDatabaseTarget.branchId,
              endpointId: stagingDatabaseTarget.endpointId,
              database: stagingDatabaseTarget.database,
            },
            verified: true,
          }));
        }
      } catch (cleanupError) {
        console.error("Runtime grant cleanup failed; owner readback is required.", safeErrorSummary(cleanupError));
      }
    }
    throw error;
  } finally {
    try {
      if (staging && migrationAttempted) {
        console.warn(JSON.stringify({
          event: "database.migrations.owner_cleanup_required",
          target: {
            projectId: stagingDatabaseTarget.projectId,
            branchId: stagingDatabaseTarget.branchId,
            endpointId: stagingDatabaseTarget.endpointId,
            database: stagingDatabaseTarget.database,
          },
          actions: [
            "Revoke CREATE on public from karturt_stg_migrator_v2",
            "Revoke CREATE on drizzle from karturt_stg_migrator_v2",
            "Revoke USAGE on drizzle from karturt_stg_migrator_v2",
            "Revoke temporary database CREATE from karturt_stg_migrator_v2",
            "Verify database TEMP remains revoked from PUBLIC and both staging roles",
            "Set karturt_stg_migrator_v2 back to NOLOGIN",
          ],
          verified: false,
        }));
      }
    } finally {
      try {
        await runtimePool?.end();
      } finally {
        await pool.end();
      }
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error("Database migration failed.", safeErrorSummary(error));
    process.exitCode = 1;
  });
