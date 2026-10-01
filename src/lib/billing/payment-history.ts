import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  billingYears,
  households,
  houses,
  monthlyDues,
  paymentAllocations,
  paymentReversals,
  paymentRequests,
  payments,
  people,
} from "@/db/schema";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
import { assertActiveTreasurer } from "@/lib/billing/treasurer-payment-requests";

const pageSize = 50;
const paymentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidTreasurerPaymentHistoryCursorError extends Error {}
export class InvalidResidentPaymentHistoryPageError extends Error {}
export class PaymentHistoryInvariantError extends Error {}

function canonicalPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function assertHistoryAmounts(
  paymentsOnPage: Array<{ id: string; amount: number }>,
  periodsByPayment: Map<string, Array<{ period: string; amount: number }>>,
) {
  for (const payment of paymentsOnPage) {
    const items = periodsByPayment.get(payment.id) ?? [];
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    if (
      items.length === 0 ||
      !Number.isSafeInteger(total) ||
      total !== payment.amount ||
      items.some((item, index) => index > 0 && items[index - 1]!.period >= item.period)
    ) {
      throw new PaymentHistoryInvariantError("Payment history allocations do not match the immutable ledger.");
    }
  }
}

async function readPeriodRows(database: AppDatabase, paymentIds: string[]) {
  if (paymentIds.length === 0) return new Map<string, Array<{ period: string; amount: number }>>();
  const rows = await database
    .select({
      paymentId: paymentAllocations.paymentId,
      year: billingYears.year,
      month: monthlyDues.month,
      amount: paymentAllocations.amount,
    })
    .from(paymentAllocations)
    .innerJoin(monthlyDues, and(
      eq(monthlyDues.rtUnitId, paymentAllocations.rtUnitId),
      eq(monthlyDues.householdId, paymentAllocations.householdId),
      eq(monthlyDues.id, paymentAllocations.monthlyDueId),
    ))
    .innerJoin(billingYears, and(
      eq(billingYears.rtUnitId, monthlyDues.rtUnitId),
      eq(billingYears.id, monthlyDues.billingYearId),
    ))
    .where(inArray(paymentAllocations.paymentId, paymentIds))
    .orderBy(asc(paymentAllocations.paymentId), asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id));
  const grouped = new Map<string, Array<{ period: string; amount: number }>>();
  for (const row of rows) {
    const items = grouped.get(row.paymentId) ?? [];
    items.push({ period: canonicalPeriod(row.year, row.month), amount: row.amount });
    grouped.set(row.paymentId, items);
  }
  return grouped;
}

