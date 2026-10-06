import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, lt, lte, or } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  billingYears,
  monthlyDues,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  type PaymentRequestStatus,
} from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";

const periodPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidPaymentRequestInputError extends Error {}
export class PaymentRequestPeriodUnavailableError extends Error {}
export class PaymentRequestConflictError extends Error {}
export class PaymentRequestIdempotencyConflictError extends Error {}

export type ResidentPaymentRequestResult = {
  requestCode: string;
  status: PaymentRequestStatus;
  periods: string[];
  totalAmount: number;
  createdAt: Date;
  idempotentReplay: boolean;
};

function parsePeriod(period: string) {
  const match = periodPattern.exec(period);
  if (!match) throw new InvalidPaymentRequestInputError("Pilih bulan iuran yang tersedia.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2200) {
    throw new InvalidPaymentRequestInputError("Pilih bulan iuran yang tersedia.");
  }
  return { year, month };
}

function canonicalPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function requestFingerprint(period: string) {
  return createHash("sha256").update(`karturt-payment-request:v1:${period}`).digest("hex");
}

function requestCode() {
  return `KRT-${randomBytes(8).toString("hex").toUpperCase()}`;
}

function postgresError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
      if (candidate.code === "23505") {
        return {
          uniqueViolation: true,
          constraint: typeof candidate.constraint === "string" ? candidate.constraint : "",
          message: typeof candidate.message === "string" ? candidate.message : "",
        };
      }
      current = candidate.cause;
    } else {
      break;
    }
  }
  return { uniqueViolation: false, constraint: "", message: "" };
}

async function findIdempotentRequest(
  transaction: AppDatabase,
  principal: Principal,
  key: string,
  fingerprint: string,
): Promise<ResidentPaymentRequestResult | null> {
  const [existing] = await transaction
    .select({
      id: paymentRequests.id,
      requestCode: paymentRequests.requestCode,
      status: paymentRequests.status,
      requestFingerprint: paymentRequests.requestFingerprint,
      totalAmount: paymentRequests.totalAmount,
      createdAt: paymentRequests.createdAt,
    })
    .from(paymentRequests)
    .where(and(
      eq(paymentRequests.requestedByAccountId, principal.appAccountId),
      eq(paymentRequests.idempotencyKey, key),
    ))
    .limit(1);

  if (!existing) return null;
  if (existing.requestFingerprint !== fingerprint) {
    throw new PaymentRequestIdempotencyConflictError("Kunci pengajuan ini sudah dipakai untuk pilihan bulan yang berbeda.");
  }
  const items = await transaction
    .select({ period: paymentRequestItems.period })
    .from(paymentRequestItems)
    .where(eq(paymentRequestItems.requestId, existing.id))
    .orderBy(asc(paymentRequestItems.period));

  return {
    requestCode: existing.requestCode,
    status: existing.status,
    periods: items.map((item) => item.period),
    totalAmount: existing.totalAmount,
    createdAt: existing.createdAt,
    idempotentReplay: true,
  };
}

