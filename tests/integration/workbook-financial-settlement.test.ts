import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  billingYears,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import {
  createResidentPaymentRequest,
  PaymentRequestPeriodUnavailableError,
} from "@/lib/billing/resident-payment-request";
import { getRtFinancialReport } from "@/lib/reports/rt-financial-report";
import { bootstrapWorkbookSyntheticAccountFixture } from "../fixtures/workbook-account-fixture";
import type { WorkbookAccountRole, WorkbookAccountRosterEntry } from "../fixtures/workbook-account-roster";
import { createWorkbookFinancialSettlementFixture, WORKBOOK_FINANCIAL_BUSINESS_DATE } from "../fixtures/workbook-financial-settlement";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
} from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

const MONTHLY_AMOUNT = 40_000;
const SETTLED_MONTHS = Array.from({ length: 9 }, (_, index) => index + 1);
const SETTLED_PERIODS = SETTLED_MONTHS.map((month) => "2026-" + String(month).padStart(2, "0"));
const WORKBOOK_ROLES: WorkbookAccountRole[] = ["system_admin", "rt_chairman", "treasurer", "resident", "resident"];

function makeWorkbookRoster(): WorkbookAccountRosterEntry[] {
  const token = randomUUID().replace(/-/g, "");
  const sharedResidentPin = String(100_000 + Number.parseInt(token.slice(0, 6), 16) % 900_000);
  return WORKBOOK_ROLES.map((role, index) => ({
    identifier: `WBF-${token.slice(0, 20)}-${index}`,
    name: `Finance Fixture ${token}-${index}`,
    role,
    accountStatus: "active",
    pin: role === "resident"
      ? sharedResidentPin
      : String(100_000 + Number.parseInt(token.slice(6 + index, 12 + index), 16) % 900_000),
  }));
}

