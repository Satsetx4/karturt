import { createHash } from "node:crypto";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  activeDueSettlements,
  billingYears,
  households,
  houses,
  monthlyDues,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequests,
  paymentReversals,
  payments,
  people,
} from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";
import type { Principal } from "@/lib/auth/permissions";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { assertActiveTreasurer } from "@/lib/billing/treasurer-payment-requests";

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const periodPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
const HOUSEHOLD_PAGE_SIZE = 20;

export class InvalidCashPaymentInputError extends Error {}
export class CashPaymentHouseholdNotFoundError extends Error {}
export class CashPaymentDueConflictError extends Error {}
export class CashPaymentPendingRequestConflictError extends Error {}
export class CashPaymentIdempotencyConflictError extends Error {}
export class CashPaymentLedgerInvariantError extends Error {}

export type CashHouseholdSearchResult = {
  householdId: string;
  houseNumber: string;
  residentNames: string[];
  isActive: boolean;
};

export type CashDuePreviewItem = {
  period: string;
  amount: number;
  pendingConflict: boolean;
};

export type CashHouseholdDetail = CashHouseholdSearchResult & {
  unpaidPeriods: CashDuePreviewItem[];
};

export type CashPaymentPreview = {
  household: CashHouseholdSearchResult;
  targetPeriod: string;
  items: CashDuePreviewItem[];
  totalAmount: number;
  hasPendingConflict: boolean;
};

export type RecordTreasurerCashPaymentInput = {
  householdId: string;
  period: string;
  idempotencyKey: string;
};

export type TreasurerCashPaymentResult = {
  status: "recorded";
  periods: string[];
  itemCount: number;
  totalAmount: number;
  replayed: boolean;
};

function assertUuidV4(value: string, label: string) {
  if (!uuidV4Pattern.test(value)) {
    throw new InvalidCashPaymentInputError(`${label} must be a UUIDv4.`);
  }
}

function assertPeriod(value: string) {
  if (!periodPattern.test(value)) {
    throw new InvalidCashPaymentInputError("Pilih bulan dalam format tahun dan bulan yang benar.");
  }
}

function canonicalPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function householdSelect() {
  return {
    householdId: households.id,
    houseNumber: houses.number,
    residentNames: sql<string[]>`coalesce(
      array_agg(distinct ${people.fullName}) filter (where ${people.isActive} is true),
      array[]::text[]
    )`,
    isActive: sql<boolean>`${households.status} = 'active'`,
  };
}

function normalizeHousehold(row: CashHouseholdSearchResult) {
  return {
    ...row,
    residentNames: [...row.residentNames].sort((left, right) => left.localeCompare(right, "id")),
    isActive: Boolean(row.isActive),
  };
}

async function assertCashTreasurer(database: AppDatabase, principal: Principal, businessDate: string) {
  return assertActiveTreasurer(database, principal, businessDate, "payment:record_cash");
}

export async function searchTreasurerCashPaymentHouseholds(
  database: AppDatabase,
  principal: Principal,
  searchText: string,
  page = 1,
  businessDate = jakartaBusinessDate(),
) {
  const query = searchText.trim();
  if (!query || query.length > 80 || !Number.isInteger(page) || page < 1 || page > 1000) {
    throw new InvalidCashPaymentInputError("Cari rumah atau nama warga dengan kata kunci yang lebih singkat.");
  }
  const { rtUnitId } = await assertCashTreasurer(database, principal, businessDate);
  const pattern = `%${query}%`;
  const rows = await database
    .select(householdSelect())
    .from(households)
    .innerJoin(houses, and(
      eq(houses.rtUnitId, households.rtUnitId),
      eq(houses.id, households.houseId),
    ))
    .leftJoin(people, and(
      eq(people.rtUnitId, households.rtUnitId),
      eq(people.householdId, households.id),
      eq(people.isActive, true),
    ))
    .where(and(
      eq(households.rtUnitId, rtUnitId),
      or(
        ilike(houses.number, pattern),
        sql`exists (
          select 1 from people matched_person
          where matched_person.rt_unit_id = ${households.rtUnitId}
            and matched_person.household_id = ${households.id}
            and matched_person.is_active = true
            and matched_person.full_name ilike ${pattern}
        )`,
      ),
    ))
    .groupBy(households.id, houses.number, households.status)
    .orderBy(asc(houses.number), asc(households.id))
    .limit(HOUSEHOLD_PAGE_SIZE + 1)
    .offset((page - 1) * HOUSEHOLD_PAGE_SIZE);

  return {
    households: rows.slice(0, HOUSEHOLD_PAGE_SIZE).map(normalizeHousehold),
    hasMore: rows.length > HOUSEHOLD_PAGE_SIZE,
    page,
  };
}

