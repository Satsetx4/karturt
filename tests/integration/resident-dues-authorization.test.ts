import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { activeDueSettlements, appAccounts, billingYears, monthlyDues, officialAssignments, paymentAllocations, payments } from "../../src/db/schema";
import { resolvePrincipalForUser } from "../../src/lib/auth/principal";
import type { Principal } from "../../src/lib/auth/permissions";
import { getResidentMonthlyDues } from "../../src/lib/billing/resident-dues";
import { recordTreasurerCashPayment } from "../../src/lib/billing/treasurer-cash-payments";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("resident monthly-dues authorization", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  it("returns only the authenticated resident's household dues across all RTs", async () => {
    const { db } = testDatabase;
    const rtOne = await createRt(db);
    const rtTwo = await createRt(db);
    const residentHousehold = await createHousehold(db, rtOne);
    const otherHousehold = await createHousehold(db, rtOne);
    const otherRtHousehold = await createHousehold(db, rtTwo);
    const [yearOne] = await db.insert(billingYears).values({ rtUnitId: rtOne, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [yearTwo] = await db.insert(billingYears).values({ rtUnitId: rtTwo, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [rateOne] = await createFeeRateFixture(db, { rtUnitId: rtOne, billingYearId: yearOne.id, effectiveMonth: 1, monthlyAmount: 40_000 });
    const [rateTwo] = await createFeeRateFixture(db, { rtUnitId: rtTwo, billingYearId: yearTwo.id, effectiveMonth: 1, monthlyAmount: 50_000 });
    await db.insert(monthlyDues).values([
      {
        rtUnitId: rtOne,
        householdId: residentHousehold.householdId,
        billingYearId: yearOne.id,
        feeRateId: null,
        month: 1,
        amount: 0,
        dueDate: "2026-01-10",
        status: "not_due",
      },
      {
        rtUnitId: rtOne,
        householdId: residentHousehold.householdId,
        billingYearId: yearOne.id,
        feeRateId: rateOne.id,
        month: 5,
        amount: 40_000,
        dueDate: "2026-05-10",
        status: "unpaid",
      },
      {
        rtUnitId: rtOne,
        householdId: otherHousehold.householdId,
        billingYearId: yearOne.id,
        feeRateId: rateOne.id,
        month: 1,
        amount: 40_000,
        dueDate: "2026-01-10",
        status: "unpaid",
      },
      {
        rtUnitId: rtTwo,
        householdId: otherRtHousehold.householdId,
        billingYearId: yearTwo.id,
        feeRateId: rateTwo.id,
        month: 1,
        amount: 50_000,
        dueDate: "2026-01-10",
        status: "unpaid",
      },
    ]);

    const treasurerPrincipals = new Map<string, Principal>();
    const seedCashReceipt = async (input: {
      rtUnitId: string;
      householdId: string;
      personId: string;
      period: string;
    }) => {
      let principal = treasurerPrincipals.get(input.rtUnitId);
      if (!principal) {
        const user = await createAuthUser(db);
        const [official] = await db.insert(appAccounts).values({
          rtUnitId: input.rtUnitId,
          authUserId: user.id,
          accountType: "official",
          loginIdentifier: `receipt-fixture-${randomUUID()}`,
          personId: input.personId,
        }).returning({ id: appAccounts.id });
        await db.insert(officialAssignments).values({
          rtUnitId: input.rtUnitId,
          appAccountId: official!.id,
          role: "treasurer",
          startsOn: "2020-01-01",
        });
        principal = {
          authUserId: user.id,
          appAccountId: official!.id,
          role: "treasurer",
          rtUnitId: input.rtUnitId,
          householdId: null,
          personId: input.personId,
        };
        treasurerPrincipals.set(input.rtUnitId, principal);
      }
      const idempotencyKey = randomUUID();
      await recordTreasurerCashPayment(db as never, principal, {
        householdId: input.householdId,
        period: input.period,
        idempotencyKey,
      }, "2026-06-15");
      const [payment] = await db.select({ id: payments.id }).from(payments)
        .where(eq(payments.cashIdempotencyKey, idempotencyKey));
      return payment!.id;
    };
    const foreignPaymentIds = [
      await seedCashReceipt({
        rtUnitId: rtOne,
        householdId: otherHousehold.householdId,
        personId: otherHousehold.personId,
        period: "2026-01",
      }),
      await seedCashReceipt({
        rtUnitId: rtTwo,
        householdId: otherRtHousehold.householdId,
        personId: otherRtHousehold.personId,
        period: "2026-01",
      }),
    ];
    const residentPaymentId = await seedCashReceipt({
      rtUnitId: rtOne,
      householdId: residentHousehold.householdId,
      personId: residentHousehold.personId,
      period: "2026-05",
    });
    expect(await db.select({ id: paymentAllocations.id }).from(paymentAllocations)
      .where(inArray(paymentAllocations.paymentId, foreignPaymentIds))).toHaveLength(2);
    expect(await db.select({ allocationId: activeDueSettlements.allocationId }).from(activeDueSettlements)
      .where(inArray(activeDueSettlements.paymentId, foreignPaymentIds))).toHaveLength(2);
    const user = await createAuthUser(db);
    await db.insert(appAccounts).values({
      rtUnitId: rtOne,
      authUserId: user.id,
      accountType: "resident",
      loginIdentifier: "07",
      personId: residentHousehold.personId,
      householdId: residentHousehold.householdId,
    });

    const principal = await resolvePrincipalForUser(db as never, user.id, "2026-06-15");
    const dues = await getResidentMonthlyDues(db as never, principal, "2026-06-15");

    expect(dues).toHaveLength(2);
    expect(dues.map((due) => [due.billingYear, due.month, due.status])).toEqual([
      [2026, 1, "not_due"],
      [2026, 5, "paid"],
    ]);
    expect(Object.keys(dues[0]).sort()).toEqual([
      "activeReceived",
      "adjustmentTotal",
      "amount",
      "billingYear",
      "dueDate",
      "effectiveTarget",
      "month",
      "originalAmount",
      "outstanding",
      "paymentRequestStatus",
      "periodTiming",
      "receipts",
      "status",
    ]);
    expect(dues.map((due) => due.paymentRequestStatus)).toEqual([null, null]);
    expect(dues.map((due) => due.periodTiming)).toEqual(["past", "past"]);
    const residentReceiptReference = `KRT-${residentPaymentId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    expect(dues.map((due) => due.receipts)).toEqual([
      [],
      [{
        allocationAmount: 40_000,
        method: "cash",
        verifiedAt: expect.any(String),
        reference: residentReceiptReference,
      }],
    ]);
    const residentReceipt = dues[1]?.receipts?.[0];
    expect(Number.isNaN(Date.parse(residentReceipt?.verifiedAt ?? ""))).toBe(false);
    const foreignReferences = foreignPaymentIds.map((id) => `KRT-${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`);
    const returnedReferences = dues.flatMap((due) => due.receipts ?? []).map((receipt) => receipt.reference);
    expect(returnedReferences).toEqual([residentReceiptReference]);
    expect(foreignReferences.some((reference) => returnedReferences.includes(reference))).toBe(false);
    for (const due of dues) {
      expect(due).not.toHaveProperty("id");
      expect(due).not.toHaveProperty("rtUnitId");
      expect(due).not.toHaveProperty("householdId");
      expect(due).not.toHaveProperty("waivedReason");
    }
  });
});
