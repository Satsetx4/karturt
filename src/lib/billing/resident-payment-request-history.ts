import { and, desc, eq, inArray, lt, or, asc } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { paymentRequestItems, paymentRequests } from "@/db/schema";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";

const requestCodePattern = /^KRT-[A-F0-9]{16}$/;
const pageSize = 50;

export class InvalidResidentPaymentHistoryCursorError extends Error {}
export class ResidentPaymentHistoryInvariantError extends Error {}

export async function getResidentPaymentRequestHistory(
  database: AppDatabase,
  principal: Principal,
  cursor?: string,
) {
  if (principal.role !== "resident" || !principal.rtUnitId || !principal.householdId) {
    throw new Error("Forbidden: payment request history is available only to an active resident principal.");
  }
  assertCanPerform(principal, "payment:history:self", {
    rtUnitId: principal.rtUnitId,
    householdId: principal.householdId,
  });

  const scope = and(
    eq(paymentRequests.rtUnitId, principal.rtUnitId),
    eq(paymentRequests.householdId, principal.householdId),
    eq(paymentRequests.requestedByAccountId, principal.appAccountId),
  );

  let cursorCondition;
  if (cursor !== undefined) {
    if (!requestCodePattern.test(cursor)) {
      throw new InvalidResidentPaymentHistoryCursorError("Payment request history cursor is invalid.");
    }
    const [anchor] = await database
      .select({ id: paymentRequests.id, createdAt: paymentRequests.createdAt })
      .from(paymentRequests)
      .where(and(scope, eq(paymentRequests.requestCode, cursor)))
      .limit(1);
    if (!anchor) throw new InvalidResidentPaymentHistoryCursorError("Payment request history cursor is invalid.");
    cursorCondition = or(
      lt(paymentRequests.createdAt, anchor.createdAt),
      and(eq(paymentRequests.createdAt, anchor.createdAt), lt(paymentRequests.id, anchor.id)),
    );
  }

  const rows = await database
    .select({
      id: paymentRequests.id,
      requestCode: paymentRequests.requestCode,
      status: paymentRequests.status,
      createdAt: paymentRequests.createdAt,
      resolvedAt: paymentRequests.resolvedAt,
      resolutionReason: paymentRequests.resolutionReason,
      totalAmount: paymentRequests.totalAmount,
      itemCount: paymentRequests.itemCount,
    })
    .from(paymentRequests)
    .where(cursorCondition ? and(scope, cursorCondition) : scope)
    .orderBy(desc(paymentRequests.createdAt), desc(paymentRequests.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const requestIds = page.map((row) => row.id);
  const itemRows = requestIds.length === 0
    ? []
    : await database
      .select({ requestId: paymentRequestItems.requestId, period: paymentRequestItems.period, amount: paymentRequestItems.amount })
      .from(paymentRequestItems)
      .where(inArray(paymentRequestItems.requestId, requestIds))
      .orderBy(asc(paymentRequestItems.period));
  const itemsByRequest = new Map<string, Array<{ period: string; amount: number }>>();
  for (const item of itemRows) {
    const items = itemsByRequest.get(item.requestId) ?? [];
    items.push({ period: item.period, amount: item.amount });
    itemsByRequest.set(item.requestId, items);
  }

  const requests = page.map((row) => {
    const items = itemsByRequest.get(row.id) ?? [];
    if (
      items.length !== row.itemCount ||
      items.reduce((total, item) => total + item.amount, 0) !== row.totalAmount
    ) {
      throw new ResidentPaymentHistoryInvariantError("Payment request history snapshot is inconsistent.");
    }
    return {
      requestCode: row.requestCode,
      status: row.status,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      items,
      totalAmount: row.totalAmount,
      resolutionReason: row.status === "rejected" ? row.resolutionReason : null,
    };
  });

  return {
    requests,
    nextCursor: hasMore ? requests.at(-1)?.requestCode ?? null : null,
  };
}
