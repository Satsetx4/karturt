import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import type { AppDatabase } from "@/db/client";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  billingYears,
  houses,
  households,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentReversals,
  paymentRequestClaims,
  paymentRequests,
  payments,
  relationalSchema,
  waiverActions,
  waiverItems,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createResidentAuthRecords } from "@/lib/accounts/resident-auth-records";
import { createChairmanWaiver, ChairmanWaiverConflictError } from "@/lib/billing/chairman-waiver";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import {
  recordTreasurerCashPayment,
} from "@/lib/billing/treasurer-cash-payments";
import {
  TreasurerPaymentAlreadyReversedError,
  reverseTreasurerPayment,
} from "@/lib/billing/treasurer-payment-reversal";
import {
  TreasurerPaymentRequestAlreadyProcessedError,
  verifyTreasurerPaymentRequest,
} from "@/lib/billing/treasurer-payment-verification";
import {
  HouseholdConflictError,
  replaceHouseholdResident,
} from "@/lib/households/lifecycle";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
} from "../tests/helpers/database";

type FixtureDatabase = Awaited<ReturnType<typeof createTestDatabase>>["db"];
type Settled<T> = PromiseSettledResult<T>;
type ActivityRow = {
  pid: number;
  application_name: string;
  state: string;
  wait_event_type: string | null;
  wait_event: string | null;
};
type DbPool = InstanceType<typeof Pool>;

const businessDate = "2026-10-04";
const lockHoldSeconds = 0.8;
const activityWaitMilliseconds = 8_000;
const runId = randomUUID().replaceAll("-", "").slice(0, 10);
const appNameA = `krt-launch-${runId}-a`;
const appNameB = `krt-launch-${runId}-b`;
let localDatabaseUrl: string;

function validateDatabaseUrl(value: string | undefined) {
  if (!value) {
    throw new Error("LAUNCH_SAFETY_POSTGRES_URL is required; the independent PostgreSQL suite fails closed.");
  }

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error("LAUNCH_SAFETY_POSTGRES_URL is malformed; no database connection was opened.");
  }

  const databaseName = target.pathname.replace(/^\//, "");
  const allowedHost = target.hostname === "127.0.0.1";
  const allowedTarget = target.protocol === "postgresql:"
    && allowedHost
    && target.port === "5432"
    && databaseName === "karturt_concurrency_test"
    && decodeURIComponent(target.username) === "karturt_concurrency_test"
    && target.password.length > 0
    && target.search.length === 0
    && target.hash.length === 0;

  if (!allowedTarget || process.env.APP_ENV !== "test" || process.env.DATABASE_ENV !== "test") {
    throw new Error("PostgreSQL concurrency requires the isolated loopback karturt_concurrency_test target with APP_ENV=test and DATABASE_ENV=test; no database connection was opened.");
  }

  return value;
}

function makePool(applicationName: string, max: number): DbPool {
  return new Pool({
    connectionString: localDatabaseUrl,
    application_name: applicationName,
    max,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 5_000,
  });
}

const migrationsDirectory = resolve(process.cwd(), "drizzle");
const evidencePath = resolve(process.cwd(), "docs/launch-safety-evidence/postgres-independent-concurrency.json");
const migrationNames = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
if (migrationNames.length !== 14 || migrationNames.at(-1) !== "0013_phase_12_household_management.sql") {
  throw new Error("Concurrency proof requires the checked-in 0000–0013 migration set.");
}

let observerPool: DbPool;
let fixturePool: DbPool;
let poolA: DbPool;
let poolB: DbPool;
let fixtureDatabase: FixtureDatabase;
let databaseA: AppDatabase;
let databaseB: AppDatabase;
let fixtureDatabaseAsApp: AppDatabase;

function principal(
  userId: string,
  accountId: string,
  role: Principal["role"],
  rtUnitId: string,
  personId: string,
  householdId: string | null = null,
): Principal {
  return {
    authUserId: userId,
    appAccountId: accountId,
    role,
    rtUnitId,
    householdId,
    personId,
  };
}

