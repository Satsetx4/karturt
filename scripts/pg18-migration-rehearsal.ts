import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  assertInitialDatabaseSnapshot,
  assertMigrationLedger,
  assertPostMigrationCatalog,
  expectedPg18MigrationTags,
  type InitialDatabaseSnapshot,
  type MigrationLedgerExpectation,
  type PostMigrationCatalog,
  validatePg18RehearsalEnvironment,
} from "./lib/pg18-migration-rehearsal";
import { validateDisposablePostgresTarget } from "./lib/disposable-postgres-identity";

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

let currentStage = "run and target preflight";

function readExpectedLedger() {
  const journalPath = resolve(process.cwd(), "drizzle/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
  const expectedTags = expectedPg18MigrationTags();
  assert.equal(journal.version, "7", "The Drizzle journal version must remain 7.");
  assert.equal(journal.dialect, "postgresql", "The Drizzle journal dialect must remain PostgreSQL.");
  assert.equal(journal.entries.length, expectedTags.length, "The checked-in journal must contain exactly the reviewed 14 entries.");

  let previousWhen = 0;
  return journal.entries.map((entry, index) => {
    assert.equal(entry.idx, index, "The Drizzle journal indexes must be contiguous and ordered.");
    assert.equal(entry.version, journal.version, "Each Drizzle entry must match the journal version.");
    assert.equal(entry.tag, expectedTags[index], "The checked-in migration tag/order changed from the reviewed baseline.");
    assert.equal(entry.breakpoints, true, "Each checked-in migration must retain its Drizzle breakpoint setting.");
    assert.ok(Number.isSafeInteger(entry.when), "Each Drizzle journal timestamp must be a safe integer.");
    assert.ok(entry.when > previousWhen, "The Drizzle journal timestamps must increase in migration order.");
    previousWhen = entry.when;

    const migrationPath = resolve(process.cwd(), "drizzle", `${entry.tag}.sql`);
    const migrationSql = readFileSync(migrationPath);
    return {
      hash: createHash("sha256").update(migrationSql).digest("hex"),
      createdAt: String(entry.when),
    };
  });
}

function quoteIdentifier(identifier: string) {
  assert.match(identifier, /^[a-z0-9_]{1,63}$/, "Run-owned PostgreSQL identifiers must be plain lowercase names.");
  return `"${identifier}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function readDatabaseSnapshot(pool: Pool): Promise<InitialDatabaseSnapshot> {
  const result = await pool.query<{
    current_database: string;
    current_user: string;
    identity_marker: string | null;
    server_version_num: number;
    user_schema_count: string;
    user_relation_count: string;
  }>(`
    SELECT current_database() AS current_database,
      current_user AS current_user,
      shobj_description(database.oid, 'pg_database') AS identity_marker,
      current_setting('server_version_num')::integer AS server_version_num,
      (
        SELECT count(*)::text
        FROM pg_namespace AS namespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
          AND namespace.nspname NOT LIKE 'pg_toast%'
          AND namespace.nspname NOT LIKE 'pg_temp%'
      ) AS user_schema_count,
      (
        SELECT count(*)::text
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname NOT LIKE 'pg_toast%'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ) AS user_relation_count
    FROM pg_database AS database
    WHERE database.datname = current_database()
  `);
  assert.equal(result.rows.length, 1, "The service database identity must be readable.");
  const row = result.rows[0]!;
  return {
    currentDatabase: row.current_database,
    currentUser: row.current_user,
    identityMarker: row.identity_marker,
    serverVersionNum: row.server_version_num,
    userSchemaCount: Number(row.user_schema_count),
    userRelationCount: Number(row.user_relation_count),
  };
}

async function readMigrationLedger(pool: Pool) {
  const result = await pool.query<{ hash: string; created_at: string }>(`
    SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at, id
  `);
  return result.rows;
}

async function readPostMigrationCatalog(pool: Pool): Promise<PostMigrationCatalog> {
  const result = await pool.query<{
    public_table_count: string;
    constraint_count: string;
    index_count: string;
    trigger_count: string;
    function_count: string;
    enum_count: string;
    constraint_names: string[];
    index_names: string[];
    trigger_names: string[];
    function_names: string[];
    enum_names: string[];
  }>(`
    SELECT
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))::text AS public_table_count,
      (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public')::text AS constraint_count,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'i')::text AS index_count,
      (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal)::text AS trigger_count,
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f')::text AS function_count,
      (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e')::text AS enum_count,
      (SELECT coalesce(array_agg(c.conname ORDER BY c.conname), ARRAY[]::text[])
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public') AS constraint_names,
      (SELECT coalesce(array_agg(c.relname ORDER BY c.relname), ARRAY[]::text[])
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'i') AS index_names,
      (SELECT coalesce(array_agg(t.tgname ORDER BY t.tgname), ARRAY[]::text[])
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal) AS trigger_names,
      (SELECT coalesce(array_agg(p.proname ORDER BY p.proname), ARRAY[]::text[])
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f') AS function_names,
      (SELECT coalesce(array_agg(t.typname ORDER BY t.typname), ARRAY[]::text[])
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e') AS enum_names
  `);
  assert.equal(result.rows.length, 1, "The public migration catalog must be readable.");
  const row = result.rows[0]!;
  return {
    publicTableCount: Number(row.public_table_count),
    constraintCount: Number(row.constraint_count),
    indexCount: Number(row.index_count),
    triggerCount: Number(row.trigger_count),
    functionCount: Number(row.function_count),
    enumCount: Number(row.enum_count),
    constraints: row.constraint_names,
    indexes: row.index_names,
    triggers: row.trigger_names,
    functions: row.function_names,
    enums: row.enum_names,
  };
}

async function runDockerCapture(args: string[]) {
  return await new Promise<{ exitCode: number | null; stdout: string }>((resolveResult, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.once("error", () => reject(new Error("The PostgreSQL 18 service container could not be inspected.")));
    child.once("close", (exitCode) => resolveResult({ exitCode, stdout: stdout.trim() }));
  });
}

async function assertPostgres18Tools(serviceId: string) {
  const inspection = await runDockerCapture(["inspect", "--format", "{{.Config.Image}}|{{.State.Running}}", serviceId]);
  assert.equal(inspection.exitCode, 0, "The exact PostgreSQL service container must be inspectable.");
  assert.equal(inspection.stdout, "postgres:18|true", "Dump and restore must use the running postgres:18 service image.");

  for (const tool of ["pg_dump", "pg_restore"] as const) {
    const version = await runDockerCapture(["exec", "--user", "postgres", serviceId, tool, "--version"]);
    assert.equal(version.exitCode, 0, "The PostgreSQL service image must provide its native dump tools.");
    assert.match(version.stdout, new RegExp(`^${tool} \\(PostgreSQL\\) 18(?:\\.|$)`));
  }
}

function waitForChild(child: ReturnType<typeof spawn>) {
  return new Promise<number | null>((resolveResult, reject) => {
    child.once("error", () => reject(new Error("The PostgreSQL 18 container command could not start.")));
    child.once("close", resolveResult);
  });
}

async function dumpPostgres18Database(serviceId: string, target: { username: string; databaseName: string }, dumpPath: string) {
  const child = spawn("docker", [
    "exec", "--user", "postgres", serviceId,
    "pg_dump", "--format=custom", "--no-owner", "--no-acl",
    "--username", target.username, "--dbname", target.databaseName,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  const exitCodePromise = waitForChild(child);
  await Promise.all([
    pipeline(child.stdout!, createWriteStream(dumpPath, { mode: 0o600 })),
    exitCodePromise.then((exitCode) => {
      assert.equal(exitCode, 0, "PostgreSQL 18 pg_dump failed; process output is suppressed for safety.");
    }),
  ]);
}

async function restorePostgres18Database(serviceId: string, username: string, databaseName: string, dumpPath: string) {
  const child = spawn("docker", [
    "exec", "--interactive", "--user", "postgres", serviceId,
    "pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
    "--username", username, "--dbname", databaseName,
  ], { stdio: ["pipe", "ignore", "ignore"] });
  const exitCodePromise = waitForChild(child);
  await Promise.all([
    pipeline(createReadStream(dumpPath), child.stdin!),
    exitCodePromise.then((exitCode) => {
      assert.equal(exitCode, 0, "PostgreSQL 18 pg_restore failed; process output is suppressed for safety.");
    }),
  ]);
}

async function removeOwnedTempDirectory(tempDirectory: string) {
  await rm(tempDirectory, { recursive: true, force: false });
  try {
    await access(tempDirectory);
    throw new Error("A run-owned PostgreSQL rehearsal temporary directory remains after cleanup.");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

async function exerciseInjectedMigrationFailure(
  pool: Pool,
  runId: string,
  expectedLedger: MigrationLedgerExpectation[],
  expectedCatalog: PostMigrationCatalog,
) {
  currentStage = "temporary injected migration failure and rollback verification";
  const tempDirectory = await mkdtemp(join(tmpdir(), `karturt-pg18-failure-${runId}-`));
  try {
    const sourceDrizzle = resolve(process.cwd(), "drizzle");
    await mkdir(join(tempDirectory, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(resolve(sourceDrizzle, "meta/_journal.json"), "utf8")) as MigrationJournal;
    for (const entry of journal.entries) {
      await copyFile(resolve(sourceDrizzle, `${entry.tag}.sql`), join(tempDirectory, `${entry.tag}.sql`));
    }
    const syntheticTag = "9999_wave12_3_injected_failure";
    const when = Math.max(Date.now(), journal.entries.at(-1)!.when + 1);
    await writeFile(join(tempDirectory, `${syntheticTag}.sql`), "SELECT 1 / 0;\n", { encoding: "utf8", flag: "wx" });
    journal.entries.push({
      idx: journal.entries.length,
      version: journal.version,
      when,
      tag: syntheticTag,
      breakpoints: true,
    });
    await writeFile(resolve(tempDirectory, "meta/_journal.json"), `${JSON.stringify(journal, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });

    let failureCode: unknown;
    try {
      await migrate(drizzle(pool), { migrationsFolder: tempDirectory });
    } catch (error) {
      failureCode = (error as { code?: unknown }).code;
    }
    assert.equal(failureCode, "22012", "The generated migration must fail specifically with division by zero.");

    const ledgerAfterFailure = await readMigrationLedger(pool);
    assertMigrationLedger(ledgerAfterFailure, expectedLedger);
    assert.deepEqual(await readPostMigrationCatalog(pool), expectedCatalog, "The injected migration failure must leave the real schema catalog intact.");
  } finally {
    await removeOwnedTempDirectory(tempDirectory);
  }
}

async function exercisePostgres18BackupRestore(
  pool: Pool,
  target: { connectionString: string; databaseName: string; identityMarker: string; runId: string; username: string },
  serviceId: string,
  expectedLedger: MigrationLedgerExpectation[],
  expectedCatalog: PostMigrationCatalog,
) {
  currentStage = "PostgreSQL 18 dump and restore rehearsal";
  await assertPostgres18Tools(serviceId);
  const restoreDatabaseName = `${target.databaseName}_restore`;
  const quotedRestoreDatabaseName = quoteIdentifier(restoreDatabaseName);
  assert.ok(restoreDatabaseName.startsWith(`${target.databaseName}_`) && restoreDatabaseName.length <= 63);

  const existing = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
    [restoreDatabaseName],
  );
  assert.equal(existing.rows[0]?.exists, false, "The run-scoped restore database must not already exist.");
  await pool.query(`CREATE DATABASE ${quotedRestoreDatabaseName} OWNER ${quoteIdentifier(target.username)}`);
  let restoreDatabaseCreated = true;
  let restorePool: Pool | undefined;
  let tempDirectory: string | undefined;

  try {
    await pool.query(`COMMENT ON DATABASE ${quotedRestoreDatabaseName} IS ${quoteLiteral(target.identityMarker)}`);
    const restoreUrl = new URL(target.connectionString);
    restoreUrl.pathname = `/${restoreDatabaseName}`;
    restorePool = new Pool({
      connectionString: restoreUrl.toString(),
      application_name: `karturt-pg18-restore-${target.runId}`,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 0,
    });
    const emptyRestore = await readDatabaseSnapshot(restorePool);
    assertInitialDatabaseSnapshot({
      databaseName: restoreDatabaseName,
      username: target.username,
      identityMarker: target.identityMarker,
    }, emptyRestore);

    tempDirectory = await mkdtemp(join(tmpdir(), `karturt-pg18-dump-${target.runId}-`));
    const dumpPath = join(tempDirectory, "karturt-pg18.dump");
    await dumpPostgres18Database(serviceId, target, dumpPath);
    await restorePostgres18Database(serviceId, target.username, restoreDatabaseName, dumpPath);

    const restoredIdentity = await readDatabaseSnapshot(restorePool);
    assert.equal(restoredIdentity.currentDatabase, restoreDatabaseName);
    assert.equal(restoredIdentity.currentUser, target.username);
    assert.equal(restoredIdentity.identityMarker, target.identityMarker);
    assert.equal(restoredIdentity.serverVersionNum >= 180000 && restoredIdentity.serverVersionNum < 190000, true);

    const restoredLedger = await readMigrationLedger(restorePool);
    assertMigrationLedger(restoredLedger, expectedLedger);
    const restoredCatalog = await readPostMigrationCatalog(restorePool);
    assertPostMigrationCatalog(restoredCatalog);
    assert.deepEqual(restoredCatalog, expectedCatalog, "The restored database catalog must match the source rehearsal database.");
    const syntheticReadback = await restorePool.query<{ rt_count: string; house_count: string }>(`
      SELECT
        (SELECT count(*)::text FROM public.rt_units WHERE code IN ($1, $2)) AS rt_count,
        (SELECT count(*)::text FROM public.houses WHERE number = 'SYNTHETIC-A') AS house_count
    `, [`W123${target.runId}A`, `W123${target.runId}B`]);
    assert.deepEqual(syntheticReadback.rows[0], { rt_count: "2", house_count: "1" });
  } finally {
    if (restorePool) await restorePool.end();
    if (tempDirectory) await removeOwnedTempDirectory(tempDirectory);

    if (restoreDatabaseCreated) {
      const identity = await pool.query<{ datname: string; identity_marker: string | null }>(`
        SELECT datname, shobj_description(database.oid, 'pg_database') AS identity_marker
        FROM pg_database AS database
        WHERE datname = $1
      `, [restoreDatabaseName]);
      if (identity.rows.length !== 1 || identity.rows[0]?.identity_marker !== target.identityMarker) {
        throw new Error("Restore database cleanup refused because its run identity could not be verified.");
      }
      await pool.query(`DROP DATABASE ${quotedRestoreDatabaseName}`);
      restoreDatabaseCreated = false;
      const afterCleanup = await pool.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
        [restoreDatabaseName],
      );
      assert.equal(afterCleanup.rows[0]?.exists, false, "The run-owned restore database must be removed after readback.");
    }
  }
}

async function main() {
  validatePg18RehearsalEnvironment(process.env);
  const target = validateDisposablePostgresTarget(process.env);
  assert.equal(target.runId, `${process.env.GITHUB_RUN_ID}_${process.env.GITHUB_RUN_ATTEMPT}`);
  const expectedLedger = readExpectedLedger();
  const pool = new Pool({
    connectionString: target.connectionString,
    application_name: `karturt-pg18-rehearsal-${target.runId}`,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 0,
  });

  try {
    currentStage = "service identity, PostgreSQL major, and empty-target verification";
    assertInitialDatabaseSnapshot(target, await readDatabaseSnapshot(pool));

    currentStage = "repository Drizzle migrator applying the checked-in journal";
    await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), "drizzle") });

    currentStage = "migration ledger count validation";
    const ledger = await readMigrationLedger(pool);
    assert.equal(ledger.length, expectedLedger.length, "The Drizzle migration ledger does not contain exactly 14 entries.");

    currentStage = "migration ledger hash and timestamp validation";
    assertMigrationLedger(ledger, expectedLedger);

    currentStage = "post-migration catalog count and named-object validation";
    const catalog = await readPostMigrationCatalog(pool);
    assertPostMigrationCatalog(catalog);

    await exerciseInjectedMigrationFailure(pool, target.runId, expectedLedger, catalog);

    currentStage = "synthetic cross-RT constraint rejection";
    const rtA = await pool.query<{ id: string }>(`
      INSERT INTO public.rt_units (code, name, rw_code, village)
      VALUES ($1, 'Synthetic Wave 12.3 A', 'W12-3', 'Synthetic')
      RETURNING id
    `, [`W123${target.runId}A`]);
    const rtB = await pool.query<{ id: string }>(`
      INSERT INTO public.rt_units (code, name, rw_code, village)
      VALUES ($1, 'Synthetic Wave 12.3 B', 'W12-3', 'Synthetic')
      RETURNING id
    `, [`W123${target.runId}B`]);
    assert.equal(rtA.rows.length, 1);
    assert.equal(rtB.rows.length, 1);
    const house = await pool.query<{ id: string }>(`
      INSERT INTO public.houses (rt_unit_id, number) VALUES ($1, 'SYNTHETIC-A') RETURNING id
    `, [rtA.rows[0]!.id]);
    assert.equal(house.rows.length, 1);
    let crossRtRejected = false;
    try {
      await pool.query(`
        INSERT INTO public.households (rt_unit_id, house_id, starts_on)
        VALUES ($1, $2, '2026-01-01')
      `, [rtB.rows[0]!.id, house.rows[0]!.id]);
    } catch (error) {
      const pgError = error as { code?: unknown; constraint?: unknown };
      crossRtRejected = pgError.code === "23503" && pgError.constraint === "households_rt_house_fk";
    }
    assert.ok(crossRtRejected, "A household in a different RT must not attach to another RT's house.");

    await exercisePostgres18BackupRestore(
      pool,
      target,
      process.env.PG18_SERVICE_ID!,
      expectedLedger,
      await readPostMigrationCatalog(pool),
    );

    currentStage = "final identity and run-owned boundary verification";
    const finalIdentity = await readDatabaseSnapshot(pool);
    assert.equal(finalIdentity.currentDatabase, target.databaseName);
    assert.equal(finalIdentity.currentUser, target.username);
    assert.equal(finalIdentity.identityMarker, target.identityMarker);

    process.stdout.write(`${JSON.stringify({
      event: "karturt.pg18_migration_rehearsal",
      outcome: "PASS",
      runId: target.runId,
      postgresMajor: 18,
      migrationLedgerEntries: ledger.length,
      publicTables: catalog.publicTableCount,
      constraints: catalog.constraintCount,
      indexes: catalog.indexCount,
      triggers: catalog.triggerCount,
      functions: catalog.functionCount,
      enums: catalog.enumCount,
      syntheticCrossRtRejection: "PASS",
      injectedMigrationFailureRollback: "PASS",
      pgDumpRestore: "PASS",
      restoreDatabaseCleanup: "PASS",
      databaseUrl: "redacted",
    })}\n`, "utf8");
  } finally {
    await pool.end();
  }
}

void main().catch(() => {
  process.stderr.write(`${JSON.stringify({
    event: "karturt.pg18_migration_rehearsal",
    outcome: "FAIL",
    stage: currentStage,
    details: "Database URLs, credentials, SQL text, and driver errors are intentionally omitted.",
  })}\n`, "utf8");
  process.exitCode = 1;
});