async function readCashHousehold(
  database: AppDatabase,
  rtUnitId: string,
  householdId: string,
): Promise<CashHouseholdDetail | null> {
  const [household] = await database
    .select(householdSelect())
    .from(households)
    .innerJoin(houses, and(
      eq(houses.rtUnitId, households.rtUnitId),
      eq(houses.id, households.houseId),
    ))
    .leftJoin(people, and(
      eq(people.rtUnitId, households.rtUnitId),
      eq(people.householdId, households.id),
      eq(people.isActive, true),
    ))
    .where(and(eq(households.rtUnitId, rtUnitId), eq(households.id, householdId)))
    .groupBy(households.id, houses.number, households.status)
    .limit(1);
  if (!household) return null;

  const dues = await database
    .select({
      year: billingYears.year,
      month: monthlyDues.month,
      dueId: monthlyDues.id,
      amount: monthlyDues.amount,
      hasClaim: sql<boolean>`${paymentRequestClaims.monthlyDueId} is not null and ${paymentRequests.id} is not null`,
      requestStatus: paymentRequests.status,
    })
    .from(monthlyDues)
    .innerJoin(billingYears, and(
      eq(billingYears.id, monthlyDues.billingYearId),
      eq(billingYears.rtUnitId, monthlyDues.rtUnitId),
    ))
    .leftJoin(paymentRequestClaims, eq(paymentRequestClaims.monthlyDueId, monthlyDues.id))
    .leftJoin(paymentRequests, and(
      eq(paymentRequests.id, paymentRequestClaims.requestId),
      eq(paymentRequests.rtUnitId, monthlyDues.rtUnitId),
      eq(paymentRequests.householdId, monthlyDues.householdId),
    ))
    .where(and(
      eq(monthlyDues.rtUnitId, rtUnitId),
      eq(monthlyDues.householdId, householdId),
      eq(monthlyDues.status, "unpaid"),
    ))
    .orderBy(asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id));

  return {
    ...normalizeHousehold(household),
    unpaidPeriods: dues.map((due) => ({
      period: canonicalPeriod(due.year, due.month),
      amount: due.amount,
      pendingConflict: Boolean(due.hasClaim && due.requestStatus === "pending"),
    })),
  };
}

export async function getTreasurerCashPaymentHousehold(
  database: AppDatabase,
  principal: Principal,
  householdId: string,
  targetPeriod?: string,
  businessDate = jakartaBusinessDate(),
): Promise<CashHouseholdDetail | CashPaymentPreview> {
  assertUuidV4(householdId, "Household identifier");
  if (targetPeriod !== undefined) assertPeriod(targetPeriod);
  const { rtUnitId } = await assertCashTreasurer(database, principal, businessDate);
  const household = await readCashHousehold(database, rtUnitId, householdId);
  if (!household) throw new CashPaymentHouseholdNotFoundError("Rumah tidak ditemukan.");
  if (targetPeriod === undefined) return household;

  const target = household.unpaidPeriods.find((due) => due.period === targetPeriod);
  if (!target) {
    throw new CashPaymentDueConflictError("Bulan yang dipilih tidak lagi memiliki tagihan belum lunas. Muat ulang data rumah.");
  }
  const items = household.unpaidPeriods.filter((due) => due.period <= targetPeriod);
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
    throw new CashPaymentLedgerInvariantError("Cash payment preview total is invalid.");
  }
  return {
    household: {
      householdId: household.householdId,
      houseNumber: household.houseNumber,
      residentNames: household.residentNames,
      isActive: household.isActive,
    },
    targetPeriod,
    items,
    totalAmount,
    hasPendingConflict: items.some((item) => item.pendingConflict),
  };
}

function cashFingerprint(rtUnitId: string, input: Pick<RecordTreasurerCashPaymentInput, "householdId" | "period">) {
  return createHash("sha256")
    .update(JSON.stringify({ rtUnitId, householdId: input.householdId, period: input.period }))
    .digest("hex");
}

async function readCommittedCashResult(database: AppDatabase, paymentId: string): Promise<TreasurerCashPaymentResult> {
  const [reversal] = await database
    .select({ id: paymentReversals.id })
    .from(paymentReversals)
    .where(eq(paymentReversals.paymentId, paymentId))
    .limit(1);
  if (reversal) {
    throw new CashPaymentIdempotencyConflictError(
      "Pembayaran dengan kunci ini sudah dibatalkan. Gunakan kunci pengiriman baru untuk pencatatan ulang.",
    );
  }

  const rows = await database
    .select({ year: billingYears.year, month: monthlyDues.month, amount: paymentAllocations.amount })
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
    .where(eq(paymentAllocations.paymentId, paymentId))
    .orderBy(asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id));
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  if (rows.length === 0 || !Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
    throw new CashPaymentLedgerInvariantError("Cash payment ledger could not be replayed.");
  }
  return {
    status: "recorded",
    periods: rows.map((row) => canonicalPeriod(row.year, row.month)),
    itemCount: rows.length,
    totalAmount,
    replayed: true,
  };
}

