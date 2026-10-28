import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";
import { and, eq, getTableName } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appAccounts, payments, relationalSchema, rtUnits, schema } from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { CashPaymentIdempotencyConflictError, recordTreasurerCashPayment } from "@/lib/billing/treasurer-cash-payments";
import { TreasurerPaymentAlreadyReversedError, reverseTreasurerPayment } from "@/lib/billing/treasurer-payment-reversal";
import { TreasurerPaymentRequestAlreadyProcessedError, verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import { bootstrapR2SyntheticFixture, type R2StagingFixtureCredentials } from "@/lib/rt/r2-staging-fixture";

type Options = { isCi?: boolean; platform?: NodeJS.Platform };
type PassEvidence = { migrationEntries: number; fixtureCreated: boolean; fixtureIdempotentReplay: boolean };
type GeneratedDb = { created: boolean; name: string; marker: string; owner: string };
const prefix = "krt_r2_recovery_";
const fixtureDate = "2026-10-25";
const transferDate = "2027-02-28";
const cashDate = "2027-03-15";
const reversalDate = "2027-03-16";
const migrationDir = resolve(process.cwd(), "drizzle");
const journalPath = resolve(migrationDir, "meta/_journal.json");
const migrationTags = [
  "0000_messy_menace", "0001_classy_ricochet", "0002_monthly_due_period_guard", "0003_due_auth_audit_domain",
  "0004_phase_5_payment_request", "0005_phase_5_1_payment_request_items_immutable", "0006_phase_6_treasurer_payment_ledger",
  "0007_phase_7_reject_cancel", "0008_phase_7_1_post_resolution_lifecycle", "0009_phase_8_cash_payment",
  "0010_phase_9_payment_reversal", "0011_phase_10_waiver", "0012_phase_11_tariff_adjustment", "0013_phase_12_household_management",
  "0014_handy_genesis", "0015_sheet2_opening_balance_import",
] as const;

export function assertPostgresMajor18(versionNum: number) {
  if (!Number.isInteger(versionNum) || Math.floor(versionNum / 10_000) !== 18) throw new Error("Disposable recovery requires PostgreSQL major version 18.");
}

export function parseAdminTarget(value: string | undefined, options: Options = {}) {
  if (!value) throw new Error("R2_DISPOSABLE_PG18_ADMIN_URL is required; no database connection was opened.");
  let target: URL;
  try { target = new URL(value); } catch { throw new Error("R2_DISPOSABLE_PG18_ADMIN_URL is malformed; no database connection was opened."); }
  const host = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const database = decodeURIComponent(target.pathname.replace(/^\//, ""));
  const isCi = options.isCi ?? process.env.GITHUB_ACTIONS === "true";
  const platform = options.platform ?? process.platform;
  const valid = ["127.0.0.1", "::1"].includes(host)
    && ["postgres:", "postgresql:"].includes(target.protocol)
    && target.port.length > 0 && Number(target.port) >= 1 && Number(target.port) <= 65_535
    && database === "postgres" && decodeURIComponent(target.username).length > 0
    && !target.search && !target.hash;
  if (!valid) throw new Error("The PG18 admin URL must target a loopback PostgreSQL host and the postgres admin database; no database connection was opened.");
  if (isCi && (platform !== "linux" || target.port !== "5432" || !target.password || decodeURIComponent(target.username) !== "karturt_concurrency_test")) {
    throw new Error("GitHub Actions requires the isolated Linux postgres:18 service on loopback port 5432; no database connection was opened.");
  }
  if (!isCi && target.port === "5432") throw new Error("Local PG18 recovery refuses port 5432; use the explicitly isolated local cluster port.");
  return target;
}

function checkSafetyGuards() {
  const local = { isCi: false, platform: "win32" as NodeJS.Platform };
  assert.doesNotThrow(() => parseAdminTarget("postgres://postgres@127.0.0.1:55439/postgres", local));
  assert.throws(() => parseAdminTarget("postgres://postgres@192.0.2.10:55439/postgres", local), /loopback/);
  assert.throws(() => parseAdminTarget("postgres://postgres@127.0.0.1:55439/karturt_staging", local), /postgres admin database/);
  assert.throws(() => parseAdminTarget("postgres://postgres@127.0.0.1:5432/postgres", local), /refuses port 5432/);
  assert.doesNotThrow(() => parseAdminTarget("postgresql://karturt_concurrency_test:test-only@127.0.0.1:5432/postgres", { isCi: true, platform: "linux" }));
  assert.throws(() => parseAdminTarget("postgresql://karturt_concurrency_test:test-only@127.0.0.1:55439/postgres", { isCi: true, platform: "linux" }), /port 5432/);
  assert.doesNotThrow(() => assertPostgresMajor18(180_006));
  assert.throws(() => assertPostgresMajor18(170_006), /major version 18/);
}

function qid(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function qlit(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function makePool(url: string, applicationName: string, max = 4) {
  return new Pool({ connectionString: url, application_name: applicationName, max, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 0 });
}
function sourceSha() {
  const expected = process.env.R2_DISPOSABLE_PG18_EXPECTED_SHA?.trim().toLowerCase();
  if (!expected || !/^[0-9a-f]{40}$/.test(expected)) throw new Error("R2_DISPOSABLE_PG18_EXPECTED_SHA must be the exact 40-character checked-out source SHA.");
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim().toLowerCase();
  if (actual !== expected) throw new Error("The disposable recovery expected SHA does not match the checked-out HEAD.");
  return actual;
}

function workingTreeIsClean() {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim();
  const clean = status.length === 0;
  if (process.env.GITHUB_ACTIONS === "true") assert.ok(clean, "GitHub Actions recovery must run from the exact clean source checkout.");
  return clean;
}
function readOfficialMigrations() {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number; when: number; tag: string }> };
  const migrations = readMigrationFiles({ migrationsFolder: migrationDir });
  assert.equal(journal.entries.length, 16, "checked-in journal has exactly 16 entries");
  assert.equal(migrations.length, 16, "Drizzle discovers exactly 16 official migrations");
  migrationTags.forEach((tag, index) => {
    assert.equal(journal.entries[index]!.idx, index);
    assert.equal(journal.entries[index]!.tag, tag, `journal entry ${index} is the official migration ${tag}`);
    assert.equal(migrations[index]!.folderMillis, journal.entries[index]!.when, `${tag} timestamp matches the journal`);
    assert.equal(migrations[index]!.hash.length, 64, `${tag} has a migration SHA-256 hash`);
  });
  return { journal, migrations };
}
async function assertMigrationLedger(pool: Pool, source: ReturnType<typeof readOfficialMigrations>) {
  const result = await pool.query<{ id: number; hash: string; created_at: string }>(
    "SELECT id, hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id",
  );
  assert.equal(result.rows.length, 16, "migration ledger has exactly 16 entries");
  result.rows.forEach((row, index) => {
    assert.equal(Number(row.id), index + 1, `ledger row ${index} sequence matches`);
    assert.equal(row.hash, source.migrations[index]!.hash, `ledger row ${index} SQL hash matches the official file`);
    assert.equal(Number(row.created_at), source.journal.entries[index]!.when, `ledger row ${index} timestamp matches the exact journal`);
  });
}

async function assertExpectedSchema(pool: Pool) {
  const tables = Object.values(schema) as AnyPgTable[];
  const expectedTables = tables.map(getTableName).sort();
  const actualTables = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  assert.deepEqual(actualTables.rows.map((row) => row.table_name), expectedTables, "public table set matches the Drizzle application schema exactly");
  const expectedColumns = new Map<string, string[]>(tables.map((table) => [
    getTableName(table), getTableConfig(table).columns.map((column) => column.name).sort(),
  ]));
  const actualColumnRows = await pool.query<{ table_name: string; column_name: string }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name",
  );
  const actualColumns = new Map<string, string[]>();
  for (const row of actualColumnRows.rows) actualColumns.set(row.table_name, [...(actualColumns.get(row.table_name) ?? []), row.column_name]);
  assert.deepEqual([...actualColumns.entries()].sort(), [...expectedColumns.entries()].sort(), "public columns match the Drizzle application schema exactly");
  const indexes = await pool.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'");
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  for (const name of ["payments_payment_request_uq", "payments_cash_idempotency_uq", "payment_allocations_payment_due_uq", "payment_reversals_payment_uq", "active_due_settlements_payment_due_uq"]) {
    assert.ok(indexNames.has(name), `required payment index ${name} exists`);
  }
  const constraints = await pool.query<{ conname: string }>("SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace");
  const constraintNames = new Set(constraints.rows.map((row) => row.conname));
  for (const name of ["payments_method_source_consistent", "payments_cash_idempotency_consistent", "payment_allocations_positive_amount", "active_due_settlements_positive_amount"]) {
    assert.ok(constraintNames.has(name), `required payment constraint ${name} exists`);
  }
}

function freshCredentials(): R2StagingFixtureCredentials {
  return {
    residentPin: String(randomInt(0, 1_000_000)).padStart(6, "0"),
    chairmanPassword: randomBytes(32).toString("base64url"),
    treasurerPassword: randomBytes(32).toString("base64url"),
    systemAdminPassword: randomBytes(32).toString("base64url"),
  };
}

async function syntheticPrincipals(database: AppDatabase) {
  const units = await database.select({ id: rtUnits.id }).from(rtUnits).where(eq(rtUnits.code, "R2-SYNTH-01")).limit(2);
  assert.equal(units.length, 1, "exact synthetic RT is present");
  const rtUnitId = units[0]!.id;
  const residents = await database.select({ id: appAccounts.id, authUserId: appAccounts.authUserId, householdId: appAccounts.householdId, personId: appAccounts.personId })
    .from(appAccounts).where(and(eq(appAccounts.rtUnitId, rtUnitId), eq(appAccounts.accountType, "resident"), eq(appAccounts.loginIdentifier, "R2-101"))).limit(2);
  const treasurers = await database.select({ id: appAccounts.id, authUserId: appAccounts.authUserId, personId: appAccounts.personId })
    .from(appAccounts).where(and(eq(appAccounts.rtUnitId, rtUnitId), eq(appAccounts.accountType, "official"), eq(appAccounts.loginIdentifier, "r2-treasurer"))).limit(2);
  assert.equal(residents.length, 1, "exact synthetic resident is present");
  assert.equal(treasurers.length, 1, "exact synthetic treasurer is present");
  const resident = residents[0]!;
  const treasurer = treasurers[0]!;
  assert.ok(resident.householdId && resident.personId && treasurer.personId, "synthetic payment actors have complete scopes");
  const residentPrincipal: Principal = { authUserId: resident.authUserId, appAccountId: resident.id, role: "resident", rtUnitId, householdId: resident.householdId, personId: resident.personId };
  const treasurerPrincipal: Principal = { authUserId: treasurer.authUserId, appAccountId: treasurer.id, role: "treasurer", rtUnitId, householdId: null, personId: treasurer.personId };
  return { householdId: resident.householdId, residentPrincipal, treasurerPrincipal };
}

async function assertAccounting(pool: Pool, reversed: boolean) {
  const result = await pool.query<{
    payments: number; payment_total: string; allocations: number; allocation_total: string;
    settlements: number; settlement_total: string; reversals: number; reversed_total: string;
    requests: number; verified_requests: number; claims: number; paid_dues: number; paid_total: string;
    unpaid_dues: number; unpaid_total: string;
  }>(`
    SELECT
      (SELECT count(*)::int FROM payments) payments,
      (SELECT coalesce(sum(amount),0)::text FROM payments) payment_total,
      (SELECT count(*)::int FROM payment_allocations) allocations,
      (SELECT coalesce(sum(amount),0)::text FROM payment_allocations) allocation_total,
      (SELECT count(*)::int FROM active_due_settlements) settlements,
      (SELECT coalesce(sum(amount),0)::text FROM active_due_settlements) settlement_total,
      (SELECT count(*)::int FROM payment_reversals) reversals,
      (SELECT coalesce(sum(payment.amount),0)::text FROM payment_reversals reversal JOIN payments payment ON payment.id = reversal.payment_id) reversed_total,
      (SELECT count(*)::int FROM payment_requests) requests,
      (SELECT count(*)::int FROM payment_requests WHERE status = 'verified') verified_requests,
      (SELECT count(*)::int FROM payment_request_claims) claims,
      (SELECT count(*)::int FROM monthly_dues WHERE status = 'paid') paid_dues,
      (SELECT coalesce(sum(amount),0)::text FROM monthly_dues WHERE status = 'paid') paid_total,
      (SELECT count(*)::int FROM monthly_dues WHERE status = 'unpaid') unpaid_dues,
      (SELECT coalesce(sum(amount),0)::text FROM monthly_dues WHERE status = 'unpaid') unpaid_total
  `);
  const row = result.rows[0]!;
  const expected = reversed
    ? [2, 150000, 3, 150000, 2, 100000, 1, 50000, 1, 1, 0, 2, 100000, 10, 500000]
    : [2, 150000, 3, 150000, 3, 150000, 0, 0, 1, 1, 0, 3, 150000, 9, 450000];
  assert.deepEqual([
    row.payments, Number(row.payment_total), row.allocations, Number(row.allocation_total),
    row.settlements, Number(row.settlement_total), row.reversals, Number(row.reversed_total),
    row.requests, row.verified_requests, row.claims, row.paid_dues, Number(row.paid_total), row.unpaid_dues, Number(row.unpaid_total),
  ], expected, "payment, allocation, settlement, reversal, and dues totals are balanced");

  const details = await pool.query<{ method: string; amount: string; allocation_count: number; allocated: string; active_count: number; reversed: boolean }>(`
    SELECT payment.method, payment.amount::text AS amount,
      (SELECT count(*)::int FROM payment_allocations a WHERE a.payment_id = payment.id) allocation_count,
      (SELECT coalesce(sum(a.amount),0)::text FROM payment_allocations a WHERE a.payment_id = payment.id) allocated,
      (SELECT count(*)::int FROM active_due_settlements s WHERE s.payment_id = payment.id) active_count,
      EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = payment.id) reversed
    FROM payments payment ORDER BY payment.method
  `);
  assert.equal(details.rows.length, 2, "history has exactly one transfer and one cash payment");
  const transfer = details.rows.find((payment) => payment.method === "transfer");
  const cash = details.rows.find((payment) => payment.method === "cash");
  assert.ok(transfer && cash);
  assert.deepEqual([Number(transfer.amount), transfer.allocation_count, Number(transfer.allocated), transfer.active_count, transfer.reversed], [100000, 2, 100000, 2, false]);
  assert.deepEqual([Number(cash.amount), cash.allocation_count, Number(cash.allocated), cash.active_count, cash.reversed], [50000, 1, 50000, reversed ? 0 : 1, reversed]);
  const audits = await pool.query<{ action: string; count: number }>(`
    SELECT action, count(*)::int AS count FROM audit_events
    WHERE action IN ('payment_request.verified','payment.cash_recorded','payment.reversed') GROUP BY action ORDER BY action COLLATE "C"
  `);
  const expectedAudits = [
    { action: "payment.cash_recorded", count: 1 },
    ...(reversed ? [{ action: "payment.reversed", count: 1 }] : []),
    { action: "payment_request.verified", count: 1 },
  ];
  assert.deepEqual(audits.rows, expectedAudits, "verification, cash, and reversal each have the expected audit entry");
}
async function runRecoveryPass(connectionString: string, pass: string): Promise<PassEvidence> {
  const pool = makePool(connectionString, `krt-r2-recovery-${pass}`);
  const database = drizzlePostgres(pool, { schema: relationalSchema }) as unknown as AppDatabase;
  try {
    const source = readOfficialMigrations();
    const server = await pool.query<{ current_database: string; server_version_num: number }>(
      "SELECT current_database(), current_setting('server_version_num')::int AS server_version_num",
    );
    assertPostgresMajor18(server.rows[0]!.server_version_num);
    assert.ok(server.rows[0]!.current_database.startsWith(prefix), "application migrations only run in the generated database");
    await migrate(drizzlePostgres(pool, { schema: relationalSchema }), { migrationsFolder: migrationDir });
    await assertMigrationLedger(pool, source);
    await assertExpectedSchema(pool);

    const credentials = freshCredentials();
    const seeded = await bootstrapR2SyntheticFixture(database, credentials, fixtureDate);
    assert.equal(seeded.status, "created");
    assert.deepEqual(seeded.counts, { rtUnits: 1, residents: 1, treasurers: 1, chairmen: 1, systemAdmins: 1, billingYears: 1, feeRates: 1, monthlyDues: 12 });
    const fixtureReplay = await bootstrapR2SyntheticFixture(database, credentials, fixtureDate);
    assert.equal(fixtureReplay.status, "already_present", "same fixture credentials replay idempotently");
    assert.deepEqual(fixtureReplay.counts, seeded.counts);
    const wrongPin = credentials.residentPin === "000000" ? "000001" : "000000";
    await assert.rejects(
      bootstrapR2SyntheticFixture(database, { ...credentials, residentPin: wrongPin }, fixtureDate),
      /credentials do not match/,
      "edited fixture credentials are rejected without mutating the synthetic target",
    );

    const principals = await syntheticPrincipals(database);
    const requestInput = { period: "2027-02", idempotencyKey: randomUUID() };
    const request = await createResidentPaymentRequest(database, principals.residentPrincipal, requestInput, transferDate);
    assert.deepEqual(request.periods, ["2027-01", "2027-02"]);
    assert.equal(request.totalAmount, 100_000);
    const requestReplay = await createResidentPaymentRequest(database, principals.residentPrincipal, requestInput, transferDate);
    assert.equal(requestReplay.idempotentReplay, true);
    assert.equal(requestReplay.requestCode, request.requestCode);
    const verified = await verifyTreasurerPaymentRequest(database, principals.treasurerPrincipal, request.requestCode, transferDate);
    assert.equal(verified.status, "verified");
    assert.equal(verified.totalAmount, 100_000);
    await assert.rejects(
      verifyTreasurerPaymentRequest(database, principals.treasurerPrincipal, request.requestCode, transferDate),
      (error: unknown) => error instanceof TreasurerPaymentRequestAlreadyProcessedError,
      "a verified request cannot be posted twice",
    );

    const cashInput = { householdId: principals.householdId, period: "2027-03", idempotencyKey: randomUUID() };
    const cash = await recordTreasurerCashPayment(database, principals.treasurerPrincipal, cashInput, cashDate);
    assert.equal(cash.totalAmount, 50_000);
    assert.deepEqual(cash.periods, ["2027-03"]);
    const cashReplay = await recordTreasurerCashPayment(database, principals.treasurerPrincipal, cashInput, cashDate);
    assert.equal(cashReplay.replayed, true, "same-key cash retry is idempotently replayed");
    await assert.rejects(
      recordTreasurerCashPayment(database, principals.treasurerPrincipal, { ...cashInput, period: "2027-04" }, cashDate),
      (error: unknown) => error instanceof CashPaymentIdempotencyConflictError,
      "reusing a cash idempotency key for another period is rejected",
    );
    await assertAccounting(pool, false);

    const cashRows = await database.select({ id: payments.id }).from(payments).where(eq(payments.cashIdempotencyKey, cashInput.idempotencyKey)).limit(2);
    assert.equal(cashRows.length, 1, "cash retry retained one payment row");
    const reversal = await reverseTreasurerPayment(database, principals.treasurerPrincipal, {
      paymentId: cashRows[0]!.id,
      reason: "Synthetic disposable recovery rehearsal",
    }, reversalDate);
    assert.equal(reversal.status, "reversed");
    assert.equal(reversal.totalAmount, 50_000);
    await assert.rejects(
      reverseTreasurerPayment(database, principals.treasurerPrincipal, { paymentId: cashRows[0]!.id, reason: "Duplicate synthetic reversal check" }, reversalDate),
      (error: unknown) => error instanceof TreasurerPaymentAlreadyReversedError,
      "a payment cannot be reversed twice",
    );
    await assertAccounting(pool, true);
    await assertMigrationLedger(pool, source);
    await assertExpectedSchema(pool);
    return { migrationEntries: source.migrations.length, fixtureCreated: true, fixtureIdempotentReplay: true };
  } finally {
    await pool.end();
  }
}

async function readAdminIdentity(pool: Pool) {
  const result = await pool.query<{
    current_database: string; current_user: string; server_version: string; server_version_num: number;
    role_superuser: boolean; in_recovery: boolean;
  }>(`
    SELECT current_database(), current_user, current_setting('server_version') AS server_version,
      current_setting('server_version_num')::int AS server_version_num,
      role.rolsuper AS role_superuser, pg_is_in_recovery() AS in_recovery
    FROM pg_roles role WHERE role.rolname = current_user
  `);
  const row = result.rows[0];
  assert.ok(row, "admin identity was read");
  assert.equal(row.current_database, "postgres");
  assert.equal(row.role_superuser, true, "admin must be superuser on the isolated disposable cluster");
  assert.equal(row.in_recovery, false, "admin target is a writable disposable PostgreSQL cluster");
  assertPostgresMajor18(row.server_version_num);
  return row;
}

async function createGeneratedDatabase(pool: Pool, state: GeneratedDb) {
  assert.match(state.name, /^krt_r2_recovery_[0-9a-f]{24}$/, "database name is generated with a private harness prefix");
  const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [state.name]);
  assert.equal(exists.rowCount, 0, "generated database name did not exist before creation");
  await pool.query(`CREATE DATABASE ${qid(state.name)} OWNER ${qid(state.owner)} TEMPLATE template0 ENCODING 'UTF8'`);
  state.created = true;
  await pool.query(`COMMENT ON DATABASE ${qid(state.name)} IS ${qlit(state.marker)}`);
}

async function dropGeneratedDatabase(pool: Pool, state: GeneratedDb) {
  if (!state.created) return;
  assert.match(state.name, /^krt_r2_recovery_[0-9a-f]{24}$/, "refuse to drop a database outside this harness prefix");
  const result = await pool.query<{ owner: string; marker: string | null }>(`
    SELECT pg_get_userbyid(datdba) AS owner, shobj_description(oid,'pg_database') AS marker
    FROM pg_database WHERE datname = $1
  `, [state.name]);
  assert.equal(result.rows.length, 1, "generated database is present before drop");
  assert.equal(result.rows[0]!.owner, state.owner, "generated database remains owned by this run's admin role");
  assert.ok(result.rows[0]!.marker === state.marker || result.rows[0]!.marker === null, "generated database has this run's marker or was interrupted before marking");
  await pool.query(`DROP DATABASE ${qid(state.name)}`);
  state.created = false;
}
function writeEvidence(sha: string, postgresVersion: string, passes: PassEvidence[], clean: boolean) {
  const evidence = {
    schemaVersion: 1,
    event: "karturt.r2.disposable_pg18_rebuild_recovery",
    generatedAt: new Date().toISOString(),
    result: "PASS",
    sourceSha: sha,
    workingTreeClean: clean,
    postgresMajor: 18,
    postgresVersion,
    migrationTags,
    migrationsPerPass: passes.map((pass) => pass.migrationEntries),
    generatedDatabaseDropsAndRebuilds: 1,
    syntheticFixtureCreatedAndReplayedOnBothPasses: passes.every((pass) => pass.fixtureCreated && pass.fixtureIdempotentReplay),
    paymentProof: {
      transferAmount: 100_000,
      cashAmount: 50_000,
      cashPaymentReversed: true,
      activeSettlementsAfterReversal: 2,
      paidDuesAfterReversal: 2,
      retriesAndDuplicateReversalRejectedOrReplayed: true,
    },
    neonPitr: "NOT_TESTED",
    productionRecovery: "NOT_TESTED",
    scope: "Disposable PostgreSQL 18 synthetic reconstruction only; no live staging or production database was used.",
  };
  const directory = process.env.RUNNER_TEMP || tmpdir();
  mkdirSync(directory, { recursive: true });
  const output = join(directory, `r2-disposable-pg18-recovery-${sha}-${randomUUID().slice(0, 8)}.json`);
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const summary = [
    "## R2 disposable PostgreSQL 18 reconstruction",
    "",
    `- Result: PASS (${sha})`,
    `- PostgreSQL: ${postgresVersion} (major 18)`,
    `- Checked-out source tree clean: ${clean}.`,
    "- Official Drizzle migrations 0000–0015: exact journal and schema verified on both builds.",
    "- Synthetic fixture: freshly generated credentials, idempotent replay, payment/dues accounting, and reversal checks passed on both builds.",
    "- Recovery: the generated database was dropped and recreated, then migrated and reseeded successfully.",
    "- Neon PITR: NOT TESTED.",
    "- Production recovery: NOT TESTED.",
    "",
    "This proves disposable PostgreSQL 18 reconstruction only.",
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  process.stdout.write(`${summary}\nSanitized evidence written under the runner temporary directory.\n`);
}

async function main() {
  checkSafetyGuards();
  const sha = sourceSha();
  const clean = workingTreeIsClean();
  const target = parseAdminTarget(process.env.R2_DISPOSABLE_PG18_ADMIN_URL);
  const pool = makePool(target.toString(), "krt-r2-recovery-admin", 1);
  const state: GeneratedDb = {
    created: false,
    name: `${prefix}${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    marker: `karturt-r2-disposable-pg18-recovery:v1:${randomUUID()}:${sha}`,
    owner: "",
  };
  let failure: unknown;
  let cleanupFailure: unknown;
  let first: PassEvidence | undefined;
  let rebuilt: PassEvidence | undefined;
  let version = "unknown";
  try {
    const identity = await readAdminIdentity(pool);
    state.owner = identity.current_user;
    version = identity.server_version;
    await createGeneratedDatabase(pool, state);
    const firstUrl = new URL(target.toString());
    firstUrl.pathname = `/${state.name}`;
    first = await runRecoveryPass(firstUrl.toString(), "initial");

    await dropGeneratedDatabase(pool, state);
    await createGeneratedDatabase(pool, state);
    const rebuiltUrl = new URL(target.toString());
    rebuiltUrl.pathname = `/${state.name}`;
    rebuilt = await runRecoveryPass(rebuiltUrl.toString(), "rebuilt");
    await dropGeneratedDatabase(pool, state);
  } catch (error) {
    failure = error;
  }
  try {
    await dropGeneratedDatabase(pool, state);
  } catch (error) {
    cleanupFailure = error;
  }
  await pool.end();
  if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], "Disposable PG18 recovery failed and generated-database cleanup also failed.");
  if (failure) throw failure;
  if (cleanupFailure) throw cleanupFailure;
  assert.ok(first && rebuilt, "both initial and rebuilt recovery passes completed");
  writeEvidence(sha, version, [first, rebuilt], clean);
}

function isMainModule() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Disposable PG18 recovery failed."}\n`);
    process.exitCode = 1;
  });
}
