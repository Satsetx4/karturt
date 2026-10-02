import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  dueAdjustments,
  monthlyDues,
  officialAssignments,
} from "@/db/schema";
import type { AppRole, Principal } from "@/lib/auth/permissions";
import {
  ChairmanAdjustmentForbiddenError,
  ChairmanAdjustmentNotFoundError,
  createChairmanAdjustment,
} from "@/lib/billing/chairman-adjustment";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
} from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type ChairmanFixture = {
  rtUnitId: string;
  householdId: string;
  dueId: string;
  accountId: string;
  assignmentId: string;
  principal: Principal;
};

const businessDate = "2026-10-02";
const originalAmount = 40000;
const validReason = "Penyesuaian sesuai keputusan rapat RT";

describe("Chairman adjustment service authorization", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createChairmanFixture(): Promise<ChairmanFixture> {
    const db = testDatabase.db;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const user = await createAuthUser(db, "Chairman adjustment authorization fixture");
    const [account] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `adjustment-chair-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    const [assignment] = await db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    }).returning({ id: officialAssignments.id });
    const [year] = await db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [feeRate] = await createFeeRateFixture(db, {
      rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: originalAmount,
    });
    const [due] = await db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year!.id,
      feeRateId: feeRate!.id,
      month: 1,
      amount: originalAmount,
      dueDate: "2026-01-10",
      status: "unpaid",
    }).returning({ id: monthlyDues.id });

    return {
      rtUnitId,
      householdId: household.householdId,
      dueId: due!.id,
      accountId: account!.id,
      assignmentId: assignment!.id,
      principal: {
        authUserId: user.id,
        appAccountId: account!.id,
        role: "rt_chairman",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
    };
  }

  function adjustmentInput(dueId: string, overrides: Record<string, unknown> = {}) {
    return {
      monthlyDueId: dueId,
      amountDelta: 10000,
      reason: validReason,
      idempotencyKey: randomUUID(),
      ...overrides,
    } as Parameters<typeof createChairmanAdjustment>[2];
  }

  it("allows an active same-RT Chairman and records the adjustment with its audit", async () => {
    const fixture = await createChairmanFixture();
    const result = await createChairmanAdjustment(
      database,
      fixture.principal,
      adjustmentInput(fixture.dueId),
      businessDate,
    );

    const [storedDue] = await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, fixture.dueId));
    const adjustments = await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, fixture.dueId));
    const audits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "billing.adjustment_created"),
      eq(auditEvents.entityId, result.id),
    ));

    expect(result).toMatchObject({
      monthlyDueId: fixture.dueId,
      amountDelta: 10000,
      effectiveTargetAfter: originalAmount + 10000,
      idempotentReplay: false,
    });
    expect(storedDue).toMatchObject({ status: "unpaid", amount: originalAmount });
    expect(adjustments).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorAppAccountId: fixture.accountId,
      reason: validReason,
      context: {
        amountDelta: 10000,
        effectiveTargetAfter: originalAmount + 10000,
        originalAmount,
      },
    });
  });

  it.each([
    ["Treasurer", "treasurer" as AppRole],
    ["Resident", "resident" as AppRole],
    ["System Admin", "system_admin" as AppRole],
  ])("rejects a %s principal", async (_label, role) => {
    const fixture = await createChairmanFixture();
    const unauthorized: Principal = {
      ...fixture.principal,
      role,
      rtUnitId: role === "system_admin" ? null : fixture.rtUnitId,
      householdId: role === "resident" ? fixture.householdId : null,
    };

    await expect(createChairmanAdjustment(
      database,
      unauthorized,
      adjustmentInput(fixture.dueId),
      businessDate,
    )).rejects.toBeInstanceOf(ChairmanAdjustmentForbiddenError);
    expect(await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, fixture.dueId))).toHaveLength(0);
  });

  it("rejects an inactive Chairman account", async () => {
    const fixture = await createChairmanFixture();
    await testDatabase.db.update(appAccounts)
      .set({ status: "disabled" })
      .where(eq(appAccounts.id, fixture.accountId));

    await expect(createChairmanAdjustment(
      database,
      fixture.principal,
      adjustmentInput(fixture.dueId),
      businessDate,
    )).rejects.toBeInstanceOf(ChairmanAdjustmentForbiddenError);
  });

  it("rejects an ended Chairman assignment", async () => {
    const fixture = await createChairmanFixture();
    await testDatabase.db.update(officialAssignments)
      .set({ endsOn: "2026-10-01" })
      .where(eq(officialAssignments.id, fixture.assignmentId));

    await expect(createChairmanAdjustment(
      database,
      fixture.principal,
      adjustmentInput(fixture.dueId),
      businessDate,
    )).rejects.toBeInstanceOf(ChairmanAdjustmentForbiddenError);
  });

  it("rejects an ambiguous Chairman with multiple active assignments", async () => {
    const fixture = await createChairmanFixture();
    await testDatabase.client.exec(
      "ALTER TABLE public.official_assignments DISABLE TRIGGER official_assignments_temporal_exclusivity",
    );
    try {
      await testDatabase.db.insert(officialAssignments).values({
        rtUnitId: fixture.rtUnitId,
        appAccountId: fixture.accountId,
        role: "rt_chairman",
        startsOn: "2021-01-01",
      });
    } finally {
      await testDatabase.client.exec(
        "ALTER TABLE public.official_assignments ENABLE TRIGGER official_assignments_temporal_exclusivity",
      );
    }

    await expect(createChairmanAdjustment(
      database,
      fixture.principal,
      adjustmentInput(fixture.dueId),
      businessDate,
    )).rejects.toBeInstanceOf(ChairmanAdjustmentForbiddenError);
    expect(await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, fixture.dueId))).toHaveLength(0);
  });

  it("hides a cross-RT due with the same not-found result as an unknown due", async () => {
    const fixture = await createChairmanFixture();
    const foreignRtUnitId = await createRt(testDatabase.db);
    const foreignHousehold = await createHousehold(testDatabase.db, foreignRtUnitId);
    const [foreignYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: foreignRtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [foreignFeeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId: foreignRtUnitId,
      billingYearId: foreignYear!.id,
      effectiveMonth: 1,
      monthlyAmount: originalAmount,
    });
    const [foreignDue] = await testDatabase.db.insert(monthlyDues).values({
      rtUnitId: foreignRtUnitId,
      householdId: foreignHousehold.householdId,
      billingYearId: foreignYear!.id,
      feeRateId: foreignFeeRate!.id,
      month: 1,
      amount: originalAmount,
      dueDate: "2026-01-10",
      status: "unpaid",
    }).returning({ id: monthlyDues.id });

    const foreignError = await createChairmanAdjustment(
      database,
      fixture.principal,
      adjustmentInput(foreignDue!.id),
      businessDate,
    ).catch((error: unknown) => error);
    const unknownError = await createChairmanAdjustment(
      database,
      fixture.principal,
      adjustmentInput(randomUUID()),
      businessDate,
    ).catch((error: unknown) => error);

    expect(foreignError).toBeInstanceOf(ChairmanAdjustmentNotFoundError);
    expect(unknownError).toBeInstanceOf(ChairmanAdjustmentNotFoundError);
    expect((foreignError as Error).message).toBe("Tagihan tidak ditemukan.");
    expect((unknownError as Error).message).toBe("Tagihan tidak ditemukan.");
    expect((foreignError as Error).message).not.toContain(foreignDue!.id);
    expect(await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, foreignDue!.id))).toHaveLength(0);
  });
});
