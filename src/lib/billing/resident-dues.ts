import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { billingYears, monthlyDues } from "@/db/schema";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";

export async function getResidentMonthlyDues(database: AppDatabase, principal: Principal) {
  if (principal.role !== "resident" || !principal.rtUnitId || !principal.householdId) {
    throw new Error("Forbidden: monthly dues are available only to an active resident principal.");
  }
  assertCanPerform(principal, "billing:read:self", {
    rtUnitId: principal.rtUnitId,
    householdId: principal.householdId,
  });

  return database
    .select({
      billingYear: billingYears.year,
      month: monthlyDues.month,
      amount: monthlyDues.amount,
      dueDate: monthlyDues.dueDate,
      status: monthlyDues.status,
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
    .orderBy(asc(billingYears.year), asc(monthlyDues.month));
}
