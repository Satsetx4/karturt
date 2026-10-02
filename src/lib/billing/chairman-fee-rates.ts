import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  billingYears,
  feeRates,
  officialAssignments,
} from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";
import { canPerform, type Principal } from "@/lib/auth/permissions";
import { jakartaBusinessDate, officialAssignmentActiveOn } from "@/lib/officials/lifecycle";

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export class ChairmanFeeRateForbiddenError extends Error {}
export class InvalidChairmanFeeRateInputError extends Error {}
export class ChairmanFeeRateNotFoundError extends Error {}
export class ChairmanFeeRateConflictError extends Error {}
export class ChairmanFeeRateIdempotencyConflictError extends ChairmanFeeRateConflictError {}
export class ChairmanFeeRateInvariantError extends Error {}

export interface CreateChairmanFeeRateInput {
  billingYearId: string;
  effectiveMonth: number;
  monthlyAmount: number;
  idempotencyKey: string;
}

export interface ChairmanFeeRateView {
  id: string;
  billingYearId: string;
  effectiveMonth: number;
  monthlyAmount: number;
  createdAt: Date;
}

export interface ChairmanBillingYearView {
  id: string;
  year: number;
  status: "draft" | "open" | "closed";
}

export interface ChairmanFeeRateList {
  years: ChairmanBillingYearView[];
  rates: ChairmanFeeRateView[];
}

export interface ChairmanFeeRateResult extends ChairmanFeeRateView {
  idempotentReplay: boolean;
}

function canonicalPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function fingerprint(input: Omit<CreateChairmanFeeRateInput, "idempotencyKey">) {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    billingYearId: input.billingYearId,
    effectiveMonth: input.effectiveMonth,
    monthlyAmount: input.monthlyAmount,
  })).digest("hex");
}

function normalizeCreateInput(input: CreateChairmanFeeRateInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidChairmanFeeRateInputError("Data tarif belum lengkap.");
  }
  const allowedKeys = new Set(["billingYearId", "effectiveMonth", "monthlyAmount", "idempotencyKey"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new InvalidChairmanFeeRateInputError("Data tarif belum lengkap.");
  }
  if (!uuidV4Pattern.test(input.billingYearId) || !uuidV4Pattern.test(input.idempotencyKey)) {
    throw new InvalidChairmanFeeRateInputError("Periksa kembali tahun dan kunci permintaan.");
  }
  if (!Number.isInteger(input.effectiveMonth) || input.effectiveMonth < 1 || input.effectiveMonth > 12) {
    throw new InvalidChairmanFeeRateInputError("Pilih bulan efektif yang valid.");
  }
  if (
    !Number.isSafeInteger(input.monthlyAmount) ||
    input.monthlyAmount <= 0 ||
    input.monthlyAmount > MAX_POSTGRES_INTEGER
  ) {
    throw new InvalidChairmanFeeRateInputError("Nominal tarif harus berupa bilangan rupiah bulat yang valid.");
  }
  return {
    billingYearId: input.billingYearId,
    effectiveMonth: input.effectiveMonth,
    monthlyAmount: input.monthlyAmount,
    idempotencyKey: input.idempotencyKey,
  };
}

