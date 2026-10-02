import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  billingYears,
  households,
  monthlyDues,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  payments,
  people,
} from "@/db/schema";
import { appendAuditEvent, normalizeAuditReason } from "@/lib/audit/writer";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { assertActiveTreasurer } from "@/lib/billing/treasurer-payment-requests";

const requestCodePattern = /^KRT-[A-F0-9]{16}$/;

export class InvalidPaymentRequestResolutionInputError extends Error {}
export class PaymentRequestResolutionNotFoundError extends Error {}
export class PaymentRequestAlreadyProcessedError extends Error {}
export class PaymentRequestResolutionConflictError extends Error {}
export class PaymentRequestResolutionInvariantError extends Error {}

export type PaymentRequestResolutionResult = {
  requestCode: string;
  status: "rejected" | "cancelled";
  itemCount: number;
  totalAmount: number;
  resolvedAt: Date;
};

type ResolutionAction = "rejected" | "cancelled";

function canonicalPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function assertActiveResident(database: AppDatabase, principal: Principal) {
  if (
    principal.role !== "resident" ||
    !principal.rtUnitId ||
    !principal.householdId ||
    !principal.personId
  ) {
    throw new Error("Forbidden: only an active resident may cancel their own payment request.");
  }
  assertCanPerform(principal, "payment:cancel:self", {
    rtUnitId: principal.rtUnitId,
    householdId: principal.householdId,
  });

  const [account] = await database
    .select({ id: appAccounts.id, personId: appAccounts.personId, status: appAccounts.status })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.id, principal.appAccountId),
      eq(appAccounts.rtUnitId, principal.rtUnitId),
      eq(appAccounts.householdId, principal.householdId),
      eq(appAccounts.accountType, "resident"),
    ))
    .limit(1)
    .for("share");
  if (!account || account.status !== "active" || account.personId !== principal.personId) {
    throw new Error("Forbidden: only an active resident may cancel their own payment request.");
  }

  const [membership] = await database
    .select({ householdStatus: households.status, personIsActive: people.isActive })
    .from(households)
    .innerJoin(people, and(
      eq(people.rtUnitId, households.rtUnitId),
      eq(people.householdId, households.id),
      eq(people.id, principal.personId),
    ))
    .where(and(
      eq(households.rtUnitId, principal.rtUnitId),
      eq(households.id, principal.householdId),
    ))
    .limit(1);
  if (!membership || membership.householdStatus !== "active" || !membership.personIsActive) {
    throw new Error("Forbidden: only an active resident may cancel their own payment request.");
  }
}

function parseRejectReason(value: unknown) {
  if (typeof value !== "string") {
    throw new InvalidPaymentRequestResolutionInputError("Tuliskan alasan penolakan terlebih dahulu.");
  }
  try {
    const reason = normalizeAuditReason(value);
    if (!reason) throw new Error("blank");
    return reason;
  } catch {
    throw new InvalidPaymentRequestResolutionInputError(
      "Alasan penolakan wajib diisi, maksimal 500 karakter, dan tidak boleh memuat nomor kontak atau data rahasia.",
    );
  }
}

