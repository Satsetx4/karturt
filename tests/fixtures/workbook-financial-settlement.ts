import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  activeDueSettlements,
  auditEvents,
  billingYears,
  monthlyDues,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { activateBillingYear } from "@/lib/billing/activation";
import { generateHouseholdDues } from "@/lib/billing/generator";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import {
  TreasurerPaymentRequestAlreadyProcessedError,
  verifyTreasurerPaymentRequest,
} from "@/lib/billing/treasurer-payment-verification";

export const WORKBOOK_FINANCIAL_BUSINESS_DATE = "2026-10-27";
export const WORKBOOK_FINANCIAL_YEAR = 2026;
export const WORKBOOK_FINANCIAL_SETTLEMENT_TARGET = "2026-09";

export type WorkbookFinancialSettlementInput = {
  database: AppDatabase;
  rtUnitId: string;
  householdId: string;
  billingYearId: string;
  chairmanPrincipal: Principal;
  residentPrincipal: Principal;
  treasurerPrincipal: Principal;
};

export type WorkbookFinancialSettlementResult = {
  generatedDuesCount: number;
  replayedGenerationInsertCount: number;
  requestPeriods: string[];
  requestTotalAmount: number;
  requestReplayMatched: boolean;
  verifiedItemCount: number;
  verifiedTotalAmount: number;
  duplicateVerificationRejected: boolean;
};

/**
 * Create a synthetic year of household dues and settle Jan-Sep through the
 * resident request and Treasurer verification services. Call only with a
 * fresh household in a disposable test database.
 */