async function createOfficial(
  rtUnitId: string,
  householdPersonId: string,
  role: "treasurer" | "rt_chairman",
) {
  const user = await createAuthUser(fixtureDatabase, `Concurrency ${role}`);
  const [account] = await fixtureDatabase.insert(appAccounts).values({
    rtUnitId,
    authUserId: user.id,
    accountType: "official",
    loginIdentifier: `${role}-${randomUUID()}`,
    personId: householdPersonId,
  }).returning({ id: appAccounts.id });
  assert.ok(account, `${role} account fixture is created`);
  await fixtureDatabase.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: account.id,
    role,
    startsOn: "2020-01-01",
  });
  return {
    accountId: account.id,
    principal: principal(user.id, account.id, role, rtUnitId, householdPersonId),
  };
}

async function createFinancialScenario(months: number[] = [1, 2]) {
  const rtUnitId = await createRt(fixtureDatabase);
  const household = await createHousehold(fixtureDatabase, rtUnitId, {
    number: `PG-${randomUUID().slice(0, 8)}`,
  });
  const resident = await createAuthUser(fixtureDatabase, "Concurrency Resident");
  const [residentAccount] = await fixtureDatabase.insert(appAccounts).values({
    rtUnitId,
    authUserId: resident.id,
    accountType: "resident",
    loginIdentifier: `resident-${randomUUID()}`,
    personId: household.personId,
    householdId: household.householdId,
  }).returning({ id: appAccounts.id });
  assert.ok(residentAccount, "resident account fixture is created");

  const treasurer = await createOfficial(rtUnitId, household.personId, "treasurer");
  const chairman = await createOfficial(rtUnitId, household.personId, "rt_chairman");
  const [year] = await fixtureDatabase.insert(billingYears).values({
    rtUnitId,
    year: 2026,
    status: "open",
  }).returning({ id: billingYears.id });
  assert.ok(year, "billing year fixture is created");
  const [feeRate] = await createFeeRateFixture(fixtureDatabase, {
    rtUnitId,
    billingYearId: year.id,
    effectiveMonth: 1,
    monthlyAmount: 40_000,
  });
  assert.ok(feeRate, "fee rate fixture is created");
  const dues = await fixtureDatabase.insert(monthlyDues).values(months.map((month) => ({
    rtUnitId,
    householdId: household.householdId,
    billingYearId: year.id,
    feeRateId: feeRate.id,
    month,
    amount: 40_000,
    dueDate: `2026-${String(month).padStart(2, "0")}-10`,
    status: "unpaid" as const,
  }))).returning({ id: monthlyDues.id, month: monthlyDues.month });

  return {
    rtUnitId,
    household,
    residentPrincipal: principal(resident.id, residentAccount.id, "resident", rtUnitId, household.personId, household.householdId),
    treasurerPrincipal: treasurer.principal,
    treasurerAccountId: treasurer.accountId,
    chairmanPrincipal: chairman.principal,
    chairmanAccountId: chairman.accountId,
    dueIds: dues.map((due) => due.id),
    dueIdsByMonth: new Map(dues.map((due) => [due.month, due.id])),
  };
}

async function applyMigrations(pool: DbPool) {
  const { rows } = await pool.query<{ current_database: string; server_version: string; server_version_num: string }>(
    "SELECT current_database() AS current_database, current_setting('server_version') AS server_version, current_setting('server_version_num') AS server_version_num",
  );
  assert.equal(rows[0]?.current_database, "karturt_concurrency_test", "refuse to migrate a database outside the disposable test target");
  const { rows: existingSchema } = await pool.query<{ exists: string | null }>(
    "SELECT to_regclass('public.rt_units')::text AS exists",
  );
  assert.equal(existingSchema[0]?.exists, null, "the disposable PostgreSQL test database must start empty");

  for (const name of migrationNames) {
    await pool.query(readFileSync(resolve(migrationsDirectory, name), "utf8"));
  }
  return { version: rows[0]!.server_version, versionNumber: rows[0]!.server_version_num };
}