async function resolvePendingRequest(
  database: AppDatabase,
  principal: Principal,
  requestCode: string,
  action: ResolutionAction,
  reason: string | null,
  businessDate: string,
): Promise<PaymentRequestResolutionResult> {
  if (!requestCodePattern.test(requestCode)) {
    throw new PaymentRequestResolutionNotFoundError("Payment request was not found.");
  }

  return database.transaction(async (transaction) => {
    const transactionDb = transaction as unknown as AppDatabase;
    if (action === "cancelled") {
      await assertActiveResident(transactionDb, principal);
    } else {
      await assertActiveTreasurer(transactionDb, principal, businessDate, "payment:reject");
    }

    const scope = action === "cancelled"
      ? and(
        eq(paymentRequests.requestCode, requestCode),
        eq(paymentRequests.rtUnitId, principal.rtUnitId!),
        eq(paymentRequests.householdId, principal.householdId!),
        eq(paymentRequests.requestedByAccountId, principal.appAccountId),
      )
      : and(
        eq(paymentRequests.requestCode, requestCode),
        eq(paymentRequests.rtUnitId, principal.rtUnitId!),
      );
    const [request] = await transaction
      .select({
        id: paymentRequests.id,
        requestCode: paymentRequests.requestCode,
        rtUnitId: paymentRequests.rtUnitId,
        householdId: paymentRequests.householdId,
        requestedByAccountId: paymentRequests.requestedByAccountId,
        status: paymentRequests.status,
        totalAmount: paymentRequests.totalAmount,
        itemCount: paymentRequests.itemCount,
      })
      .from(paymentRequests)
      .where(scope)
      .limit(1)
      .for("update");

    if (!request) throw new PaymentRequestResolutionNotFoundError("Payment request was not found.");
    if (request.status !== "pending") {
      throw new PaymentRequestAlreadyProcessedError("Payment request has already been processed.");
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
      throw new PaymentRequestResolutionInvariantError("Payment request item count does not match its snapshot.");
    }

    const itemDueIds = items.map((item) => item.monthlyDueId);
    const dues = await transaction
      .select({
        id: monthlyDues.id,
        rtUnitId: monthlyDues.rtUnitId,
        householdId: monthlyDues.householdId,
        billingYear: billingYears.year,
        month: monthlyDues.month,
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
      throw new PaymentRequestResolutionConflictError("The requested dues or claims changed. Reload the payment request.");
    }

    const balances = await getDueFinancialBalances(transactionDb, itemDueIds);
    if (balances.length !== itemDueIds.length) {
      throw new PaymentRequestResolutionInvariantError("A requested due balance could not be loaded.");
    }
    const balanceByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));

    const totalAmount = items.reduce((total, item) => total + item.amount, 0);
    if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0 || totalAmount !== request.totalAmount) {
      throw new PaymentRequestResolutionInvariantError("Payment request total does not match its immutable items.");
    }

    const dueById = new Map(dues.map((due) => [due.id, due]));
    for (const item of items) {
      const due = dueById.get(item.monthlyDueId);
      const balance = balanceByDueId.get(item.monthlyDueId);
      const [yearText, monthText] = item.period.split("-");
      if (
        item.requestId !== request.id ||
        item.rtUnitId !== request.rtUnitId ||
        item.householdId !== request.householdId ||
        !due ||
        !balance ||
        due.rtUnitId !== request.rtUnitId ||
        due.householdId !== request.householdId ||
        due.status !== "unpaid" ||
        balance.status !== "unpaid" ||
        balance.outstanding !== item.amount ||
        !balance.hasPendingRequest ||
        due.billingYear !== Number(yearText) ||
        due.month !== Number(monthText) ||
        item.period !== canonicalPeriod(due.billingYear, due.month)
      ) {
        throw new PaymentRequestResolutionConflictError("A requested month is no longer eligible for resolution.");
      }
    }

    const expectedDueIds = [...itemDueIds].sort();
    if (!claims.every((claim, index) =>
      claim.requestId === request.id && claim.monthlyDueId === expectedDueIds[index],
    )) {
      throw new PaymentRequestResolutionConflictError("The payment request no longer owns every requested month.");
    }

    const existingPayments = await transaction
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.paymentRequestId, request.id))
      .limit(1);
    const existingAllocations = await transaction
      .select({ id: paymentAllocations.id })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, request.id))
      .limit(1);
    if (existingPayments.length > 0 || existingAllocations.length > 0) {
      throw new PaymentRequestResolutionInvariantError("An unresolved request already has a payment ledger.");
    }

    const [resolved] = await transaction
      .update(paymentRequests)
      .set({
        status: action,
        resolvedAt: sql`now()`,
        resolvedByAccountId: principal.appAccountId,
        resolvedByAccountType: action === "rejected" ? "official" : "resident",
        resolutionReason: reason,
      })
      .where(and(
        eq(paymentRequests.id, request.id),
        eq(paymentRequests.status, "pending"),
      ))
      .returning({ resolvedAt: paymentRequests.resolvedAt });
    if (!resolved?.resolvedAt) {
      throw new PaymentRequestAlreadyProcessedError("Payment request has already been processed.");
    }

    const closedClaims = await transaction
      .delete(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, request.id))
      .returning({ monthlyDueId: paymentRequestClaims.monthlyDueId });
    if (closedClaims.length !== items.length) {
      throw new PaymentRequestResolutionConflictError("Payment request claims changed before resolution.");
    }

    await appendAuditEvent(transaction, {
      actorAppAccountId: principal.appAccountId,
      action: `payment_request.${action}`,
      entityType: "payment_request",
      entityId: request.id,
      reason,
      context: { itemCount: items.length, totalAmount: request.totalAmount },
    });

    return {
      requestCode: request.requestCode,
      status: action,
      itemCount: items.length,
      totalAmount: request.totalAmount,
      resolvedAt: resolved.resolvedAt,
    };
  });
}

export async function cancelResidentPaymentRequest(
  database: AppDatabase,
  principal: Principal,
  requestCode: string,
) {
  return resolvePendingRequest(database, principal, requestCode, "cancelled", null, jakartaBusinessDate());
}

export async function rejectTreasurerPaymentRequest(
  database: AppDatabase,
  principal: Principal,
  requestCode: string,
  reason: unknown,
  businessDate = jakartaBusinessDate(),
) {
  return resolvePendingRequest(database, principal, requestCode, "rejected", parseRejectReason(reason), businessDate);
}
