import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { execFileSync } from "node:child_process";
import { createDatabasePool } from "@/db/pool";
import { assertR2StagingRuntimeEvidence, type R2StagingRuntimeEvidence } from "@/db/r2-staging-runtime-policy";
import { parseR2BootstrapInputs, type R2BootstrapMode } from "@/db/r2-bootstrap-policy";
import { relationalSchema } from "@/db/schema";
import { bootstrapR2SyntheticFixture, type R2StagingFixtureCredentials } from "@/lib/rt/r2-staging-fixture";

function readCheckedOutReleaseSha() {
  try {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    });
    if (status.split(/\r?\n/).filter(Boolean).some((line) => !line.startsWith("?? .vc/"))) return undefined;
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true })
      .trim().toLowerCase();
  } catch {
    return undefined;
  }
}

function parseMode(argument: string | undefined): R2BootstrapMode {
  if (argument === undefined || argument === "--plan") return "plan";
  if (argument === "--apply") return "apply";
  throw new Error("Use --plan or explicitly pass --apply for the canonical staging fixture.");
}

function fixtureCredentials(environment: NodeJS.ProcessEnv): R2StagingFixtureCredentials {
  const values = {
    residentPin: environment.KARTURT_R2_RESIDENT_PIN,
    chairmanPassword: environment.KARTURT_R2_CHAIRMAN_PASSWORD,
    treasurerPassword: environment.KARTURT_R2_TREASURER_PASSWORD,
    systemAdminPassword: environment.KARTURT_R2_SYSTEM_ADMIN_PASSWORD,
  };
  if (Object.values(values).some((value) => !value)) {
    throw new Error("R2 synthetic login credentials must be provisioned through the approved secret store before --apply.");
  }
  return values as R2StagingFixtureCredentials;
}

async function assertRuntimeRole(pool: ReturnType<typeof createDatabasePool>) {
  const result = await pool.query<R2StagingRuntimeEvidence>(`
    SELECT
      current_database() AS "databaseName",
      current_user AS "effectiveRole",
      session_user AS "sessionRole",
      current_setting('server_version_num')::int AS "serverVersionNum",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_ssl
        WHERE pid = pg_catalog.pg_backend_pid() AND ssl
      ) AS "tlsActive",
      role.rolcanlogin AS "roleCanLogin",
      role.rolsuper AS "roleIsSuperuser",
      role.rolcreatedb AS "roleCanCreateDb",
      role.rolcreaterole AS "roleCanCreateRole",
      role.rolreplication AS "roleCanReplicate",
      role.rolbypassrls AS "roleBypassesRls",
      role.rolinherit AS "roleInherits",
      (SELECT count(*)::int FROM pg_catalog.pg_auth_members WHERE member = role.oid) AS "roleMembershipCount",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_database AS database
        WHERE database.datname = current_database() AND database.datdba = role.oid
      ) AS "databaseOwnedByRuntime",
      pg_catalog.has_database_privilege(role.oid, current_database(), 'CREATE') AS "databaseCreateEffective",
      pg_catalog.has_database_privilege(role.oid, current_database(), 'TEMPORARY') AS "databaseTempEffective",
      pg_catalog.has_schema_privilege(role.oid, 'public', 'USAGE') AS "publicUsageEffective",
      pg_catalog.has_schema_privilege(role.oid, 'public', 'CREATE') AS "publicCreateEffective",
      (
        SELECT count(*)::int FROM pg_catalog.pg_namespace AS schema
        WHERE schema.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND schema.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
          AND schema.nspname <> 'public' AND schema.nspowner = role.oid
      ) AS "customSchemasOwnedByRuntime",
      (
        SELECT count(*)::int FROM pg_catalog.pg_namespace AS schema
        WHERE schema.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND schema.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
          AND schema.nspname <> 'public' AND pg_catalog.has_schema_privilege(role.oid, schema.oid, 'CREATE')
      ) AS "customSchemasWithCreate",
      (
        SELECT count(*)::int FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
        WHERE schema.nspname = 'public' AND relation.relowner = role.oid
      ) AS "publicObjectsOwnedByRuntime",
      (
        SELECT count(*)::int FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS schema ON schema.oid = routine.pronamespace
        WHERE schema.nspname = 'public' AND routine.proowner = role.oid
      ) AS "publicRoutinesOwnedByRuntime",
      (
        SELECT count(*)::int FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS schema ON schema.oid = routine.pronamespace
        WHERE schema.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND schema.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
          AND pg_catalog.has_function_privilege(role.oid, routine.oid, 'EXECUTE')
      ) AS "customRoutinesWithExecute",
      EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle') AS "drizzleSchemaExists",
      CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
        THEN pg_catalog.has_schema_privilege(role.oid, 'drizzle', 'USAGE') ELSE false END AS "drizzleUsageEffective",
      CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle')
        THEN pg_catalog.has_schema_privilege(role.oid, 'drizzle', 'CREATE') ELSE false END AS "drizzleCreateEffective",
      CASE WHEN pg_catalog.to_regclass('drizzle.__drizzle_migrations') IS NOT NULL
        THEN pg_catalog.has_table_privilege(role.oid, 'drizzle.__drizzle_migrations', 'SELECT') ELSE false END AS "drizzleJournalSelectEffective",
      EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'karturt_stg_migrator') AS "migrationRoleExists",
      COALESCE((SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'karturt_stg_migrator'), false) AS "migrationRoleCanLogin",
      COALESCE((SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = 'karturt_stg_migrator'), false) AS "migrationRoleIsSuperuser",
      COALESCE((SELECT rolcreatedb FROM pg_catalog.pg_roles WHERE rolname = 'karturt_stg_migrator'), true) AS "migrationRoleCanCreateDb",
      COALESCE((SELECT rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = 'karturt_stg_migrator'), true) AS "migrationRoleCanCreateRole",
      COALESCE((SELECT rolreplication FROM pg_catalog.pg_roles WHERE rolname = 'karturt_stg_migrator'), true) AS "migrationRoleCanReplicate",
      COALESCE((SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = 'karturt_stg_migrator'), true) AS "migrationRoleBypassesRls",
      COALESCE((SELECT rolinherit FROM pg_catalog.pg_roles WHERE rolname = 'karturt_stg_migrator'), true) AS "migrationRoleInherits",
      COALESCE((SELECT count(*)::int FROM pg_catalog.pg_auth_members WHERE member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'karturt_stg_migrator')), 0) AS "migrationRoleMembershipCount",
      COALESCE((SELECT pg_catalog.has_database_privilege(migrator.oid, current_database(), 'CREATE') FROM pg_catalog.pg_roles AS migrator WHERE migrator.rolname = 'karturt_stg_migrator'), true) AS "migrationDatabaseCreateEffective",
      COALESCE((SELECT pg_catalog.has_database_privilege(migrator.oid, current_database(), 'TEMPORARY') FROM pg_catalog.pg_roles AS migrator WHERE migrator.rolname = 'karturt_stg_migrator'), true) AS "migrationDatabaseTempEffective",
      COALESCE((SELECT pg_catalog.has_schema_privilege(migrator.oid, 'public', 'CREATE') FROM pg_catalog.pg_roles AS migrator WHERE migrator.rolname = 'karturt_stg_migrator'), true) AS "migrationPublicCreateEffective",
      COALESCE((
        SELECT count(*)::int FROM pg_catalog.pg_namespace AS schema
        WHERE schema.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'public')
          AND schema.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
          AND pg_catalog.has_schema_privilege('karturt_stg_migrator', schema.oid, 'CREATE')
      ), 1) AS "migrationCustomSchemasWithCreate",
      COALESCE((SELECT pg_catalog.has_schema_privilege(migrator.oid, 'drizzle', 'USAGE') FROM pg_catalog.pg_roles AS migrator WHERE migrator.rolname = 'karturt_stg_migrator'), true) AS "migrationDrizzleUsageEffective",
      COALESCE((SELECT pg_catalog.has_schema_privilege(migrator.oid, 'drizzle', 'CREATE') FROM pg_catalog.pg_roles AS migrator WHERE migrator.rolname = 'karturt_stg_migrator'), true) AS "migrationDrizzleCreateEffective"
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user
  `);
  const row = result.rows[0];
  if (!row) throw new Error("R2 staging runtime preflight returned no effective database role.");
  return assertR2StagingRuntimeEvidence(row);
}