async function backendPid(pool: DbPool) {
  const { rows } = await pool.query<{ pid: number }>("SELECT pg_backend_pid()::int AS pid");
  assert.ok(rows[0]?.pid, "the PostgreSQL backend PID is returned");
  return rows[0].pid;
}

async function currentActivity() {
  const { rows } = await observerPool.query<ActivityRow>(`
    SELECT pid::int, application_name, state, wait_event_type, wait_event
    FROM pg_stat_activity
    WHERE application_name = ANY($1::text[])
  `, [[appNameA, appNameB]]);
  return rows;
}

async function waitForActivity(
  predicate: (row: ActivityRow) => boolean,
  expectation: string,
) {
  const deadline = Date.now() + activityWaitMilliseconds;
  let latest: ActivityRow[] = [];
  while (Date.now() < deadline) {
    latest = await currentActivity();
    const match = latest.find(predicate);
    if (match) return match;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  const summary = latest.map(({ pid, application_name, state, wait_event_type, wait_event }) => ({
    pid,
    application_name,
    state,
    wait_event_type,
    wait_event,
  }));
  throw new Error(`PostgreSQL did not show ${expectation}; observed activity: ${JSON.stringify(summary)}`);
}

type DelayTrigger = {
  table: "payments" | "payment_reversals" | "waiver_actions" | "households";
  event: "BEFORE INSERT" | "BEFORE UPDATE OF status";
  condition?: string;
};

async function installLockHoldingTrigger(config: DelayTrigger) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const functionName = `launch_safety_hold_${suffix}`;
  const triggerName = `launch_safety_hold_${suffix}_trigger`;
  const condition = config.condition ? `IF ${config.condition} THEN` : "";
  const finishCondition = config.condition ? "END IF;" : "";
  await fixturePool.query(`
    CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      ${condition}
        PERFORM pg_sleep(${lockHoldSeconds});
      ${finishCondition}
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER ${triggerName}
      ${config.event} ON public.${config.table}
      FOR EACH ROW EXECUTE FUNCTION public.${functionName}();
  `);
  return async () => {
    await fixturePool.query(`
      DROP TRIGGER ${triggerName} ON public.${config.table};
      DROP FUNCTION public.${functionName}();
    `);
  };
}

async function proveContendedRace<T>(input: {
  name: string;
  trigger: DelayTrigger;
  first: () => Promise<T>;
  second: () => Promise<T>;
}): Promise<{ outcomes: [Settled<T>, Settled<T>]; lockWait: Record<string, unknown> }> {
  const removeTrigger = await installLockHoldingTrigger(input.trigger);
  let firstAttempt: Promise<T> | undefined;
  let secondAttempt: Promise<T> | undefined;
  try {
    firstAttempt = input.first();
    const sleeping = await waitForActivity(
      (row) => row.pid === pidA && row.wait_event === "PgSleep",
      `${appNameA} holding the target row/advisory lock inside a PostgreSQL trigger`,
    );
    secondAttempt = input.second();
    const blocked = await waitForActivity(
      (row) => row.pid === pidB && row.wait_event_type === "Lock",
      `${appNameB} waiting on PostgreSQL lock contention while ${appNameA} holds the lock`,
    );
    const outcomes = await Promise.allSettled([firstAttempt, secondAttempt]) as [Settled<T>, Settled<T>];
    return {
      outcomes,
      lockWait: {
        observed: true,
        firstBackendPid: sleeping.pid,
        firstWaitEvent: sleeping.wait_event,
        secondBackendPid: blocked.pid,
        secondWaitEventType: blocked.wait_event_type,
        secondWaitEvent: blocked.wait_event,
      },
    };
  } catch (error) {
    await Promise.allSettled([firstAttempt, secondAttempt].filter((attempt): attempt is Promise<T> => Boolean(attempt)));
    throw error;
  } finally {
    await removeTrigger();
  }
}

