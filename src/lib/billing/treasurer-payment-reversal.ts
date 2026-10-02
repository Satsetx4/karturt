import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  activeDueSettlements,
  monthlyDues,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequests,
  paymentReversals,
  payments,
} from "@/db/schema";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { appendAuditEvent, normalizeAuditReason } from "@/lib/audit/writer";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { assertActiveTreasurer } from "@/lib/billing/treasurer-payment-requests";

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidPaymentReversalInputError extends Error {}
export class TreasurerPaymentNotFoundError extends Error {}
export class TreasurerPaymentAlreadyReversedError extends Error {}
export class TreasurerPaymentReversalConflictError extends Error {}
export class TreasurerPaymentReversalInvariantError extends Error {}

export type TreasurerPaymentReversalResult = {
  status: "reversed";
  method: "transfer" | "cash";
  itemCount: number;
  totalAmount: number;
  reversedAt: Date;
};

function postgresUniqueViolation(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
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

function normalizeReversalReason(value: unknown) {
  if (typeof value !== "string" || value.length > 500) {
    throw new InvalidPaymentReversalInputError("Alasan pembatalan wajib diisi, maksimal 500 karakter.");
  }
  try {
    const normalized = normalizeAuditReason(value);
    if (!normalized) throw new Error("blank");
    return normalized;
  } catch {
    throw new InvalidPaymentReversalInputError("Alasan pembatalan wajib diisi dan tidak boleh memuat data pribadi atau rahasia.");
  }
}

export async function reverseTreasurerPayment(
  database: AppDatabase,
  principal: Principal,
  input: { paymentId: string; reason: string },
  businessDate = jakartaBusinessDate(),
): Promise<TreasurerPaymentReversalResult> {
  if (!uuidV4Pattern.test(input.paymentId)) {
    throw new InvalidPaymentReversalInputError("Identitas pembayaran tidak sesuai.");
  }
  const reason = normalizeReversalReason(input.reason);
  if (principal.role !== "treasurer" || !principal.rtUnitId) {
    throw new Error("Forbidden: only an active Treasurer may reverse a payment.");
  }
  const rtUnitId = principal.rtUnitId;
  assertCanPerform(principal, "payment:reverse", { rtUnitId });

  try {
    return await database.transaction(async (transaction) => {
      const transactionDatabase = transaction as unknown as AppDatabase;
      await assertActiveTreasurer(transactionDatabase, principal, businessDate, "payment:reverse");

      const [payment] = await transaction
        .select({
          id: payments.id,
          rtUnitId: payments.rtUnitId,
          householdId: payments.householdId,
          paymentRequestId: payments.paymentRequestId,
          amount: payments.amount,
          method: payments.method,
          verifiedByAccountType: payments.verifiedByAccountType,
        })
        .from(payments)
        .where(and(eq(payments.id, input.paymentId), eq(payments.rtUnitId, rtUnitId)))
        .limit(1)
        .for("update");

      if (!payment) throw new TreasurerPaymentNotFoundError("Payment was not found.");
      const [existingReversal] = await transaction
        .select({ id: paymentReversals.id })
        .from(paymentReversals)
        .where(eq(paymentReversals.paymentId, payment.id))
        .limit(1);
      if (existingReversal) {
        throw new TreasurerPaymentAlreadyReversedError("Payment has already been reversed.");
      }

      if (
        (payment.method !== "cash" && payment.method !== "transfer") ||
        payment.verifiedByAccountType !== "official" ||
        (payment.method === "transfer" && !payment.paymentRequestId) ||
        (payment.method === "cash" && payment.paymentRequestId !== null)
      ) {
        throw new TreasurerPaymentReversalInvariantError("Payment source metadata is inconsistent.");
      }

      const allocations = await transaction
        .select({
          id: paymentAllocations.id,
          rtUnitId: paymentAllocations.rtUnitId,
          householdId: paymentAllocations.householdId,
          paymentRequestId: paymentAllocations.paymentRequestId,
          paymentId: paymentAllocations.paymentId,
          monthlyDueId: paymentAllocations.monthlyDueId,
          amount: paymentAllocations.amount,
        })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, payment.id))
        .orderBy(asc(paymentAllocations.monthlyDueId), asc(paymentAllocations.id));
      const totalAmount = allocations.reduce((total, allocation) => total + allocation.amount, 0);
      if (
        allocations.length === 0 ||
        !Number.isSafeInteger(totalAmount) ||
        totalAmount !== payment.amount ||
        allocations.some((allocation) =>
          allocation.paymentId !== payment.id ||
          allocation.rtUnitId !== payment.rtUnitId ||
          allocation.householdId !== payment.householdId ||
          allocation.amount <= 0 ||
          (payment.method === "transfer" && allocation.paymentRequestId !== payment.paymentRequestId) ||
          (payment.method === "cash" && allocation.paymentRequestId !== null),
        )
      ) {
        throw new TreasurerPaymentReversalInvariantError("Payment allocations are incomplete or inconsistent.");
      }

      const dueIds = allocations.map((allocation) => allocation.monthlyDueId);
      const dues = await transaction
        .select({
          id: monthlyDues.id,
          rtUnitId: monthlyDues.rtUnitId,
          householdId: monthlyDues.householdId,
          status: monthlyDues.status,
        })
        .from(monthlyDues)
        .where(and(
          eq(monthlyDues.rtUnitId, payment.rtUnitId),
          eq(monthlyDues.householdId, payment.householdId),
          inArray(monthlyDues.id, dueIds),
        ))
        .orderBy(asc(monthlyDues.id))
        .for("update", { of: monthlyDues });

      const claims = await transaction
        .select({
          monthlyDueId: paymentRequestClaims.monthlyDueId,
          requestStatus: paymentRequests.status,
        })
        .from(paymentRequestClaims)
        .innerJoin(paymentRequests, and(
          eq(paymentRequests.id, paymentRequestClaims.requestId),
          eq(paymentRequests.rtUnitId, payment.rtUnitId),
          eq(paymentRequests.householdId, payment.householdId),
        ))
        .where(inArray(paymentRequestClaims.monthlyDueId, dueIds))
        .orderBy(asc(paymentRequestClaims.monthlyDueId), asc(paymentRequestClaims.requestId))
        .for("update", { of: paymentRequestClaims });
      if (claims.some((claim) => claim.requestStatus === "pending")) {
        throw new TreasurerPaymentReversalConflictError("Payment reversal is blocked while a due has a pending request.");
      }
      if (claims.length > 0) {
        throw new TreasurerPaymentReversalInvariantError("A terminal payment request retained an active claim.");
      }

      const settlements = await transaction
        .select({
          monthlyDueId: activeDueSettlements.monthlyDueId,
          paymentId: activeDueSettlements.paymentId,
          allocationId: activeDueSettlements.allocationId,
          rtUnitId: activeDueSettlements.rtUnitId,
          householdId: activeDueSettlements.householdId,
          amount: activeDueSettlements.amount,
        })
        .from(activeDueSettlements)
        .where(and(
          eq(activeDueSettlements.paymentId, payment.id),
          inArray(activeDueSettlements.monthlyDueId, dueIds),
        ))
        .orderBy(asc(activeDueSettlements.monthlyDueId), asc(activeDueSettlements.allocationId))
        .for("update");

      const dueById = new Map(dues.map((due) => [due.id, due]));
      const settlementByAllocationId = new Map(settlements.map((settlement) => [settlement.allocationId, settlement]));
      const balances = await getDueFinancialBalances(transactionDatabase, dueIds);
      const balancesByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));
      if (
        dues.length !== allocations.length ||
        settlements.length !== allocations.length ||
        balancesByDueId.size !== dues.length ||
        allocations.some((allocation) => {
          const due = dueById.get(allocation.monthlyDueId);
          const settlement = settlementByAllocationId.get(allocation.id);
          const balance = balancesByDueId.get(allocation.monthlyDueId);
          return !due || !settlement ||
            !balance ||
            (due.status !== "paid" && due.status !== "unpaid") ||
            due.rtUnitId !== payment.rtUnitId ||
            due.householdId !== payment.householdId ||
            balance.status !== due.status ||
            (due.status === "paid" && balance.outstanding !== 0) ||
            (due.status === "unpaid" && balance.outstanding <= 0) ||
            balance.hasPendingRequest ||
            settlement.paymentId !== payment.id ||
            settlement.allocationId !== allocation.id ||
            settlement.monthlyDueId !== allocation.monthlyDueId ||
            settlement.rtUnitId !== payment.rtUnitId ||
            settlement.householdId !== payment.householdId ||
            settlement.amount !== allocation.amount;
        })
      ) {
        throw new TreasurerPaymentReversalInvariantError("Payment no longer owns every allocation through its active settlement rows.");
      }

      const [reversal] = await transaction
        .insert(paymentReversals)
        .values({
          rtUnitId: payment.rtUnitId,
          householdId: payment.householdId,
          paymentId: payment.id,
          reversedByAccountId: principal.appAccountId,
          reversedByAccountType: "official",
          reason,
        })
        .returning({ reversedAt: paymentReversals.reversedAt });
      if (!reversal) throw new TreasurerPaymentReversalInvariantError("Payment reversal record was not created.");

      const releasedSettlements = await transaction
        .delete(activeDueSettlements)
        .where(and(
          eq(activeDueSettlements.paymentId, payment.id),
          inArray(activeDueSettlements.monthlyDueId, dueIds),
        ))
        .returning({ allocationId: activeDueSettlements.allocationId });
      if (
        releasedSettlements.length !== allocations.length ||
        releasedSettlements.some((settlement) => !allocations.some((allocation) => allocation.id === settlement.allocationId))
      ) {
        throw new TreasurerPaymentReversalInvariantError("Active settlement ownership changed during reversal.");
      }

      const postReversalBalances = await getDueFinancialBalances(transactionDatabase, dueIds);
      const postBalancesByDueId = new Map(postReversalBalances.map((balance) => [balance.monthlyDueId, balance]));
      if (postBalancesByDueId.size !== dueIds.length || postReversalBalances.some((balance) =>
        balance.rtUnitId !== payment.rtUnitId ||
        balance.householdId !== payment.householdId ||
        balance.hasPendingRequest ||
        (balance.status !== "paid" && balance.status !== "unpaid") ||
        balance.outstanding < 0
      )) {
        throw new TreasurerPaymentReversalInvariantError("Due balance could not be recomputed after reversal.");
      }
      for (const balance of postReversalBalances) {
        const [updatedDue] = await transaction
          .update(monthlyDues)
          .set({ status: balance.outstanding === 0 ? "paid" : "unpaid" })
          .where(and(
            eq(monthlyDues.id, balance.monthlyDueId),
            eq(monthlyDues.rtUnitId, payment.rtUnitId),
            eq(monthlyDues.householdId, payment.householdId),
          ))
          .returning({ id: monthlyDues.id });
        if (!updatedDue) {
          throw new TreasurerPaymentReversalConflictError("One or more due statuses changed before reversal completed.");
        }
      }

      await appendAuditEvent(transaction, {
        actorAppAccountId: principal.appAccountId,
        action: "payment.reversed",
        entityType: "payment",
        entityId: payment.id,
        reason,
        context: { itemCount: allocations.length, method: payment.method, totalAmount },
      });

      return {
        status: "reversed" as const,
        method: payment.method,
        itemCount: allocations.length,
        totalAmount,
        reversedAt: reversal.reversedAt,
      };
    });
  } catch (error) {
    if (postgresUniqueViolation(error) === "payment_reversals_payment_uq") {
      throw new TreasurerPaymentAlreadyReversedError("Payment has already been reversed.");
    }
    throw error;
  }
}