async function main() {
  loadEnvConfig(process.cwd());
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) throw new Error("Pass one mode only: --plan or --apply.");
  const mode = parseMode(arguments_[0]);
  const actualHeadSha = readCheckedOutReleaseSha();
  if (!actualHeadSha) throw new Error("R2 bootstrap requires a clean checkout with a full committed HEAD.");
  const inputs = parseR2BootstrapInputs(process.env, actualHeadSha, mode);

  if (mode === "plan") {
    console.info(JSON.stringify({
      event: "r2.staging_fixture.plan",
      mode,
      releaseSha: inputs.releaseSha,
      ciHeadSha: inputs.ciHeadSha,
      ciRunId: inputs.ciRunId,
      ciAttempt: inputs.ciAttempt,
      target: inputs.target,
      fixture: { rtUnits: 1, residents: 1, treasurers: 1, chairmen: 1, systemAdmins: 1, billingYears: 1, feeRates: 1, monthlyDues: 12 },
      requiresExplicitApply: true,
    }));
    return;
  }

  const credentials = fixtureCredentials(process.env);
  const pool = createDatabasePool(process.env.DATABASE_URL!, "staging", "runtime", 1);
  try {
    const runtimeEvidence = await assertRuntimeRole(pool);
    const database = drizzle({ client: pool, schema: relationalSchema });
    const seeded = await bootstrapR2SyntheticFixture(database as unknown as Parameters<typeof bootstrapR2SyntheticFixture>[0], credentials);
    console.info(JSON.stringify({
      event: `r2.staging_fixture.${seeded.status}`,
      releaseSha: inputs.releaseSha,
      target: inputs.target,
      runtime: runtimeEvidence,
      counts: seeded.counts,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const result: { name: string; code?: string; message?: string } = {
    name: error instanceof Error ? error.name : "UnknownError",
  };
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    result.code = error.code;
  }
  if (error instanceof Error && !/(postgres(?:ql)?:\/\/|password\s*[=:]|pin\s*[=:])/i.test(error.message)) {
    result.message = error.message;
  }
  console.error("R2 staging bootstrap failed.", JSON.stringify(result));
  process.exitCode = 1;
});