function outcomeNames(outcomes: [Settled<unknown>, Settled<unknown>]) {
  return outcomes.map((outcome) => outcome.status === "fulfilled"
    ? "fulfilled"
    : outcome.reason instanceof Error ? outcome.reason.name : "rejected");
}

function safeOutcomeSummary(outcomes: [Settled<unknown>, Settled<unknown>]) {
  return outcomes.map((outcome) => {
    if (outcome.status === "fulfilled") return { status: "fulfilled" };
    let current: unknown = outcome.reason;
    let postgresCode: string | null = null;
    for (let depth = 0; depth < 4 && current; depth += 1) {
      if (typeof current !== "object" || current === null) break;
      const candidate = current as { code?: unknown; cause?: unknown };
      if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
        postgresCode = candidate.code;
        break;
      }
      current = candidate.cause;
    }
    return {
      status: "rejected",
      errorName: outcome.reason instanceof Error ? outcome.reason.name : "UnknownError",
      postgresCode,
    };
  });
}

function assertFulfilledCount(
  outcomes: [Settled<unknown>, Settled<unknown>],
  expected: number,
  scenario: string,
) {
  const actual = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
  assert.equal(actual, expected, `${scenario}: expected ${expected} fulfilled outcome(s); observed ${JSON.stringify(safeOutcomeSummary(outcomes))}`);
}

async function testConcurrentVerification() {
  const scenario = await createFinancialScenario();
  const request = await createResidentPaymentRequest(databaseA, scenario.residentPrincipal, {
    period: "2026-02",
    idempotencyKey: randomUUID(),
  });
  const race = await proveContendedRace({
    name: "duplicate_payment_request_verification",
    trigger: { table: "payments", event: "BEFORE INSERT", condition: "NEW.method = 'transfer'" },
    first: () => verifyTreasurerPaymentRequest(databaseA, scenario.treasurerPrincipal, request.requestCode, businessDate),
    second: () => verifyTreasurerPaymentRequest(databaseB, scenario.treasurerPrincipal, request.requestCode, businessDate),
  });
  assertFulfilledCount(race.outcomes, 1, "duplicate_payment_request_verification");
  const rejected = race.outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof TreasurerPaymentRequestAlreadyProcessedError);

  const [requestRow] = await fixtureDatabase.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, request.requestCode));
  assert.equal(requestRow?.status, "verified");
  const paymentRows = await fixtureDatabase.select().from(payments)
    .where(eq(payments.paymentRequestId, requestRow!.id));
  assert.equal(paymentRows.length, 1);
  const allocations = await fixtureDatabase.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentRequestId, requestRow!.id));
  assert.equal(allocations.length, 2);
  assert.equal(allocations.reduce((sum, row) => sum + row.amount, 0), 80_000);
  assert.equal((await fixtureDatabase.select().from(paymentRequestClaims)
    .where(eq(paymentRequestClaims.requestId, requestRow!.id))).length, 0);
  assert.equal((await fixtureDatabase.select().from(auditEvents).where(and(
    eq(auditEvents.action, "payment_request.verified"),
    eq(auditEvents.entityId, requestRow!.id),
  ))).length, 1);

  return {
    name: "duplicate_payment_request_verification",
    result: "PASS",
    outcomes: outcomeNames(race.outcomes),
    persisted: { requestsVerified: 1, payments: 1, allocations: 2, allocationAmount: 80_000, verificationAudits: 1, openClaims: 0 },
    lockWait: race.lockWait,
  };
}

