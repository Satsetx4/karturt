import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "../../src/db/client";
import { billingYears, feeRates, monthlyDues } from "../../src/db/schema";
import { generateHouseholdDues } from "../../src/lib/billing/generator";
import { createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("monthly-dues database integration", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => { testDatabase = await createTestDatabase(); });
  afterAll(async () => { if (testDatabase) await testDatabase.close(); });

  it("writes twelve rows once, snapshots fee changes, and keeps pre-residency months waived", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId, { number: "C-01", startsOn: "2026-05-15" });
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [firstRate] = await db.insert(feeRates).values({ rtUnitId, billingYearId: year.id, effectiveMonth: 1, monthlyAmount: 40_000 }).returning({ id: feeRates.id });
    await db.insert(feeRates).values({ rtUnitId, billingYearId: year.id, effectiveMonth: 7, monthlyAmount: 50_000 });

    const result = await generateHouseholdDues(db as unknown as AppDatabase, { rtUnitId, householdId: household.householdId, billingYearId: year.id });
    const retry = await generateHouseholdDues(db as unknown as AppDatabase, { rtUnitId, householdId: household.householdId, billingYearId: year.id });
    const rows = await db.select().from(monthlyDues).where((await import("drizzle-orm")).eq(monthlyDues.householdId, household.householdId)).orderBy(monthlyDues.month);

    expect(result.insertedCount).toBe(12);
    expect(retry.insertedCount).toBe(0);
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 4).every((row) => row.status === "waived" && row.amount === 0 && row.feeRateId === null)).toBe(true);
    expect(rows[4]?.feeRateId).toBe(firstRate.id);
    expect(rows[4]?.amount).toBe(40_000);
    expect(rows[6]?.amount).toBe(50_000);
    expect(rows.every((row) => row.dueDate.endsWith("-10"))).toBe(true);
  });
});
