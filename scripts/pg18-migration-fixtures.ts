import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import {
  expectedPg18MigrationTags,
  type MigrationLedgerExpectation,
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

type FixtureDatabase = {
  databaseName: string;
  identityMarker: string;
  pool: Pool;
};

type SyntheticTenant = {
  rtUnitId: string;
  houseId: string;
  householdId: string;
  billingYearId: string;
  feeRateId: string;
  personId: string;
};

let currentStage = "run and PostgreSQL service identity preflight";

function quoteIdentifier(identifier: string) {
  assert.match(identifier, /^[a-z0-9_]{1,63}$/, "A run-scoped PostgreSQL identifier must be lowercase and bounded.");
  return `"${identifier}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function readJournal(): MigrationJournal {
  const journal = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as MigrationJournal;
  const tags = expectedPg18MigrationTags();
  assert.equal(journal.version, "7");
  assert.equal(journal.dialect, "postgresql");
  assert.equal(journal.entries.length, tags.length);
  let previousWhen = 0;
  journal.entries.forEach((entry, index) => {
    assert.equal(entry.idx, index);
    assert.equal(entry.version, journal.version);
    assert.equal(entry.tag, tags[index]);
    assert.equal(entry.breakpoints, true);
    assert.ok(Number.isSafeInteger(entry.when) && entry.when > previousWhen);
    previousWhen = entry.when;
  });
  return journal;
}

function expectedLedger(journal: MigrationJournal, highestIndex: number): MigrationLedgerExpectation[] {
  return journal.entries.slice(0, highestIndex + 1).map((entry) => ({
    hash: createHash("sha256")
      .update(readFileSync(resolve(process.cwd(), "drizzle", `${entry.tag}.sql`)))
      .digest("hex"),
    createdAt: String(entry.when),
  }));
}

async function readLedger(pool: Pool) {
  const result = await pool.query<{ hash: string; created_at: string }>(`
    SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at, id
  `);
  return result.rows;
}

async function assertLedgerThrough(pool: Pool, journal: MigrationJournal, highestIndex: number) {
  const expected = expectedLedger(journal, highestIndex);
  const actual = await readLedger(pool);
  assert.equal(actual.length, expected.length, "The Drizzle ledger must stop at the requested journal entry.");
  for (const [index, expectation] of expected.entries()) {
    assert.equal(actual[index]?.hash, expectation.hash, `Unexpected migration hash at journal index ${index}.`);
    assert.equal(actual[index]?.created_at, expectation.createdAt, `Unexpected migration timestamp at journal index ${index}.`);
  }
}

async function removeOwnedTempDirectory(directory: string) {
  await rm(directory, { recursive: true, force: false });
  try {
    await access(directory);
    throw new Error("A run-owned migration fixture directory remains after cleanup.");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

async function applyJournalThrough(pool: Pool, journal: MigrationJournal, highestIndex: number, runId: string) {
  assert.ok(Number.isInteger(highestIndex) && highestIndex >= 0 && highestIndex < journal.entries.length);
  currentStage = `Drizzle journal through ${journal.entries[highestIndex]!.tag}`;
  const entries = journal.entries.slice(0, highestIndex + 1);
  const directory = await mkdtemp(join(tmpdir(), `karturt-pg18-journal-${runId}-`));
  try {
    await mkdir(join(directory, "meta"), { recursive: true });
    for (const entry of entries) {
      await copyFile(resolve(process.cwd(), "drizzle", `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
    }
    await writeFile(join(directory, "meta", "_journal.json"), `${JSON.stringify({ ...journal, entries }, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await migrate(drizzle(pool), { migrationsFolder: directory });
  } finally {
    await removeOwnedTempDirectory(directory);
  }
}

async function expectMigratorFailure(
  pool: Pool,
  journal: MigrationJournal,
  highestIndex: number,
  runId: string,
  expectedCode: string,
  expectedConstraint: string,
  ledgerIndexAfterFailure: number,
) {
  let caught: { code?: unknown; constraint?: unknown } | undefined;
  try {
    await applyJournalThrough(pool, journal, highestIndex, runId);
  } catch (error) {
    caught = error as { code?: unknown; constraint?: unknown };
  }
  assert.equal(caught?.code, expectedCode, "The expected migration preflight SQLSTATE was not returned.");
  assert.equal(caught?.constraint, expectedConstraint, "The expected migration preflight name was not returned.");
  await assertLedgerThrough(pool, journal, ledgerIndexAfterFailure);
}

async function readIdentity(pool: Pool) {
  const result = await pool.query<{
    current_database: string;
    current_user: string;
    identity_marker: string | null;
    server_version_num: number;
    relation_count: string;
    schema_count: string;
  }>(`
    SELECT current_database() AS current_database,
      current_user AS current_user,
      shobj_description(database.oid, 'pg_database') AS identity_marker,
      current_setting('server_version_num')::integer AS server_version_num,
      (
        SELECT count(*)::text
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname NOT LIKE 'pg_toast%'
          AND namespace.nspname NOT LIKE 'pg_temp%'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ) AS relation_count,
      (
        SELECT count(*)::text
        FROM pg_namespace namespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
          AND namespace.nspname NOT LIKE 'pg_toast%'
          AND namespace.nspname NOT LIKE 'pg_temp%'
      ) AS schema_count
    FROM pg_database database
    WHERE database.datname = current_database()
  `);
  assert.equal(result.rows.length, 1, "The connected PostgreSQL database identity must be readable.");
  return result.rows[0]!;
}

async function inspectServiceContainer(serviceId: string) {
  const child = spawn("docker", ["inspect", "--format", "{{.Config.Image}}|{{.State.Running}}", serviceId], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk; });
  const exitCode = await new Promise<number | null>((resolveResult, reject) => {
    child.once("error", () => reject(new Error("The PostgreSQL 18 service container could not be inspected.")));
    child.once("close", resolveResult);
  });
  assert.equal(exitCode, 0, "The exact CI service container must be inspectable.");
  assert.equal(output.trim(), "postgres:18|true", "The run-owned fixture databases require the live postgres:18 service container.");
}

async function verifyNewFixtureDatabase(pool: Pool, databaseName: string, username: string, marker: string) {
  const identity = await readIdentity(pool);
  assert.equal(identity.current_database, databaseName);
  assert.equal(identity.current_user, username);
  assert.equal(identity.identity_marker, marker);
  assert.ok(identity.server_version_num >= 180000 && identity.server_version_num < 190000);
  assert.equal(Number(identity.relation_count), 0, "A fixture database must be empty before its ordered migrations run.");
  assert.equal(Number(identity.schema_count), 0, "A fixture database must have no user schema before its ordered migrations run.");
}

async function withFixtureDatabase<T>(
  adminPool: Pool,
  target: ReturnType<typeof validateDisposablePostgresTarget>,
  slug: "fixture3" | "fixture10",
  run: (fixture: FixtureDatabase) => Promise<T>,
): Promise<T> {
  const databaseName = `${target.databaseName}_${slug}`;
  const identityMarker = `${target.identityMarker}:fixture:${slug}`;
  const quotedDatabaseName = quoteIdentifier(databaseName);
  assert.ok(databaseName.startsWith(`${target.databaseName}_`) && databaseName.length <= 63);

  const previous = await adminPool.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
    [databaseName],
  );
  assert.equal(previous.rows[0]?.exists, false, "A fixture database name must be absent before this run creates it.");
  await adminPool.query(`CREATE DATABASE ${quotedDatabaseName} OWNER ${quoteIdentifier(target.username)}`);
  let databaseCreated = true;
  let fixturePool: Pool | undefined;

  try {
    const preMarker = await adminPool.query<{ owner_name: string; identity_marker: string | null }>(`
      SELECT pg_get_userbyid(database.datdba) AS owner_name,
        shobj_description(database.oid, 'pg_database') AS identity_marker
      FROM pg_database database
      WHERE database.datname = $1
    `, [databaseName]);
    assert.equal(preMarker.rows.length, 1);
    assert.equal(preMarker.rows[0]?.owner_name, target.username);
    assert.equal(preMarker.rows[0]?.identity_marker, null, "A newly created fixture database must not carry stale marker data.");
    await adminPool.query(`COMMENT ON DATABASE ${quotedDatabaseName} IS ${quoteLiteral(identityMarker)}`);

    const fixtureUrl = new URL(target.connectionString);
    fixtureUrl.pathname = `/${databaseName}`;
    fixturePool = new Pool({
      connectionString: fixtureUrl.toString(),
      application_name: `karturt-pg18-${slug}-${target.runId}`,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 0,
    });
    await verifyNewFixtureDatabase(fixturePool, databaseName, target.username, identityMarker);
    const result = await run({ databaseName, identityMarker, pool: fixturePool });
    return result;
  } finally {
    try {
      if (fixturePool) await fixturePool.end();
    } finally {
      if (databaseCreated) {
        const identity = await adminPool.query<{ owner_name: string; identity_marker: string | null }>(`
          SELECT pg_get_userbyid(database.datdba) AS owner_name,
            shobj_description(database.oid, 'pg_database') AS identity_marker
          FROM pg_database database
          WHERE database.datname = $1
        `, [databaseName]);
        if (identity.rows.length !== 1
            || identity.rows[0]?.owner_name !== target.username
            || identity.rows[0]?.identity_marker !== identityMarker) {
          throw new Error("Fixture database cleanup refused because its run-owned identity did not match.");
        }
        await adminPool.query(`DROP DATABASE ${quotedDatabaseName}`);
        databaseCreated = false;
        const afterCleanup = await adminPool.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
          [databaseName],
        );
        assert.equal(afterCleanup.rows[0]?.exists, false, "The exact run-owned fixture database must be absent after cleanup.");
      }
    }
  }
}

async function createSyntheticTenant(pool: Pool, code: string): Promise<SyntheticTenant> {
  const rt = await pool.query<{ id: string }>(`
    INSERT INTO public.rt_units (code, name, rw_code, village)
    VALUES ($1, 'Wave 12.3 synthetic fixture', 'W12-3', 'Synthetic')
    RETURNING id
  `, [code]);
  const rtUnitId = rt.rows[0]!.id;
  await pool.query("INSERT INTO public.rt_settings (rt_unit_id) VALUES ($1)", [rtUnitId]);
  const house = await pool.query<{ id: string }>(`
    INSERT INTO public.houses (rt_unit_id, number)
    VALUES ($1, 'SYNTHETIC-1')
    RETURNING id
  `, [rtUnitId]);
  const houseId = house.rows[0]!.id;
  const household = await pool.query<{ id: string }>(`
    INSERT INTO public.households (rt_unit_id, house_id, starts_on)
    VALUES ($1, $2, '2026-01-01')
    RETURNING id
  `, [rtUnitId, houseId]);
  const householdId = household.rows[0]!.id;
  const person = await pool.query<{ id: string }>(`
    INSERT INTO public.people (rt_unit_id, household_id, full_name)
    VALUES ($1, $2, 'Wave 12.3 synthetic resident')
    RETURNING id
  `, [rtUnitId, householdId]);
  const billingYear = await pool.query<{ id: string }>(`
    INSERT INTO public.billing_years (rt_unit_id, year, status)
    VALUES ($1, 2026, 'open')
    RETURNING id
  `, [rtUnitId]);
  const billingYearId = billingYear.rows[0]!.id;
  const feeRate = await pool.query<{ id: string }>(`
    INSERT INTO public.fee_rates (rt_unit_id, billing_year_id, effective_month, monthly_amount)
    VALUES ($1, $2, 1, 1000)
    RETURNING id
  `, [rtUnitId, billingYearId]);
  return {
    rtUnitId,
    houseId,
    householdId,
    billingYearId,
    feeRateId: feeRate.rows[0]!.id,
    personId: person.rows[0]!.id,
  };
}

async function createSyntheticOfficial(pool: Pool, tenant: SyntheticTenant, runId: string) {
  const userId = `w12_3_fixture_${runId}`;
  const email = `w12-3-fixture-${runId}@example.invalid`;
  await pool.query(`
    INSERT INTO public."user" (id, name, email)
    VALUES ($1, 'Wave 12.3 synthetic official', $2)
  `, [userId, email]);
  const person = await pool.query<{ id: string }>(`
    INSERT INTO public.people (rt_unit_id, full_name)
    VALUES ($1, 'Wave 12.3 synthetic official')
    RETURNING id
  `, [tenant.rtUnitId]);
  const account = await pool.query<{ id: string }>(`
    INSERT INTO public.app_accounts (rt_unit_id, auth_user_id, account_type, login_identifier, person_id)
    VALUES ($1, $2, 'official', $3, $4)
    RETURNING id
  `, [tenant.rtUnitId, userId, `fixture-${runId}`, person.rows[0]!.id]);
  const accountId = account.rows[0]!.id;
  await pool.query(`
    INSERT INTO public.official_assignments (rt_unit_id, app_account_id, role, starts_on)
    VALUES ($1, $2, 'treasurer', '2020-01-01')
  `, [tenant.rtUnitId, accountId]);
  return accountId;
}

async function createSyntheticResident(pool: Pool, tenant: SyntheticTenant, runId: string) {
  const userId = `w12_3_resident_${runId}`;
  await pool.query(`
    INSERT INTO public."user" (id, name, email)
    VALUES ($1, 'Wave 12.3 synthetic resident', $2)
  `, [userId, `w12-3-resident-${runId}@example.invalid`]);
  const account = await pool.query<{ id: string }>(`
    INSERT INTO public.app_accounts (rt_unit_id, auth_user_id, account_type, login_identifier, person_id, household_id)
    VALUES ($1, $2, 'resident', $3, $4, $5)
    RETURNING id
  `, [tenant.rtUnitId, userId, `resident-fixture-${runId}`, tenant.personId, tenant.householdId]);
  return account.rows[0]!.id;
}

async function seedSyntheticPaidPaymentHistory(
  pool: Pool,
  tenant: SyntheticTenant,
  actorId: string,
  residentId: string,
) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const cashDue = await client.query<{ id: string }>(`
      INSERT INTO public.monthly_dues (
        rt_unit_id, household_id, billing_year_id, fee_rate_id, month, amount, due_date, status
      ) VALUES ($1, $2, $3, $4, 1, 1000, '2026-01-10', 'unpaid')
      RETURNING id
    `, [tenant.rtUnitId, tenant.householdId, tenant.billingYearId, tenant.feeRateId]);
    const cashDueId = cashDue.rows[0]!.id;

    const payment = await client.query<{ id: string }>(`
      INSERT INTO public.payments (
        rt_unit_id, household_id, amount, method, verified_by_account_id, verified_by_account_type,
        cash_idempotency_key, cash_idempotency_fingerprint
      ) VALUES ($1, $2, 1000, 'cash', $3, 'official', $4, $5)
      RETURNING id
    `, [tenant.rtUnitId, tenant.householdId, actorId, "a1000000-0000-4000-8000-000000000001", "a".repeat(64)]);
    const paymentId = payment.rows[0]!.id;

    const allocation = await client.query<{ id: string }>(`
      INSERT INTO public.payment_allocations (rt_unit_id, household_id, payment_id, monthly_due_id, amount)
      VALUES ($1, $2, $3, $4, 1000)
      RETURNING id
    `, [tenant.rtUnitId, tenant.householdId, paymentId, cashDueId]);

    await client.query(`
      INSERT INTO public.audit_events (actor_app_account_id, action, entity_type, entity_id, reason, context)
      VALUES ($1, 'payment.cash_recorded', 'payment', $2, NULL, $3::jsonb)
    `, [actorId, paymentId, JSON.stringify({ itemCount: 1, method: "cash", totalAmount: 1000 })]);
    await client.query("UPDATE public.monthly_dues SET status = 'paid' WHERE id = $1", [cashDueId]);

    const transferDue = await client.query<{ id: string }>(`
      INSERT INTO public.monthly_dues (
        rt_unit_id, household_id, billing_year_id, fee_rate_id, month, amount, due_date, status
      ) VALUES ($1, $2, $3, $4, 2, 1000, '2026-02-10', 'unpaid')
      RETURNING id
    `, [tenant.rtUnitId, tenant.householdId, tenant.billingYearId, tenant.feeRateId]);
    const transferDueId = transferDue.rows[0]!.id;
    const requestId = randomUUID();
    await client.query(`
      INSERT INTO public.payment_requests (
        id, request_code, rt_unit_id, household_id, requested_by_account_id, requested_by_account_type,
        status, idempotency_key, request_fingerprint, total_amount, item_count
      ) VALUES ($1, $2, $3, $4, $5, 'resident', 'pending', $6, $7, 1000, 1)
    `, [requestId, `PG18-${requestId.slice(0, 16)}`, tenant.rtUnitId, tenant.householdId, residentId, randomUUID(), "b".repeat(64)]);
    await client.query(`
      INSERT INTO public.payment_request_items (request_id, rt_unit_id, household_id, monthly_due_id, period, amount)
      VALUES ($1, $2, $3, $4, '2026-02', 1000)
    `, [requestId, tenant.rtUnitId, tenant.householdId, transferDueId]);
    await client.query(`
      INSERT INTO public.payment_request_claims (request_id, monthly_due_id)
      VALUES ($1, $2)
    `, [requestId, transferDueId]);
    const transferPayment = await client.query<{ id: string }>(`
      INSERT INTO public.payments (
        rt_unit_id, household_id, payment_request_id, amount, method, verified_by_account_id, verified_by_account_type
      ) VALUES ($1, $2, $3, 1000, 'transfer', $4, 'official')
      RETURNING id
    `, [tenant.rtUnitId, tenant.householdId, requestId, actorId]);
    const transferPaymentId = transferPayment.rows[0]!.id;
    const transferAllocation = await client.query<{ id: string }>(`
      INSERT INTO public.payment_allocations (
        rt_unit_id, household_id, payment_request_id, payment_id, monthly_due_id, amount
      ) VALUES ($1, $2, $3, $4, $5, 1000)
      RETURNING id
    `, [tenant.rtUnitId, tenant.householdId, requestId, transferPaymentId, transferDueId]);
    await client.query("UPDATE public.monthly_dues SET status = 'paid' WHERE id = $1", [transferDueId]);
    await client.query(`
      UPDATE public.payment_requests
      SET status = 'verified', verified_at = now(), verified_by_account_id = $2, verified_by_account_type = 'official'
      WHERE id = $1
    `, [requestId, actorId]);
    await client.query("DELETE FROM public.payment_request_claims WHERE request_id = $1", [requestId]);
    await client.query(`
      INSERT INTO public.audit_events (actor_app_account_id, action, entity_type, entity_id, reason, context)
      VALUES ($1, 'payment_request.verified', 'payment_request', $2, NULL, $3::jsonb)
    `, [actorId, requestId, JSON.stringify({ itemCount: 1, totalAmount: 1000 })]);
    await client.query("COMMIT");
    return {
      cash: { dueId: cashDueId, paymentId, allocationId: allocation.rows[0]!.id },
      transfer: { dueId: transferDueId, paymentId: transferPaymentId, allocationId: transferAllocation.rows[0]!.id },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertNoTable(pool: Pool, tableName: string) {
  const result = await pool.query<{ relation: string | null }>("SELECT to_regclass($1) AS relation", [`public.${tableName}`]);
  assert.equal(result.rows[0]?.relation, null, `The failed migration must not leave public.${tableName}.`);
}

async function assertNoFunction(pool: Pool, signature: string) {
  const result = await pool.query<{ function_name: string | null }>("SELECT to_regprocedure($1)::text AS function_name", [signature]);
  assert.equal(result.rows[0]?.function_name, null, `The failed migration must not leave ${signature}.`);
}

async function runLegacyWaivedConversion(pool: Pool, journal: MigrationJournal, runId: string) {
  currentStage = "0003 synthetic legacy WAIVED conversion";
  await applyJournalThrough(pool, journal, 2, runId);
  await assertLedgerThrough(pool, journal, 2);
  const tenant = await createSyntheticTenant(pool, `W123_${runId}_F3`);
  const legacy = await pool.query<{ id: string }>(`
    INSERT INTO public.monthly_dues (
      rt_unit_id, household_id, billing_year_id, month, amount, due_date, status, waived_reason
    ) VALUES ($1, $2, $3, 1, 0, '2026-01-10', 'waived', 'not_yet_resident')
    RETURNING id
  `, [tenant.rtUnitId, tenant.householdId, tenant.billingYearId]);
  const dueId = legacy.rows[0]!.id;

  await applyJournalThrough(pool, journal, 3, runId);
  await assertLedgerThrough(pool, journal, 3);
  const converted = await pool.query<{ status: string; amount: number; fee_rate_id: string | null; waived_reason: string | null }>(`
    SELECT status::text AS status, amount, fee_rate_id, waived_reason
    FROM public.monthly_dues
    WHERE id = $1
  `, [dueId]);
  assert.deepEqual(converted.rows[0], {
    status: "not_due",
    amount: 0,
    fee_rate_id: null,
    waived_reason: null,
  });
  const oldReasonType = await pool.query<{ exists: boolean }>(
    "SELECT to_regtype('public.monthly_due_waiver_reason') IS NOT NULL AS exists",
  );
  assert.equal(oldReasonType.rows[0]?.exists, false, "Migration 0003 must remove the legacy waiver reason enum.");
}

async function runPhase9To12Fixtures(pool: Pool, journal: MigrationJournal, runId: string) {
  currentStage = "ordered pre-Phase-9 journal preparation";
  await applyJournalThrough(pool, journal, 9, runId);
  await assertLedgerThrough(pool, journal, 9);

  const tenant = await createSyntheticTenant(pool, `W123_${runId}_F10`);
  const actorId = await createSyntheticOfficial(pool, tenant, runId);
  const residentId = await createSyntheticResident(pool, tenant, runId);
  const paymentFixtures = await seedSyntheticPaidPaymentHistory(pool, tenant, actorId, residentId);

  currentStage = "0010 synthetic transfer and cash active settlement backfill";
  await applyJournalThrough(pool, journal, 10, runId);
  await assertLedgerThrough(pool, journal, 10);
  const backfill = await pool.query<{
    rt_unit_id: string;
    household_id: string;
    monthly_due_id: string;
    payment_id: string;
    allocation_id: string;
    amount: number;
  }>(`
    SELECT rt_unit_id, household_id, monthly_due_id, payment_id, allocation_id, amount::integer AS amount
    FROM public.active_due_settlements
    WHERE monthly_due_id = ANY($1::uuid[])
    ORDER BY monthly_due_id
  `, [[paymentFixtures.cash.dueId, paymentFixtures.transfer.dueId]]);
  const expectedBackfill = [paymentFixtures.cash, paymentFixtures.transfer]
    .map((fixture) => ({
      rt_unit_id: tenant.rtUnitId,
      household_id: tenant.householdId,
      monthly_due_id: fixture.dueId,
      payment_id: fixture.paymentId,
      allocation_id: fixture.allocationId,
      amount: 1000,
    }))
    .sort((left, right) => left.monthly_due_id.localeCompare(right.monthly_due_id));
  assert.deepEqual(backfill.rows, expectedBackfill);

  currentStage = "0011 negative legacy WAIVED preflight and clean retry";
  const legacyWaived = await pool.query<{ id: string }>(`
    INSERT INTO public.monthly_dues (
      rt_unit_id, household_id, billing_year_id, fee_rate_id, month, amount, due_date, status, waived_reason
    ) VALUES ($1, $2, $3, $4, 3, 1000, '2026-03-10', 'waived', 'legacy synthetic waiver')
    RETURNING id
  `, [tenant.rtUnitId, tenant.householdId, tenant.billingYearId, tenant.feeRateId]);
  const legacyWaivedId = legacyWaived.rows[0]!.id;
  await expectMigratorFailure(pool, journal, 11, runId, "23514", "phase10_legacy_waived_dues", 10);
  await assertNoTable(pool, "waiver_actions");
  await pool.query("DELETE FROM public.monthly_dues WHERE id = $1", [legacyWaivedId]);
  await applyJournalThrough(pool, journal, 11, runId);
  await assertLedgerThrough(pool, journal, 11);
  const waiverTable = await pool.query<{ relation: string | null }>("SELECT to_regclass('public.waiver_actions') AS relation");
  assert.ok(waiverTable.rows[0]?.relation, "A clean 0011 retry must create the waiver ledger.");

  currentStage = "0012 negative active-ownership preflight probe with transaction rollback";
  const firstPreflight = readFileSync(resolve(process.cwd(), "drizzle/0012_phase_11_tariff_adjustment.sql"), "utf8")
    .split("--> statement-breakpoint")[0];
  assert.match(firstPreflight, /phase11_active_ownership_preflight/);
  const client = await pool.connect();
  let preflightError: { code?: unknown; constraint?: unknown } | undefined;
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM public.active_due_settlements WHERE monthly_due_id = $1", [paymentFixtures.cash.dueId]);
    try {
      await client.query(firstPreflight);
    } catch (error) {
      preflightError = error as { code?: unknown; constraint?: unknown };
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  assert.equal(preflightError?.code, "23514");
  assert.equal(preflightError?.constraint, "phase11_active_ownership_preflight");
  const restoredOwnership = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM public.active_due_settlements WHERE monthly_due_id = $1
  `, [paymentFixtures.cash.dueId]);
  assert.equal(Number(restoredOwnership.rows[0]?.count), 1, "The rejected preflight probe must leave the fixture database unchanged after rollback.");
  await assertLedgerThrough(pool, journal, 11);

  currentStage = "0012 full migration success on valid synthetic ownership";
  await applyJournalThrough(pool, journal, 12, runId);
  await assertLedgerThrough(pool, journal, 12);
  const adjustmentTable = await pool.query<{ relation: string | null }>("SELECT to_regclass('public.due_adjustments') AS relation");
  assert.ok(adjustmentTable.rows[0]?.relation, "A valid 0012 migration must create the due adjustment ledger.");

  currentStage = "0013 negative overlapping-household preflight and clean retry";
  const overlap = await pool.query<{ id: string }>(`
    INSERT INTO public.households (rt_unit_id, house_id, starts_on)
    VALUES ($1, $2, '2026-06-01')
    RETURNING id
  `, [tenant.rtUnitId, tenant.houseId]);
  const overlapId = overlap.rows[0]!.id;
  await expectMigratorFailure(pool, journal, 13, runId, "23514", "phase12_household_period_overlap_preflight", 12);
  await assertNoFunction(pool, "public.guard_phase12_household_period_v1()");
  const phase12IndexAfterFailure = await pool.query<{ relation: string | null }>("SELECT to_regclass('public.households_rt_house_period_idx') AS relation");
  assert.equal(phase12IndexAfterFailure.rows[0]?.relation, null, "A failed 0013 migration must roll back its later DDL.");
  await pool.query("DELETE FROM public.households WHERE id = $1", [overlapId]);

  await applyJournalThrough(pool, journal, 13, runId);
  await assertLedgerThrough(pool, journal, 13);
  const phase12Function = await pool.query<{ function_name: string | null }>("SELECT to_regprocedure('public.guard_phase12_household_period_v1()')::text AS function_name");
  assert.ok(phase12Function.rows[0]?.function_name, "A clean 0013 retry must create the household period guard.");
}