export async function createWorkbookFinancialSettlementFixture(
  input: WorkbookFinancialSettlementInput,
): Promise<WorkbookFinancialSettlementResult> {
  if (
    input.chairmanPrincipal.role !== "rt_chairman" ||
    input.chairmanPrincipal.rtUnitId !== input.rtUnitId ||
    input.residentPrincipal.role !== "resident" ||
    input.residentPrincipal.rtUnitId !== input.rtUnitId ||
    input.residentPrincipal.householdId !== input.householdId ||
    input.treasurerPrincipal.role !== "treasurer" ||
    input.treasurerPrincipal.rtUnitId !== input.rtUnitId
  ) {
    throw new Error("Workbook finance fixture principals must match the target RT and household.");
  }

  const [year] = await input.database
    .select({ year: billingYears.year })
    .from(billingYears)
    .where(and(
      eq(billingYears.id, input.billingYearId),
      eq(billingYears.rtUnitId, input.rtUnitId),
    ))
    .limit(1);
  if (year?.year !== WORKBOOK_FINANCIAL_YEAR) {
    throw new Error("Workbook finance fixture requires a same-RT 2026 billing year.");
  }

  const existingDues = await input.database
    .select({ id: monthlyDues.id })
    .from(monthlyDues)
    .where(and(
      eq(monthlyDues.rtUnitId, input.rtUnitId),
      eq(monthlyDues.householdId, input.householdId),
    ));
  if (existingDues.length > 0) {
    throw new Error("Workbook finance fixture requires a fresh household.");
  }

  await activateBillingYear(input.database, input.chairmanPrincipal, {
    billingYearId: input.billingYearId,
  });

  const generated = await generateHouseholdDues(input.database, input.chairmanPrincipal, {
    householdId: input.householdId,
    billingYearId: input.billingYearId,
  });
  const replayedGeneration = await generateHouseholdDues(input.database, input.chairmanPrincipal, {
    householdId: input.householdId,
    billingYearId: input.billingYearId,
  });
  const [sampleDue] = await input.database.select({ amount: monthlyDues.amount }).from(monthlyDues).where(and(
    eq(monthlyDues.rtUnitId, input.rtUnitId),
    eq(monthlyDues.householdId, input.householdId),
    eq(monthlyDues.billingYearId, input.billingYearId),
  )).limit(1);
  if (!sampleDue || sampleDue.amount <= 0) throw new Error("The workbook financial tariff did not create a valid due.");
  const monthlyAmount = sampleDue.amount;

  const idempotencyKey = randomUUID();
  const request = await createResidentPaymentRequest(
    input.database,
    input.residentPrincipal,
    { period: WORKBOOK_FINANCIAL_SETTLEMENT_TARGET, idempotencyKey },
    WORKBOOK_FINANCIAL_BUSINESS_DATE,
  );
  const replayedRequest = await createResidentPaymentRequest(
    input.database,
    input.residentPrincipal,
    { period: WORKBOOK_FINANCIAL_SETTLEMENT_TARGET, idempotencyKey },
    WORKBOOK_FINANCIAL_BUSINESS_DATE,
  );
  const verified = await verifyTreasurerPaymentRequest(
    input.database,
    input.treasurerPrincipal,
    request.requestCode,
    WORKBOOK_FINANCIAL_BUSINESS_DATE,
  );

  let duplicateVerificationRejected = false;
  try {
    await verifyTreasurerPaymentRequest(
      input.database,
      input.treasurerPrincipal,
      request.requestCode,
      WORKBOOK_FINANCIAL_BUSINESS_DATE,
    );
  } catch (error) {
    if (!(error instanceof TreasurerPaymentRequestAlreadyProcessedError)) throw error;
    duplicateVerificationRejected = true;
  }

  const [verifiedRequest] = await input.database.select({
    id: paymentRequests.id,
    status: paymentRequests.status,
    itemCount: paymentRequests.itemCount,
    totalAmount: paymentRequests.totalAmount,
  }).from(paymentRequests).where(and(
    eq(paymentRequests.requestCode, request.requestCode),
    eq(paymentRequests.rtUnitId, input.rtUnitId),
    eq(paymentRequests.householdId, input.householdId),
  )).limit(1);
  if (!verifiedRequest) throw new Error("The workbook payment request could not be verified.");
  const requestId = verifiedRequest.id;
  const requestItems = await input.database.select({
    period: paymentRequestItems.period,
    amount: paymentRequestItems.amount,
  }).from(paymentRequestItems).where(eq(paymentRequestItems.requestId, requestId))
    .orderBy(paymentRequestItems.period);
  const paymentRows = await input.database.select({
    amount: payments.amount,
    method: payments.method,
  }).from(payments).where(and(
    eq(payments.paymentRequestId, requestId),
    eq(payments.rtUnitId, input.rtUnitId),
    eq(payments.householdId, input.householdId),
  ));
  const allocationRows = await input.database.select({
    month: monthlyDues.month,
    amount: paymentAllocations.amount,
  }).from(paymentAllocations).innerJoin(monthlyDues, and(
    eq(monthlyDues.id, paymentAllocations.monthlyDueId),
    eq(monthlyDues.rtUnitId, paymentAllocations.rtUnitId),
    eq(monthlyDues.householdId, paymentAllocations.householdId),
  )).where(and(
    eq(paymentAllocations.paymentRequestId, requestId),
    eq(paymentAllocations.rtUnitId, input.rtUnitId),
    eq(paymentAllocations.householdId, input.householdId),
  )).orderBy(monthlyDues.month);
  const settlementRows = await input.database.select({
    month: monthlyDues.month,
    amount: activeDueSettlements.amount,
  }).from(activeDueSettlements).innerJoin(monthlyDues, and(
    eq(monthlyDues.id, activeDueSettlements.monthlyDueId),
    eq(monthlyDues.rtUnitId, activeDueSettlements.rtUnitId),
    eq(monthlyDues.householdId, activeDueSettlements.householdId),
  )).where(and(
    eq(activeDueSettlements.rtUnitId, input.rtUnitId),
    eq(activeDueSettlements.householdId, input.householdId),
  )).orderBy(monthlyDues.month);
  const remainingClaims = await input.database.select({ requestId: paymentRequestClaims.requestId })
    .from(paymentRequestClaims).where(eq(paymentRequestClaims.requestId, requestId));
  const householdDues = await input.database.select({
    id: monthlyDues.id,
    month: monthlyDues.month,
    amount: monthlyDues.amount,
    dueDate: monthlyDues.dueDate,
    status: monthlyDues.status,
  })
    .from(monthlyDues).where(and(
      eq(monthlyDues.rtUnitId, input.rtUnitId),
      eq(monthlyDues.householdId, input.householdId),
      eq(monthlyDues.billingYearId, input.billingYearId),
    )).orderBy(monthlyDues.month);
  const october = householdDues.find((due) => due.month === 10);
  const octoberAllocations = october ? await input.database.select({ id: paymentAllocations.id })
    .from(paymentAllocations).where(eq(paymentAllocations.monthlyDueId, october.id)) : [];
  const octoberSettlements = october ? await input.database.select({ allocationId: activeDueSettlements.allocationId })
    .from(activeDueSettlements).where(eq(activeDueSettlements.monthlyDueId, october.id)) : [];
  const requestAuditActions = await input.database.select({ action: auditEvents.action })
    .from(auditEvents).where(and(
      eq(auditEvents.entityType, "payment_request"),
      eq(auditEvents.entityId, requestId),
    ));
  const settledMonths = Array.from({ length: 9 }, (_, index) => index + 1);
  const residentDues = await getResidentMonthlyDues(
    input.database,
    input.residentPrincipal,
    WORKBOOK_FINANCIAL_BUSINESS_DATE,
  );
  const paidResidentDues = residentDues.filter((due) => due.month <= 9);
  const octoberResidentDue = residentDues.find((due) => due.month === 10);
  const futureResidentDues = residentDues.filter((due) => due.month === 11 || due.month === 12);
  if (
    verified.itemCount !== 9 || verified.totalAmount !== 9 * monthlyAmount ||
    verifiedRequest?.status !== "verified" || verifiedRequest.itemCount !== 9 ||
    verifiedRequest.totalAmount !== 9 * monthlyAmount ||
    requestItems.length !== 9 || requestItems.some((item, index) => (
      item.period !== `2026-${String(index + 1).padStart(2, "0")}` || item.amount !== monthlyAmount
    )) ||
    paymentRows.length !== 1 || paymentRows[0]?.amount !== verified.totalAmount || paymentRows[0]?.method !== "transfer" ||
    allocationRows.length !== 9 || allocationRows.some((row, index) => row.month !== settledMonths[index] || row.amount !== monthlyAmount) ||
    settlementRows.length !== 9 || settlementRows.some((row, index) => row.month !== settledMonths[index] || row.amount !== monthlyAmount) ||
    remainingClaims.length !== 0 || householdDues.length !== 12 ||
    householdDues.some((due, index) => (
      due.month !== index + 1 || due.amount !== monthlyAmount ||
      (index < 9 && due.status !== "paid") ||
      (index >= 9 && due.status !== "unpaid")
    )) ||
    !october || octoberAllocations.length !== 0 || octoberSettlements.length !== 0 ||
    paidResidentDues.length !== 9 || paidResidentDues.some((due) => (
      due.status !== "paid" || due.activeReceived !== monthlyAmount || due.outstanding !== 0 ||
      due.receipts.length !== 1 || due.receipts[0]?.method !== "transfer" ||
      due.receipts[0]?.allocationAmount !== monthlyAmount
    )) ||
    !octoberResidentDue || octoberResidentDue.status !== "unpaid" ||
    octoberResidentDue.activeReceived !== 0 || octoberResidentDue.receipts.length !== 0 ||
    futureResidentDues.length !== 2 || futureResidentDues.some((due) => (
      due.status !== "unpaid" || due.periodTiming !== "future" || due.receipts.length !== 0
    )) ||
    requestAuditActions.length !== 2 ||
    !requestAuditActions.some((event) => event.action === "payment_request.created") ||
    !requestAuditActions.some((event) => event.action === "payment_request.verified")
  ) throw new Error("The workbook financial ledger, verification, allocation, or receipt invariant failed.");

  return {
    generatedDuesCount: generated.insertedCount,
    replayedGenerationInsertCount: replayedGeneration.insertedCount,
    requestPeriods: request.periods,
    requestTotalAmount: request.totalAmount,
    requestReplayMatched:
      replayedRequest.idempotentReplay &&
      replayedRequest.requestCode === request.requestCode &&
      replayedRequest.totalAmount === request.totalAmount &&
      replayedRequest.periods.join(",") === request.periods.join(","),
    verifiedItemCount: verified.itemCount,
    verifiedTotalAmount: verified.totalAmount,
    duplicateVerificationRejected,
  };
}