async function testSameKeyCashRetry() {
  const scenario = await createFinancialScenario();
  const idempotencyKey = randomUUID();
  const input = {
    householdId: scenario.household.householdId,
    period: "2026-02",
    idempotencyKey,
  };
  const race = await proveContendedRace({
    name: "same_key_cash_retry",
    trigger: { table: "payments", event: "BEFORE INSERT", condition: "NEW.method = 'cash'" },
    first: () => recordTreasurerCashPayment(databaseA, scenario.treasurerPrincipal, input, businessDate),
    second: () => recordTreasurerCashPayment(databaseB, scenario.treasurerPrincipal, input, businessDate),
  });
  assertFulfilledCount(race.outcomes, 2, "same_key_cash_retry");
  const results = race.outcomes.map((outcome) => outcome.status === "fulfilled" ? outcome.value : null);
  assert.deepEqual(results.map((result) => result?.replayed).sort(), [false, true]);

  const paymentRows = await fixtureDatabase.select().from(payments)
    .where(eq(payments.cashIdempotencyKey, idempotencyKey));
  assert.equal(paymentRows.length, 1);
  assert.equal(paymentRows[0]?.amount, 80_000);
  const allocations = await fixtureDatabase.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, paymentRows[0]!.id));
  assert.equal(allocations.length, 2);
  assert.equal(allocations.reduce((sum, row) => sum + row.amount, 0), 80_000);
  const dueRows = await fixtureDatabase.select().from(monthlyDues).where(inArray(monthlyDues.id, scenario.dueIds));
  assert.equal(dueRows.length, 2);
  assert.ok(dueRows.every((due) => due.status === "paid"));
  assert.equal((await fixtureDatabase.select().from(activeDueSettlements)
    .where(inArray(activeDueSettlements.monthlyDueId, scenario.dueIds))).length, 2);
  assert.equal((await fixtureDatabase.select().from(auditEvents).where(and(
    eq(auditEvents.action, "payment.cash_recorded"),
    eq(auditEvents.entityId, paymentRows[0]!.id),
  ))).length, 1);

  return {
    name: "same_key_cash_retry",
    result: "PASS",
    outcomes: outcomeNames(race.outcomes),
    replayFlags: results.map((result) => result?.replayed),
    persisted: { payments: 1, allocations: 2, allocationAmount: 80_000, paidDues: 2, activeSettlements: 2, cashAudits: 1 },
    lockWait: race.lockWait,
  };
}

async function testConcurrentReversal() {
  const scenario = await createFinancialScenario([1]);
  const idempotencyKey = randomUUID();
  const cash = await recordTreasurerCashPayment(databaseA, scenario.treasurerPrincipal, {
    householdId: scenario.household.householdId,
    period: "2026-01",
    idempotencyKey,
  }, businessDate);
  assert.equal(cash.status, "recorded");
  const [payment] = await fixtureDatabase.select().from(payments)
    .where(eq(payments.cashIdempotencyKey, idempotencyKey));
  assert.ok(payment, "cash payment fixture exists before reversal race");

  const race = await proveContendedRace({
    name: "same_payment_concurrent_reversal",
    trigger: { table: "payment_reversals", event: "BEFORE INSERT" },
    first: () => reverseTreasurerPayment(databaseA, scenario.treasurerPrincipal, {
      paymentId: payment.id,
      reason: "Concurrency reversal A",
    }, businessDate),
    second: () => reverseTreasurerPayment(databaseB, scenario.treasurerPrincipal, {
      paymentId: payment.id,
      reason: "Concurrency reversal B",
    }, businessDate),
  });
  assertFulfilledCount(race.outcomes, 1, "same_payment_concurrent_reversal");
  const rejected = race.outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof TreasurerPaymentAlreadyReversedError);

  assert.equal((await fixtureDatabase.select().from(paymentReversals)
    .where(eq(paymentReversals.paymentId, payment.id))).length, 1);
  assert.equal((await fixtureDatabase.select().from(activeDueSettlements)
    .where(eq(activeDueSettlements.paymentId, payment.id))).length, 0);
  assert.equal((await fixtureDatabase.select().from(monthlyDues)
    .where(inArray(monthlyDues.id, scenario.dueIds))).filter((due) => due.status === "unpaid").length, 1);
  assert.equal((await fixtureDatabase.select().from(auditEvents).where(and(
    eq(auditEvents.action, "payment.reversed"),
    eq(auditEvents.entityId, payment.id),
  ))).length, 1);

  return {
    name: "same_payment_concurrent_reversal",
    result: "PASS",
    outcomes: outcomeNames(race.outcomes),
    persisted: { originalPayments: 1, reversals: 1, activeSettlements: 0, unpaidDues: 1, reversalAudits: 1 },
    lockWait: race.lockWait,
  };
}

