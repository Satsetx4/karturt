import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appAccounts, billingYears, feeRates, monthlyDues } from "../../src/db/schema";
import { resolvePrincipalForUser } from "../../src/lib/auth/principal";
import { getResidentMonthlyDues } from "../../src/lib/billing/resident-dues";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

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
    const [rateOne] = await db.insert(feeRates).values({ rtUnitId: rtOne, billingYearId: yearOne.id, effectiveMonth: 1, monthlyAmount: 40_000 }).returning({ id: feeRates.id });
    const [rateTwo] = await db.insert(feeRates).values({ rtUnitId: rtTwo, billingYearId: yearTwo.id, effectiveMonth: 1, monthlyAmount: 50_000 }).returning({ id: feeRates.id });
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
    const dues = await getResidentMonthlyDues(db as never, principal);

    expect(dues).toHaveLength(2);
    expect(dues.map((due) => [due.billingYear, due.month, due.status])).toEqual([
      [2026, 1, "not_due"],
      [2026, 5, "unpaid"],
    ]);
    expect(Object.keys(dues[0]).sort()).toEqual([
      "amount",
      "billingYear",
      "dueDate",
      "month",
      "status",
    ]);
    for (const due of dues) {
      expect(due).not.toHaveProperty("id");
      expect(due).not.toHaveProperty("rtUnitId");
      expect(due).not.toHaveProperty("householdId");
      expect(due).not.toHaveProperty("waivedReason");
    }
  });
});