export async function recordTreasurerCashPayment(
  database: AppDatabase,
  principal: Principal,
  input: RecordTreasurerCashPaymentInput,
  businessDate = jakartaBusinessDate(),
): Promise<TreasurerCashPaymentResult> {
  assertUuidV4(input.householdId, "Household identifier");
  assertUuidV4(input.idempotencyKey, "Idempotency key");
  assertPeriod(input.period);
  if (principal.role !== "treasurer" || !principal.rtUnitId) {
    throw new Error("Forbidden: only an active Treasurer may record cash payments.");
  }
  const rtUnitId = principal.rtUnitId;
  const fingerprint = cashFingerprint(rtUnitId, input);

  try {
    return await database.transaction(async (transaction) => {
      const transactionDatabase = transaction as unknown as AppDatabase;
      await assertCashTreasurer(transactionDatabase, principal, businessDate);

      const [household] = await transaction
        .select({ id: households.id })
        .from(households)
        .where(and(eq(households.rtUnitId, rtUnitId), eq(households.id, input.householdId)))
        .limit(1)
        .for("share");
      if (!household) throw new CashPaymentHouseholdNotFoundError("Rumah tidak ditemukan.");

      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`${rtUnitId}:${principal.appAccountId}:${input.idempotencyKey}`}, 0)
        )
      `);

      const [existing] = await transaction
        .select({ id: payments.id, fingerprint: payments.cashIdempotencyFingerprint })
        .from(payments)
        .where(and(
          eq(payments.rtUnitId, rtUnitId),
          eq(payments.verifiedByAccountId, principal.appAccountId),
          eq(payments.method, "cash"),
          eq(payments.cashIdempotencyKey, input.idempotencyKey),
        ))
        .limit(1)
        .for("update");
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new CashPaymentIdempotencyConflictError("Kunci pengiriman ini sudah digunakan untuk rumah atau bulan yang berbeda.");
        }
        return readCommittedCashResult(transactionDatabase, existing.id);
      }

      const targetYear = Number(input.period.slice(0, 4));
      const targetMonth = Number(input.period.slice(5, 7));
      const lockedDues = await transaction
        .select({
          id: monthlyDues.id,
          rtUnitId: monthlyDues.rtUnitId,
          householdId: monthlyDues.householdId,
          year: billingYears.year,
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
          eq(monthlyDues.rtUnitId, rtUnitId),
          eq(monthlyDues.householdId, input.householdId),
          inArray(monthlyDues.status, ["unpaid", "paid"]),
          or(
            sql`${billingYears.year} < ${targetYear}`,
            and(eq(billingYears.year, targetYear), sql`${monthlyDues.month} <= ${targetMonth}`),
          ),
        ))
        .orderBy(asc(monthlyDues.id))
        .for("update", { of: monthlyDues });

      const targetDue = lockedDues.find((due) => due.year === targetYear && due.month === targetMonth);
      if (!targetDue || targetDue.status !== "unpaid") {
        throw new CashPaymentDueConflictError("Bulan yang dipilih tidak lagi memiliki tagihan belum lunas. Muat ulang data rumah.");
      }
      const dues = lockedDues
        .filter((due) => due.status === "unpaid")
        .sort((left, right) => canonicalPeriod(left.year, left.month).localeCompare(canonicalPeriod(right.year, right.month)));
      if (dues.length === 0 || lockedDues.some((due) =>
        !["unpaid", "paid"].includes(due.status) || due.rtUnitId !== rtUnitId || due.householdId !== input.householdId ||
        !Number.isSafeInteger(due.amount) || due.amount <= 0 ||
        due.year < 1 || due.year > 9999 || due.month < 1 || due.month > 12,
      ) || dues.some((due, index) =>
        due.rtUnitId !== rtUnitId || due.householdId !== input.householdId ||
        !Number.isSafeInteger(due.amount) || due.amount <= 0 ||
        due.year < 1 || due.year > 9999 || due.month < 1 || due.month > 12 ||
        (index > 0 && canonicalPeriod(dues[index - 1]!.year, dues[index - 1]!.month) >= canonicalPeriod(due.year, due.month)),
      )) {
        throw new CashPaymentDueConflictError("Data tagihan berubah. Muat ulang sebelum mencatat pembayaran.");
      }

      const dueIds = dues.map((due) => due.id);
      const claims = await transaction
        .select({
          dueId: paymentRequestClaims.monthlyDueId,
          requestId: paymentRequestClaims.requestId,
          status: paymentRequests.status,
        })
        .from(paymentRequestClaims)
        .innerJoin(paymentRequests, and(
          eq(paymentRequests.id, paymentRequestClaims.requestId),
          eq(paymentRequests.rtUnitId, rtUnitId),
          eq(paymentRequests.householdId, input.householdId),
        ))
        .where(inArray(paymentRequestClaims.monthlyDueId, dueIds))
        .orderBy(asc(paymentRequestClaims.monthlyDueId))
        .for("update", { of: paymentRequestClaims });
      if (claims.some((claim) => claim.status === "pending")) {
        throw new CashPaymentPendingRequestConflictError("Ada permintaan pembayaran yang masih menunggu untuk bulan ini. Selesaikan atau tolak/batalkan permintaan tersebut lebih dulu.");
      }
      if (claims.length > 0) {
        throw new CashPaymentLedgerInvariantError("A terminal payment request retained an active claim.");
      }

      const totalAmount = dues.reduce((sum, due) => sum + due.amount, 0);
      if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
        throw new CashPaymentLedgerInvariantError("Cash payment total is invalid.");
      }

      const [payment] = await transaction
        .insert(payments)
        .values({
          rtUnitId,
          householdId: input.householdId,
          paymentRequestId: null,
          amount: totalAmount,
          method: "cash",
          verifiedByAccountId: principal.appAccountId,
          verifiedByAccountType: "official",
          cashIdempotencyKey: input.idempotencyKey,
          cashIdempotencyFingerprint: fingerprint,
        })
        .returning({ id: payments.id });
      if (!payment) throw new CashPaymentLedgerInvariantError("Cash payment could not be recorded.");

      const allocations = await transaction.insert(paymentAllocations).values(dues.map((due) => ({
        rtUnitId,
        householdId: input.householdId,
        paymentRequestId: null,
        paymentId: payment.id,
        monthlyDueId: due.id,
        amount: due.amount,
      }))).returning({ id: paymentAllocations.id, monthlyDueId: paymentAllocations.monthlyDueId, amount: paymentAllocations.amount });
      if (allocations.length !== dues.length) {
        throw new CashPaymentLedgerInvariantError("Cash payment allocation count does not match selected dues.");
      }

      await transaction.insert(activeDueSettlements).values(allocations.map((allocation) => ({
        rtUnitId,
        householdId: input.householdId,
        paymentId: payment.id,
        allocationId: allocation.id,
        monthlyDueId: allocation.monthlyDueId,
        amount: allocation.amount,
      })));

      const paidDues = await transaction
        .update(monthlyDues)
        .set({ status: "paid" })
        .where(and(
          eq(monthlyDues.rtUnitId, rtUnitId),
          eq(monthlyDues.householdId, input.householdId),
          eq(monthlyDues.status, "unpaid"),
          inArray(monthlyDues.id, dueIds),
        ))
        .returning({ id: monthlyDues.id });
      if (paidDues.length !== dues.length) {
        throw new CashPaymentDueConflictError("Data tagihan berubah sebelum pembayaran dapat dicatat.");
      }

      await appendAuditEvent(transaction, {
        actorAppAccountId: principal.appAccountId,
        action: "payment.cash_recorded",
        entityType: "payment",
        entityId: payment.id,
        reason: null,
        context: { itemCount: dues.length, method: "cash", totalAmount },
      });

      return {
        status: "recorded" as const,
        periods: dues.map((due) => canonicalPeriod(due.year, due.month)),
        itemCount: dues.length,
        totalAmount,
        replayed: false,
      };
    });
  } catch (error) {
    const databaseError = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const code = databaseError.code ?? databaseError.cause?.code;
    const constraint = databaseError.constraint ?? databaseError.cause?.constraint;
    if (code === "23505" && constraint === "payments_cash_idempotency_uq") {
      const [existing] = await database
        .select({ id: payments.id, fingerprint: payments.cashIdempotencyFingerprint })
        .from(payments)
        .where(and(
          eq(payments.rtUnitId, rtUnitId),
          eq(payments.verifiedByAccountId, principal.appAccountId),
          eq(payments.method, "cash"),
          eq(payments.cashIdempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (!existing || existing.fingerprint !== fingerprint) {
        throw new CashPaymentIdempotencyConflictError("Kunci pengiriman ini sudah digunakan untuk rumah atau bulan yang berbeda.");
      }
      return readCommittedCashResult(database, existing.id);
    }
    if (code === "23505" && constraint === "payment_allocations_payment_due_uq") {
      throw new CashPaymentDueConflictError("Bulan ini baru saja dicatat pembayarannya. Muat ulang data rumah.");
    }
    throw error;
  }
}
