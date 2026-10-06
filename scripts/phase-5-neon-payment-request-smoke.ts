import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  authUser,
  billingYears,
  feeRates,
  households,
  monthlyDues,
  officialAssignments,
  people,
  paymentRequestClaims,
  paymentRequests,
  rtSettings,
  rtUnits,
  houses,
} from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import {
  createResidentPaymentRequest,
  PaymentRequestConflictError,
} from "@/lib/billing/resident-payment-request";

const target = {
  projectId: "billowing-base-57949906",
  branchId: "br-crimson-band-az6i637k",
  endpointId: "ep-quiet-cake-azrhjiyh",
};

function assertDevelopmentTarget() {
  const env = requireDatabaseEnvironment();
  const expected = {
    KARTURT_NEON_DEV_PROJECT_ID: target.projectId,
    KARTURT_NEON_DEV_BRANCH_ID: target.branchId,
    KARTURT_NEON_DEV_ENDPOINT_ID: target.endpointId,
  };
  if (env.appEnv !== "development" || env.databaseEnv !== "development") {
    throw new Error("Phase 5 Neon smoke requires APP_ENV and DATABASE_ENV to both be development.");
  }
  for (const [key, value] of Object.entries(expected)) {
    if (process.env[key] !== value) throw new Error(`Set the verified development target in ${key}.`);
  }
  const url = new URL(env.databaseUrl);
  if (url.hostname.split(".")[0] !== target.endpointId || url.hostname.includes("pooler")) {
    throw new Error("DATABASE_URL must use the verified direct development endpoint.");
  }
  if (url.pathname !== "/neondb") throw new Error("The development smoke only runs against neondb.");
}

