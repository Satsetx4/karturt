import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  activeDueSettlements,
  appAccounts,
  billingYears,
  dueAdjustments,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentReversals,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createChairmanAdjustment, ChairmanAdjustmentConflictError } from "@/lib/billing/chairman-adjustment";
import { createChairmanWaiver } from "@/lib/billing/chairman-waiver";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { recordTreasurerCashPayment } from "@/lib/billing/treasurer-cash-payments";
import { reverseTreasurerPayment } from "@/lib/billing/treasurer-payment-reversal";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
} from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type DueStatus = "paid" | "unpaid" | "waived" | "not_due";

type ManualDue = {
  month: number;
  originalAmount: number;
  adjustmentTotal: number;
  activeReceived: number;
  status: DueStatus;
  hasPendingRequest: boolean;
  paymentRequestStatus: "pending" | null;
};

type SqlDueBalance = {
  dueId: string;
  month: number | string;
  status: string;
  originalAmount: number | string;
  adjustmentTotal: number | string;
  effectiveTarget: number | string;
  activeReceived: number | string;
  outstanding: number | string;
  hasPendingRequest: boolean;
  originalPotential: number | string;
  waivedOriginal: number | string;
  originalPayable: number | string;
  positiveAdjustments: number | string;
  negativeAdjustments: number | string;
  collectibleTarget: number | string;
  activeReceivedTotal: number | string;
  collectibleOutstanding: number | string;
};

const BUSINESS_DATE = "2026-10-02";

// Frozen independent expectations from docs/gate-c-financial-invariants-plan.md.
const MANUAL_DATASET: readonly ManualDue[] = [
  { month: 1, originalAmount: 40000, adjustmentTotal: 0, activeReceived: 40000, status: "paid", hasPendingRequest: false, paymentRequestStatus: null },
  { month: 2, originalAmount: 40000, adjustmentTotal: 10000, activeReceived: 50000, status: "paid", hasPendingRequest: false, paymentRequestStatus: null },
  { month: 3, originalAmount: 50000, adjustmentTotal: -10000, activeReceived: 40000, status: "paid", hasPendingRequest: false, paymentRequestStatus: null },
  { month: 4, originalAmount: 40000, adjustmentTotal: 0, activeReceived: 0, status: "unpaid", hasPendingRequest: false, paymentRequestStatus: null },
  { month: 5, originalAmount: 40000, adjustmentTotal: 0, activeReceived: 0, status: "unpaid", hasPendingRequest: true, paymentRequestStatus: "pending" },
  { month: 6, originalAmount: 40000, adjustmentTotal: 0, activeReceived: 0, status: "waived", hasPendingRequest: false, paymentRequestStatus: null },
  { month: 7, originalAmount: 0, adjustmentTotal: 0, activeReceived: 0, status: "not_due", hasPendingRequest: false, paymentRequestStatus: null },
  { month: 8, originalAmount: 40000, adjustmentTotal: 10000, activeReceived: 0, status: "unpaid", hasPendingRequest: false, paymentRequestStatus: null },
];

const FROZEN_TOTALS = {
  originalPotential: 290000,
  waivedOriginal: 40000,
  originalPayable: 250000,
  positiveAdjustments: 20000,
  negativeAdjustments: -10000,
  collectibleTarget: 260000,
  activeReceived: 130000,
  collectibleOutstanding: 130000,
};

function asNumber(value: number | string) {
  return typeof value === "number" ? value : Number(value);
}

