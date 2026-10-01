import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  billingYears,
  monthlyDues,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  payments,
} from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { assertActiveTreasurer } from "@/lib/billing/treasurer-payment-requests";

export class TreasurerPaymentRequestNotFoundError extends Error {}
export class TreasurerPaymentRequestAlreadyProcessedError extends Error {}
export class TreasurerPaymentRequestConflictError extends Error {}
export class TreasurerPaymentLedgerInvariantError extends Error {}

export type TreasurerPaymentVerificationResult = {
  requestCode: string;
  status: "verified";
  itemCount: number;
  totalAmount: number;
  verifiedAt: Date;
};

function postgresUniqueViolation(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
      if (candidate.code === "23505") {
        return typeof candidate.constraint === "string" ? candidate.constraint : "";
      }
      current = candidate.cause;
    } else {
      break;
    }
  }
  return null;
}

function canonicalPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function verifyTreasurerPaymentRequest(
  database: AppDatabase,
  principal: Principal,
  requestCode: string,
  businessDate = jakartaBusinessDate(),
): Promise<TreasurerPaymentVerificationResult> {
  if (!/^KRT-[A-F0-9]{16}$/.test(requestCode)) {
    throw new TreasurerPaymentRequestNotFoundError("Payment request was not found.");
  }
  if (principal.role !== "treasurer" || !principal.rtUnitId) {
    throw new Error("Forbidden: only an active Treasurer may verify a payment request.");
  }
  const rtUnitId = principal.rtUnitId;
  assertCanPerform(principal, "payment:verify", { rtUnitId });

  try {
    return await database.transaction(async (transaction) => {
      const transactionDb = transaction as unknown as AppDatabase;
      await assertActiveTreasurer(transactionDb, principal, businessDate);

      const [request] = await transaction
        .select({
          id: paymentRequests.id,
          requestCode: paymentRequests.requestCode,
          rtUnitId: paymentRequests.rtUnitId,
          householdId: paymentRequests.householdId,
          status: paymentRequests.status,
          totalAmount: paymentRequests.totalAmount,
          itemCount: paymentRequests.itemCount,
        })
        .from(paymentRequests)
        .where(and(
          eq(paymentRequests.requestCode, requestCode),
          eq(paymentRequests.rtUnitId, rtUnitId),
        ))
        .limit(1)
        .for("update");

      if (!request) {
        throw new TreasurerPaymentRequestNotFoundError("Payment request was not found.");
      }
      if (request.status !== "pending") {
        if (request.status === "verified") {
          const [existingPayment] = await transaction
            .select({ id: payments.id })
            .from(payments)
            .where(eq(payments.paymentRequestId, request.id))
            .limit(1);
          if (!existingPayment) {
            throw new TreasurerPaymentLedgerInvariantError("Verified request has no payment ledger.");
          }
        }
        throw new TreasurerPaymentRequestAlreadyProcessedError("Payment request has already been processed.");
      }

      const items = await transaction
        .select({
          requestId: paymentRequestItems.requestId,
          rtUnitId: paymentRequestItems.rtUnitId,
          householdId: paymentRequestItems.householdId,
          monthlyDueId: paymentRequestItems.monthlyDueId,
          period: paymentRequestItems.period,
          amount: paymentRequestItems.amount,
        })
        .from(paymentRequestItems)
        .where(eq(paymentRequestItems.requestId, request.id))
        .orderBy(asc(paymentRequestItems.period), asc(paymentRequestItems.monthlyDueId));
      if (items.length === 0 || items.length !== request.itemCount) {
        throw new TreasurerPaymentLedgerInvariantError("Payment request item count does not match its snapshot.");
      }

      const itemDueIds = items.map((item) => item.monthlyDueId);
      const dues = await transaction
        .select({
          id: monthlyDues.id,
          rtUnitId: monthlyDues.rtUnitId,
          householdId: monthlyDues.householdId,
          billingYear: billingYears.year,
          month: monthlyDues.month,
          amount: monthlyDues.amount,
          status: monthlyDues.status,
        })
        .from(monthlyDues)
        .innerJoin(billingYears, and(
          eq(billingYears.id, monthlyDues.billingYearId),
          eq(billingYears.rtUnitId, monthlyDues.rtUnitId),
        ))
        .where(and(
          eq(monthlyDues.rtUnitId, request.rtUnitId),
          eq(monthlyDues.householdId, request.householdId),
          inArray(monthlyDues.id, itemDueIds),
        ))
        .orderBy(asc(monthlyDues.id))
        .for("update", { of: monthlyDues });

      const claims = await transaction
        .select({ monthlyDueId: paymentRequestClaims.monthlyDueId, requestId: paymentRequestClaims.requestId })
        .from(paymentRequestClaims)
        .where(inArray(paymentRequestClaims.monthlyDueId, itemDueIds))
        .orderBy(asc(paymentRequestClaims.monthlyDueId))
        .for("update");

      if (dues.length !== items.length || claims.length !== items.length) {
        throw new TreasurerPaymentRequestConflictError("The requested dues changed. Reload the payment queue.");
      }

      const dueById = new Map(dues.map((due) => [due.id, due]));
      const totalAmount = items.reduce((total, item) => total + item.amount, 0);
      if (
        !Number.isSafeInteger(totalAmount) ||
        totalAmount <= 0 ||
        totalAmount !== request.totalAmount
      ) {
        throw new TreasurerPaymentLedgerInvariantError("Payment request total does not match its immutable items.");
      }

      for (const item of items) {
        const due = dueById.get(item.monthlyDueId);
        const [yearText, monthText] = item.period.split("-");
        const year = Number(yearText);
        const month = Number(monthText);
        if (
          item.requestId !== request.id ||
          item.rtUnitId !== request.rtUnitId ||
          item.householdId !== request.householdId ||
          !due ||
          due.rtUnitId !== request.rtUnitId ||
          due.householdId !== request.householdId ||
          due.status !== "unpaid" ||
          due.amount !== item.amount ||
          due.billingYear !== year ||
          due.month !== month ||
          item.period !== canonicalPeriod(due.billingYear, due.month)
        ) {
          throw new TreasurerPaymentRequestConflictError("A requested month is no longer eligible for verification.");
        }
      }

      const expectedDueIds = [...itemDueIds].sort();
      const actualClaimsMatch = claims.every((claim, index) =>
        claim.requestId === request.id && claim.monthlyDueId === expectedDueIds[index],
      );
      if (!actualClaimsMatch) {
        throw new TreasurerPaymentRequestConflictError("The payment request no longer owns every requested month.");
      }

      const [existingPayment] = await transaction
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.paymentRequestId, request.id))
        .limit(1);
      if (existingPayment) {
        throw new TreasurerPaymentLedgerInvariantError("Pending request already has a payment ledger.");
      }

      const [payment] = await transaction
        .insert(payments)
        .values({
          rtUnitId: request.rtUnitId,
          householdId: request.householdId,
          paymentRequestId: request.id,
          amount: request.totalAmount,
          method: "transfer",
          verifiedByAccountId: principal.appAccountId,
          verifiedByAccountType: "official",
        })
        .returning({ id: payments.id });
      if (!payment) {
        throw new TreasurerPaymentLedgerInvariantError("Payment ledger was not created.");
      }

      await transaction.insert(paymentAllocations).values(items.map((item) => ({
        rtUnitId: request.rtUnitId,
        householdId: request.householdId,
        paymentRequestId: request.id,
        paymentId: payment.id,
        monthlyDueId: item.monthlyDueId,
        amount: item.amount,
      })));

      const paidDues = await transaction
        .update(monthlyDues)
        .set({ status: "paid" })
        .where(and(
          eq(monthlyDues.rtUnitId, request.rtUnitId),
          eq(monthlyDues.householdId, request.householdId),
          eq(monthlyDues.status, "unpaid"),
          inArray(monthlyDues.id, itemDueIds),
        ))
        .returning({ id: monthlyDues.id });
      if (paidDues.length !== items.length) {
        throw new TreasurerPaymentRequestConflictError("A requested month changed before payment could be confirmed.");
      }

      const [verifiedRequest] = await transaction
        .update(paymentRequests)
        .set({
          status: "verified",
          verifiedAt: sql`now()`,
          verifiedByAccountId: principal.appAccountId,
          verifiedByAccountType: "official",
        })
        .where(and(
          eq(paymentRequests.id, request.id),
          eq(paymentRequests.status, "pending"),
        ))
        .returning({ verifiedAt: paymentRequests.verifiedAt });
      if (!verifiedRequest?.verifiedAt) {
        throw new TreasurerPaymentRequestConflictError("Payment request was processed before confirmation.");
      }

      const closedClaims = await transaction
        .delete(paymentRequestClaims)
        .where(eq(paymentRequestClaims.requestId, request.id))
        .returning({ monthlyDueId: paymentRequestClaims.monthlyDueId });
      if (closedClaims.length !== items.length) {
        throw new TreasurerPaymentRequestConflictError("Payment request claims changed before confirmation.");
      }

      await appendAuditEvent(transaction, {
        actorAppAccountId: principal.appAccountId,
        action: "payment_request.verified",
        entityType: "payment_request",
        entityId: request.id,
        context: { itemCount: items.length, totalAmount: request.totalAmount },
      });

      return {
        requestCode: request.requestCode,
        status: "verified" as const,
        itemCount: items.length,
        totalAmount: request.totalAmount,
        verifiedAt: verifiedRequest.verifiedAt,
      };
    });
  } catch (error) {
    const constraint = postgresUniqueViolation(error);
    if (constraint === "payments_payment_request_uq") {
      throw new TreasurerPaymentRequestAlreadyProcessedError("Payment request has already been processed.");
    }
    throw error;
  }
}
