import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  appAccounts,
  billingYears,
  feeRates,
  households,
  houses,
  monthlyDues,
  officialAssignments,
  people,
  rtSettings,
} from "../../src/db/schema";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("PostgreSQL constraints", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => { testDatabase = await createTestDatabase(); });
  afterAll(async () => { if (testDatabase) await testDatabase.close(); });

  it("enforces case-insensitive house numbers per RT while allowing another RT to reuse a number", async () => {
    const { db } = testDatabase;
    const rtOne = await createRt(db);
    const rtTwo = await createRt(db);
    await db.insert(houses).values({ rtUnitId: rtOne, number: "C-01" });
    await expect(db.insert(houses).values({ rtUnitId: rtOne, number: "c-01" })).rejects.toThrow();
    await expect(db.insert(houses).values({ rtUnitId: rtTwo, number: "C-01" })).resolves.toBeDefined();
  });

  it("allows only one active household for a house but preserves ended household history", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const [house] = await db.insert(houses).values({ rtUnitId, number: `H-${randomUUID().slice(0, 6)}` }).returning({ id: houses.id });
    await db.insert(households).values({ rtUnitId, houseId: house.id, startsOn: "2020-01-01", status: "active" });
    await expect(db.insert(households).values({ rtUnitId, houseId: house.id, startsOn: "2021-01-01", status: "active" })).rejects.toThrow();
    await db.insert(households).values({ rtUnitId, houseId: house.id, startsOn: "2020-01-01", endsOn: "2024-12-31", status: "inactive" });
  });

  it("rejects a household reference from another RT unit", async () => {
    const { db } = testDatabase;
    const rtOne = await createRt(db);
    const rtTwo = await createRt(db);
    const household = await createHousehold(db, rtTwo);
    await expect(db.insert(people).values({ rtUnitId: rtOne, householdId: household.householdId, fullName: "Constraint Fixture" })).rejects.toThrow();
  });

  it("requires a resident account's person to belong to the same household", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const residentHousehold = await createHousehold(db, rtUnitId);
    const otherHousehold = await createHousehold(db, rtUnitId);
    const residentUser = await createAuthUser(db);
    await expect(db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `H-${randomUUID().slice(0, 6)}`,
      personId: otherHousehold.personId,
      householdId: residentHousehold.householdId,
    })).rejects.toThrow();
  });

  it("allows only one active resident account per household", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const firstUser = await createAuthUser(db);
    const secondUser = await createAuthUser(db);
    const loginIdentifier = `H-${randomUUID().slice(0, 6)}`;
    const account = {
      rtUnitId,
      accountType: "resident" as const,
      loginIdentifier,
      personId: household.personId,
      householdId: household.householdId,
    };
    await db.insert(appAccounts).values({ ...account, authUserId: firstUser.id });
    await expect(db.insert(appAccounts).values({ ...account, authUserId: secondUser.id, loginIdentifier: `${loginIdentifier}-2` })).rejects.toThrow();
  });

  it("keeps System Admin login names unique across the platform", async () => {
    const { db } = testDatabase;
    const firstUser = await createAuthUser(db);
    const secondUser = await createAuthUser(db);
    const loginIdentifier = `recovery-${randomUUID().slice(0, 6)}`;
    await db.insert(appAccounts).values({ authUserId: firstUser.id, accountType: "system_admin", loginIdentifier });
    await expect(db.insert(appAccounts).values({
      authUserId: secondUser.id,
      accountType: "system_admin",
      loginIdentifier: loginIdentifier.toUpperCase(),
    })).rejects.toThrow();
  });

  it("allows one active Treasurer and keeps the prior assignment as history", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const firstHousehold = await createHousehold(db, rtUnitId);
    const secondHousehold = await createHousehold(db, rtUnitId);
    const firstUser = await createAuthUser(db);
    const secondUser = await createAuthUser(db);
    const [firstAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: firstUser.id,
      accountType: "official",
      loginIdentifier: `official-${randomUUID().slice(0, 6)}`,
      personId: firstHousehold.personId,
    }).returning({ id: appAccounts.id });
    const [secondAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: secondUser.id,
      accountType: "official",
      loginIdentifier: `official-${randomUUID().slice(0, 6)}`,
      personId: secondHousehold.personId,
    }).returning({ id: appAccounts.id });

    await db.insert(officialAssignments).values({ rtUnitId, appAccountId: firstAccount.id, role: "treasurer", startsOn: "2024-01-01" });
    await expect(db.insert(officialAssignments).values({ rtUnitId, appAccountId: secondAccount.id, role: "treasurer", startsOn: "2025-01-01" })).rejects.toThrow();
    await db.update(officialAssignments).set({ endsOn: "2025-12-31" }).where(eq(officialAssignments.appAccountId, firstAccount.id));
    await expect(db.insert(officialAssignments).values({ rtUnitId, appAccountId: secondAccount.id, role: "treasurer", startsOn: "2026-01-01" })).resolves.toBeDefined();
  });

  it("rejects a second monthly due for the same household, year, and month", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [rate] = await db.insert(feeRates).values({ rtUnitId, billingYearId: year.id, effectiveMonth: 1, monthlyAmount: 40_000 }).returning({ id: feeRates.id });
    const row = { rtUnitId, householdId: household.householdId, billingYearId: year.id, feeRateId: rate.id, month: 1, amount: 40_000, dueDate: "2026-01-10", status: "unpaid" as const, waivedReason: null };
    await db.insert(monthlyDues).values(row);
    await expect(db.insert(monthlyDues).values(row)).rejects.toThrow();
  });

  it("rejects a monthly due not dated on the 10th", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [rate] = await db.insert(feeRates).values({ rtUnitId, billingYearId: year.id, effectiveMonth: 1, monthlyAmount: 40_000 }).returning({ id: feeRates.id });
    await expect(db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year.id,
      feeRateId: rate.id,
      month: 1,
      amount: 40_000,
      dueDate: "2026-01-11",
      status: "unpaid",
    })).rejects.toThrow();
  });

  it("keeps the configured due day fixed at ten", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    await expect(db.update(rtSettings).set({ dueDay: 15 }).where(eq(rtSettings.rtUnitId, rtUnitId))).rejects.toThrow();
  });
});