export async function getTreasurerPaymentHistory(
  database: AppDatabase,
  principal: Principal,
  cursor?: string,
  businessDate?: string,
) {
  const { rtUnitId } = await assertActiveTreasurer(database, principal, businessDate, "payment:reverse");
  let cursorCondition;
  if (cursor !== undefined) {
    if (!paymentIdPattern.test(cursor)) throw new InvalidTreasurerPaymentHistoryCursorError("Payment history cursor is invalid.");
    const [anchor] = await database
      .select({ id: payments.id, verifiedAt: payments.verifiedAt })
      .from(payments)
      .where(and(eq(payments.rtUnitId, rtUnitId), eq(payments.id, cursor)))
      .limit(1);
    if (!anchor) throw new InvalidTreasurerPaymentHistoryCursorError("Payment history cursor is invalid.");
    cursorCondition = or(
      lt(payments.verifiedAt, anchor.verifiedAt),
      and(eq(payments.verifiedAt, anchor.verifiedAt), lt(payments.id, anchor.id)),
    );
  }

  const rows = await database
    .select({
      id: payments.id,
      householdId: payments.householdId,
      houseNumber: houses.number,
      amount: payments.amount,
      method: payments.method,
      verifiedAt: payments.verifiedAt,
      requestCode: paymentRequests.requestCode,
    })
    .from(payments)
    .innerJoin(households, and(
      eq(households.rtUnitId, payments.rtUnitId),
      eq(households.id, payments.householdId),
    ))
    .innerJoin(houses, and(
      eq(houses.rtUnitId, households.rtUnitId),
      eq(houses.id, households.houseId),
    ))
    .leftJoin(paymentRequests, and(
      eq(paymentRequests.rtUnitId, payments.rtUnitId),
      eq(paymentRequests.householdId, payments.householdId),
      eq(paymentRequests.id, payments.paymentRequestId),
    ))
    .where(cursorCondition ? and(eq(payments.rtUnitId, rtUnitId), cursorCondition) : eq(payments.rtUnitId, rtUnitId))
    .orderBy(desc(payments.verifiedAt), desc(payments.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const ids = page.map((row) => row.id);
  const householdIds = [...new Set(page.map((row) => row.householdId))];
  const [periodsByPayment, reversals, residentRows] = ids.length === 0
    ? [new Map<string, Array<{ period: string; amount: number }>>(), [], []] as const
    : await Promise.all([
      readPeriodRows(database, ids),
      database.select({ paymentId: paymentReversals.paymentId, reversedAt: paymentReversals.reversedAt, reason: paymentReversals.reason })
        .from(paymentReversals)
        .where(inArray(paymentReversals.paymentId, ids)),
      database.select({ householdId: appAccounts.householdId, fullName: people.fullName, accountId: appAccounts.id })
        .from(appAccounts)
        .innerJoin(people, and(
          eq(people.rtUnitId, appAccounts.rtUnitId),
          eq(people.id, appAccounts.personId),
        ))
        .where(and(
          eq(appAccounts.rtUnitId, rtUnitId),
          eq(appAccounts.accountType, "resident"),
          eq(appAccounts.status, "active"),
          inArray(appAccounts.householdId, householdIds),
        ))
        .orderBy(asc(appAccounts.householdId), asc(appAccounts.id)),
    ]);
  assertHistoryAmounts(page, periodsByPayment);
  const reversalByPayment = new Map(reversals.map((reversal) => [reversal.paymentId, reversal]));
  const residentNameByHousehold = new Map<string, string>();
  for (const resident of residentRows) {
    if (resident.householdId && !residentNameByHousehold.has(resident.householdId)) {
      residentNameByHousehold.set(resident.householdId, resident.fullName);
    }
  }

  const transactions = page.map((row) => {
    const reversal = reversalByPayment.get(row.id);
    const items = periodsByPayment.get(row.id) ?? [];
    if (row.method !== "transfer" && row.method !== "cash") {
      throw new PaymentHistoryInvariantError("Payment history contains an unsupported method.");
    }
    const method: "transfer" | "cash" = row.method;
    return {
      paymentId: row.id,
      residentName: residentNameByHousehold.get(row.householdId) ?? null,
      houseNumber: row.houseNumber,
      method,
      periods: items.map((item) => item.period),
      totalAmount: row.amount,
      paidAt: row.verifiedAt,
      requestCode: row.requestCode,
      lifecycle: reversal ? "reversed" as const : "active" as const,
      reversedAt: reversal?.reversedAt ?? null,
      reversalReason: reversal?.reason ?? null,
    };
  });
  return {
    transactions,
    nextCursor: hasMore ? transactions.at(-1)?.paymentId ?? null : null,
  };
}

export async function getResidentPaymentHistory(
  database: AppDatabase,
  principal: Principal,
  page = 1,
) {
  if (principal.role !== "resident" || !principal.rtUnitId || !principal.householdId) {
    throw new Error("Forbidden: payment history is available only to an active resident principal.");
  }
  assertCanPerform(principal, "payment:history:self", {
    rtUnitId: principal.rtUnitId,
    householdId: principal.householdId,
  });
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) {
    throw new InvalidResidentPaymentHistoryPageError("Payment history page is invalid.");
  }

  const rows = await database
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      paidAt: payments.verifiedAt,
      requestCode: paymentRequests.requestCode,
    })
    .from(payments)
    .leftJoin(paymentRequests, and(
      eq(paymentRequests.rtUnitId, payments.rtUnitId),
      eq(paymentRequests.householdId, payments.householdId),
      eq(paymentRequests.id, payments.paymentRequestId),
    ))
    .where(and(
      eq(payments.rtUnitId, principal.rtUnitId),
      eq(payments.householdId, principal.householdId),
    ))
    .orderBy(desc(payments.verifiedAt), desc(payments.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  const hasMore = rows.length > pageSize;
  const currentPage = hasMore ? rows.slice(0, pageSize) : rows;
  const ids = currentPage.map((row) => row.id);
  const [periodsByPayment, reversals] = ids.length === 0
    ? [new Map<string, Array<{ period: string; amount: number }>>(), []] as const
    : await Promise.all([
      readPeriodRows(database, ids),
      database.select({ paymentId: paymentReversals.paymentId, reversedAt: paymentReversals.reversedAt })
        .from(paymentReversals)
        .where(inArray(paymentReversals.paymentId, ids)),
    ]);
  assertHistoryAmounts(currentPage, periodsByPayment);
  const reversedPaymentIds = new Set(reversals.map((reversal) => reversal.paymentId));

  return {
    payments: currentPage.map((row) => {
      if (row.method !== "transfer" && row.method !== "cash") {
        throw new PaymentHistoryInvariantError("Payment history contains an unsupported method.");
      }
      const method: "transfer" | "cash" = row.method;
      return {
        method,
        periods: (periodsByPayment.get(row.id) ?? []).map((item) => item.period),
        totalAmount: row.amount,
        paidAt: row.paidAt,
        requestCode: row.requestCode,
        lifecycle: reversedPaymentIds.has(row.id) ? "reversed" as const : "active" as const,
        reversedAt: reversals.find((reversal) => reversal.paymentId === row.id)?.reversedAt ?? null,
      };
    }),
    nextPage: hasMore ? page + 1 : null,
  };
}
