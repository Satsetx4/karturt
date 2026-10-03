import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "../../src/db/client";
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
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  paymentReversals,
  payments,
  waiverActions,
  waiverItems,
} from "../../src/db/schema";
import type { Principal } from "../../src/lib/auth/permissions";
import { createChairmanAdjustment } from "../../src/lib/billing/chairman-adjustment";
import { createChairmanFeeRate } from "../../src/lib/billing/chairman-fee-rates";
import { createChairmanWaiver } from "../../src/lib/billing/chairman-waiver";
import { generateHouseholdDues } from "../../src/lib/billing/generator";
import { cancelResidentPaymentRequest } from "../../src/lib/billing/payment-request-resolution";
import { createResidentPaymentRequest } from "../../src/lib/billing/resident-payment-request";
import { reverseTreasurerPayment } from "../../src/lib/billing/treasurer-payment-reversal";
import { recordTreasurerCashPayment } from "../../src/lib/billing/treasurer-cash-payments";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type Scenario = {
  rtUnitId: string;
  householdId: string;
  personId: string;
  billingYearId: string;
  originalFeeRateId: string;
  chairman: Principal;
  treasurer: Principal;
  resident: Principal;
  dues: Map<number, string>;
};

const businessDate = "2026-10-02";
const waiverReason = "Pemutihan berdasarkan keputusan rapat RT";

function postgresCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

async function expectHistoryMutationRejected(operation: () => Promise<unknown>) {
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  expect(postgresCode(failure)).toBe("55000");
}

