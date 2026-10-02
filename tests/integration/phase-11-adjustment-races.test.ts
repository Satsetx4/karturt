import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  billingYears,
  dueAdjustments,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentReversals,
  paymentRequestItems,
  paymentRequests,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createChairmanAdjustment, ChairmanAdjustmentConflictError } from "@/lib/billing/chairman-adjustment";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { recordTreasurerCashPayment } from "@/lib/billing/treasurer-cash-payments";
import { reverseTreasurerPayment } from "@/lib/billing/treasurer-payment-reversal";
import { verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type Fixture = {
  rtUnitId: string;
  householdId: string;
  dueId: string;
  chairmanPrincipal: Principal;
  treasurerPrincipal: Principal;
  residentPrincipal: Principal;
};

const businessDate = "2026-10-02";
const originalAmount = 40000;
const increasedTarget = 50000;
const adjustmentReason = "Penyesuaian sesuai keputusan pengurus RT";

describe("F11 adjustment races", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createFixture(): Promise<Fixture> {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);

    const chairmanUser = await createAuthUser(testDatabase.db);
    const [chairmanAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: chairmanUser.id,
      accountType: "official",
      loginIdentifier: `chairman-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: chairmanAccount!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });

    const treasurerUser = await createAuthUser(testDatabase.db);
    const [treasurerAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: treasurerUser.id,
      accountType: "official",
      loginIdentifier: `treasurer-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: treasurerAccount!.id,
      role: "treasurer",
      startsOn: "2020-01-01",
    });

    const residentUser = await createAuthUser(testDatabase.db);
    const [residentAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id });

    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [feeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 1,
      monthlyAmount: originalAmount,
    });
    const [due] = await testDatabase.db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: billingYear!.id,
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
      chairmanPrincipal: {
        authUserId: chairmanUser.id,
        appAccountId: chairmanAccount!.id,
        role: "rt_chairman",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
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

  function adjust(fixture: Fixture) {
    return createChairmanAdjustment(database, fixture.chairmanPrincipal, {
      monthlyDueId: fixture.dueId,
      amountDelta: 10000,
      reason: adjustmentReason,
      idempotencyKey: randomUUID(),
    }, businessDate);
  }

  function request(fixture: Fixture) {
    return createResidentPaymentRequest(database, fixture.residentPrincipal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
  }

  function cash(fixture: Fixture) {
    return recordTreasurerCashPayment(database, fixture.treasurerPrincipal, {
      householdId: fixture.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, businessDate);
  }

  async function state(fixture: Fixture) {
    const [balance] = await getDueFinancialBalances(database, [fixture.dueId]);
    const [due] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, fixture.dueId));
    const owners = await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, fixture.dueId));
    const allocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.monthlyDueId, fixture.dueId));
    const adjustments = await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, fixture.dueId));
    const paymentRows = await testDatabase.db.select().from(payments)
      .where(eq(payments.householdId, fixture.householdId));
    const adjustmentAudits = adjustments.length === 0 ? [] : await testDatabase.db.select().from(auditEvents)
      .where(and(
        eq(auditEvents.action, "billing.adjustment_created"),
        eq(auditEvents.entityId, adjustments[0]!.id),
      ));

    expect(balance).toBeDefined();
    expect(balance!.activeReceived).toBeLessThanOrEqual(balance!.effectiveTarget);
    expect(balance!.outstanding).toBeGreaterThanOrEqual(0);
    expect(owners.reduce((sum, owner) => sum + owner.amount, 0)).toBe(balance!.activeReceived);
    expect(owners.reduce((sum, owner) => sum + owner.amount, 0)).toBeLessThanOrEqual(balance!.effectiveTarget);
    expect(allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(
      paymentRows.reduce((sum, payment) => sum + payment.amount, 0),
    );
    expect(adjustments.length).toBeLessThanOrEqual(1);
    expect(adjustmentAudits).toHaveLength(adjustments.length);

    return { balance: balance!, due: due!, owners, allocations, adjustments, paymentRows };
  }

  it("serializes adjustment against request creation without changing the request snapshot", async () => {
    const fixture = await createFixture();
    const [requestAttempt, adjustmentAttempt] = await Promise.allSettled([
      request(fixture),
      adjust(fixture),
    ]);

    expect(requestAttempt.status).toBe("fulfilled");
    const createdRequest = (requestAttempt as PromiseFulfilledResult<Awaited<ReturnType<typeof request>>>).value;
    const [requestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, createdRequest.requestCode));
    const [item] = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestRow!.id));
    const snapshot = await state(fixture);

    expect(requestRow).toMatchObject({ status: "pending", totalAmount: item!.amount, itemCount: 1 });
    expect(item).toMatchObject({ monthlyDueId: fixture.dueId, period: "2026-01" });
    expect(snapshot.due.status).toBe("unpaid");
    expect(snapshot.balance.hasPendingRequest).toBe(true);
    expect(item!.amount).toBe(snapshot.balance.outstanding);
    expect(snapshot.allocations).toHaveLength(0);
    expect(snapshot.owners).toHaveLength(0);

    if (adjustmentAttempt.status === "fulfilled") {
      expect(snapshot.adjustments).toHaveLength(1);
      expect(item!.amount).toBe(increasedTarget);
      expect(snapshot.balance.effectiveTarget).toBe(increasedTarget);
    } else {
      expect(adjustmentAttempt.reason).toBeInstanceOf(ChairmanAdjustmentConflictError);
      expect(snapshot.adjustments).toHaveLength(0);
      expect(item!.amount).toBe(originalAmount);
      expect(snapshot.balance.effectiveTarget).toBe(originalAmount);
    }
    expect(await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment_request.created"),
      eq(auditEvents.entityId, requestRow!.id),
    ))).toHaveLength(1);
  });

  it("serializes adjustment against Treasurer verification and preserves the pending snapshot", async () => {
    const fixture = await createFixture();
    const createdRequest = await request(fixture);
    const [requestRowBefore] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, createdRequest.requestCode));
    const [itemBefore] = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestRowBefore!.id));
    const [adjustmentAttempt, verificationAttempt] = await Promise.allSettled([
      adjust(fixture),
      verifyTreasurerPaymentRequest(database, fixture.treasurerPrincipal, createdRequest.requestCode, businessDate),
    ]);

    expect(verificationAttempt.status).toBe("fulfilled");
    const snapshot = await state(fixture);
    const [requestRowAfter] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, requestRowBefore!.id));
    const [itemAfter] = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestRowBefore!.id));
    const verificationAudits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment_request.verified"),
      eq(auditEvents.entityId, requestRowBefore!.id),
    ));

    expect(requestRowAfter?.status).toBe("verified");
    expect(itemAfter).toEqual(itemBefore);
    expect(itemAfter!.amount).toBe(originalAmount);
    expect(verificationAudits).toHaveLength(1);
    expect(snapshot.paymentRows).toHaveLength(1);
    expect(snapshot.paymentRows[0]).toMatchObject({ amount: originalAmount, method: "transfer" });
    expect(snapshot.allocations).toHaveLength(1);
    expect(snapshot.allocations[0]).toMatchObject({ amount: originalAmount, paymentRequestId: requestRowBefore!.id });
    expect(snapshot.owners).toHaveLength(1);
    expect(snapshot.owners[0]?.amount).toBe(originalAmount);

    if (adjustmentAttempt.status === "fulfilled") {
      expect(snapshot.adjustments).toHaveLength(1);
      expect(snapshot.balance).toMatchObject({ effectiveTarget: increasedTarget, activeReceived: originalAmount, outstanding: 10000 });
      expect(snapshot.due.status).toBe("unpaid");
    } else {
      expect(adjustmentAttempt.reason).toBeInstanceOf(ChairmanAdjustmentConflictError);
      expect(snapshot.adjustments).toHaveLength(0);
      expect(snapshot.balance).toMatchObject({ effectiveTarget: originalAmount, activeReceived: originalAmount, outstanding: 0 });
      expect(snapshot.due.status).toBe("paid");
    }
  });

  it("serializes adjustment against cash settlement without partial payment or over-allocation", async () => {
    const fixture = await createFixture();
    const [adjustmentAttempt, cashAttempt] = await Promise.allSettled([
      adjust(fixture),
      cash(fixture),
    ]);

    expect(adjustmentAttempt.status).toBe("fulfilled");
    expect(cashAttempt.status).toBe("fulfilled");
    const snapshot = await state(fixture);
    const cashResult = (cashAttempt as PromiseFulfilledResult<Awaited<ReturnType<typeof cash>>>).value;
    expect(snapshot.adjustments).toHaveLength(1);
    expect(snapshot.paymentRows).toHaveLength(1);
    expect(snapshot.paymentRows[0]?.method).toBe("cash");
    expect(snapshot.balance.effectiveTarget).toBe(increasedTarget);
    expect([originalAmount, increasedTarget]).toContain(cashResult.totalAmount);
    expect(snapshot.balance.activeReceived).toBe(cashResult.totalAmount);
    expect(snapshot.balance.outstanding).toBe(increasedTarget - cashResult.totalAmount);
    expect(snapshot.due.status).toBe(snapshot.balance.outstanding === 0 ? "paid" : "unpaid");
    expect(snapshot.allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(cashResult.totalAmount);
    expect(snapshot.owners.reduce((sum, owner) => sum + owner.amount, 0)).toBe(cashResult.totalAmount);
    expect(snapshot.balance.outstanding === 0 || snapshot.balance.outstanding === 10000).toBe(true);
    expect(await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment.cash_recorded"),
      eq(auditEvents.entityId, snapshot.paymentRows[0]!.id),
    ))).toHaveLength(1);
  });

  it("serializes adjustment against reversal and retains immutable ledgers with a matching audit", async () => {
    const fixture = await createFixture();
    await cash(fixture);
    const [paymentBefore] = await testDatabase.db.select().from(payments)
      .where(eq(payments.householdId, fixture.householdId));
    const allocationsBefore = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentBefore!.id));

    const [adjustmentAttempt, reversalAttempt] = await Promise.allSettled([
      adjust(fixture),
      reverseTreasurerPayment(database, fixture.treasurerPrincipal, {
        paymentId: paymentBefore!.id,
        reason: "Reversal uji race F11",
      }, businessDate),
    ]);

    expect(adjustmentAttempt.status).toBe("fulfilled");
    expect(reversalAttempt.status).toBe("fulfilled");
    const snapshot = await state(fixture);
    const [paymentAfter] = await testDatabase.db.select().from(payments)
      .where(eq(payments.id, paymentBefore!.id));
    const allocationsAfter = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentBefore!.id));
    const reversals = await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, paymentBefore!.id));
    const reversalAudits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment.reversed"),
      eq(auditEvents.entityId, paymentBefore!.id),
    ));

    expect(paymentAfter).toEqual(paymentBefore);
    expect(allocationsAfter).toEqual(allocationsBefore);
    expect(reversals).toHaveLength(1);
    expect(reversalAudits).toHaveLength(1);
    expect(snapshot.adjustments).toHaveLength(1);
    expect(snapshot.adjustments[0]).toMatchObject({ amountDelta: 10000, effectiveTargetAfter: increasedTarget });
    expect(snapshot.owners).toHaveLength(0);
    expect(snapshot.balance).toMatchObject({ effectiveTarget: increasedTarget, activeReceived: 0, outstanding: increasedTarget });
    expect(snapshot.due.status).toBe("unpaid");
  });
});