async function testConcurrentWaiver() {
  const scenario = await createFinancialScenario([1]);
  const create = (database: AppDatabase, suffix: string) => createChairmanWaiver(database, scenario.chairmanPrincipal, {
    householdId: scenario.household.householdId,
    periods: ["2026-01"],
    reason: `Concurrency waiver ${suffix}`,
    idempotencyKey: randomUUID(),
  }, businessDate);
  const race = await proveContendedRace({
    name: "same_due_concurrent_waiver",
    trigger: { table: "waiver_actions", event: "BEFORE INSERT" },
    first: () => create(databaseA, "A"),
    second: () => create(databaseB, "B"),
  });
  assertFulfilledCount(race.outcomes, 1, "same_due_concurrent_waiver");
  const rejected = race.outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof ChairmanWaiverConflictError);

  const [due] = await fixtureDatabase.select().from(monthlyDues)
    .where(eq(monthlyDues.id, scenario.dueIds[0]!));
  assert.equal(due?.status, "waived");
  const actions = await fixtureDatabase.select().from(waiverActions)
    .where(eq(waiverActions.householdId, scenario.household.householdId));
  assert.equal(actions.length, 1);
  assert.equal((await fixtureDatabase.select().from(waiverItems)
    .where(eq(waiverItems.householdId, scenario.household.householdId))).length, 1);
  assert.equal((await fixtureDatabase.select().from(auditEvents).where(and(
    eq(auditEvents.action, "waiver.created"),
    eq(auditEvents.entityId, actions[0]!.id),
  ))).length, 1);
  assert.equal((await fixtureDatabase.select().from(activeDueSettlements)
    .where(eq(activeDueSettlements.monthlyDueId, scenario.dueIds[0]!))).length, 0);

  return {
    name: "same_due_concurrent_waiver",
    result: "PASS",
    outcomes: outcomeNames(race.outcomes),
    persisted: { waiverActions: 1, waiverItems: 1, waivedDues: 1, activeSettlements: 0, waiverAudits: 1 },
    lockWait: race.lockWait,
  };
}

async function testConcurrentHouseholdReplacement() {
  const rtUnitId = await createRt(fixtureDatabase);
  const resident = await createHousehold(fixtureDatabase, rtUnitId, {
    number: `LIFE-${randomUUID().slice(0, 8)}`,
  });
  const chairman = await createOfficial(rtUnitId, resident.personId, "rt_chairman");
  const [house] = await fixtureDatabase.select({ number: houses.number })
    .from(houses).where(eq(houses.id, resident.houseId));
  assert.ok(house, "lifecycle house fixture exists");
  await createResidentAuthRecords(fixtureDatabaseAsApp, {
    rtUnitId,
    householdId: resident.householdId,
    personId: resident.personId,
    loginIdentifier: house.number.toUpperCase(),
    fullName: "Concurrency Resident Before Replacement",
    pin: "482913",
  });
  const replace = (database: AppDatabase, fullName: string) => replaceHouseholdResident(database, chairman.principal, {
    householdId: resident.householdId,
    effectiveMonth: "2026-11",
    fullName,
    initialPin: "493821",
    reason: "Concurrency replacement proof",
  }, businessDate);

  const race = await proveContendedRace({
    name: "same_house_concurrent_resident_replacement",
    trigger: {
      table: "households",
      event: "BEFORE UPDATE OF status",
      condition: "OLD.status = 'active' AND NEW.status = 'inactive'",
    },
    first: () => replace(databaseA, "Replacement A"),
    second: () => replace(databaseB, "Replacement B"),
  });
  assertFulfilledCount(race.outcomes, 1, "same_house_concurrent_resident_replacement");
  const rejected = race.outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof HouseholdConflictError);

  const householdRows = await fixtureDatabase.select({ id: households.id, status: households.status })
    .from(households).where(and(
      eq(households.rtUnitId, rtUnitId),
      eq(households.houseId, resident.houseId),
    ));
  assert.equal(householdRows.length, 2);
  assert.equal(householdRows.filter((row) => row.status === "inactive").length, 1);
  assert.equal(householdRows.filter((row) => row.status === "active").length, 1);
  const replacementAudits = await fixtureDatabase.select().from(auditEvents).where(and(
    eq(auditEvents.action, "household.resident_replaced"),
    eq(auditEvents.entityId, resident.householdId),
  ));
  assert.equal(replacementAudits.length, 1);

  return {
    name: "same_house_concurrent_resident_replacement",
    result: "PASS",
    outcomes: outcomeNames(race.outcomes),
    persisted: { householdRowsForHouse: 2, inactiveHouseholds: 1, activeHouseholds: 1, replacementAudits: 1 },
    lockWait: race.lockWait,
  };
}

