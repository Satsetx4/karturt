// Frozen F19 reader from 7493fa0, used only by the local synthetic F23 benchmark.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { paymentRequests, payments, paymentReversals } from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { resolvePrincipalForUser } from "@/lib/auth/principal";

export class PaymentNotificationsForbiddenError extends Error {}

export async function getBaselinePaymentNotifications(database: AppDatabase, principal: Principal) {
  if (principal.role !== "resident" && principal.role !== "treasurer") throw new PaymentNotificationsForbiddenError();
  const active = await resolvePrincipalForUser(database, principal.authUserId);
  if (active.appAccountId !== principal.appAccountId || active.role !== principal.role ||
      active.rtUnitId !== principal.rtUnitId || active.householdId !== principal.householdId || !active.rtUnitId) {
    throw new PaymentNotificationsForbiddenError();
  }
  const isResident = active.role === "resident";
  const eventAt = sql<Date>`coalesce(${paymentReversals.reversedAt}, ${paymentRequests.resolvedAt}, ${paymentRequests.verifiedAt}, ${paymentRequests.createdAt})`.mapWith(paymentRequests.createdAt);
  const rows = await database.select({
    id: paymentRequests.id, requestCode: paymentRequests.requestCode,
    status: paymentRequests.status, reversedAt: paymentReversals.reversedAt, eventAt,
  }).from(paymentRequests)
    .leftJoin(payments, and(eq(payments.paymentRequestId, paymentRequests.id), eq(payments.rtUnitId, paymentRequests.rtUnitId), eq(payments.householdId, paymentRequests.householdId)))
    .leftJoin(paymentReversals, and(eq(paymentReversals.paymentId, payments.id), eq(paymentReversals.rtUnitId, paymentRequests.rtUnitId), eq(paymentReversals.householdId, paymentRequests.householdId)))
    .where(and(eq(paymentRequests.rtUnitId, active.rtUnitId), isResident
      ? and(eq(paymentRequests.requestedByAccountId, active.appAccountId), eq(paymentRequests.householdId, active.householdId!), inArray(paymentRequests.status, ["verified", "rejected"]))
      : eq(paymentRequests.status, "pending")))
    .orderBy(desc(eventAt), desc(paymentRequests.id)).limit(21);
  return {
    viewerAccountId: active.appAccountId, role: active.role, checkedAt: new Date().toISOString(), hasMore: rows.length > 20,
    items: rows.slice(0, 20).map((row) => ({
      requestCode: row.requestCode,
      status: row.reversedAt ? "reversed" as const : row.status as "pending" | "verified" | "rejected",
      occurredAt: row.eventAt.toISOString(),
    })),
  };
}
export type BaselineNotificationFeed = Awaited<ReturnType<typeof getBaselinePaymentNotifications>>;