async function assertActiveChairman(
  database: AppDatabase,
  principal: Principal,
  businessDate = jakartaBusinessDate(),
) {
  const rtUnitId = principal.rtUnitId;
  if (
    principal.role !== "rt_chairman" ||
    !rtUnitId ||
    !uuidV4Pattern.test(principal.appAccountId) ||
    !canPerform(principal, "fee_rate:manage", { rtUnitId })
  ) {
    throw new ChairmanFeeRateForbiddenError("Tarif iuran hanya tersedia untuk Ketua RT aktif.");
  }

  const [account] = await database
    .select({ id: appAccounts.id, status: appAccounts.status })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.id, principal.appAccountId),
      eq(appAccounts.rtUnitId, rtUnitId),
      eq(appAccounts.accountType, "official"),
    ))
    .limit(1)
    .for("share");
  if (!account || account.status !== "active") {
    throw new ChairmanFeeRateForbiddenError("Tarif iuran hanya tersedia untuk Ketua RT aktif.");
  }

  const assignments = await database
    .select({ id: officialAssignments.id, role: officialAssignments.role })
    .from(officialAssignments)
    .where(and(
      eq(officialAssignments.appAccountId, principal.appAccountId),
      eq(officialAssignments.rtUnitId, rtUnitId),
      officialAssignmentActiveOn(businessDate),
    ))
    .orderBy(asc(officialAssignments.id))
    .limit(2)
    .for("share");
  if (assignments.length !== 1 || assignments[0]?.role !== "rt_chairman") {
    throw new ChairmanFeeRateForbiddenError("Tarif iuran hanya tersedia untuk Ketua RT aktif.");
  }
  return { rtUnitId, appAccountId: principal.appAccountId };
}

function feeRateView(row: ChairmanFeeRateView, idempotentReplay: boolean): ChairmanFeeRateResult {
  return {
    id: row.id,
    billingYearId: row.billingYearId,
    effectiveMonth: row.effectiveMonth,
    monthlyAmount: row.monthlyAmount,
    createdAt: row.createdAt,
    idempotentReplay,
  };
}

export async function listChairmanFeeRates(
  database: AppDatabase,
  principal: Principal,
  billingYearId?: string,
  businessDate = jakartaBusinessDate(),
): Promise<ChairmanFeeRateList> {
  if (billingYearId !== undefined && !uuidV4Pattern.test(billingYearId)) {
    throw new InvalidChairmanFeeRateInputError("Tahun tarif tidak valid.");
  }
  const { rtUnitId } = await assertActiveChairman(database, principal, businessDate);
  const years = await database
    .select({
      id: billingYears.id,
      year: billingYears.year,
      status: billingYears.status,
    })
    .from(billingYears)
    .where(eq(billingYears.rtUnitId, rtUnitId))
    .orderBy(asc(billingYears.year));

  const yearFilter = billingYearId === undefined
    ? eq(feeRates.rtUnitId, rtUnitId)
    : and(eq(feeRates.rtUnitId, rtUnitId), eq(feeRates.billingYearId, billingYearId));
  const rates = await database
    .select({
      id: feeRates.id,
      billingYearId: feeRates.billingYearId,
      effectiveMonth: feeRates.effectiveMonth,
      monthlyAmount: feeRates.monthlyAmount,
      createdAt: feeRates.createdAt,
    })
    .from(feeRates)
    .where(yearFilter)
    .orderBy(asc(feeRates.billingYearId), asc(feeRates.effectiveMonth), asc(feeRates.createdAt));

  return { years, rates };
}

function isUniqueConstraintViolation(error: unknown, expectedConstraint: string) {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
    const databaseError = candidate as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (databaseError.code === "23505" && databaseError.constraint === expectedConstraint) return true;
    candidate = databaseError.cause;
  }
  return false;
}