describe("workbook financial settlement fixture", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterEach(async () => {
    await testDatabase?.close();
  });

  async function createPrincipal(
    rtUnitId: string,
    personId: string,
    role: "resident" | "rt_chairman" | "treasurer",
    householdId: string | null = null,
  ): Promise<Principal> {
    if (role === "resident" && !householdId) {
      throw new Error("A synthetic resident principal requires its household.");
    }
    const user = await createAuthUser(testDatabase.db);
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: role === "resident" ? "resident" : "official",
      loginIdentifier: "workbook-fixture-" + role + "-" + randomUUID(),
      personId,
      ...(role === "resident" && householdId ? { householdId } : {}),
    }).returning({ id: appAccounts.id });
    if (!account) throw new Error("Could not create a synthetic workbook fixture account.");

    if (role !== "resident") {
      await testDatabase.db.insert(officialAssignments).values({
        rtUnitId,
        appAccountId: account.id,
        role,
        startsOn: "2020-01-01",
      });
    }

    return {
      authUserId: user.id,
      appAccountId: account.id,
      role,
      rtUnitId,
      householdId: role === "resident" ? householdId : null,
      personId,
    };
  }

  it("settles Jan-Sep once, leaves October unpaid, and excludes future months from arrears", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId, { startsOn: "2020-01-01" });
    const chairmanPrincipal = await createPrincipal(rtUnitId, household.personId, "rt_chairman");
    const residentPrincipal = await createPrincipal(
      rtUnitId,
      household.personId,
      "resident",
      household.householdId,
    );
    const treasurerPrincipal = await createPrincipal(rtUnitId, household.personId, "treasurer");

    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "draft",
    }).returning({ id: billingYears.id });
    if (!billingYear) throw new Error("Could not create the synthetic 2026 billing year.");

    const [feeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear.id,
      effectiveMonth: 1,
      monthlyAmount: MONTHLY_AMOUNT,
    });
    if (!feeRate) throw new Error("Could not create the synthetic January tariff.");

    const fixture = await createWorkbookFinancialSettlementFixture({
      database,
      rtUnitId,
      householdId: household.householdId,
      billingYearId: billingYear.id,
      chairmanPrincipal,
      residentPrincipal,
      treasurerPrincipal,
    });

    expect(fixture.generatedDuesCount).toBe(12);
    expect(fixture.replayedGenerationInsertCount).toBe(0);
    expect(fixture.requestPeriods).toEqual(SETTLED_PERIODS);
    expect(fixture.requestTotalAmount).toBe(9 * MONTHLY_AMOUNT);
    expect(fixture.requestReplayMatched).toBe(true);
    expect(fixture.verifiedItemCount).toBe(9);
    expect(fixture.verifiedTotalAmount).toBe(9 * MONTHLY_AMOUNT);
    expect(fixture.duplicateVerificationRejected).toBe(true);

    let futureRequestRejected = false;
    try {
      await createResidentPaymentRequest(
        database,
        residentPrincipal,
        { period: "2026-11", idempotencyKey: randomUUID() },
        WORKBOOK_FINANCIAL_BUSINESS_DATE,
      );
    } catch (error) {
      if (!(error instanceof PaymentRequestPeriodUnavailableError)) throw error;
      futureRequestRejected = true;
    }
    expect(futureRequestRejected).toBe(true);

    const dueRows = await testDatabase.db
      .select({
        id: monthlyDues.id,
        month: monthlyDues.month,
        dueDate: monthlyDues.dueDate,
        status: monthlyDues.status,
      })
      .from(monthlyDues)
      .where(and(
        eq(monthlyDues.rtUnitId, rtUnitId),
        eq(monthlyDues.householdId, household.householdId),
        eq(monthlyDues.billingYearId, billingYear.id),
      ))
      .orderBy(asc(monthlyDues.month));
    expect(dueRows.length).toBe(12);
    expect(dueRows.map((due) => due.month)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(dueRows.every((due) => due.dueDate.endsWith("-10"))).toBe(true);
    expect(dueRows.filter((due) => due.month <= 9 && due.status === "paid").length).toBe(9);
    expect(dueRows.filter((due) => due.month >= 10 && due.status === "unpaid").length).toBe(3);

    const requestRows = await testDatabase.db
      .select({
        id: paymentRequests.id,
        status: paymentRequests.status,
        itemCount: paymentRequests.itemCount,
        totalAmount: paymentRequests.totalAmount,
      })
      .from(paymentRequests)
      .where(and(
        eq(paymentRequests.rtUnitId, rtUnitId),
        eq(paymentRequests.householdId, household.householdId),
      ));
    expect(requestRows.length).toBe(1);
    const request = requestRows[0];
    if (!request) throw new Error("The synthetic transfer request was not created.");
    expect(request.status).toBe("verified");
    expect(request.itemCount).toBe(9);
    expect(request.totalAmount).toBe(9 * MONTHLY_AMOUNT);

    const requestItems = await testDatabase.db
      .select({ period: paymentRequestItems.period, amount: paymentRequestItems.amount })
      .from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, request.id))
      .orderBy(asc(paymentRequestItems.period));
    expect(requestItems.map((item) => item.period)).toEqual(SETTLED_PERIODS);
    expect(requestItems.every((item) => item.amount === MONTHLY_AMOUNT)).toBe(true);

    const paymentRows = await testDatabase.db
      .select({ amount: payments.amount, method: payments.method })
      .from(payments)
      .where(eq(payments.paymentRequestId, request.id));
    expect(paymentRows.length).toBe(1);
    expect(paymentRows[0]?.amount).toBe(9 * MONTHLY_AMOUNT);
    expect(paymentRows[0]?.method).toBe("transfer");

    const allocationRows = await testDatabase.db
      .select({ month: monthlyDues.month, amount: paymentAllocations.amount })
      .from(paymentAllocations)
      .innerJoin(monthlyDues, and(
        eq(monthlyDues.id, paymentAllocations.monthlyDueId),
        eq(monthlyDues.rtUnitId, paymentAllocations.rtUnitId),
        eq(monthlyDues.householdId, paymentAllocations.householdId),
      ))
      .where(eq(paymentAllocations.paymentRequestId, request.id))
      .orderBy(asc(monthlyDues.month));
    expect(allocationRows.length).toBe(9);
    expect(allocationRows.map((item) => item.month)).toEqual(SETTLED_MONTHS);
    expect(allocationRows.every((item) => item.amount === MONTHLY_AMOUNT)).toBe(true);
    expect(allocationRows.reduce((total, item) => total + item.amount, 0)).toBe(9 * MONTHLY_AMOUNT);

    const settlementRows = await testDatabase.db
      .select({ month: monthlyDues.month, amount: activeDueSettlements.amount })
      .from(activeDueSettlements)
      .innerJoin(monthlyDues, and(
        eq(monthlyDues.id, activeDueSettlements.monthlyDueId),
        eq(monthlyDues.rtUnitId, activeDueSettlements.rtUnitId),
        eq(monthlyDues.householdId, activeDueSettlements.householdId),
      ))
      .where(and(
        eq(activeDueSettlements.rtUnitId, rtUnitId),
        eq(activeDueSettlements.householdId, household.householdId),
      ))
      .orderBy(asc(monthlyDues.month));
    expect(settlementRows.length).toBe(9);
    expect(settlementRows.map((item) => item.month)).toEqual(SETTLED_MONTHS);
    expect(settlementRows.reduce((total, item) => total + item.amount, 0)).toBe(9 * MONTHLY_AMOUNT);

    const remainingClaims = await testDatabase.db
      .select({ requestId: paymentRequestClaims.requestId })
      .from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, request.id));
    expect(remainingClaims.length).toBe(0);

    const requestAuditActions = await testDatabase.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(
        eq(auditEvents.entityType, "payment_request"),
        eq(auditEvents.entityId, request.id),
        inArray(auditEvents.action, ["payment_request.created", "payment_request.verified"]),
      ));
    expect(requestAuditActions.map((event) => event.action).sort()).toEqual([
      "payment_request.created",
      "payment_request.verified",
    ]);

    const october = dueRows.find((due) => due.month === 10);
    if (!october) throw new Error("The October household due was not generated.");
    const octoberAllocations = await testDatabase.db
      .select({ id: paymentAllocations.id })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.monthlyDueId, october.id));
    const octoberSettlements = await testDatabase.db
      .select({ allocationId: activeDueSettlements.allocationId })
      .from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, october.id));
    const octoberItems = requestItems.filter((item) => item.period === "2026-10");
    expect(octoberAllocations.length).toBe(0);
    expect(octoberSettlements.length).toBe(0);
    expect(octoberItems.length).toBe(0);

    const residentDues = await getResidentMonthlyDues(
      database,
      residentPrincipal,
      WORKBOOK_FINANCIAL_BUSINESS_DATE,
    );
    expect(residentDues.length).toBe(12);
    const paidResidentDues = residentDues.filter((due) => due.month <= 9);
    expect(paidResidentDues.length).toBe(9);
    expect(paidResidentDues.every((due) =>
      due.status === "paid" &&
      due.activeReceived === MONTHLY_AMOUNT &&
      due.outstanding === 0 &&
      due.receipts.length === 1 &&
      due.receipts[0]?.method === "transfer" &&
      due.receipts[0]?.allocationAmount === MONTHLY_AMOUNT,
    )).toBe(true);

    const octoberResidentDue = residentDues.find((due) => due.month === 10);
    expect(octoberResidentDue && {
      status: octoberResidentDue.status,
      periodTiming: octoberResidentDue.periodTiming,
      dueDate: octoberResidentDue.dueDate,
      activeReceived: octoberResidentDue.activeReceived,
      outstanding: octoberResidentDue.outstanding,
      paymentRequestStatus: octoberResidentDue.paymentRequestStatus,
      receiptCount: octoberResidentDue.receipts.length,
    }).toEqual({
      status: "unpaid",
      periodTiming: "current",
      dueDate: "2026-10-10",
      activeReceived: 0,
      outstanding: MONTHLY_AMOUNT,
      paymentRequestStatus: null,
      receiptCount: 0,
    });

    const futureResidentDues = residentDues.filter((due) => due.month === 11 || due.month === 12);
    expect(futureResidentDues.length).toBe(2);
    expect(futureResidentDues.every((due) =>
      due.status === "unpaid" &&
      due.periodTiming === "future" &&
      due.activeReceived === 0 &&
      due.outstanding === MONTHLY_AMOUNT &&
      due.receipts.length === 0,
    )).toBe(true);

    const report = await getRtFinancialReport(database, chairmanPrincipal, {
      year: 2026,
      businessDate: WORKBOOK_FINANCIAL_BUSINESS_DATE,
    });
    expect(report.asOf).toEqual({ businessDate: WORKBOOK_FINANCIAL_BUSINESS_DATE, period: "2026-10" });
    expect(report.dueNowOutstanding).toBe(MONTHLY_AMOUNT);
    expect(report.futureUnpaidOutstanding).toBe(2 * MONTHLY_AMOUNT);
    expect(report.yearly).toEqual({
      target: 12 * MONTHLY_AMOUNT,
      effectiveTarget: 12 * MONTHLY_AMOUNT,
      received: 9 * MONTHLY_AMOUNT,
      openingBalanceReceived: 0,
      transferReceived: 9 * MONTHLY_AMOUNT,
      cashReceived: 0,
      waived: 0,
      outstanding: 3 * MONTHLY_AMOUNT,
      obligationCount: 12,
      waivedCount: 0,
      notDueCount: 0,
      overdueCount: 1,
    });
    expect(report.monthly.length).toBe(12);
    expect(report.monthly.slice(0, 9).every((month) =>
      month.received === MONTHLY_AMOUNT &&
      month.transferReceived === MONTHLY_AMOUNT &&
      month.cashReceived === 0 &&
      month.outstanding === 0 &&
      month.overdueCount === 0,
    )).toBe(true);
    expect(report.monthly[9]?.overdueCount).toBe(1);
    expect(report.monthly[10]?.overdueCount).toBe(0);
    expect(report.monthly[11]?.overdueCount).toBe(0);
    expect(report.yearly.effectiveTarget).toBe(
      report.yearly.received + report.yearly.waived + report.yearly.outstanding,
    );
    expect({
      totalOutstanding: report.arrears.totalOutstanding,
      count: report.arrears.count,
      householdCount: report.arrears.householdCount,
      periods: report.arrears.households.flatMap((household) =>
        household.periods.map((period) => ({
          month: period.month,
          dueDate: period.dueDate,
          outstanding: period.outstanding,
          pending: period.pending,
        })),
      ),
    }).toEqual({
      totalOutstanding: MONTHLY_AMOUNT,
      count: 1,
      householdCount: 1,
      periods: [{
        month: 10,
        dueDate: "2026-10-10",
        outstanding: MONTHLY_AMOUNT,
        pending: false,
      }],
    });
  });

  it("settles Jan-Sep for both workbook residents through the five-account isolated fixture", async () => {
    const fixture = await bootstrapWorkbookSyntheticAccountFixture(database, makeWorkbookRoster());
    const rtUnitId = fixture.rtUnitId;
    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "draft",
    }).returning({ id: billingYears.id });
    if (!billingYear) throw new Error("Could not create the isolated 2026 billing year.");

    const [feeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear.id,
      effectiveMonth: 1,
      monthlyAmount: MONTHLY_AMOUNT,
    });
    if (!feeRate) throw new Error("Could not create the isolated January tariff.");

    const settlements = [];
    for (const residentPrincipal of fixture.principals.residents) {
      if (!residentPrincipal.householdId) throw new Error("The workbook resident household is missing.");
      settlements.push(await createWorkbookFinancialSettlementFixture({
        database,
        rtUnitId,
        householdId: residentPrincipal.householdId,
        billingYearId: billingYear.id,
        chairmanPrincipal: fixture.principals.chairman,
        residentPrincipal,
        treasurerPrincipal: fixture.principals.treasurer,
      }));
    }

    expect(settlements).toHaveLength(2);
    expect(settlements.every((result) =>
      result.generatedDuesCount === 12 &&
      result.replayedGenerationInsertCount === 0 &&
      result.requestPeriods.join(",") === SETTLED_PERIODS.join(",") &&
      result.requestTotalAmount === 9 * MONTHLY_AMOUNT &&
      result.requestReplayMatched &&
      result.verifiedItemCount === 9 &&
      result.verifiedTotalAmount === 9 * MONTHLY_AMOUNT &&
      result.duplicateVerificationRejected,
    )).toBe(true);

    for (const residentPrincipal of fixture.principals.residents) {
      const residentDues = await getResidentMonthlyDues(database, residentPrincipal, WORKBOOK_FINANCIAL_BUSINESS_DATE);
      expect(residentDues).toHaveLength(12);
      expect(residentDues.filter((due) => due.month <= 9).every((due) =>
        due.status === "paid" &&
        due.activeReceived === MONTHLY_AMOUNT &&
        due.outstanding === 0 &&
        due.receipts.length === 1 &&
        due.receipts[0]?.method === "transfer" &&
        due.receipts[0]?.allocationAmount === MONTHLY_AMOUNT,
      )).toBe(true);
      const october = residentDues.find((due) => due.month === 10);
      expect(october && {
        status: october.status,
        periodTiming: october.periodTiming,
        activeReceived: october.activeReceived,
        outstanding: october.outstanding,
        receiptCount: october.receipts.length,
      }).toEqual({
        status: "unpaid",
        periodTiming: "current",
        activeReceived: 0,
        outstanding: MONTHLY_AMOUNT,
        receiptCount: 0,
      });
      const future = residentDues.filter((due) => due.month === 11 || due.month === 12);
      expect(future.length).toBe(2);
      expect(future.every((due) => due.periodTiming === "future" && due.receipts.length === 0)).toBe(true);
    }

    const report = await getRtFinancialReport(database, fixture.principals.chairman, {
      year: 2026,
      businessDate: WORKBOOK_FINANCIAL_BUSINESS_DATE,
    });
    expect(report.yearly.received).toBe(18 * MONTHLY_AMOUNT);
    expect(report.yearly.outstanding).toBe(6 * MONTHLY_AMOUNT);
    expect(report.yearly.overdueCount).toBe(2);
    expect(report.futureUnpaidOutstanding).toBe(4 * MONTHLY_AMOUNT);
    expect(report.arrears.householdCount).toBe(2);
    expect(report.arrears.totalOutstanding).toBe(2 * MONTHLY_AMOUNT);
  });
});
