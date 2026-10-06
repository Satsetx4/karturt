import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import {
  appAccounts,
  billingYears,
  feeRates,
  houses,
  households,
  monthlyDues,
  paymentRequestItems,
  paymentRequests,
  payments,
  people,
  rtUnits,
} from "@/db/schema";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { requireDatabaseEnvironment } from "@/lib/env";

type Mode = "pending" | "paid";

const showcase = {
  paid: [
    { houseNumber: "D-01", periodMonth: 1, idempotencyKey: "600d0001-0000-4000-8000-000000000001" },
    { houseNumber: "D-02", periodMonth: 2, idempotencyKey: "600d0002-0000-4000-8000-000000000002" },
    { houseNumber: "D-03", periodMonth: 1, idempotencyKey: "600d0003-0000-4000-8000-000000000003" },
    { houseNumber: "C-01", periodMonth: 3, idempotencyKey: "600c0001-0000-4000-8000-000000000004" },
  ],
  pending: [
    { houseNumber: "D-07", periodMonth: 1, idempotencyKey: "400b3857-9509-4682-b149-a65c485f7ec9" },
    { houseNumber: "D-08", periodMonth: 2, idempotencyKey: "b7278c71-9da3-4a21-9ed9-df7da3d4246d" },
    { houseNumber: "C-07", periodMonth: 3, idempotencyKey: "fc4f60e8-8e35-4e36-920a-a98bb16f0e24" },
  ],
} satisfies Record<Mode, Array<{ houseNumber: string; periodMonth: number; idempotencyKey: string }>>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function modeFromArgs(): Mode {
  const mode = process.argv[2];
  assert(mode === "pending" || mode === "paid", "Run with exactly one mode: pending or paid.");
  return mode;
}

function period(month: number) {
  return `2026-${String(month).padStart(2, "0")}`;
}

function expectedPeriods(month: number) {
  return Array.from({ length: month }, (_, index) => period(index + 1));
}