async function main() {
  const runId = validatePg18RehearsalEnvironment(process.env);
  const target = validateDisposablePostgresTarget(process.env, { allowPasswordlessPg18: true });
  assert.equal(target.runId, runId);
  await inspectServiceContainer(process.env.PG18_SERVICE_ID!);
  const journal = readJournal();
  const adminPool = new Pool({
    connectionString: target.connectionString,
    application_name: `karturt-pg18-fixtures-admin-${runId}`,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 0,
  });

  try {
    currentStage = "base PostgreSQL service identity and run-owned database privilege verification";
    const baseIdentity = await readIdentity(adminPool);
    assert.equal(baseIdentity.current_database, target.databaseName);
    assert.equal(baseIdentity.current_user, target.username);
    assert.equal(baseIdentity.identity_marker, target.identityMarker);
    assert.ok(baseIdentity.server_version_num >= 180000 && baseIdentity.server_version_num < 190000);
    const role = await adminPool.query<{ can_create_database: boolean }>(`
      SELECT rolcreatedb OR rolsuper AS can_create_database
      FROM pg_roles
      WHERE rolname = current_user
    `);
    assert.equal(role.rows[0]?.can_create_database, true, "The exact run-scoped service role must own fixture database creation.");

    await withFixtureDatabase(adminPool, target, "fixture3", async ({ pool }) => {
      await runLegacyWaivedConversion(pool, journal, runId);
    });

    await withFixtureDatabase(adminPool, target, "fixture10", async ({ pool }) => {
      await runPhase9To12Fixtures(pool, journal, runId);
    });

    process.stdout.write(`${JSON.stringify({
      event: "karturt.pg18_migration_fixtures",
      outcome: "PASS",
      runId,
      postgresMajor: 18,
      migration0003LegacyWaivedConversion: "PASS",
      migration0010CashAndTransferSettlementBackfill: "PASS",
      migration0011LegacyWaivedPreflightStopAndRetry: "PASS",
      migration0012OwnershipPreflightRollbackProbe: "PASS",
      migration0012ValidFullMigration: "PASS",
      migration0013OverlapPreflightStopAndRetry: "PASS",
      fixtureDatabasesDropped: 2,
      databaseUrl: "redacted",
    })}\n`, "utf8");
  } finally {
    await adminPool.end();
  }
}

void main().catch(() => {
  process.stderr.write(`${JSON.stringify({
    event: "karturt.pg18_migration_fixtures",
    outcome: "FAIL",
    stage: currentStage,
    details: "Database URLs, credentials, SQL text, synthetic row values, and driver errors are intentionally omitted.",
  })}\n`, "utf8");
  process.exitCode = 1;
});