function summarizeBalances(rows: readonly {
  originalAmount: number;
  adjustmentTotal: number;
  effectiveTarget: number;
  activeReceived: number;
  outstanding: number;
  status: DueStatus;
}[]) {
  const payable = rows.filter((row) => row.status === "paid" || row.status === "unpaid");
  return {
    originalPotential: rows.reduce((sum, row) => sum + row.originalAmount, 0),
    waivedOriginal: rows
      .filter((row) => row.status === "waived")
      .reduce((sum, row) => sum + row.originalAmount, 0),
    originalPayable: payable.reduce((sum, row) => sum + row.originalAmount, 0),
    positiveAdjustments: payable.reduce((sum, row) => sum + Math.max(row.adjustmentTotal, 0), 0),
    negativeAdjustments: payable.reduce((sum, row) => sum + Math.min(row.adjustmentTotal, 0), 0),
    collectibleTarget: payable.reduce((sum, row) => sum + row.effectiveTarget, 0),
    activeReceived: payable.reduce((sum, row) => sum + row.activeReceived, 0),
    collectibleOutstanding: payable.reduce((sum, row) => sum + row.outstanding, 0),
  };
}

async function createOfficialPrincipal(
  database: TestDatabase["db"],
  rtUnitId: string,
  personId: string,
  role: "rt_chairman" | "treasurer",
): Promise<Principal> {
  const user = await createAuthUser(database);
  const [account] = await database.insert(appAccounts).values({
    rtUnitId,
    authUserId: user.id,
    accountType: "official",
    loginIdentifier: `${role}-${randomUUID()}`,
    personId,
  }).returning({ id: appAccounts.id });
  if (!account) throw new Error(`Could not create the ${role} test account.`);

  await database.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: account.id,
    role,
    startsOn: "2020-01-01",
  });

  return {
    authUserId: user.id,
    appAccountId: account.id,
    role,
    rtUnitId,
    householdId: null,
    personId,
  };
}

async function createResidentPrincipal(
  database: TestDatabase["db"],
  rtUnitId: string,
  household: Awaited<ReturnType<typeof createHousehold>>,
): Promise<Principal> {
  const user = await createAuthUser(database);
  const [account] = await database.insert(appAccounts).values({
    rtUnitId,
    authUserId: user.id,
    accountType: "resident",
    loginIdentifier: `resident-${randomUUID()}`,
    personId: household.personId,
    householdId: household.householdId,
  }).returning({ id: appAccounts.id });
  if (!account) throw new Error("Could not create a resident test account.");

  return {
    authUserId: user.id,
    appAccountId: account.id,
    role: "resident",
    rtUnitId,
    householdId: household.householdId,
    personId: household.personId,
  };
}