async function main() {
  loadEnvConfig(process.cwd());
  const mode = modeFromArgs();
  const environment = requireDatabaseEnvironment();
  assert(
    environment.appEnv === "staging" && environment.databaseEnv === "staging",
    "Refusing financial demo mutations unless APP_ENV and DATABASE_ENV are both staging.",
  );
  assert(environment.databaseUrl, "The isolated demo DATABASE_URL is missing.");
  const target = new URL(environment.databaseUrl);
  assert(
    target.hostname.startsWith("ep-lingering-star-azj3l9mj") &&
      !target.hostname.includes("pooler") &&
      target.pathname === "/karturt_demo_20261006_final",
    "Refusing financial mutations outside the isolated final demo database.",
  );

  const database = getDb();
  const businessDate = jakartaBusinessDate();
  const rtRows = await database.select({ id: rtUnits.id })
    .from(rtUnits)
    .where(and(
      eq(rtUnits.code, "RT.05"),
      eq(rtUnits.rwCode, "RW.04"),
      eq(rtUnits.village, "Jrebeng Wetan"),
    ))
    .limit(2);
  assert(rtRows.length === 1, "Expected the single isolated RT.05 / RW.04 / Jrebeng Wetan fixture.");
  const rtUnitId = rtRows[0]!.id;

  const yearRows = await database.select({ id: billingYears.id, status: billingYears.status })
    .from(billingYears)
    .where(and(eq(billingYears.rtUnitId, rtUnitId), eq(billingYears.year, 2026)))
    .limit(2);
  assert(yearRows.length === 1 && yearRows[0]!.status === "open", "The 2026 billing year must already be active through the canonical billing flow.");
  const rates = await database.select({ amount: feeRates.monthlyAmount })
    .from(feeRates)
    .where(and(eq(feeRates.billingYearId, yearRows[0]!.id), eq(feeRates.effectiveMonth, 1)))
    .limit(2);
  assert(rates.length === 1 && rates[0]!.amount === 40_000, "The historical January 2026 fee must be Rp40,000.");

  const fixtureRows = await database.select({
    houseNumber: houses.number,
    householdId: households.id,
    startsOn: households.startsOn,
    householdStatus: households.status,
    fullName: people.fullName,
    phone: people.phone,
    personIsActive: people.isActive,
  }).from(houses)
    .innerJoin(households, and(eq(households.rtUnitId, houses.rtUnitId), eq(households.houseId, houses.id)))
    .innerJoin(people, and(eq(people.rtUnitId, households.rtUnitId), eq(people.householdId, households.id)))
    .where(eq(houses.rtUnitId, rtUnitId));
  assert(fixtureRows.length === 60, `Expected 60 synthetic households, found ${fixtureRows.length}.`);
  assert(fixtureRows.every((row) =>
    row.fullName === `NAMA ${row.houseNumber}` &&
    row.phone === null &&
    row.householdStatus === "active" &&
    row.personIsActive &&
    row.startsOn <= businessDate,
  ), "The fixture must contain only active, phone-free synthetic residents.");

  const allDues = await database.select({ amount: monthlyDues.amount, status: monthlyDues.status })
    .from(monthlyDues)
    .where(eq(monthlyDues.rtUnitId, rtUnitId));
  assert(allDues.length === 720, `Expected 720 canonical 2026 dues, found ${allDues.length}.`);
  assert(allDues.every((due) => due.amount === 40_000 && (due.status === "unpaid" || due.status === "paid")), "Unexpected amount or noncanonical due status found in demo dues.");

  let treasurerPrincipal: Awaited<ReturnType<typeof resolvePrincipalForUser>> | undefined;
  if (mode === "paid") {
    const treasurerAccounts = await database.select({ authUserId: appAccounts.authUserId })
      .from(appAccounts)
      .where(and(
        eq(appAccounts.rtUnitId, rtUnitId),
        eq(appAccounts.accountType, "official"),
        eq(appAccounts.status, "active"),
        eq(appAccounts.loginIdentifier, "bendahara.rt"),
      ))
      .limit(2);
    assert(treasurerAccounts.length === 1, "An active demo Treasurer account must be provisioned before marking any request paid.");
    treasurerPrincipal = await resolvePrincipalForUser(database, treasurerAccounts[0]!.authUserId, businessDate);
    assert(treasurerPrincipal.role === "treasurer" && treasurerPrincipal.rtUnitId === rtUnitId, "The demo Treasurer assignment is not active today.");
  }

  const processed: Array<{ houseNumber: string; expectedPeriods: string[]; totalAmount: number; status: string; replay: boolean }> = [];
  for (const item of showcase[mode]) {
    const accounts = await database.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      status: appAccounts.status,
      householdId: appAccounts.householdId,
    }).from(appAccounts)
      .where(and(
        eq(appAccounts.rtUnitId, rtUnitId),
        eq(appAccounts.accountType, "resident"),
        eq(appAccounts.status, "active"),
        eq(appAccounts.loginIdentifier, item.houseNumber),
      ))
      .limit(2);
    assert(accounts.length === 1 && accounts[0]!.householdId, `Expected one active synthetic Resident account for ${item.houseNumber}.`);
    const residentPrincipal = await resolvePrincipalForUser(database, accounts[0]!.authUserId, businessDate);
    assert(
      residentPrincipal.role === "resident" &&
        residentPrincipal.rtUnitId === rtUnitId &&
        residentPrincipal.householdId === accounts[0]!.householdId,
      `The ${item.houseNumber} Resident principal is not bound to its active demo household.`,
    );

    const existingRequests = await database.select({
      id: paymentRequests.id,
      requestCode: paymentRequests.requestCode,
      status: paymentRequests.status,
      idempotencyKey: paymentRequests.idempotencyKey,
      totalAmount: paymentRequests.totalAmount,
      itemCount: paymentRequests.itemCount,
      requestedByAccountId: paymentRequests.requestedByAccountId,
    }).from(paymentRequests)
      .where(and(eq(paymentRequests.rtUnitId, rtUnitId), eq(paymentRequests.householdId, accounts[0]!.householdId)))
      .limit(2);
    assert(existingRequests.length <= 1, `More than one showcase request already exists for ${item.houseNumber}; refusing to guess which to change.`);

    let request: typeof existingRequests[number];
    let replay = false;
    if (existingRequests.length === 0) {
      const created = await createResidentPaymentRequest(database, residentPrincipal, {
        period: period(item.periodMonth),
        idempotencyKey: item.idempotencyKey,
      });
      const [persisted] = await database.select({
        id: paymentRequests.id,
        requestCode: paymentRequests.requestCode,
        status: paymentRequests.status,
        idempotencyKey: paymentRequests.idempotencyKey,
        totalAmount: paymentRequests.totalAmount,
        itemCount: paymentRequests.itemCount,
        requestedByAccountId: paymentRequests.requestedByAccountId,
      }).from(paymentRequests)
        .where(and(eq(paymentRequests.rtUnitId, rtUnitId), eq(paymentRequests.requestCode, created.requestCode)))
        .limit(1);
      assert(persisted, `Canonical request creation did not persist for ${item.houseNumber}.`);
      request = persisted;
      replay = created.idempotentReplay;
    } else {
      request = existingRequests[0]!;
      replay = true;
    }

    assert(
      request.requestedByAccountId === residentPrincipal.appAccountId &&
        request.idempotencyKey === item.idempotencyKey,
      `Existing request for ${item.houseNumber} does not belong to this showcase idempotency key; refusing to alter it.`,
    );
    const requestItems = await database.select({ period: paymentRequestItems.period, amount: paymentRequestItems.amount })
      .from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, request.id))
      .orderBy(paymentRequestItems.period);
    const expectedPeriodRows = expectedPeriods(item.periodMonth);
    assert(
      requestItems.length === expectedPeriodRows.length &&
        requestItems.every((row, index) => row.period === expectedPeriodRows[index] && row.amount === 40_000) &&
        request.itemCount === expectedPeriodRows.length &&
        request.totalAmount === expectedPeriodRows.length * 40_000,
      `Request snapshot for ${item.houseNumber} does not match its canonical due items and stored total.`,
    );

    if (mode === "pending") {
      assert(request.status === "pending", `Expected ${item.houseNumber}'s showcase request to remain pending.`);
    } else {
      assert(request.status === "pending" || request.status === "verified", `Expected ${item.houseNumber}'s request to be pending or already verified.`);
      if (request.status === "pending") {
        await verifyTreasurerPaymentRequest(database, treasurerPrincipal!, request.requestCode, businessDate);
      }
      const [verified] = await database.select({ status: paymentRequests.status })
        .from(paymentRequests)
        .where(eq(paymentRequests.id, request.id))
        .limit(1);
      assert(verified?.status === "verified", `Treasurer service did not verify the ${item.houseNumber} request.`);
    }

    processed.push({
      houseNumber: item.houseNumber,
      expectedPeriods: expectedPeriodRows,
      totalAmount: expectedPeriodRows.length * 40_000,
      status: mode === "pending" ? "pending" : "verified",
      replay,
    });
  }

  const dueStates = await database.select({
    status: monthlyDues.status,
    count: sql<number>`count(*)::int`,
    totalAmount: sql<number>`sum(${monthlyDues.amount})::int`,
  }).from(monthlyDues)
    .where(eq(monthlyDues.rtUnitId, rtUnitId))
    .groupBy(monthlyDues.status);
  const requestStates = await database.select({
    status: paymentRequests.status,
    count: sql<number>`count(*)::int`,
    totalAmount: sql<number>`sum(${paymentRequests.totalAmount})::int`,
  }).from(paymentRequests)
    .where(eq(paymentRequests.rtUnitId, rtUnitId))
    .groupBy(paymentRequests.status);
  const paymentTotals = await database.select({
    count: sql<number>`count(*)::int`,
    totalAmount: sql<number>`coalesce(sum(${payments.amount}), 0)::int`,
  }).from(payments)
    .where(eq(payments.rtUnitId, rtUnitId));

  console.info(JSON.stringify({
    event: "demo.socialization.financial_showcase.complete",
    mode,
    target: { endpoint: "ep-lingering-star-azj3l9mj", database: "karturt_demo_20261006_final" },
    billing: { year: 2026, status: yearRows[0]!.status, monthlyAmount: rates[0]!.amount },
    processed,
    totals: {
      dues: dueStates.map((row) => ({ status: row.status, count: row.count, totalAmount: row.totalAmount })),
      requests: requestStates.map((row) => ({ status: row.status, count: row.count, totalAmount: row.totalAmount })),
      payments: paymentTotals[0] ?? { count: 0, totalAmount: 0 },
    },
    integrity: {
      fixtureHouseholds: fixtureRows.length,
      canonicalDues: allDues.length,
      noResidentPhoneNumbers: fixtureRows.every((row) => row.phone === null),
      noRealNames: fixtureRows.every((row) => row.fullName === `NAMA ${row.houseNumber}`),
    },
  }));
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({
      event: "demo.socialization.financial_showcase.failed",
      reason: error instanceof Error ? error.message : "unknown error",
    }));
    process.exitCode = 1;
  })
  .finally(closeDb);
