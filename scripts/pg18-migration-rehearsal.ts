import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  assertInitialDatabaseSnapshot,
  assertMigrationLedger,
  assertPostMigrationCatalog,
  expectedPg18MigrationTags,
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
    const initialResult = await pool.query<{
      current_database: string;
      current_user: string;
      identity_marker: string | null;
      server_version_num: number;
      user_schema_count: string;
      user_relation_count: string;
    }>(`
      SELECT current_database() AS current_database,
        current_user AS current_user,
        obj_description(database.oid, 'pg_database') AS identity_marker,
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
    assert.equal(initialResult.rows.length, 1, "The service database identity must be readable.");
    const initial = initialResult.rows[0]!;
    assertInitialDatabaseSnapshot(target, {
      currentDatabase: initial.current_database,
      currentUser: initial.current_user,
      identityMarker: initial.identity_marker,
      serverVersionNum: initial.server_version_num,
      userSchemaCount: Number(initial.user_schema_count),
      userRelationCount: Number(initial.user_relation_count),
    });

    currentStage = "repository Drizzle migrator applying the checked-in journal";
    await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), "drizzle") });

    currentStage = "migration ledger and catalog validation";
    const ledgerResult = await pool.query<{ hash: string; created_at: string }>(`
      SELECT hash, created_at::text AS created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at, id
    `);
    assertMigrationLedger(ledgerResult.rows, expectedLedger);

    const catalogResult = await pool.query<{
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
    assert.equal(catalogResult.rows.length, 1, "The public migration catalog must be readable.");
    const catalog = catalogResult.rows[0]!;
    assertPostMigrationCatalog({
      publicTableCount: Number(catalog.public_table_count),
      constraintCount: Number(catalog.constraint_count),
      indexCount: Number(catalog.index_count),
      triggerCount: Number(catalog.trigger_count),
      functionCount: Number(catalog.function_count),
      enumCount: Number(catalog.enum_count),
      constraints: catalog.constraint_names,
      indexes: catalog.index_names,
      triggers: catalog.trigger_names,
      functions: catalog.function_names,
      enums: catalog.enum_names,
    });

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

    currentStage = "final identity and run-owned boundary verification";
    const finalIdentity = await pool.query<{
      current_database: string;
      current_user: string;
      identity_marker: string | null;
    }>(`
      SELECT current_database() AS current_database,
        current_user AS current_user,
        obj_description(database.oid, 'pg_database') AS identity_marker
      FROM pg_database AS database
      WHERE database.datname = current_database()
    `);
    assert.equal(finalIdentity.rows.length, 1);
    assert.equal(finalIdentity.rows[0]?.current_database, target.databaseName);
    assert.equal(finalIdentity.rows[0]?.current_user, target.username);
    assert.equal(finalIdentity.rows[0]?.identity_marker, target.identityMarker);

    process.stdout.write(`${JSON.stringify({
      event: "karturt.pg18_migration_rehearsal",
      outcome: "PASS",
      runId: target.runId,
      postgresMajor: 18,
      migrationLedgerEntries: ledgerResult.rows.length,
      publicTables: Number(catalog.public_table_count),
      constraints: Number(catalog.constraint_count),
      indexes: Number(catalog.index_count),
      triggers: Number(catalog.trigger_count),
      functions: Number(catalog.function_count),
      enums: Number(catalog.enum_count),
      syntheticCrossRtRejection: "PASS",
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