describe("Gate C independent financial balance oracle", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  it("matches the frozen hand calculation, independently authored SQL, and resident read model", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const households: Awaited<ReturnType<typeof createHousehold>>[] = [];
    const residents: Principal[] = [];
    for (let householdIndex = 0; householdIndex < MANUAL_DATASET.length; householdIndex += 1) {
      const household = await createHousehold(testDatabase.db, rtUnitId);
      households.push(household);
      residents.push(await createResidentPrincipal(testDatabase.db, rtUnitId, household));
    }

    const chairman = await createOfficialPrincipal(testDatabase.db, rtUnitId, households[0]!.personId, "rt_chairman");
    const treasurer = await createOfficialPrincipal(testDatabase.db, rtUnitId, households[0]!.personId, "treasurer");
    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    if (!billingYear) throw new Error("Could not create the Gate C billing year.");

    const [januaryRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    const [marchRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear.id,
      effectiveMonth: 3,
      monthlyAmount: 50000,
    });
    const [aprilRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear.id,
      effectiveMonth: 4,
      monthlyAmount: 40000,
    });
    if (!januaryRate || !marchRate || !aprilRate) throw new Error("Could not create tariff snapshots for the dataset.");

    const dueRows = await testDatabase.db.insert(monthlyDues).values(MANUAL_DATASET.map((manualDue) => ({
      rtUnitId,
      householdId: households[manualDue.month - 1]!.householdId,
      billingYearId: billingYear.id,
      feeRateId: manualDue.month === 7
        ? null
        : manualDue.month <= 2
          ? januaryRate.id
          : manualDue.month === 3
            ? marchRate.id
            : aprilRate.id,
      month: manualDue.month,
      amount: manualDue.originalAmount,
      dueDate: `2026-${String(manualDue.month).padStart(2, "0")}-10`,
      status: manualDue.status === "not_due" ? "not_due" as const : "unpaid" as const,
    }))).returning({ id: monthlyDues.id, month: monthlyDues.month });
    const dueIdByMonth = new Map(dueRows.map((due) => [due.month, due.id]));

    async function recordCash(month: number, householdIndex = month - 1) {
      return recordTreasurerCashPayment(database, treasurer, {
        householdId: households[householdIndex]!.householdId,
        period: `2026-${String(month).padStart(2, "0")}`,
        idempotencyKey: randomUUID(),
      }, BUSINESS_DATE);
    }

    // Jan is a single full settlement.
    await recordCash(1);

    // Feb: settle the original balance, create a new +10,000 balance, then settle it fully.
    await recordCash(2);
    await createChairmanAdjustment(database, chairman, {
      monthlyDueId: dueIdByMonth.get(2)!,
      amountDelta: 10000,
      reason: "Koreksi tarif periode Februari",
      idempotencyKey: randomUUID(),
    }, BUSINESS_DATE);
    await recordCash(2);

    // Mar: apply the negative adjustment before paying the full reduced obligation.
    await createChairmanAdjustment(database, chairman, {
      monthlyDueId: dueIdByMonth.get(3)!,
      amountDelta: -10000,
      reason: "Koreksi tarif periode Maret",
      idempotencyKey: randomUUID(),
    }, BUSINESS_DATE);
    await recordCash(3);

    // May remains UNPAID in storage while its real request is pending.
    await createResidentPaymentRequest(database, residents[4]!, {
      period: "2026-05",
      idempotencyKey: randomUUID(),
    });

    // June is waived through the business flow so the database has a real waiver ledger.
    await createChairmanWaiver(database, chairman, {
      householdId: households[5]!.householdId,
      periods: ["2026-06"],
      reason: "Pemutihan sesuai keputusan RT",
      idempotencyKey: randomUUID(),
    }, BUSINESS_DATE);

    // August keeps its 40,000 payment history after +10,000 adjustment and reversal.
    await recordCash(8);
    await createChairmanAdjustment(database, chairman, {
      monthlyDueId: dueIdByMonth.get(8)!,
      amountDelta: 10000,
      reason: "Koreksi tarif periode Agustus",
      idempotencyKey: randomUUID(),
    }, BUSINESS_DATE);
    const [augustPayment] = await testDatabase.db.select().from(payments)
      .where(and(
        eq(payments.householdId, households[7]!.householdId),
        eq(payments.method, "cash"),
      ));
    if (!augustPayment) throw new Error("August test payment was not retained.");
    await reverseTreasurerPayment(database, treasurer, {
      paymentId: augustPayment.id,
      reason: "Koreksi pencatatan pembayaran Agustus",
    }, BUSINESS_DATE);

    // A new negative adjustment after Feb has been settled would create credit; it must roll back.
    await expect(createChairmanAdjustment(database, chairman, {
      monthlyDueId: dueIdByMonth.get(2)!,
      amountDelta: -1,
      reason: "Percobaan membuat saldo kredit",
      idempotencyKey: randomUUID(),
    }, BUSINESS_DATE)).rejects.toBeInstanceOf(ChairmanAdjustmentConflictError);
    const februaryAdjustments = await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, dueIdByMonth.get(2)!));
    expect(februaryAdjustments.map((adjustment) => adjustment.amountDelta)).toEqual([10000]);

    const residentRows = (await Promise.all(residents.map((principal) => getResidentMonthlyDues(database, principal))))
      .flat()
      .sort((left, right) => left.month - right.month);
    expect(residentRows).toHaveLength(MANUAL_DATASET.length);

    const sqlResult = await testDatabase.client.query<SqlDueBalance>(`
      WITH due_components AS (
        SELECT
          due.id AS due_id,
          due.month::integer AS month,
          due.status::text AS status,
          due.amount::integer AS original_amount,
          COALESCE((
            SELECT SUM(adjustment.amount_delta)
            FROM public.due_adjustments adjustment
            WHERE adjustment.monthly_due_id = due.id
              AND adjustment.rt_unit_id = due.rt_unit_id
              AND adjustment.household_id = due.household_id
          ), 0)::integer AS adjustment_total,
          COALESCE((
            SELECT SUM(allocation.amount)
            FROM public.payment_allocations allocation
            JOIN public.payments payment
              ON payment.id = allocation.payment_id
             AND payment.rt_unit_id = allocation.rt_unit_id
             AND payment.household_id = allocation.household_id
            WHERE allocation.monthly_due_id = due.id
              AND allocation.rt_unit_id = due.rt_unit_id
              AND allocation.household_id = due.household_id
              AND NOT EXISTS (
                SELECT 1
                FROM public.payment_reversals reversal
                WHERE reversal.payment_id = payment.id
              )
          ), 0)::integer AS active_received,
          EXISTS (
            SELECT 1
            FROM public.payment_request_claims claim
            JOIN public.payment_requests request ON request.id = claim.request_id
            WHERE claim.monthly_due_id = due.id
              AND request.status = 'pending'
          ) AS has_pending_request
        FROM public.monthly_dues due
        WHERE due.billing_year_id = $1::uuid
          AND due.month BETWEEN 1 AND 8
      ), due_balances AS (
        SELECT
          due_id,
          month,
          status,
          original_amount,
          adjustment_total,
          (original_amount + adjustment_total)::integer AS effective_target,
          active_received,
          (original_amount + adjustment_total - active_received)::integer AS outstanding,
          has_pending_request
        FROM due_components
      )
      SELECT
        due_id AS "dueId",
        month,
        status,
        original_amount AS "originalAmount",
        adjustment_total AS "adjustmentTotal",
        effective_target AS "effectiveTarget",
        active_received AS "activeReceived",
        outstanding,
        has_pending_request AS "hasPendingRequest",
        (SUM(original_amount) OVER ())::integer AS "originalPotential",
        (SUM(CASE WHEN status = 'waived' THEN original_amount ELSE 0 END) OVER ())::integer AS "waivedOriginal",
        (SUM(CASE WHEN status IN ('paid', 'unpaid') THEN original_amount ELSE 0 END) OVER ())::integer AS "originalPayable",
        (SUM(CASE WHEN status IN ('paid', 'unpaid') AND adjustment_total > 0 THEN adjustment_total ELSE 0 END) OVER ())::integer AS "positiveAdjustments",
        (SUM(CASE WHEN status IN ('paid', 'unpaid') AND adjustment_total < 0 THEN adjustment_total ELSE 0 END) OVER ())::integer AS "negativeAdjustments",
        (SUM(CASE WHEN status IN ('paid', 'unpaid') THEN effective_target ELSE 0 END) OVER ())::integer AS "collectibleTarget",
        (SUM(CASE WHEN status IN ('paid', 'unpaid') THEN active_received ELSE 0 END) OVER ())::integer AS "activeReceivedTotal",
        (SUM(CASE WHEN status IN ('paid', 'unpaid') THEN outstanding ELSE 0 END) OVER ())::integer AS "collectibleOutstanding"
      FROM due_balances
      ORDER BY month
    `, [billingYear.id]);

    const sqlRows = sqlResult.rows.map((row) => ({
      dueId: row.dueId,
      month: asNumber(row.month),
      status: row.status as DueStatus,
      originalAmount: asNumber(row.originalAmount),
      adjustmentTotal: asNumber(row.adjustmentTotal),
      effectiveTarget: asNumber(row.effectiveTarget),
      activeReceived: asNumber(row.activeReceived),
      outstanding: asNumber(row.outstanding),
      hasPendingRequest: row.hasPendingRequest,
    }));
    expect(sqlRows).toHaveLength(MANUAL_DATASET.length);

    const manualBalances = MANUAL_DATASET.map((manualDue) => ({
      ...manualDue,
      effectiveTarget: manualDue.originalAmount + manualDue.adjustmentTotal,
      outstanding: manualDue.originalAmount + manualDue.adjustmentTotal - manualDue.activeReceived,
    }));

    for (const expected of manualBalances) {
      const application = residentRows.find((row) => row.month === expected.month);
      const directSql = sqlRows.find((row) => row.month === expected.month);
      expect(application, `application read model for month ${expected.month}`).toBeDefined();
      expect(directSql, `direct SQL result for month ${expected.month}`).toBeDefined();

      expect(application).toMatchObject({
        originalAmount: expected.originalAmount,
        adjustmentTotal: expected.adjustmentTotal,
        effectiveTarget: expected.effectiveTarget,
        activeReceived: expected.activeReceived,
        outstanding: expected.outstanding,
        status: expected.status,
        paymentRequestStatus: expected.paymentRequestStatus,
      });
      expect(directSql).toMatchObject({
        originalAmount: expected.originalAmount,
        adjustmentTotal: expected.adjustmentTotal,
        effectiveTarget: expected.effectiveTarget,
        activeReceived: expected.activeReceived,
        outstanding: expected.outstanding,
        status: expected.status,
        hasPendingRequest: expected.hasPendingRequest,
      });

      expect(expected.outstanding).toBe(expected.effectiveTarget - expected.activeReceived);
      expect(expected.activeReceived).toBeGreaterThanOrEqual(0);
      expect(expected.activeReceived).toBeLessThanOrEqual(expected.effectiveTarget);
      if (expected.status === "paid") expect(expected.outstanding).toBe(0);
      if (expected.status === "unpaid") expect(expected.outstanding).toBeGreaterThan(0);
    }

    // WAIVED has an historical face value in the due row but is excluded from collection totals.
    const manualTotals = summarizeBalances(manualBalances);
    const applicationTotals = summarizeBalances(residentRows.map((row) => ({
      originalAmount: row.originalAmount,
      adjustmentTotal: row.adjustmentTotal,
      effectiveTarget: row.effectiveTarget,
      activeReceived: row.activeReceived,
      outstanding: row.outstanding,
      status: row.status,
    })));
    const firstSqlRow = sqlResult.rows[0];
    if (!firstSqlRow) throw new Error("Direct SQL balance aggregation returned no rows.");
    const sqlTotals = {
      originalPotential: asNumber(firstSqlRow.originalPotential),
      waivedOriginal: asNumber(firstSqlRow.waivedOriginal),
      originalPayable: asNumber(firstSqlRow.originalPayable),
      positiveAdjustments: asNumber(firstSqlRow.positiveAdjustments),
      negativeAdjustments: asNumber(firstSqlRow.negativeAdjustments),
      collectibleTarget: asNumber(firstSqlRow.collectibleTarget),
      activeReceived: asNumber(firstSqlRow.activeReceivedTotal),
      collectibleOutstanding: asNumber(firstSqlRow.collectibleOutstanding),
    };

    expect(manualTotals).toEqual(FROZEN_TOTALS);
    expect(applicationTotals).toEqual(FROZEN_TOTALS);
    expect(sqlTotals).toEqual(FROZEN_TOTALS);
    expect(sqlTotals).toEqual(applicationTotals);

    const februaryDueId = dueIdByMonth.get(2)!;
    const februaryAllocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.monthlyDueId, februaryDueId));
    expect(februaryAllocations.map((allocation) => allocation.amount).sort((left, right) => left - right))
      .toEqual([10000, 40000]);

    const augustDueId = dueIdByMonth.get(8)!;
    const augustAllocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.monthlyDueId, augustDueId));
    const augustReversals = await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, augustPayment.id));
    const augustOwnership = await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, augustDueId));
    expect(augustPayment.amount).toBe(40000);
    expect(augustAllocations).toHaveLength(1);
    expect(augustAllocations[0]?.amount).toBe(40000);
    expect(augustReversals).toHaveLength(1);
    expect(augustOwnership).toHaveLength(0);
    expect(sqlRows.find((row) => row.month === 8)?.activeReceived).toBe(0);
    expect(sqlRows.find((row) => row.month === 8)?.outstanding).toBe(50000);
  });
});