describe("Gate C WAIVED, NOT_DUE, tariff, and financial-history invariants", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createScenario(options: { notDueOnly?: boolean } = {}): Promise<Scenario> {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId, { number: `GC-${randomUUID().slice(0, 6)}` });

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

    const [year] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [originalRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });

    const months = options.notDueOnly ? [2] : [1, 2, 3];
    const dues = await testDatabase.db.insert(monthlyDues).values(months.map((month) => {
      const notDue = month === 2;
      return {
        rtUnitId,
        householdId: household.householdId,
        billingYearId: year!.id,
        feeRateId: notDue ? null : originalRate!.id,
        month,
        amount: notDue ? 0 : 40000,
        dueDate: `2026-${String(month).padStart(2, "0")}-10`,
        status: notDue ? "not_due" as const : "unpaid" as const,
      };
    })).returning({ id: monthlyDues.id, month: monthlyDues.month });

    return {
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
      billingYearId: year!.id,
      originalFeeRateId: originalRate!.id,
      chairman: {
        authUserId: chairmanUser.id,
        appAccountId: chairmanAccount!.id,
        role: "rt_chairman",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
      treasurer: {
        authUserId: treasurerUser.id,
        appAccountId: treasurerAccount!.id,
        role: "treasurer",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
      resident: {
        authUserId: residentUser.id,
        appAccountId: residentAccount!.id,
        role: "resident",
        rtUnitId,
        householdId: household.householdId,
        personId: household.personId,
      },
      dues: new Map(dues.map((due) => [due.month, due.id])),
    };
  }

  async function historySnapshot(scenario: Scenario) {
    const { db } = testDatabase;
    return {
      feeRates: await db.select({ id: feeRates.id, effectiveMonth: feeRates.effectiveMonth, monthlyAmount: feeRates.monthlyAmount })
        .from(feeRates).where(eq(feeRates.rtUnitId, scenario.rtUnitId)).orderBy(feeRates.effectiveMonth),
      adjustments: await db.select({ id: dueAdjustments.id, monthlyDueId: dueAdjustments.monthlyDueId, amountDelta: dueAdjustments.amountDelta, effectiveTargetAfter: dueAdjustments.effectiveTargetAfter, reason: dueAdjustments.reason })
        .from(dueAdjustments).where(eq(dueAdjustments.rtUnitId, scenario.rtUnitId)),
      waiverActions: await db.select({ id: waiverActions.id, householdId: waiverActions.householdId, reason: waiverActions.reason, totalAmount: waiverActions.totalAmount })
        .from(waiverActions).where(eq(waiverActions.rtUnitId, scenario.rtUnitId)),
      waiverItems: await db.select({ waiverActionId: waiverItems.waiverActionId, monthlyDueId: waiverItems.monthlyDueId, period: waiverItems.period, amount: waiverItems.amount })
        .from(waiverItems).where(eq(waiverItems.rtUnitId, scenario.rtUnitId)),
      payments: await db.select({ id: payments.id, amount: payments.amount, paymentRequestId: payments.paymentRequestId, method: payments.method })
        .from(payments).where(eq(payments.rtUnitId, scenario.rtUnitId)),
      allocations: await db.select({ id: paymentAllocations.id, paymentId: paymentAllocations.paymentId, monthlyDueId: paymentAllocations.monthlyDueId, amount: paymentAllocations.amount })
        .from(paymentAllocations).where(eq(paymentAllocations.rtUnitId, scenario.rtUnitId)),
      reversals: await db.select({ id: paymentReversals.id, paymentId: paymentReversals.paymentId, reason: paymentReversals.reason })
        .from(paymentReversals).where(eq(paymentReversals.rtUnitId, scenario.rtUnitId)),
      requests: await db.select({ id: paymentRequests.id, status: paymentRequests.status, totalAmount: paymentRequests.totalAmount, itemCount: paymentRequests.itemCount })
        .from(paymentRequests).where(eq(paymentRequests.rtUnitId, scenario.rtUnitId)),
      requestItems: await db.select({ requestId: paymentRequestItems.requestId, monthlyDueId: paymentRequestItems.monthlyDueId, period: paymentRequestItems.period, amount: paymentRequestItems.amount })
        .from(paymentRequestItems).where(eq(paymentRequestItems.rtUnitId, scenario.rtUnitId)),
      dues: await db.select({ id: monthlyDues.id, month: monthlyDues.month, status: monthlyDues.status, amount: monthlyDues.amount, feeRateId: monthlyDues.feeRateId, waivedReason: monthlyDues.waivedReason })
        .from(monthlyDues).where(and(eq(monthlyDues.rtUnitId, scenario.rtUnitId), eq(monthlyDues.householdId, scenario.householdId)))
        .orderBy(monthlyDues.month),
    };
  }

  it("waives an unpaid due after reversal while retaining the reversed receipt history and excluding WAIVED from collectible balance", async () => {
    const scenario = await createScenario();
    const dueId = scenario.dues.get(1)!;
    const request = await createResidentPaymentRequest(database, scenario.resident, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    const [requestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode));
    const [requestItemBefore] = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestRow!.id));
    expect(requestItemBefore).toMatchObject({ monthlyDueId: dueId, period: "2026-01", amount: 40000 });

    await cancelResidentPaymentRequest(database, scenario.resident, request.requestCode);
    const cash = await recordTreasurerCashPayment(database, scenario.treasurer, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, businessDate);
    const [payment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));
    const [allocation] = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payment!.id));
    expect(cash).toMatchObject({ totalAmount: 40000, itemCount: 1, periods: ["2026-01"] });
    expect(allocation).toMatchObject({ monthlyDueId: dueId, amount: 40000 });

    await reverseTreasurerPayment(database, scenario.treasurer, {
      paymentId: payment!.id,
      reason: "Membalik penerimaan sebelum waiver Gate C",
    }, businessDate);
    const [reversal] = await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, payment!.id));
    const [dueAfterReversal] = await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, dueId));
    expect(dueAfterReversal?.status).toBe("unpaid");
    expect(reversal).toMatchObject({ paymentId: payment!.id, reason: "Membalik penerimaan sebelum waiver Gate C" });

    await expect(createChairmanWaiver(database, scenario.treasurer, {
      householdId: scenario.householdId,
      periods: ["2026-03"],
      reason: waiverReason,
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toThrow();
    await expect(createChairmanWaiver(database, scenario.chairman, {
      householdId: scenario.householdId,
      periods: ["2026-03"],
      reason: "   ",
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toThrow();

    await createChairmanWaiver(database, scenario.chairman, {
      householdId: scenario.householdId,
      periods: ["2026-01"],
      reason: waiverReason,
      idempotencyKey: randomUUID(),
    }, businessDate);
    await expect(createChairmanAdjustment(database, scenario.chairman, {
      monthlyDueId: dueId,
      amountDelta: 1000,
      reason: "An adjustment cannot be added after waiver",
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toThrow();

    const actions = await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, scenario.householdId));
    const items = await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.monthlyDueId, dueId));
    const [waivedDue] = await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, dueId));
    const waiverAudits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "waiver.created"),
      eq(auditEvents.entityType, "waiver_action"),
      eq(auditEvents.entityId, actions[0]!.id),
    ));
    const chairmanAssignment = await testDatabase.db.select({ id: officialAssignments.id })
      .from(officialAssignments).where(and(
        eq(officialAssignments.rtUnitId, scenario.rtUnitId),
        eq(officialAssignments.appAccountId, scenario.chairman.appAccountId),
        eq(officialAssignments.role, "rt_chairman"),
      ));
    const activeSettlementRows = await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, dueId));
    const adjustmentRows = await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, dueId));
    const claims = await testDatabase.db.select({ requestId: paymentRequestClaims.requestId, status: paymentRequests.status })
      .from(paymentRequestClaims).innerJoin(paymentRequests, eq(paymentRequests.id, paymentRequestClaims.requestId))
      .where(eq(paymentRequestClaims.monthlyDueId, dueId));
    const activeReceiptResult = await testDatabase.client.query<{ active_received: number }>(`
      SELECT COALESCE(SUM(allocation.amount), 0)::int AS active_received
      FROM public.payment_allocations allocation
      JOIN public.payments payment ON payment.id = allocation.payment_id
      WHERE allocation.monthly_due_id = $1
        AND NOT EXISTS (SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id)
    `, [dueId]);

    expect(chairmanAssignment).toHaveLength(1);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      waivedByAccountId: scenario.chairman.appAccountId,
      waivedByAccountType: "official",
      reason: waiverReason,
      itemCount: 1,
      totalAmount: 40000,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      waiverActionId: actions[0]!.id,
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      monthlyDueId: dueId,
      period: "2026-01",
      amount: 40000,
    });
    expect(waiverAudits).toHaveLength(1);
    expect(waiverAudits[0]).toMatchObject({
      actorAppAccountId: scenario.chairman.appAccountId,
      action: "waiver.created",
      entityType: "waiver_action",
      entityId: actions[0]!.id,
      reason: waiverReason,
      context: { itemCount: 1, periods: "2026-01", totalAmount: 40000 },
    });
    expect(waivedDue).toMatchObject({ status: "waived", amount: 40000, waivedReason: waiverReason });
    expect(activeSettlementRows).toHaveLength(0);
    expect(adjustmentRows).toHaveLength(0);
    expect(claims).toHaveLength(0);
    expect(activeReceiptResult.rows[0]?.active_received).toBe(0);

    // The old payment, allocation, reversal, cancelled request, and request item remain as history.
    expect(await testDatabase.db.select().from(payments).where(eq(payments.id, payment!.id))).toHaveLength(1);
    expect(await testDatabase.db.select().from(paymentAllocations).where(eq(paymentAllocations.id, allocation!.id))).toHaveLength(1);
    expect(await testDatabase.db.select().from(paymentReversals).where(eq(paymentReversals.paymentId, payment!.id))).toHaveLength(1);
    const [cancelledRequest] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, requestRow!.id));
    const [requestItemAfter] = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestRow!.id));
    expect(cancelledRequest?.status).toBe("cancelled");
    expect(requestItemAfter).toEqual(requestItemBefore);

    // Independent SQL arithmetic proves a waived due contributes neither payable original nor outstanding.
    await createChairmanAdjustment(database, scenario.chairman, {
      monthlyDueId: scenario.dues.get(3)!,
      amountDelta: 5000,
      reason: "Gate C collectible outstanding fixture",
      idempotencyKey: randomUUID(),
    }, businessDate);
    const totals = await testDatabase.client.query<{
      payable_original: number;
      waived_original: number;
      payable_due_count: number;
      waived_due_count: number;
      collectible_outstanding: number;
    }>(`
      WITH adjustments AS (
        SELECT monthly_due_id, SUM(amount_delta)::int AS amount
        FROM public.due_adjustments
        WHERE rt_unit_id = $1
        GROUP BY monthly_due_id
      ), active_receipts AS (
        SELECT allocation.monthly_due_id, SUM(allocation.amount)::int AS amount
        FROM public.payment_allocations allocation
        JOIN public.payments payment
          ON payment.id = allocation.payment_id
         AND payment.rt_unit_id = allocation.rt_unit_id
         AND payment.household_id = allocation.household_id
        WHERE allocation.rt_unit_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id
          )
        GROUP BY allocation.monthly_due_id
      ), balances AS (
        SELECT due.status, due.amount,
               due.amount + COALESCE(adjustments.amount, 0) - COALESCE(active_receipts.amount, 0) AS outstanding
        FROM public.monthly_dues due
        LEFT JOIN adjustments ON adjustments.monthly_due_id = due.id
        LEFT JOIN active_receipts ON active_receipts.monthly_due_id = due.id
        WHERE due.rt_unit_id = $1
      )
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE status IN ('paid', 'unpaid')), 0)::int AS payable_original,
        COALESCE(SUM(amount) FILTER (WHERE status = 'waived'), 0)::int AS waived_original,
        COUNT(*) FILTER (WHERE status IN ('paid', 'unpaid'))::int AS payable_due_count,
        COUNT(*) FILTER (WHERE status = 'waived')::int AS waived_due_count,
        COALESCE(SUM(outstanding) FILTER (WHERE status IN ('paid', 'unpaid')), 0)::int AS collectible_outstanding
      FROM balances
    `, [scenario.rtUnitId]);
    expect(totals.rows[0]).toEqual({
      payable_original: 40000,
      waived_original: 40000,
      payable_due_count: 1,
      waived_due_count: 1,
      collectible_outstanding: 45000,
    });
  });

  it("keeps NOT_DUE at zero with no waiver, adjustment, payment, or request activity", async () => {
    const scenario = await createScenario({ notDueOnly: true });
    const dueId = scenario.dues.get(2)!;
    const [before] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, dueId));
    expect(before).toMatchObject({ status: "not_due", amount: 0, feeRateId: null, waivedReason: null });

    await expect(createResidentPaymentRequest(database, scenario.resident, {
      period: "2026-02",
      idempotencyKey: randomUUID(),
    })).rejects.toThrow();
    await expect(recordTreasurerCashPayment(database, scenario.treasurer, {
      householdId: scenario.householdId,
      period: "2026-02",
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toThrow();
    await expect(createChairmanWaiver(database, scenario.chairman, {
      householdId: scenario.householdId,
      periods: ["2026-02"],
      reason: waiverReason,
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toThrow();
    await expect(createChairmanAdjustment(database, scenario.chairman, {
      monthlyDueId: dueId,
      amountDelta: 1000,
      reason: "NOT_DUE must not be adjustable",
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toThrow();

    const activity = await testDatabase.client.query<{
      adjustments: number;
      waiver_items: number;
      allocations: number;
      request_items: number;
      claims: number;
      active_settlements: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM public.due_adjustments WHERE monthly_due_id = $1) AS adjustments,
        (SELECT COUNT(*)::int FROM public.waiver_items WHERE monthly_due_id = $1) AS waiver_items,
        (SELECT COUNT(*)::int FROM public.payment_allocations WHERE monthly_due_id = $1) AS allocations,
        (SELECT COUNT(*)::int FROM public.payment_request_items WHERE monthly_due_id = $1) AS request_items,
        (SELECT COUNT(*)::int FROM public.payment_request_claims WHERE monthly_due_id = $1) AS claims,
        (SELECT COUNT(*)::int FROM public.active_due_settlements WHERE monthly_due_id = $1) AS active_settlements
    `, [dueId]);
    const [after] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, dueId));
    expect(activity.rows[0]).toEqual({ adjustments: 0, waiver_items: 0, allocations: 0, request_items: 0, claims: 0, active_settlements: 0 });
    expect(after).toEqual(before);
    expect(await testDatabase.db.select().from(waiverActions).where(eq(waiverActions.householdId, scenario.householdId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(payments).where(eq(payments.rtUnitId, scenario.rtUnitId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(paymentRequests).where(eq(paymentRequests.rtUnitId, scenario.rtUnitId))).toHaveLength(0);
  });

  it("uses a scheduled tariff only for newly generated dues and rejects direct edits to financial history", async () => {
    const scenario = await createScenario();
    const januaryDueId = scenario.dues.get(1)!;
    const marchDueId = scenario.dues.get(3)!;
    const request = await createResidentPaymentRequest(database, scenario.resident, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    const [requestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode));
    const [requestItemBefore] = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestRow!.id));

    const futureRate = await createChairmanFeeRate(database, scenario.chairman, {
      billingYearId: scenario.billingYearId,
      effectiveMonth: 11,
      monthlyAmount: 75000,
      idempotencyKey: randomUUID(),
    }, businessDate);
    await generateHouseholdDues(database, scenario.chairman, {
      householdId: scenario.householdId,
      billingYearId: scenario.billingYearId,
    });

    const [historicalDueAfterTariff] = await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, januaryDueId));
    const [futureDue] = await testDatabase.db.select().from(monthlyDues)
      .where(and(eq(monthlyDues.householdId, scenario.householdId), eq(monthlyDues.month, 11)));
    const [requestItemAfterTariff] = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestRow!.id));
    expect(historicalDueAfterTariff).toMatchObject({ amount: 40000, feeRateId: scenario.originalFeeRateId, status: "unpaid" });
    expect(futureDue).toMatchObject({ amount: 75000, feeRateId: futureRate.id, status: "unpaid" });
    expect(requestItemAfterTariff).toEqual(requestItemBefore);

    await cancelResidentPaymentRequest(database, scenario.resident, request.requestCode);
    await recordTreasurerCashPayment(database, scenario.treasurer, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, businessDate);
    const [payment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));
    const [allocation] = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payment!.id));
    await reverseTreasurerPayment(database, scenario.treasurer, {
      paymentId: payment!.id,
      reason: "Tariff history immutability fixture reversal",
    }, businessDate);
    await createChairmanWaiver(database, scenario.chairman, {
      householdId: scenario.householdId,
      periods: ["2026-01"],
      reason: waiverReason,
      idempotencyKey: randomUUID(),
    }, businessDate);
    const adjustment = await createChairmanAdjustment(database, scenario.chairman, {
      monthlyDueId: marchDueId,
      amountDelta: 5000,
      reason: "History immutability fixture adjustment",
      idempotencyKey: randomUUID(),
    }, businessDate);

    const before = await historySnapshot(scenario);
    const [waiverAction] = await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.rtUnitId, scenario.rtUnitId));
    const [waiverItem] = await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.rtUnitId, scenario.rtUnitId));
    const [requestItem] = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestRow!.id));

    await expectHistoryMutationRejected(() => testDatabase.db.update(feeRates)
      .set({ monthlyAmount: 76000 }).where(eq(feeRates.id, futureRate.id)));
    await expectHistoryMutationRejected(() => testDatabase.db.delete(feeRates).where(eq(feeRates.id, futureRate.id)));
    await expectHistoryMutationRejected(() => testDatabase.client.exec("TRUNCATE TABLE public.fee_rates CASCADE"));

    await expectHistoryMutationRejected(() => testDatabase.db.update(dueAdjustments)
      .set({ reason: "Rewritten adjustment" }).where(eq(dueAdjustments.id, adjustment.id)));
    await expectHistoryMutationRejected(() => testDatabase.db.delete(dueAdjustments).where(eq(dueAdjustments.id, adjustment.id)));
    await expectHistoryMutationRejected(() => testDatabase.client.exec("TRUNCATE TABLE public.due_adjustments CASCADE"));

    await expectHistoryMutationRejected(() => testDatabase.db.update(waiverActions)
      .set({ reason: "Rewritten waiver" }).where(eq(waiverActions.id, waiverAction!.id)));
    await expectHistoryMutationRejected(() => testDatabase.db.delete(waiverActions).where(eq(waiverActions.id, waiverAction!.id)));
    await expectHistoryMutationRejected(() => testDatabase.client.exec("TRUNCATE TABLE public.waiver_actions CASCADE"));
    await expectHistoryMutationRejected(() => testDatabase.db.update(waiverItems)
      .set({ amount: 1 }).where(and(
        eq(waiverItems.waiverActionId, waiverItem!.waiverActionId),
        eq(waiverItems.monthlyDueId, waiverItem!.monthlyDueId),
      )));
    await expectHistoryMutationRejected(() => testDatabase.db.delete(waiverItems)
      .where(and(
        eq(waiverItems.waiverActionId, waiverItem!.waiverActionId),
        eq(waiverItems.monthlyDueId, waiverItem!.monthlyDueId),
      )));
    await expectHistoryMutationRejected(() => testDatabase.client.exec("TRUNCATE TABLE public.waiver_items CASCADE"));

    await expectHistoryMutationRejected(() => testDatabase.db.update(payments)
      .set({ amount: 1 }).where(eq(payments.id, payment!.id)));
    await expectHistoryMutationRejected(() => testDatabase.db.delete(payments).where(eq(payments.id, payment!.id)));
    await expectHistoryMutationRejected(() => testDatabase.client.exec("TRUNCATE TABLE public.payments CASCADE"));
    await expectHistoryMutationRejected(() => testDatabase.db.update(paymentAllocations)
      .set({ amount: 1 }).where(eq(paymentAllocations.id, allocation!.id)));
    await expectHistoryMutationRejected(() => testDatabase.db.delete(paymentAllocations).where(eq(paymentAllocations.id, allocation!.id)));
    await expectHistoryMutationRejected(() => testDatabase.client.exec("TRUNCATE TABLE public.payment_allocations CASCADE"));
    const [reversal] = await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, payment!.id));
    await expectHistoryMutationRejected(() => testDatabase.db.update(paymentReversals)
      .set({ reason: "Rewritten reversal" }).where(eq(paymentReversals.id, reversal!.id)));
    await expectHistoryMutationRejected(() => testDatabase.db.delete(paymentReversals)
      .where(eq(paymentReversals.id, reversal!.id)));
    await expectHistoryMutationRejected(() => testDatabase.client.exec("TRUNCATE TABLE public.payment_reversals CASCADE"));

    await expectHistoryMutationRejected(() => testDatabase.db.update(paymentRequests)
      .set({ totalAmount: 41000 }).where(eq(paymentRequests.id, requestRow!.id)));
    await expectHistoryMutationRejected(() => testDatabase.db.delete(paymentRequests)
      .where(eq(paymentRequests.id, requestRow!.id)));
    await expectHistoryMutationRejected(() => testDatabase.client.exec("TRUNCATE TABLE public.payment_requests CASCADE"));
    await expectHistoryMutationRejected(() => testDatabase.db.update(paymentRequestItems)
      .set({ amount: 41000 }).where(and(
        eq(paymentRequestItems.requestId, requestItem!.requestId),
        eq(paymentRequestItems.monthlyDueId, requestItem!.monthlyDueId),
      )));
    await expectHistoryMutationRejected(() => testDatabase.db.delete(paymentRequestItems)
      .where(and(
        eq(paymentRequestItems.requestId, requestItem!.requestId),
        eq(paymentRequestItems.monthlyDueId, requestItem!.monthlyDueId),
      )));
    await expectHistoryMutationRejected(() => testDatabase.client.exec("TRUNCATE TABLE public.payment_request_items CASCADE"));

    await expectHistoryMutationRejected(() => testDatabase.db.update(monthlyDues)
      .set({ amount: 40001 }).where(eq(monthlyDues.id, marchDueId)));
    await expectHistoryMutationRejected(() => testDatabase.db.update(monthlyDues)
      .set({ feeRateId: futureRate.id }).where(eq(monthlyDues.id, marchDueId)));

    expect(await historySnapshot(scenario)).toEqual(before);
  });
});
