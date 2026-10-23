import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  feeRates,
  officialAssignments,
  monthlyDues,
  paymentAllocations,
  paymentRequestItems,
  paymentRequests,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import {
  ChairmanFeeRateConflictError,
  ChairmanFeeRateIdempotencyConflictError,
  createChairmanFeeRate,
  listChairmanFeeRates,
} from "@/lib/billing/chairman-fee-rates";
import { generateHouseholdDues } from "@/lib/billing/generator";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { recordTreasurerCashPayment } from "@/lib/billing/treasurer-cash-payments";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type Fixture = { rtUnitId: string; chairman: Principal };
const businessDate = "2026-10-02";

describe("Chairman fee rate read/write service", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createChairmanFixture(): Promise<Fixture> {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db, "Chairman fee rate fixture");
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `chairman-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });
    return {
      rtUnitId,
      chairman: {
        authUserId: user.id,
        appAccountId: account!.id,
        role: "rt_chairman",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
    };
  }

  it("returns only this RT's years and rates, with the optional year filter", async () => {
    const fixture = await createChairmanFixture();
    const other = await createChairmanFixture();
    const [year] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: fixture.rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [otherYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: other.rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    await createFeeRateFixture(testDatabase.db, {
      rtUnitId: fixture.rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    await createFeeRateFixture(testDatabase.db, {
      rtUnitId: other.rtUnitId,
      billingYearId: otherYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 99000,
    });

    await expect(listChairmanFeeRates(database, fixture.chairman, undefined, businessDate)).resolves.toMatchObject({
      years: [{ id: year!.id, year: 2026, status: "open" }],
      rates: [{ billingYearId: year!.id, effectiveMonth: 1, monthlyAmount: 40000 }],
    });
    await expect(listChairmanFeeRates(database, fixture.chairman, year!.id, businessDate)).resolves.toMatchObject({
      rates: [{ billingYearId: year!.id, monthlyAmount: 40000 }],
    });
    await expect(listChairmanFeeRates(database, fixture.chairman, otherYear!.id, businessDate)).resolves.toMatchObject({
      years: [{ id: year!.id, year: 2026, status: "open" }],
      rates: [],
    });
  });

  it("appends an upcoming period, audits it, and replays the same idempotency key", async () => {
    const fixture = await createChairmanFixture();
    const [year] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: fixture.rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    await createFeeRateFixture(testDatabase.db, {
      rtUnitId: fixture.rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    const idempotencyKey = randomUUID();
    const input = {
      billingYearId: year!.id,
      effectiveMonth: 11,
      monthlyAmount: 75000,
      idempotencyKey,
    };

    const created = await createChairmanFeeRate(database, fixture.chairman, input, businessDate);
    const replay = await createChairmanFeeRate(database, fixture.chairman, input, businessDate);
    const [stored] = await testDatabase.db.select().from(feeRates).where(eq(feeRates.id, created.id));
    const audits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "fee_rate.created"),
      eq(auditEvents.entityId, created.id),
    ));

    expect(created).toMatchObject({
      billingYearId: year!.id,
      effectiveMonth: 11,
      monthlyAmount: 75000,
      idempotentReplay: false,
    });
    expect(replay).toMatchObject({ id: created.id, idempotentReplay: true });
    expect(stored).toMatchObject({
      rtUnitId: fixture.rtUnitId,
      createdByAccountId: fixture.chairman.appAccountId,
      createdByAccountType: "official",
      idempotencyKey,
      monthlyAmount: 75000,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: "fee_rate",
      entityId: created.id,
      reason: null,
      context: { period: "2026-11", monthlyAmount: 75000 },
    });

    await expect(createChairmanFeeRate(database, fixture.chairman, {
      ...input,
      monthlyAmount: 76000,
    }, businessDate)).rejects.toBeInstanceOf(ChairmanFeeRateIdempotencyConflictError);
    await expect(createChairmanFeeRate(database, fixture.chairman, {
      ...input,
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toBeInstanceOf(ChairmanFeeRateConflictError);
    expect(await testDatabase.db.select().from(feeRates).where(eq(feeRates.billingYearId, year!.id))).toHaveLength(2);
    expect(await testDatabase.db.select().from(auditEvents).where(eq(auditEvents.entityId, created.id))).toHaveLength(1);
  });

  it("rejects current/past periods and years that are not open", async () => {
    const fixture = await createChairmanFixture();
    const [openYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: fixture.rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [draftYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: fixture.rtUnitId,
      year: 2027,
      status: "draft",
    }).returning({ id: billingYears.id });
    await createFeeRateFixture(testDatabase.db, {
      rtUnitId: fixture.rtUnitId,
      billingYearId: openYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });

    await expect(createChairmanFeeRate(database, fixture.chairman, {
      billingYearId: openYear!.id,
      effectiveMonth: 10,
      monthlyAmount: 50000,
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toBeInstanceOf(ChairmanFeeRateConflictError);
    await expect(createChairmanFeeRate(database, fixture.chairman, {
      billingYearId: draftYear!.id,
      effectiveMonth: 11,
      monthlyAmount: 50000,
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toBeInstanceOf(ChairmanFeeRateConflictError);
    expect(await testDatabase.db.select().from(feeRates).where(eq(feeRates.rtUnitId, fixture.rtUnitId))).toHaveLength(1);
  });

  it("keeps a paid due and payment at the old snapshot while a not-yet-generated due uses the new tariff", async () => {
    const fixture = await createChairmanFixture();
    const [year] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: fixture.rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    await createFeeRateFixture(testDatabase.db, {
      rtUnitId: fixture.rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });

    const existingHousehold = await createHousehold(testDatabase.db, fixture.rtUnitId);
    const newlyGeneratedHousehold = await createHousehold(testDatabase.db, fixture.rtUnitId);
    await generateHouseholdDues(database, fixture.chairman, {
      householdId: existingHousehold.householdId,
      billingYearId: year!.id,
    });

    const treasurerUser = await createAuthUser(testDatabase.db);
    const [treasurerAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId: fixture.rtUnitId,
      authUserId: treasurerUser.id,
      accountType: "official",
      loginIdentifier: `treasurer-${randomUUID()}`,
      personId: fixture.chairman.personId!,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId: fixture.rtUnitId,
      appAccountId: treasurerAccount!.id,
      role: "treasurer",
      startsOn: "2020-01-01",
    });
    const treasurer: Principal = {
      authUserId: treasurerUser.id,
      appAccountId: treasurerAccount!.id,
      role: "treasurer",
      rtUnitId: fixture.rtUnitId,
      householdId: null,
      personId: fixture.chairman.personId,
    };
    await recordTreasurerCashPayment(database, treasurer, {
      householdId: existingHousehold.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, businessDate);

    const created = await createChairmanFeeRate(database, fixture.chairman, {
      billingYearId: year!.id,
      effectiveMonth: 11,
      monthlyAmount: 75000,
      idempotencyKey: randomUUID(),
    }, businessDate);
    await generateHouseholdDues(database, fixture.chairman, {
      householdId: newlyGeneratedHousehold.householdId,
      billingYearId: year!.id,
    });

    const [existingNovember] = await testDatabase.db.select({ amount: monthlyDues.amount, feeRateId: monthlyDues.feeRateId })
      .from(monthlyDues)
      .where(and(eq(monthlyDues.householdId, existingHousehold.householdId), eq(monthlyDues.month, 11)));
    const [newNovember] = await testDatabase.db.select({ amount: monthlyDues.amount, feeRateId: monthlyDues.feeRateId })
      .from(monthlyDues)
      .where(and(eq(monthlyDues.householdId, newlyGeneratedHousehold.householdId), eq(monthlyDues.month, 11)));
    const [paidJanuary] = await testDatabase.db.select({ id: monthlyDues.id, amount: monthlyDues.amount, status: monthlyDues.status })
      .from(monthlyDues)
      .where(and(eq(monthlyDues.householdId, existingHousehold.householdId), eq(monthlyDues.month, 1)));
    const oldPayments = await testDatabase.db.select({ amount: payments.amount })
      .from(payments)
      .where(eq(payments.verifiedByAccountId, treasurerAccount!.id));
    const oldAllocations = await testDatabase.db.select({ amount: paymentAllocations.amount })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.monthlyDueId, paidJanuary!.id));

    expect(existingNovember).toMatchObject({ amount: 40000 });
    expect(newNovember).toMatchObject({ amount: 75000, feeRateId: created.id });
    expect(paidJanuary).toMatchObject({ amount: 40000, status: "paid" });
    expect(oldPayments).toEqual([{ amount: 40000 }]);
    expect(oldAllocations).toEqual([{ amount: 40000 }]);
  });

  it("keeps a pending request snapshot unchanged while a new household uses the later tariff", async () => {
    const fixture = await createChairmanFixture();
    const [year] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: fixture.rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    await createFeeRateFixture(testDatabase.db, {
      rtUnitId: fixture.rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });

    const requestedHousehold = await createHousehold(testDatabase.db, fixture.rtUnitId, { startsOn: "2026-11-01" });
    await generateHouseholdDues(database, fixture.chairman, {
      householdId: requestedHousehold.householdId,
      billingYearId: year!.id,
    });
    const residentUser = await createAuthUser(testDatabase.db);
    await testDatabase.db.insert(appAccounts).values({
      rtUnitId: fixture.rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: requestedHousehold.personId,
      householdId: requestedHousehold.householdId,
    });
    const resident = await resolvePrincipalForUser(database, residentUser.id, "2026-11-01");
    const request = await createResidentPaymentRequest(database, resident, {
      period: "2026-11",
      idempotencyKey: randomUUID(),
    }, "2026-11-01");
    const [requestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode));
    const [requestItem] = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestRow!.id));

    await createChairmanFeeRate(database, fixture.chairman, {
      billingYearId: year!.id,
      effectiveMonth: 11,
      monthlyAmount: 75000,
      idempotencyKey: randomUUID(),
    }, businessDate);
    const newlyGeneratedHousehold = await createHousehold(testDatabase.db, fixture.rtUnitId, { startsOn: "2026-11-01" });
    await generateHouseholdDues(database, fixture.chairman, {
      householdId: newlyGeneratedHousehold.householdId,
      billingYearId: year!.id,
    });

    const [requestedNovember] = await testDatabase.db.select({ amount: monthlyDues.amount, feeRateId: monthlyDues.feeRateId })
      .from(monthlyDues)
      .where(and(eq(monthlyDues.householdId, requestedHousehold.householdId), eq(monthlyDues.month, 11)));
    const [newNovember] = await testDatabase.db.select({ amount: monthlyDues.amount })
      .from(monthlyDues)
      .where(and(eq(monthlyDues.householdId, newlyGeneratedHousehold.householdId), eq(monthlyDues.month, 11)));
    const [requestAfter] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, requestRow!.id));
    const [itemAfter] = await testDatabase.db.select().from(paymentRequestItems)
      .where(and(
        eq(paymentRequestItems.requestId, requestItem!.requestId),
        eq(paymentRequestItems.monthlyDueId, requestItem!.monthlyDueId),
      ));

    expect(requestItem).toMatchObject({ amount: 40000, period: "2026-11" });
    expect(requestAfter).toMatchObject({ status: "pending", totalAmount: 40000 });
    expect(itemAfter).toEqual(requestItem);
    expect(requestedNovember).toMatchObject({ amount: 40000 });
    expect(newNovember).toMatchObject({ amount: 75000 });
  });
});
