import { and, asc, eq, lt, lte, or } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { billingYears, monthlyDues } from "@/db/schema";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
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

  const [currentYear, currentMonth] = businessDate.split("-").slice(0, 2).map(Number);
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
      or(
        lt(billingYears.year, currentYear!),
        and(eq(billingYears.year, currentYear!), lte(monthlyDues.month, currentMonth!)),
      ),
    ))
    .orderBy(asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id));

  if (dues.length === 0) return [];
  const balances = await getDueFinancialBalances(database, dues.map((due) => due.id));
  const balancesByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));
  if (balancesByDueId.size !== dues.length) {
    throw new Error("Resident due balance read did not match the requested dues.");
  }

  return dues.map((due) => {
    const balance = balancesByDueId.get(due.id);
    if (!balance || balance.rtUnitId !== principal.rtUnitId || balance.householdId !== principal.householdId) {
      throw new Error("Resident due balance scope did not match the requested household.");
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
      paymentRequestStatus: balance.hasPendingRequest ? "pending" as const : null,
    };
  });
}
