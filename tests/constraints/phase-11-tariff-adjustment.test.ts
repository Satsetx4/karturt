import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  billingYears,
  dueAdjustments,
  feeRates,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  payments,
} from "../../src/db/schema";
import type { Principal } from "../../src/lib/auth/permissions";
import { createChairmanWaiver } from "../../src/lib/billing/chairman-waiver";
import { createResidentPaymentRequest } from "../../src/lib/billing/resident-payment-request";
import { recordTreasurerCashPayment } from "../../src/lib/billing/treasurer-cash-payments";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type Fixture = {
  rtUnitId: string;
  householdId: string;
  dueId: string;
  originalAmount: number;
  feeRateId: string;
  chairmanAccountId: string;
  chairmanPrincipal: Principal;
  treasurerAccountId: string;
  treasurerPrincipal: Principal;
  residentPrincipal: Principal;
};

const businessDate = "2026-10-02";
const originalAmount = 40000;

async function sqlStateAfter(operation: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    let current: unknown = error;
    while (current && typeof current === "object") {
      const candidate = current as { code?: unknown; cause?: unknown };
      if (typeof candidate.code === "string") return candidate.code;
      current = candidate.cause;
    }
    return undefined;
  }
}

describe("F11 financial database constraints", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createFixture(options: { notDue?: boolean } = {}): Promise<Fixture> {
    const db = testDatabase.db;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);

    const chairmanUser = await createAuthUser(db);
    const [chairmanAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: chairmanUser.id,
      accountType: "official",
      loginIdentifier: `chairman-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: chairmanAccount!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });

    const treasurerUser = await createAuthUser(db);
    const [treasurerAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: treasurerUser.id,
      accountType: "official",
      loginIdentifier: `treasurer-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: treasurerAccount!.id,
      role: "treasurer",
      startsOn: "2020-01-01",
    });

    const residentUser = await createAuthUser(db);
    const [residentAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id });

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
      feeRateId: options.notDue ? null : feeRate!.id,
      month: 1,
      amount: options.notDue ? 0 : originalAmount,
      dueDate: "2026-01-10",
      status: options.notDue ? "not_due" : "unpaid",
    }).returning({ id: monthlyDues.id });

    return {
      rtUnitId,
      householdId: household.householdId,
      dueId: due!.id,
      originalAmount: options.notDue ? 0 : originalAmount,
      feeRateId: feeRate!.id,
      chairmanAccountId: chairmanAccount!.id,
      chairmanPrincipal: {
        authUserId: chairmanUser.id,
        appAccountId: chairmanAccount!.id,
        role: "rt_chairman",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
      treasurerAccountId: treasurerAccount!.id,
      treasurerPrincipal: {
        authUserId: treasurerUser.id,
        appAccountId: treasurerAccount!.id,
        role: "treasurer",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
      residentPrincipal: {
        authUserId: residentUser.id,
        appAccountId: residentAccount!.id,
        role: "resident",
        rtUnitId,
        householdId: household.householdId,
        personId: household.personId,
      },
    };
  }

  async function recordAdjustment(
    fixture: Fixture,
    options: { amountDelta: number; effectiveTargetAfter: number; dueStatus?: "unpaid" | "paid" },
  ) {
    const db = testDatabase.db;
    const id = randomUUID();
    const reason = "Penyesuaian sesuai keputusan pengurus RT";
    await db.transaction(async (transaction) => {
      await transaction.insert(dueAdjustments).values({
        id,
        rtUnitId: fixture.rtUnitId,
        householdId: fixture.householdId,
        monthlyDueId: fixture.dueId,
        amountDelta: options.amountDelta,
        effectiveTargetAfter: options.effectiveTargetAfter,
        reason,
        adjustedByAccountId: fixture.chairmanAccountId,
        adjustedByAccountType: "official",
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
      });
      if (options.dueStatus) {
        await transaction.update(monthlyDues)
          .set({ status: options.dueStatus })
          .where(eq(monthlyDues.id, fixture.dueId));
      }
      await transaction.insert(auditEvents).values({
        actorAppAccountId: fixture.chairmanAccountId,
        action: "billing.adjustment_created",
        entityType: "due_adjustment",
        entityId: id,
        reason,
        context: {
          amountDelta: options.amountDelta,
          effectiveTargetAfter: options.effectiveTargetAfter,
          originalAmount: fixture.originalAmount,
        },
      });
    });
    return id;
  }

  async function recordCashPayment(fixture: Fixture) {
    return recordTreasurerCashPayment(testDatabase.db as never, fixture.treasurerPrincipal, {
      householdId: fixture.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, businessDate);
  }

  it("rejects UPDATE, DELETE, and TRUNCATE on fee-rate and adjustment history", async () => {
    const fixture = await createFixture();
    const adjustmentId = await recordAdjustment(fixture, { amountDelta: 5000, effectiveTargetAfter: 45000 });
    const db = testDatabase.db;

    expect(await sqlStateAfter(() => db.update(feeRates)
      .set({ monthlyAmount: 45000 })
      .where(eq(feeRates.id, fixture.feeRateId)))).toBe("55000");
    expect(await sqlStateAfter(() => db.delete(feeRates)
      .where(eq(feeRates.id, fixture.feeRateId)))).toBe("55000");
    expect(await sqlStateAfter(() => db.update(dueAdjustments)
      .set({ reason: "Riwayat diubah" })
      .where(eq(dueAdjustments.id, adjustmentId)))).toBe("55000");
    expect(await sqlStateAfter(() => db.delete(dueAdjustments)
      .where(eq(dueAdjustments.id, adjustmentId)))).toBe("55000");

    expect(await sqlStateAfter(() => testDatabase.client.exec("TRUNCATE TABLE public.fee_rates CASCADE"))).toBe("55000");
    expect(await sqlStateAfter(() => testDatabase.client.exec("TRUNCATE TABLE public.due_adjustments CASCADE"))).toBe("55000");
    expect(await db.select().from(feeRates).where(eq(feeRates.id, fixture.feeRateId))).toHaveLength(1);
    expect(await db.select().from(dueAdjustments).where(eq(dueAdjustments.id, adjustmentId))).toHaveLength(1);
  });

  it("rejects new fee-rate rows that omit Chairman attribution and idempotency metadata", async () => {
    const fixture = await createFixture();
    const [year] = await testDatabase.db.select({ id: billingYears.id })
      .from(billingYears).where(eq(billingYears.rtUnitId, fixture.rtUnitId));
    await expect(testDatabase.db.insert(feeRates).values({
      rtUnitId: fixture.rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 11,
      monthlyAmount: 50000,
    })).rejects.toThrow();
  });

  it("blocks adjustment while an active payment request owns the due", async () => {
    const fixture = await createFixture();
    const request = await createResidentPaymentRequest(testDatabase.db as never, fixture.residentPrincipal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });

    await expect(recordAdjustment(fixture, { amountDelta: 5000, effectiveTargetAfter: 45000 })).rejects.toThrow();
    expect(await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, fixture.dueId))).toHaveLength(0);
    const [due] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, fixture.dueId));
    expect(due).toMatchObject({ status: "unpaid", amount: originalAmount });
    expect(request.requestCode).toBeTruthy();
  });

  it("rejects a negative adjustment that would put active receipts above target", async () => {
    const fixture = await createFixture();
    await recordCashPayment(fixture);

    await expect(recordAdjustment(fixture, {
      amountDelta: -1000,
      effectiveTargetAfter: originalAmount - 1000,
    })).rejects.toThrow();
    expect(await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, fixture.dueId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, fixture.dueId))).toHaveLength(1);
  });

  it("blocks adjustment for WAIVED and NOT_DUE obligations", async () => {
    const waived = await createFixture();
    await createChairmanWaiver(testDatabase.db as never, waived.chairmanPrincipal, {
      householdId: waived.householdId,
      periods: ["2026-01"],
      reason: "Pemutihan sesuai keputusan RT",
      idempotencyKey: randomUUID(),
    }, businessDate);
    await expect(recordAdjustment(waived, {
      amountDelta: 1000,
      effectiveTargetAfter: originalAmount + 1000,
    })).rejects.toThrow();

    const notDue = await createFixture({ notDue: true });
    await expect(recordAdjustment(notDue, {
      amountDelta: 1000,
      effectiveTargetAfter: 1000,
    })).rejects.toThrow();
    expect(await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, waived.dueId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, notDue.dueId))).toHaveLength(0);
  });

  it("allows multiple active allocations within effective target and rejects direct over-allocation", async () => {
    const fixture = await createFixture();
    await recordCashPayment(fixture);
    await recordAdjustment(fixture, {
      amountDelta: 10000,
      effectiveTargetAfter: originalAmount + 10000,
      dueStatus: "unpaid",
    });
    const secondPayment = await recordCashPayment(fixture);
    expect(secondPayment.totalAmount).toBe(10000);

    const db = testDatabase.db;
    const validOwners = await db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, fixture.dueId));
    expect(validOwners).toHaveLength(2);
    expect(validOwners.reduce((sum, owner) => sum + owner.amount, 0)).toBe(originalAmount + 10000);

    const extraPaymentId = randomUUID();
    await expect(db.transaction(async (transaction) => {
      await transaction.insert(payments).values({
        id: extraPaymentId,
        rtUnitId: fixture.rtUnitId,
        householdId: fixture.householdId,
        paymentRequestId: null,
        amount: 1,
        method: "cash",
        verifiedByAccountId: fixture.treasurerAccountId,
        verifiedByAccountType: "official",
        cashIdempotencyKey: randomUUID(),
        cashIdempotencyFingerprint: "b".repeat(64),
      });
      const [allocation] = await transaction.insert(paymentAllocations).values({
        rtUnitId: fixture.rtUnitId,
        householdId: fixture.householdId,
        paymentRequestId: null,
        paymentId: extraPaymentId,
        monthlyDueId: fixture.dueId,
        amount: 1,
      }).returning({ id: paymentAllocations.id });
      await transaction.insert(activeDueSettlements).values({
        rtUnitId: fixture.rtUnitId,
        householdId: fixture.householdId,
        paymentId: extraPaymentId,
        allocationId: allocation!.id,
        monthlyDueId: fixture.dueId,
        amount: 1,
      });
      await transaction.insert(auditEvents).values({
        actorAppAccountId: fixture.treasurerAccountId,
        action: "payment.cash_recorded",
        entityType: "payment",
        entityId: extraPaymentId,
        reason: null,
        context: { itemCount: 1, method: "cash", totalAmount: 1 },
      });
    })).rejects.toThrow();

    expect(await db.select().from(payments).where(eq(payments.id, extraPaymentId))).toHaveLength(0);
    expect(await db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, fixture.dueId))).toHaveLength(2);
  });

  it("requires payment evidence for unpaid/paid transitions, but lets a valid adjustment reopen a paid due", async () => {
    const fixture = await createFixture();
    const db = testDatabase.db;

    await expect(db.update(monthlyDues).set({ status: "paid" })
      .where(eq(monthlyDues.id, fixture.dueId))).rejects.toThrow();
    await recordCashPayment(fixture);
    await expect(db.update(monthlyDues).set({ status: "unpaid" })
      .where(eq(monthlyDues.id, fixture.dueId))).rejects.toThrow();

    await expect(recordAdjustment(fixture, {
      amountDelta: 5000,
      effectiveTargetAfter: originalAmount + 5000,
      dueStatus: "unpaid",
    })).resolves.toBeTruthy();
    await expect(db.update(monthlyDues).set({ status: "paid" })
      .where(eq(monthlyDues.id, fixture.dueId))).rejects.toThrow();

    const nextPayment = await recordCashPayment(fixture);
    expect(nextPayment.totalAmount).toBe(5000);
    const [due] = await db.select().from(monthlyDues).where(eq(monthlyDues.id, fixture.dueId));
    expect(due?.status).toBe("paid");
  });
});