export async function createResidentPaymentRequest(
  database: AppDatabase,
  principal: Principal,
  input: { period: string; idempotencyKey: string },
  businessDate = jakartaBusinessDate(),
): Promise<ResidentPaymentRequestResult> {
  if (principal.role !== "resident") {
    throw new Error("Forbidden: payment requests are available only to an active resident principal.");
  }
  const { rtUnitId, householdId, personId, appAccountId } = principal;
  if (!rtUnitId || !householdId || !personId) {
    throw new Error("Forbidden: payment requests are available only to an active resident principal.");
  }
  assertCanPerform(principal, "payment:request:self", {
    rtUnitId,
    householdId,
  });
  if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
    throw new InvalidPaymentRequestInputError("Pengajuan belum dapat diproses. Silakan coba lagi.");
  }

  const target = parsePeriod(input.period);
  const [currentYear, currentMonth] = businessDate.split("-").slice(0, 2).map(Number);
  if (target.year > currentYear! || (target.year === currentYear! && target.month > currentMonth!)) {
    throw new PaymentRequestPeriodUnavailableError("Bulan iuran ini belum tersedia.");
  }
  const fingerprint = requestFingerprint(input.period);

  try {
    return await database.transaction(async (transaction) => {
      const earlyReplay = await findIdempotentRequest(
        transaction as unknown as AppDatabase,
        principal,
        input.idempotencyKey,
        fingerprint,
      );
      if (earlyReplay) return earlyReplay;

      const lockedDues = await transaction
        .select({
          id: monthlyDues.id,
          billingYear: billingYears.year,
          month: monthlyDues.month,
          status: monthlyDues.status,
        })
        .from(monthlyDues)
        .innerJoin(billingYears, and(
          eq(billingYears.id, monthlyDues.billingYearId),
          eq(billingYears.rtUnitId, rtUnitId),
        ))
        .where(and(
          eq(monthlyDues.rtUnitId, rtUnitId),
          eq(monthlyDues.householdId, householdId),
          or(
            lt(billingYears.year, target.year),
            and(eq(billingYears.year, target.year), lte(monthlyDues.month, target.month)),
          ),
        ))
        .orderBy(asc(monthlyDues.id))
        .for("update", { of: monthlyDues });

      const replayAfterLock = await findIdempotentRequest(
        transaction as unknown as AppDatabase,
        principal,
        input.idempotencyKey,
        fingerprint,
      );
      if (replayAfterLock) return replayAfterLock;

      const balances = await getDueFinancialBalances(
        transaction as unknown as AppDatabase,
        lockedDues.map((due) => due.id),
      );
      if (balances.length !== lockedDues.length) {
        throw new PaymentRequestPeriodUnavailableError("Saldo iuran belum dapat dimuat. Silakan muat ulang halaman.");
      }
      const balanceByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));

      const targetDue = lockedDues.find((due) => due.billingYear === target.year && due.month === target.month);
      const targetBalance = targetDue ? balanceByDueId.get(targetDue.id) : undefined;
      if (!targetDue || !targetBalance || targetDue.status !== "unpaid" || targetBalance.outstanding <= 0) {
        throw new PaymentRequestPeriodUnavailableError("Bulan ini tidak dapat diajukan. Pilih bulan dengan status Belum bayar.");
      }

      const unpaidDues = lockedDues.filter((due) => {
        const balance = balanceByDueId.get(due.id);
        return due.status === "unpaid" && balance !== undefined && balance.outstanding > 0;
      }).sort((left, right) => left.billingYear - right.billingYear || left.month - right.month);
      const claimedIds = new Set(unpaidDues
        .filter((due) => balanceByDueId.get(due.id)?.hasPendingRequest)
        .map((due) => due.id));
      if (claimedIds.has(targetDue.id)) {
        throw new PaymentRequestConflictError("Bulan ini sudah menunggu konfirmasi.");
      }

      const eligibleDues = unpaidDues.filter((due) => !claimedIds.has(due.id));
      if (!eligibleDues.some((due) => due.id === targetDue.id)) {
        throw new PaymentRequestConflictError("Bulan ini sudah menunggu konfirmasi.");
      }
      const periods = eligibleDues.map((due) => canonicalPeriod(due.billingYear, due.month));
      const totalAmount = eligibleDues.reduce(
        (total, due) => total + (balanceByDueId.get(due.id)?.outstanding ?? 0),
        0,
      );
      if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
        throw new PaymentRequestPeriodUnavailableError("Jumlah iuran belum dapat dihitung. Silakan hubungi pengurus RT.");
      }

      const [created] = await transaction
        .insert(paymentRequests)
        .values({
          requestCode: requestCode(),
          rtUnitId,
          householdId,
          requestedByAccountId: appAccountId,
          requestedByAccountType: "resident",
          status: "pending",
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
          totalAmount,
          itemCount: eligibleDues.length,
        })
        .onConflictDoNothing({
          target: [paymentRequests.requestedByAccountId, paymentRequests.idempotencyKey],
        })
        .returning({
          id: paymentRequests.id,
          requestCode: paymentRequests.requestCode,
          status: paymentRequests.status,
          totalAmount: paymentRequests.totalAmount,
          createdAt: paymentRequests.createdAt,
        });

      if (!created) {
        const replay = await findIdempotentRequest(
          transaction as unknown as AppDatabase,
          principal,
          input.idempotencyKey,
          fingerprint,
        );
        if (replay) return replay;
        throw new PaymentRequestIdempotencyConflictError("Pengajuan ini berubah. Muat ulang halaman lalu coba lagi.");
      }

      await transaction.insert(paymentRequestItems).values(eligibleDues.map((due, index) => ({
        requestId: created.id,
        rtUnitId,
        householdId,
        monthlyDueId: due.id,
        period: periods[index],
        amount: balanceByDueId.get(due.id)!.outstanding,
      })));

      await transaction.insert(paymentRequestClaims).values(eligibleDues.map((due) => ({
        requestId: created.id,
        monthlyDueId: due.id,
      })));

      await appendAuditEvent(transaction, {
        actorAppAccountId: appAccountId,
        action: "payment_request.created",
        entityType: "payment_request",
        entityId: created.id,
        context: {
          periods: periods.join(","),
          totalAmount,
          itemCount: eligibleDues.length,
        },
      });

      return {
        requestCode: created.requestCode,
        status: created.status,
        periods,
        totalAmount: created.totalAmount,
        createdAt: created.createdAt,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    const databaseError = postgresError(error);
    if (
      databaseError.uniqueViolation &&
      (databaseError.constraint.includes("payment_request_claims") || databaseError.message.includes("payment_request_claims"))
    ) {
      throw new PaymentRequestConflictError("Salah satu bulan sudah diajukan. Muat ulang iuran untuk melihat status terbaru.");
    }
    throw error;
  }
}
