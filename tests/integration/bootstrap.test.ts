import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../src/db/client";
import { appAccounts, auditEvents, billingYears, feeRates, monthlyDues, officialAssignments, rtSettings, rtUnits } from "../../src/db/schema";
import type { Principal } from "../../src/lib/auth/permissions";
import { activateBillingYear } from "../../src/lib/billing/activation";
import { createChairmanFeeRate, ChairmanFeeRateConflictError } from "../../src/lib/billing/chairman-fee-rates";
import { generateHouseholdDues } from "../../src/lib/billing/generator";
import { bootstrapRtUnit } from "../../src/lib/rt/bootstrap";
import { createAuthUser, createHousehold, createTestDatabase } from "../helpers/database";
import { jakartaBusinessDate } from "../../src/lib/time/jakarta";

describe("RT bootstrap", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => { testDatabase = await createTestDatabase(); });
  afterAll(async () => { if (testDatabase) await testDatabase.close(); });

  it("is repeat-safe and creates one settings row for the RT", async () => {
    const { db } = testDatabase;
    const values = { code: "RT-05", rwCode: "RW-04", name: "RT 05", village: "Jrebeng Wetan" };
    const first = await bootstrapRtUnit(db as unknown as AppDatabase, values);
    const retry = await bootstrapRtUnit(db as unknown as AppDatabase, values);
    const units = await db.select().from(rtUnits).where(eq(rtUnits.code, values.code));
    const settings = await db.select().from(rtSettings).where(eq(rtSettings.rtUnitId, first.id));

    expect(first).toEqual({ id: first.id, created: true });
    expect(retry).toEqual({ id: first.id, created: false });
    expect(units).toHaveLength(1);
    expect(settings).toHaveLength(1);
  });

  it("keeps concurrent retries unique", async () => {
    const { db } = testDatabase;
    const values = { code: "RT-06", rwCode: "RW-04", name: "RT 06", village: "Jrebeng Wetan" };
    const results = await Promise.all([
      bootstrapRtUnit(db as unknown as AppDatabase, values),
      bootstrapRtUnit(db as unknown as AppDatabase, values),
    ]);
    const units = await db.select().from(rtUnits).where(eq(rtUnits.code, values.code));
    const settings = await db.select().from(rtSettings).where(eq(rtSettings.rtUnitId, results[0]!.id));

    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(units).toHaveLength(1);
    expect(settings).toHaveLength(1);
  });

  it("documents the first-year setup deadlock and the guarded next-year tariff path", async () => {
    const { db } = testDatabase;
    const values = { code: "RT-07", rwCode: "RW-04", name: "RT 07", village: "Jrebeng Wetan" };
    const { id: rtUnitId } = await bootstrapRtUnit(db as unknown as AppDatabase, values);
    const household = await createHousehold(db, rtUnitId);
    const user = await createAuthUser(db, "Bootstrap chairman fixture");
    const [account] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `bootstrap-chair-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });
    const chairman: Principal = {
      authUserId: user.id,
      appAccountId: account!.id,
      role: "rt_chairman",
      rtUnitId,
      householdId: null,
      personId: household.personId,
    };
    const businessDate = jakartaBusinessDate();
    const nextYear = Number(businessDate.slice(0, 4)) + 1;

    // The app's year activation requires a January tariff, while the canonical
    // tariff service accepts new rows only for an already-open year. With no
    // year-opening bootstrap flow, neither operation can initialize a new RT.
    const [draftYear] = await db.insert(billingYears).values({
      rtUnitId,
      year: nextYear,
      status: "draft",
    }).returning({ id: billingYears.id });
    const draftTariffRequest = {
      billingYearId: draftYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 40_000,
      idempotencyKey: randomUUID(),
    };

    await expect(createChairmanFeeRate(
      db as unknown as AppDatabase,
      chairman,
      draftTariffRequest,
      businessDate,
    )).rejects.toBeInstanceOf(ChairmanFeeRateConflictError);
    await expect(activateBillingYear(
      db as unknown as AppDatabase,
      chairman,
      { billingYearId: draftYear!.id },
    )).rejects.toThrow("January fee rate");

    const [unchangedDraft] = await db.select({ status: billingYears.status })
      .from(billingYears)
      .where(and(eq(billingYears.id, draftYear!.id), eq(billingYears.rtUnitId, rtUnitId)));
    expect(unchangedDraft?.status).toBe("draft");
    expect(await db.select().from(feeRates).where(eq(feeRates.billingYearId, draftYear!.id))).toHaveLength(0);
    expect(await db.select().from(monthlyDues).where(eq(monthlyDues.rtUnitId, rtUnitId))).toHaveLength(0);

    // A same-RT Chairman can create a future January tariff once an open
    // billing-year row exists; this state is seeded here only to isolate that
    // supported flow from the missing initial-year transition above.
    const [openYear] = await db.insert(billingYears).values({
      rtUnitId,
      year: nextYear + 1,
      status: "open",
    }).returning({ id: billingYears.id });
    const tariff = await createChairmanFeeRate(
      db as unknown as AppDatabase,
      chairman,
      {
        billingYearId: openYear!.id,
        effectiveMonth: 1,
        monthlyAmount: 40_000,
        idempotencyKey: randomUUID(),
      },
      businessDate,
    );
    await expect(activateBillingYear(
      db as unknown as AppDatabase,
      chairman,
      { billingYearId: openYear!.id },
    )).resolves.toMatchObject({ id: openYear!.id, status: "open" });
    await expect(generateHouseholdDues(
      db as unknown as AppDatabase,
      chairman,
      { householdId: household.householdId, billingYearId: openYear!.id },
    )).resolves.toMatchObject({ insertedCount: 12 });

    const rates = await db.select().from(feeRates)
      .where(and(eq(feeRates.rtUnitId, rtUnitId), eq(feeRates.billingYearId, openYear!.id)));
    const audits = await db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "fee_rate.created"),
      eq(auditEvents.entityId, tariff.id),
    ));
    const dues = await db.select().from(monthlyDues)
      .where(and(eq(monthlyDues.rtUnitId, rtUnitId), eq(monthlyDues.householdId, household.householdId)));

    expect(rates).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(dues).toHaveLength(12);
    expect(dues.every((due) => due.status === "unpaid" && due.amount === 40_000)).toBe(true);
    expect(dues.every((due) => due.dueDate.startsWith(`${nextYear + 1}-`) && due.dueDate.endsWith("-10"))).toBe(true);
  });
});
