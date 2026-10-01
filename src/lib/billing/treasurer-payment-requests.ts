import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  households,
  houses,
  officialAssignments,
  paymentRequestItems,
  paymentRequests,
  people,
} from "@/db/schema";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
import { officialAssignmentActiveOn, jakartaBusinessDate } from "@/lib/officials/lifecycle";

export type TreasurerRequestItem = { period: string; amount: number };

export type TreasurerPaymentRequest = {
  requestCode: string;
  status: "pending" | "verified" | "rejected" | "cancelled";
  residentName: string;
  houseNumber: string;
  createdAt: Date;
  verifiedAt: Date | null;
  resolvedAt: Date | null;
  resolutionReason: string | null;
  totalAmount: number;
  items: TreasurerRequestItem[];
};

export class TreasurerRequestNotFoundError extends Error {}

type TreasurerAuthDatabase = Pick<AppDatabase, "select">;

export async function assertActiveTreasurer(
  database: TreasurerAuthDatabase,
  principal: Principal,
  businessDate = jakartaBusinessDate(),
  permission: "payment:verify" | "payment:reject" | "payment:record_cash" | "payment:reverse" = "payment:verify",
) {
  if (principal.role !== "treasurer" || !principal.rtUnitId) {
    throw new Error("Forbidden: only an active Treasurer may access payment verification.");
  }
  assertCanPerform(principal, permission, { rtUnitId: principal.rtUnitId });

  const [account] = await database
    .select({ id: appAccounts.id, status: appAccounts.status })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.id, principal.appAccountId),
      eq(appAccounts.rtUnitId, principal.rtUnitId),
      eq(appAccounts.accountType, "official"),
    ))
    .limit(1)
    .for("share");
  if (!account || account.status !== "active") {
    throw new Error("Forbidden: only an active Treasurer may access payment verification.");
  }

  const assignments = await database
    .select({ id: officialAssignments.id })
    .from(officialAssignments)
    .where(and(
      eq(officialAssignments.appAccountId, principal.appAccountId),
      eq(officialAssignments.rtUnitId, principal.rtUnitId),
      eq(officialAssignments.role, "treasurer"),
      officialAssignmentActiveOn(businessDate),
    ))
    .orderBy(asc(officialAssignments.id))
    .limit(2)
    .for("share");
  if (assignments.length !== 1) {
    throw new Error("Forbidden: only an active Treasurer may access payment verification.");
  }

  return { rtUnitId: principal.rtUnitId, appAccountId: principal.appAccountId };
}

async function readItems(database: AppDatabase, requestIds: string[]) {
  if (requestIds.length === 0) return new Map<string, TreasurerRequestItem[]>();
  const rows = await database
    .select({
      requestId: paymentRequestItems.requestId,
      period: paymentRequestItems.period,
      amount: paymentRequestItems.amount,
    })
    .from(paymentRequestItems)
    .where(inArray(paymentRequestItems.requestId, requestIds))
    .orderBy(asc(paymentRequestItems.requestId), asc(paymentRequestItems.period));
  const grouped = new Map<string, TreasurerRequestItem[]>();
  for (const row of rows) {
    const items = grouped.get(row.requestId) ?? [];
    items.push({ period: row.period, amount: row.amount });
    grouped.set(row.requestId, items);
  }
  return grouped;
}

function assertSnapshot(items: TreasurerRequestItem[], itemCount: number, totalAmount: number) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  if (
    items.length !== itemCount ||
    !Number.isSafeInteger(total) ||
    total !== totalAmount ||
    items.some((item, index) => index > 0 && items[index - 1]!.period >= item.period)
  ) {
    throw new Error("Payment request snapshot is inconsistent.");
  }
}