export async function createChairmanFeeRate(
  database: AppDatabase,
  principal: Principal,
  input: CreateChairmanFeeRateInput,
  businessDate = jakartaBusinessDate(),
): Promise<ChairmanFeeRateResult> {
  const normalized = normalizeCreateInput(input);
  const rtUnitId = principal.rtUnitId;
  if (
    principal.role !== "rt_chairman" ||
    !rtUnitId ||
    !canPerform(principal, "fee_rate:manage", { rtUnitId })
  ) {
    throw new ChairmanFeeRateForbiddenError("Tarif iuran hanya tersedia untuk Ketua RT aktif.");
  }
  const requestFingerprint = fingerprint(normalized);

  try {
    return await database.transaction(async (transaction) => {
      const transactionDatabase = transaction as unknown as AppDatabase;
      const { appAccountId } = await assertActiveChairman(transactionDatabase, principal, businessDate);
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`${rtUnitId}:${appAccountId}:${normalized.idempotencyKey}`}, 0)
        )
      `);

      const [existing] = await transaction
        .select({
          id: feeRates.id,
          billingYearId: feeRates.billingYearId,
          effectiveMonth: feeRates.effectiveMonth,
          monthlyAmount: feeRates.monthlyAmount,
          createdAt: feeRates.createdAt,
          requestFingerprint: feeRates.requestFingerprint,
        })
        .from(feeRates)
        .where(and(
          eq(feeRates.rtUnitId, rtUnitId),
          eq(feeRates.createdByAccountId, appAccountId),
          eq(feeRates.createdByAccountType, "official"),
          eq(feeRates.idempotencyKey, normalized.idempotencyKey),
        ))
        .limit(1)
        .for("update");
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new ChairmanFeeRateIdempotencyConflictError("Kunci permintaan ini sudah digunakan untuk tarif yang berbeda.");
        }
        return feeRateView(existing, true);
      }

      const [year] = await transaction
        .select({ id: billingYears.id, year: billingYears.year, status: billingYears.status })
        .from(billingYears)
        .where(and(
          eq(billingYears.id, normalized.billingYearId),
          eq(billingYears.rtUnitId, rtUnitId),
        ))
        .limit(1)
        .for("update");
      if (!year) throw new ChairmanFeeRateNotFoundError("Tahun tagihan tidak ditemukan.");
      if (year.status !== "open") {
        throw new ChairmanFeeRateConflictError("Tarif hanya dapat ditambahkan pada tahun tagihan yang sedang dibuka.");
      }

      const period = canonicalPeriod(year.year, normalized.effectiveMonth);
      if (period <= businessDate.slice(0, 7)) {
        throw new ChairmanFeeRateConflictError("Bulan efektif tarif harus berada setelah bulan berjalan.");
      }

      const [scheduled] = await transaction
        .select({ id: feeRates.id })
        .from(feeRates)
        .where(and(
          eq(feeRates.rtUnitId, rtUnitId),
          eq(feeRates.billingYearId, year.id),
          eq(feeRates.effectiveMonth, normalized.effectiveMonth),
        ))
        .limit(1)
        .for("share");
      if (scheduled) {
        throw new ChairmanFeeRateConflictError("Sudah ada tarif terjadwal untuk bulan tersebut.");
      }

      const [created] = await transaction
        .insert(feeRates)
        .values({
          rtUnitId,
          billingYearId: year.id,
          effectiveMonth: normalized.effectiveMonth,
          monthlyAmount: normalized.monthlyAmount,
          createdByAccountId: appAccountId,
          createdByAccountType: "official",
          idempotencyKey: normalized.idempotencyKey,
          requestFingerprint,
        })
        .returning({
          id: feeRates.id,
          billingYearId: feeRates.billingYearId,
          effectiveMonth: feeRates.effectiveMonth,
          monthlyAmount: feeRates.monthlyAmount,
          createdAt: feeRates.createdAt,
        });
      if (!created) throw new ChairmanFeeRateInvariantError("Fee rate insert returned no row.");

      await appendAuditEvent(transaction, {
        actorAppAccountId: appAccountId,
        action: "fee_rate.created",
        entityType: "fee_rate",
        entityId: created.id,
        reason: null,
        context: { period, monthlyAmount: normalized.monthlyAmount },
      });

      return feeRateView(created, false);
    });
  } catch (error) {
    if (error instanceof ChairmanFeeRateConflictError) throw error;
    if (isUniqueConstraintViolation(error, "fee_rates_year_month_uq")) {
      throw new ChairmanFeeRateConflictError("Sudah ada tarif terjadwal untuk bulan tersebut.");
    }
    if (isUniqueConstraintViolation(error, "fee_rates_rt_actor_idempotency_uq")) {
      throw new ChairmanFeeRateIdempotencyConflictError("Kunci permintaan ini sudah digunakan untuk tarif yang berbeda.");
    }
    throw error;
  }
}