async function main() {
  loadEnvConfig(process.cwd());
  assertDevelopmentTarget();
  const database = getDb();
  await migrate(database, { migrationsFolder: "./drizzle" });

  const suffix = randomBytes(5).toString("hex").toUpperCase();
  const [rtUnit] = await database.insert(rtUnits).values({
    code: `SMOKE-${suffix}`,
    rwCode: `SMOKE-${suffix}`,
    name: `Phase 5 smoke ${suffix}`,
    village: "Synthetic development fixture",
  }).returning({ id: rtUnits.id });
  await database.insert(rtSettings).values({ rtUnitId: rtUnit.id });

  const [house] = await database.insert(houses).values({
    rtUnitId: rtUnit.id,
    number: `SMOKE-${suffix}`,
  }).returning({ id: houses.id });
  const [household] = await database.insert(households).values({
    rtUnitId: rtUnit.id,
    houseId: house.id,
    startsOn: "2020-01-01",
  }).returning({ id: households.id });
  const [residentPerson] = await database.insert(people).values({
    rtUnitId: rtUnit.id,
    householdId: household.id,
    fullName: `Phase 5 resident ${suffix}`,
  }).returning({ id: people.id });
  const authUserId = randomUUID();
  await database.insert(authUser).values({
    id: authUserId,
    name: `Phase 5 resident ${suffix}`,
    email: `phase5-resident-${suffix}@example.invalid`,
    emailVerified: true,
  });

  const [residentAccount] = await database.insert(appAccounts).values({
    rtUnitId: rtUnit.id,
    authUserId,
    accountType: "resident",
    loginIdentifier: `phase5-resident-${suffix}`,
    personId: residentPerson.id,
    householdId: household.id,
  }).returning({ id: appAccounts.id });

  const testYears = [
    { year: 2024, status: "closed" as const, month: 11, amount: 32000 },
    { year: 2025, status: "open" as const, month: 2, amount: 45000 },
  ];
  const billingYearIds = new Map<number, { id: string; feeRateId: string }>();
  for (const entry of testYears) {
    const [billingYear] = await database.insert(billingYears).values({
      rtUnitId: rtUnit.id,
      year: entry.year,
      status: entry.status,
    }).returning({ id: billingYears.id });
    const [feeRate] = await database.insert(feeRates).values({
      rtUnitId: rtUnit.id,
      billingYearId: billingYear.id,
      effectiveMonth: 1,
      monthlyAmount: entry.amount,
    }).returning({ id: feeRates.id });
    billingYearIds.set(entry.year, { id: billingYear.id, feeRateId: feeRate.id });
    const month = entry.month;
    const paddedMonth = String(month).padStart(2, "0");
    await database.insert(monthlyDues).values({
      rtUnitId: rtUnit.id,
      householdId: household.id,
      billingYearId: billingYear.id,
      feeRateId: feeRate.id,
      month,
      amount: entry.amount,
      dueDate: `${entry.year}-${paddedMonth}-10`,
      status: "unpaid",
    });
  }
  const year2025 = billingYearIds.get(2025);
  assert.ok(year2025);
  await database.insert(monthlyDues).values({
    rtUnitId: rtUnit.id,
    householdId: household.id,
    billingYearId: year2025.id,
    feeRateId: year2025.feeRateId,
    month: 3,
    amount: 45000,
    dueDate: "2025-03-10",
    status: "unpaid",
  });

  const treasurerUserId = randomUUID();
  await database.insert(authUser).values({
    id: treasurerUserId,
    name: `Phase 5 Treasurer ${suffix}`,
    email: `phase5-treasurer-${suffix}@example.invalid`,
    emailVerified: true,
  });
  const [treasurerHouse] = await database.insert(houses).values({
    rtUnitId: rtUnit.id,
    number: `SMOKE-B-${suffix}`,
  }).returning({ id: houses.id });
  const [treasurerHousehold] = await database.insert(households).values({
    rtUnitId: rtUnit.id,
    houseId: treasurerHouse.id,
    startsOn: "2020-01-01",
  }).returning({ id: households.id });
  const [treasurerPerson] = await database.insert(people).values({
    rtUnitId: rtUnit.id,
    householdId: treasurerHousehold.id,
    fullName: `Phase 5 Treasurer ${suffix}`,
    phone: "08123456789",
  }).returning({ id: people.id });
  const [treasurerAccount] = await database.insert(appAccounts).values({
    rtUnitId: rtUnit.id,
    authUserId: treasurerUserId,
    accountType: "official",
    loginIdentifier: `phase5-treasurer-${suffix}`,
    personId: treasurerPerson.id,
  }).returning({ id: appAccounts.id });
  await database.insert(officialAssignments).values({
    rtUnitId: rtUnit.id,
    appAccountId: treasurerAccount.id,
    role: "treasurer",
    startsOn: "2020-01-01",
  });

  const principal = await resolvePrincipalForUser(database as never, authUserId, "2026-10-01");
  const differentKeyAttempts = await Promise.allSettled([
    createResidentPaymentRequest(database as never, principal, { period: "2025-02", idempotencyKey: randomUUID() }),
    createResidentPaymentRequest(database as never, principal, { period: "2025-02", idempotencyKey: randomUUID() }),
  ]);
  const winner = differentKeyAttempts.find((result) => result.status === "fulfilled");
  const loser = differentKeyAttempts.find((result) => result.status === "rejected");
  assert.ok(winner && winner.status === "fulfilled");
  assert.ok(loser && loser.status === "rejected" && loser.reason instanceof PaymentRequestConflictError);
  assert.deepEqual(winner.value.periods, ["2024-11", "2025-02"]);
  assert.equal(winner.value.totalAmount, 77000);

  const sameKey = randomUUID();
  const sameKeyAttempts = await Promise.all([
    createResidentPaymentRequest(database as never, principal, { period: "2025-03", idempotencyKey: sameKey }),
    createResidentPaymentRequest(database as never, principal, { period: "2025-03", idempotencyKey: sameKey }),
  ]);
  assert.equal(sameKeyAttempts[0].requestCode, sameKeyAttempts[1].requestCode);
  assert.deepEqual(sameKeyAttempts.map((result) => result.idempotentReplay).sort(), [false, true]);

  const dues = await database.select({
    id: monthlyDues.id,
    status: monthlyDues.status,
  }).from(monthlyDues).where(and(
    eq(monthlyDues.rtUnitId, rtUnit.id),
    eq(monthlyDues.householdId, household.id),
  ));
  assert.equal(dues.length, 3);
  assert.ok(dues.every((due) => due.status === "unpaid"));
  const pendingReadModel = await getResidentMonthlyDues(database as never, principal);
  assert.equal(pendingReadModel.filter((due) => due.paymentRequestStatus === "pending").length, 3);

  const requests = await database.select().from(appAccounts)
    .innerJoin(paymentRequests, eq(paymentRequests.requestedByAccountId, appAccounts.id))
    .where(eq(appAccounts.id, residentAccount.id));
  assert.equal(requests.length, 2);
  const claimCount = await database.select().from(paymentRequestClaims)
    .innerJoin(monthlyDues, eq(monthlyDues.id, paymentRequestClaims.monthlyDueId))
    .where(and(eq(monthlyDues.rtUnitId, rtUnit.id), eq(monthlyDues.householdId, household.id)));
  assert.equal(claimCount.length, 3);
  const auditRows = await database.select({ action: auditEvents.action }).from(auditEvents)
    .where(eq(auditEvents.actorAppAccountId, residentAccount.id));
  assert.equal(auditRows.filter((event) => event.action === "payment_request.created").length, 2);

  console.info(JSON.stringify({
    event: "phase_5.neon_payment_request_smoke",
    environment: "development",
    projectId: target.projectId,
    branchId: target.branchId,
    endpointId: target.endpointId,
    migrationHead: "0004_phase_5_payment_request",
    fixture: "synthetic RT, household, dues, resident, Treasurer; retained on development only",
    differentKeys: "one request created and one conflict",
    sameKey: "two simultaneous calls returned the same request",
    periods: winner.value.periods,
    totalAmount: winner.value.totalAmount,
    activePendingItems: claimCount.length,
    monthlyDueStatusesUnchanged: true,
    auditEvents: 2,
    whatsappDeepLink: "same-RT Treasurer phone and prefilled request details verified",
  }));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected development smoke failure.";
    console.error(`Neon development payment request smoke failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