export async function getTreasurerPaymentRequestQueue(
  database: AppDatabase,
  principal: Principal,
  businessDate = jakartaBusinessDate(),
): Promise<TreasurerPaymentRequest[]> {
  const { rtUnitId } = await assertActiveTreasurer(database, principal, businessDate);
  const requests = await database
    .select({
      id: paymentRequests.id,
      requestCode: paymentRequests.requestCode,
      status: paymentRequests.status,
      residentName: people.fullName,
      houseNumber: houses.number,
      createdAt: paymentRequests.createdAt,
      verifiedAt: paymentRequests.verifiedAt,
      resolvedAt: paymentRequests.resolvedAt,
      resolutionReason: paymentRequests.resolutionReason,
      totalAmount: paymentRequests.totalAmount,
      itemCount: paymentRequests.itemCount,
    })
    .from(paymentRequests)
    .innerJoin(households, and(
      eq(households.rtUnitId, paymentRequests.rtUnitId),
      eq(households.id, paymentRequests.householdId),
    ))
    .innerJoin(houses, and(
      eq(houses.rtUnitId, households.rtUnitId),
      eq(houses.id, households.houseId),
    ))
    .innerJoin(appAccounts, and(
      eq(appAccounts.rtUnitId, paymentRequests.rtUnitId),
      eq(appAccounts.id, paymentRequests.requestedByAccountId),
      eq(appAccounts.accountType, "resident"),
    ))
    .innerJoin(people, and(
      eq(people.rtUnitId, appAccounts.rtUnitId),
      eq(people.id, appAccounts.personId),
    ))
    .where(and(
      eq(paymentRequests.rtUnitId, rtUnitId),
      eq(paymentRequests.status, "pending"),
    ))
    .orderBy(asc(paymentRequests.createdAt), asc(paymentRequests.id));

  const itemsByRequest = await readItems(database, requests.map((request) => request.id));
  return requests.map((request) => {
    const items = itemsByRequest.get(request.id) ?? [];
    assertSnapshot(items, request.itemCount, request.totalAmount);
    return {
      requestCode: request.requestCode,
      status: request.status,
      residentName: request.residentName,
      houseNumber: request.houseNumber,
      createdAt: request.createdAt,
      verifiedAt: request.verifiedAt,
      resolvedAt: request.resolvedAt,
      resolutionReason: request.resolutionReason,
      totalAmount: request.totalAmount,
      items,
    };
  });
}

export async function getTreasurerPaymentRequestDetail(
  database: AppDatabase,
  principal: Principal,
  requestCode: string,
  businessDate = jakartaBusinessDate(),
): Promise<TreasurerPaymentRequest | null> {
  const { rtUnitId } = await assertActiveTreasurer(database, principal, businessDate);
  const [request] = await database
    .select({
      id: paymentRequests.id,
      requestCode: paymentRequests.requestCode,
      status: paymentRequests.status,
      residentName: people.fullName,
      houseNumber: houses.number,
      createdAt: paymentRequests.createdAt,
      verifiedAt: paymentRequests.verifiedAt,
      resolvedAt: paymentRequests.resolvedAt,
      resolutionReason: paymentRequests.resolutionReason,
      totalAmount: paymentRequests.totalAmount,
      itemCount: paymentRequests.itemCount,
    })
    .from(paymentRequests)
    .innerJoin(households, and(
      eq(households.rtUnitId, paymentRequests.rtUnitId),
      eq(households.id, paymentRequests.householdId),
    ))
    .innerJoin(houses, and(
      eq(houses.rtUnitId, households.rtUnitId),
      eq(houses.id, households.houseId),
    ))
    .innerJoin(appAccounts, and(
      eq(appAccounts.rtUnitId, paymentRequests.rtUnitId),
      eq(appAccounts.id, paymentRequests.requestedByAccountId),
      eq(appAccounts.accountType, "resident"),
    ))
    .innerJoin(people, and(
      eq(people.rtUnitId, appAccounts.rtUnitId),
      eq(people.id, appAccounts.personId),
    ))
    .where(and(
      eq(paymentRequests.rtUnitId, rtUnitId),
      eq(paymentRequests.requestCode, requestCode),
    ))
    .limit(1);
  if (!request) return null;

  const itemsByRequest = await readItems(database, [request.id]);
  const items = itemsByRequest.get(request.id) ?? [];
  assertSnapshot(items, request.itemCount, request.totalAmount);
  return {
    requestCode: request.requestCode,
    status: request.status,
    residentName: request.residentName,
    houseNumber: request.houseNumber,
    createdAt: request.createdAt,
    verifiedAt: request.verifiedAt,
    resolvedAt: request.resolvedAt,
    resolutionReason: request.resolutionReason,
    totalAmount: request.totalAmount,
    items,
  };
}
