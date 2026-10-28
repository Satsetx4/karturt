import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  billingYears,
  monthlyDues,
  paymentAllocations,
  paymentReversals,
  payments,
  sheet2ImportBatches,
  sheet2OpeningBalanceItems,
} from "@/db/schema";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import type { ResidentMonthReceipt } from "@/lib/billing/resident-card";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";

export async function getResidentMonthlyDues(
  database: AppDatabase,
  principal: Principal,
  businessDate = jakartaBusinessDate(),
) {
  if (principal.role !== "resident" || !principal.rtUnitId || !principal.householdId) {
    throw new Error("Forbidden: monthly dues are available only to an active resident principal.");
  }
  const rtUnitId = principal.rtUnitId;
  const householdId = principal.householdId;
  assertCanPerform(principal, "billing:read:self", {
    rtUnitId,
    householdId,
  });

  return database.transaction(async (transaction) => {
    const dues = await transaction
      .select({
        id: monthlyDues.id,
        billingYear: billingYears.year,
        month: monthlyDues.month,
        dueDate: monthlyDues.dueDate,
      })
      .from(monthlyDues)
      .innerJoin(billingYears, and(
        eq(billingYears.id, monthlyDues.billingYearId),
        eq(billingYears.rtUnitId, rtUnitId),
      ))
      .where(and(
        eq(monthlyDues.rtUnitId, rtUnitId),
        eq(monthlyDues.householdId, householdId),
      ))
      .orderBy(asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id));

    if (dues.length === 0) return [];
    const balances = await getDueFinancialBalances(transaction, dues.map((due) => due.id));
    const balancesByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));
    if (balancesByDueId.size !== dues.length) {
      throw new Error("Resident due balance read did not match the requested dues.");
    }

    // Keep ledger, balance, and receipt reads on one snapshot while a payment is reversed.
    const paidIds = dues
      .filter((due) => balancesByDueId.get(due.id)?.status === "paid")
      .map((due) => due.id);
    const openingRows = dues.length === 0 ? [] : await transaction
      .select({
        monthlyDueId: sheet2OpeningBalanceItems.monthlyDueId,
        amount: sheet2OpeningBalanceItems.amount,
        sourceSheet: sheet2ImportBatches.sourceSheet,
        asOfDate: sheet2ImportBatches.asOfDate,
        recordedAt: sheet2OpeningBalanceItems.recordedAt,
      })
      .from(sheet2OpeningBalanceItems)
      .innerJoin(sheet2ImportBatches, and(
        eq(sheet2ImportBatches.id, sheet2OpeningBalanceItems.importBatchId),
        eq(sheet2ImportBatches.rtUnitId, sheet2OpeningBalanceItems.rtUnitId),
      ))
      .where(and(
        eq(sheet2OpeningBalanceItems.rtUnitId, rtUnitId),
        eq(sheet2OpeningBalanceItems.householdId, householdId),
        inArray(sheet2OpeningBalanceItems.monthlyDueId, dues.map((due) => due.id)),
      ))
      .orderBy(asc(sheet2OpeningBalanceItems.monthlyDueId));
    const openingBalanceByDueId = new Map(openingRows.map((row) => {
      if (
        row.sourceSheet !== "Sheet2" ||
        !Number.isSafeInteger(row.amount) || row.amount <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.asOfDate)
      ) throw new Error("Stored Sheet2 opening balance metadata is invalid.");
      return [row.monthlyDueId, {
        amount: row.amount,
        sourceSheet: "Sheet2" as const,
        asOfDate: row.asOfDate,
        recordedAt: row.recordedAt.toISOString(),
      }] as const;
    }));
    if (openingBalanceByDueId.size !== openingRows.length) {
      throw new Error("A monthly due has more than one imported opening balance.");
    }
    const receiptRows = paidIds.length === 0 ? [] : await transaction
      .select({
        monthlyDueId: paymentAllocations.monthlyDueId,
        amount: paymentAllocations.amount,
        paymentId: payments.id,
        method: payments.method,
        verifiedAt: payments.verifiedAt,
      })
      .from(paymentAllocations)
      .innerJoin(payments, and(
        eq(payments.id, paymentAllocations.paymentId),
        eq(payments.rtUnitId, paymentAllocations.rtUnitId),
        eq(payments.householdId, paymentAllocations.householdId),
      ))
      .leftJoin(paymentReversals, and(
        eq(paymentReversals.paymentId, payments.id),
        eq(paymentReversals.rtUnitId, payments.rtUnitId),
        eq(paymentReversals.householdId, payments.householdId),
      ))
      .where(and(
        eq(paymentAllocations.rtUnitId, rtUnitId),
        eq(paymentAllocations.householdId, householdId),
        inArray(paymentAllocations.monthlyDueId, paidIds),
        isNull(paymentReversals.id),
      ))
      .orderBy(asc(paymentAllocations.monthlyDueId), asc(payments.verifiedAt), asc(paymentAllocations.id));

    const receiptsByDueId = new Map<string, ResidentMonthReceipt[]>();
    for (const row of receiptRows) {
      if (row.method !== "cash" && row.method !== "transfer") {
        throw new Error("Stored payment method is not supported for a resident receipt.");
      }
      if (!Number.isSafeInteger(row.amount) || row.amount <= 0) {
        throw new Error("Stored receipt allocation amount is invalid.");
      }
      const receipts = receiptsByDueId.get(row.monthlyDueId) ?? [];
      receipts.push({
        allocationAmount: row.amount,
        method: row.method,
        verifiedAt: row.verifiedAt.toISOString(),
        reference: `KRT-${row.paymentId.replace(/-/g, "").slice(0, 12).toUpperCase()}`,
      });
      receiptsByDueId.set(row.monthlyDueId, receipts);
    }
    const currentPeriod = businessDate.slice(0, 7);

    return dues.map((due) => {
      const balance = balancesByDueId.get(due.id);
      if (!balance || balance.rtUnitId !== rtUnitId || balance.householdId !== householdId) {
        throw new Error("Resident due balance scope did not match the requested household.");
      }
      const period = `${due.billingYear}-${String(due.month).padStart(2, "0")}`;
      const receipts = balance.status === "paid" ? (receiptsByDueId.get(due.id) ?? []) : [];
      const receiptTotal = receipts.reduce((total, receipt) => total + receipt.allocationAmount, 0);
      const openingBalanceImport = openingBalanceByDueId.get(due.id) ?? null;
      if ((openingBalanceImport?.amount ?? 0) !== balance.importedOpeningBalance) {
        throw new Error("Resident opening-balance rows do not reconcile to the financial balance.");
      }
      if (balance.status === "paid" &&
          receiptTotal !== balance.activeReceived - balance.importedOpeningBalance) {
        throw new Error("Resident receipt allocations do not reconcile to the active ledger.");
      }
      return {
        billingYear: due.billingYear,
        month: due.month,
        // Preserve the legacy amount field as the effective obligation amount.
        amount: balance.effectiveTarget,
        originalAmount: balance.originalAmount,
        adjustmentTotal: balance.adjustmentTotal,
        effectiveTarget: balance.effectiveTarget,
        activeReceived: balance.activeReceived,
        outstanding: balance.outstanding,
        dueDate: due.dueDate,
        status: balance.status,
        periodTiming: period < currentPeriod ? "past" as const
          : period > currentPeriod ? "future" as const : "current" as const,
        receipts,
        openingBalanceImport,
        paymentRequestStatus: balance.hasPendingRequest ? "pending" as const : null,
      };
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
