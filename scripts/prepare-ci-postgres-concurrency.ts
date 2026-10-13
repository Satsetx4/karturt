import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { Pool } from "pg";
import { disposablePostgresMarker, validateDisposablePostgresTarget } from "./lib/disposable-postgres-identity";

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_RUN_ID || !process.env.GITHUB_RUN_ATTEMPT) {
    throw new Error("Run identity initialization is limited to a GitHub Actions PostgreSQL service; no database connection was opened.");
  }
  const githubEnvironmentFile = process.env.GITHUB_ENV;
  if (!githubEnvironmentFile) {
    throw new Error("The GitHub Actions environment file is unavailable; no database connection was opened.");
  }

  const runId = `${process.env.GITHUB_RUN_ID}_${process.env.GITHUB_RUN_ATTEMPT}`;
  const identityToken = randomBytes(32).toString("hex");
  const target = validateDisposablePostgresTarget({
    ...process.env,
    KARTURT_POSTGRES_RUN_ID: runId,
    KARTURT_POSTGRES_IDENTITY_TOKEN: identityToken,
  });
  assert.equal(target.runId, runId);

  const pool = new Pool({
    connectionString: target.connectionString,
    application_name: `krt-postgres-identity-${runId}`,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 0,
  });
  try {
    const { rows } = await pool.query<{
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
    assert.equal(rows.length, 1, "the GitHub PostgreSQL service database must be identifiable");
    assert.equal(rows[0]?.current_database, target.databaseName, "the GitHub service database must be run-scoped");
    assert.equal(rows[0]?.current_user, target.username, "the GitHub service user must be run-scoped");
    assert.equal(rows[0]?.identity_marker, null, "a new service database must not already carry an identity marker");

    const { rows: objects } = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    `);
    assert.equal(Number(objects[0]?.count), 0, "the GitHub service database must have no user relations before the identity marker is set");

    const marker = disposablePostgresMarker(runId, identityToken);
    await pool.query(`COMMENT ON DATABASE "${target.databaseName}" IS '${marker}'`);
    const { rows: readback } = await pool.query<{ identity_marker: string | null }>(`
      SELECT obj_description(database.oid, 'pg_database') AS identity_marker
      FROM pg_database AS database
      WHERE database.datname = current_database()
    `);
    assert.equal(readback[0]?.identity_marker, marker, "the run-scoped PostgreSQL identity marker must read back exactly");

    appendFileSync(githubEnvironmentFile, `KARTURT_POSTGRES_RUN_ID=${runId}\nKARTURT_POSTGRES_IDENTITY_TOKEN=${identityToken}\n`, "utf8");
    process.stdout.write("GitHub PostgreSQL service identity initialized and read back; identity token redacted.\n");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "GitHub PostgreSQL identity initialization failed closed."}\n`);
  process.exitCode = 1;
});
