import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { billingYears, monthlyDues, paymentAllocations, paymentReversals, payments } from "@/db/schema";
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
  assertCanPerform(principal, "billing:read:self", {
    rtUnitId: principal.rtUnitId,
    householdId: principal.householdId,
  });

  const currentPeriod = businessDate.slice(0, 7);
  const dues = await database
    .select({
      id: monthlyDues.id,
      billingYear: billingYears.year,
      month: monthlyDues.month,
      dueDate: monthlyDues.dueDate,
    })
    .from(monthlyDues)
    .innerJoin(billingYears, and(
      eq(billingYears.id, monthlyDues.billingYearId),
      eq(billingYears.rtUnitId, principal.rtUnitId),
    ))
    .where(and(
      eq(monthlyDues.rtUnitId, principal.rtUnitId),
      eq(monthlyDues.householdId, principal.householdId),
    ))
    .orderBy(asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id));

  if (dues.length === 0) return [];
  const balances = await getDueFinancialBalances(database, dues.map((due) => due.id));
  const balancesByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));
  if (balancesByDueId.size !== dues.length) {
    throw new Error("Resident due balance read did not match the requested dues.");
  }

  // A paid month can have multiple active payment allocations. Read only the
  // logged-in household's non-reversed allocations; do not expose other RTs.
  const paidIds = dues
    .filter((due) => balancesByDueId.get(due.id)?.status === "paid")
    .map((due) => due.id);
  const receiptRows = paidIds.length === 0 ? [] : await database
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
      eq(paymentAllocations.rtUnitId, principal.rtUnitId),
      eq(paymentAllocations.householdId, principal.householdId),
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
    const items = receiptsByDueId.get(row.monthlyDueId) ?? [];
    items.push({
      allocationAmount: row.amount,
      method: row.method,
      verifiedAt: row.verifiedAt.toISOString(),
      reference: `KRT-${row.paymentId.slice(0, 12).toUpperCase()}`,
    });
    receiptsByDueId.set(row.monthlyDueId, items);
  }

  return dues.map((due) => {
    const balance = balancesByDueId.get(due.id);
    if (!balance || balance.rtUnitId !== principal.rtUnitId || balance.householdId !== principal.householdId) {
      throw new Error("Resident due balance scope did not match the requested household.");
    }
    const period = `${due.billingYear}-${String(due.month).padStart(2, "0")}`;
    const receipts = balance.status === "paid" ? (receiptsByDueId.get(due.id) ?? []) : [];
    if (receipts.length > 0 &&
        receipts.reduce((total, item) => total + item.allocationAmount, 0) !== balance.activeReceived) {
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
      paymentRequestStatus: balance.hasPendingRequest ? "pending" as const : null,
    };
  });
}