let pidA: number;
let pidB: number;

async function main() {
  localDatabaseUrl = validateDatabaseUrl(process.env.LAUNCH_SAFETY_POSTGRES_URL);
  observerPool = makePool(`krt-launch-${runId}-observer`, 2);
  fixturePool = makePool(`krt-launch-${runId}-fixtures`, 2);
  poolA = makePool(appNameA, 1);
  poolB = makePool(appNameB, 1);
  fixtureDatabase = drizzlePostgres(fixturePool, { schema: relationalSchema }) as unknown as FixtureDatabase;
  databaseA = drizzlePostgres(poolA, { schema: relationalSchema }) as unknown as AppDatabase;
  databaseB = drizzlePostgres(poolB, { schema: relationalSchema }) as unknown as AppDatabase;
  fixtureDatabaseAsApp = fixtureDatabase as unknown as AppDatabase;

  const postgresVersion = await applyMigrations(fixturePool);
  pidA = await backendPid(poolA);
  pidB = await backendPid(poolB);
  assert.notEqual(pidA, pidB, "two racing pools must use independent PostgreSQL backends");

  const checks = [];
  for (const [name, run] of [
    ["duplicate_payment_request_verification", testConcurrentVerification],
    ["same_key_cash_retry", testSameKeyCashRetry],
    ["same_payment_concurrent_reversal", testConcurrentReversal],
    ["same_due_concurrent_waiver", testConcurrentWaiver],
    ["same_house_concurrent_resident_replacement", testConcurrentHouseholdReplacement],
  ] as const) {
    process.stdout.write(`Running PostgreSQL race scenario: ${name}\n`);
    checks.push(await run());
  }
  for (const check of checks) assert.equal(check.result, "PASS");

  const evidence = {
    schemaVersion: 1,
    event: "launch_safety.independent_postgres_concurrency_proof",
    generatedAt: new Date().toISOString(),
    result: "PASS",
    databaseTarget: "disposable loopback PostgreSQL test database; URL redacted",
    postgresVersion,
    migrationsApplied: migrationNames.length,
    independentBackends: {
      connectionAPid: pidA,
      connectionBPid: pidB,
      distinct: pidA !== pidB,
      poolMaximumConnections: 1,
    },
    lockContentionObservedForEveryRace: checks.every((check) => (check.lockWait as { observed: boolean }).observed),
    scenarios: checks,
    sharedNeonWrites: 0,
    productionAccess: "none",
    migrationFilesChanged: 0,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

void main().finally(async () => {
  await Promise.allSettled([observerPool?.end(), fixturePool?.end(), poolA?.end(), poolB?.end()]);
}).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "PostgreSQL concurrency suite failed."}\n`);
  process.exitCode = 1;
});
