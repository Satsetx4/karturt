import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  appAccounts,
  billingYears,
  households,
  houses,
  monthlyDues,
  officialAssignments,
  people,
  rtSettings,
} from "../../src/db/schema";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

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

  it("rejects overlapping household periods and preserves adjacent ended household history", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const [house] = await db.insert(houses).values({ rtUnitId, number: `H-${randomUUID().slice(0, 6)}` }).returning({ id: houses.id });
    await db.insert(households).values({
      rtUnitId,
      houseId: house.id,
      startsOn: "2020-01-01",
      endsOn: "2020-12-31",
      status: "inactive",
    });
    const [current] = await db.insert(households).values({
      rtUnitId,
      houseId: house.id,
      startsOn: "2021-01-01",
      status: "active",
    }).returning({ id: households.id });
    await expect(db.insert(households).values({
      rtUnitId,
      houseId: house.id,
      startsOn: "2021-01-01",
      status: "active",
    })).rejects.toThrow();
    await expect(db.insert(households).values({
      rtUnitId,
      houseId: house.id,
      startsOn: "2020-12-31",
      endsOn: "2021-01-01",
      status: "inactive",
    })).rejects.toThrow();
    await expect(testDatabase.client.query(
      "UPDATE public.households SET starts_on = '2020-12-31' WHERE id = $1",
      [current!.id],
    )).rejects.toThrow(/Household identity and start fields are immutable/);
    await expect(testDatabase.client.query(
      "UPDATE public.households SET ends_on = '2021-01-01', status = 'inactive' WHERE rt_unit_id = $1 AND house_id = $2 AND starts_on = '2020-01-01'",
      [rtUnitId, house.id],
    )).rejects.toThrow(/Household period overlaps another household/);
  });

  it("allows disabled resident login history to be reused while retaining current and official uniqueness", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const formerHousehold = await createHousehold(db, rtUnitId);
    const currentHousehold = await createHousehold(db, rtUnitId);
    const identifier = `A-${randomUUID().slice(0, 6)}`;
    const formerUser = await createAuthUser(db);
    await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: formerUser.id,
      accountType: "resident",
      status: "disabled",
      loginIdentifier: identifier,
      personId: formerHousehold.personId,
      householdId: formerHousehold.householdId,
    });
    const currentUser = await createAuthUser(db);
    await expect(db.insert(appAccounts).values({
      rtUnitId,
      authUserId: currentUser.id,
      accountType: "resident",
      loginIdentifier: identifier.toLowerCase(),
      personId: currentHousehold.personId,
      householdId: currentHousehold.householdId,
    })).resolves.toBeDefined();

    const lockedUser = await createAuthUser(db);
    await expect(db.insert(appAccounts).values({
      rtUnitId,
      authUserId: lockedUser.id,
      accountType: "resident",
      status: "locked",
      loginIdentifier: identifier,
      personId: currentHousehold.personId,
      householdId: currentHousehold.householdId,
    })).rejects.toThrow();

    const officialLogin = `official-${randomUUID().slice(0, 6)}`;
    const formerOfficial = await createAuthUser(db);
    const newOfficial = await createAuthUser(db);
    await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: formerOfficial.id,
      accountType: "official",
      status: "disabled",
      loginIdentifier: officialLogin,
      personId: formerHousehold.personId,
    });
    await expect(db.insert(appAccounts).values({
      rtUnitId,
      authUserId: newOfficial.id,
      accountType: "official",
      loginIdentifier: officialLogin.toUpperCase(),
      personId: currentHousehold.personId,
    })).rejects.toThrow();
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

  it("allows only one active RT Chairman per RT", async () => {
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
      loginIdentifier: `chair-${randomUUID().slice(0, 6)}`,
      personId: firstHousehold.personId,
    }).returning({ id: appAccounts.id });
    const [secondAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: secondUser.id,
      accountType: "official",
      loginIdentifier: `chair-${randomUUID().slice(0, 6)}`,
      personId: secondHousehold.personId,
    }).returning({ id: appAccounts.id });

    await db.insert(officialAssignments).values({ rtUnitId, appAccountId: firstAccount.id, role: "rt_chairman", startsOn: "2024-01-01" });
    await expect(db.insert(officialAssignments).values({ rtUnitId, appAccountId: secondAccount.id, role: "rt_chairman", startsOn: "2025-01-01" })).rejects.toThrow();
  });

  it("rejects a second monthly due for the same household, year, and month", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [rate] = await createFeeRateFixture(db, { rtUnitId, billingYearId: year.id, effectiveMonth: 1, monthlyAmount: 40_000 });
    const row = { rtUnitId, householdId: household.householdId, billingYearId: year.id, feeRateId: rate.id, month: 1, amount: 40_000, dueDate: "2026-01-10", status: "unpaid" as const, waivedReason: null };
    await db.insert(monthlyDues).values(row);
    await expect(db.insert(monthlyDues).values(row)).rejects.toThrow();
  });

  it("keeps NOT_DUE distinct from WAIVED and requires a valid obligation for payable states", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [rate] = await createFeeRateFixture(db, { rtUnitId, billingYearId: year.id, effectiveMonth: 1, monthlyAmount: 40_000 });

    await expect(db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year.id,
      feeRateId: null,
      month: 1,
      amount: 0,
      dueDate: "2026-01-10",
      status: "not_due",
    })).resolves.toBeDefined();

    await expect(db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year.id,
      feeRateId: rate.id,
      month: 2,
      amount: 40_000,
      dueDate: "2026-02-10",
      status: "waived",
      waivedReason: "   ",
    })).rejects.toThrow();

    await expect(db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year.id,
      feeRateId: null,
      month: 3,
      amount: 0,
      dueDate: "2026-03-10",
      status: "unpaid",
    })).rejects.toThrow();
  });

  it("rejects a monthly due whose billing year belongs to another RT", async () => {
    const { db } = testDatabase;
    const rtOne = await createRt(db);
    const rtTwo = await createRt(db);
    const household = await createHousehold(db, rtOne);
    const [year] = await db.insert(billingYears).values({ rtUnitId: rtTwo, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [rate] = await createFeeRateFixture(db, { rtUnitId: rtTwo, billingYearId: year.id, effectiveMonth: 1, monthlyAmount: 40_000 });

    await expect(db.insert(monthlyDues).values({
      rtUnitId: rtOne,
      householdId: household.householdId,
      billingYearId: year.id,
      feeRateId: rate.id,
      month: 1,
      amount: 40_000,
      dueDate: "2026-01-10",
      status: "unpaid",
    })).rejects.toThrow();
  });

  it("rejects a monthly due not dated on the 10th", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [rate] = await createFeeRateFixture(db, { rtUnitId, billingYearId: year.id, effectiveMonth: 1, monthlyAmount: 40_000 });
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

  it("requires the monthly due date to match its month and billing year", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" }).returning({ id: billingYears.id });
    const [rate] = await createFeeRateFixture(db, { rtUnitId, billingYearId: year.id, effectiveMonth: 1, monthlyAmount: 40_000 });
    const common = {
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year.id,
      feeRateId: rate.id,
      month: 1,
      amount: 40_000,
      status: "unpaid" as const,
    };

    await expect(db.insert(monthlyDues).values({ ...common, dueDate: "2026-02-10" })).rejects.toThrow();
    await expect(db.insert(monthlyDues).values({ ...common, dueDate: "2027-01-10" })).rejects.toThrow();
  });

  it("keeps the configured due day fixed at ten", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    await expect(db.update(rtSettings).set({ dueDay: 15 }).where(eq(rtSettings.rtUnitId, rtUnitId))).rejects.toThrow();
  });
});
