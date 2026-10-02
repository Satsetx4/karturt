import { createHash } from "node:crypto";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  billingYears,
  dueAdjustments,
  houses,
  households,
  monthlyDues,
  officialAssignments,
  people,
} from "@/db/schema";
import { appendAuditEvent, normalizeAuditReason } from "@/lib/audit/writer";
import { canPerform, type Principal } from "@/lib/auth/permissions";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { jakartaBusinessDate, officialAssignmentActiveOn } from "@/lib/officials/lifecycle";

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 2_147_483_647;
const HOUSEHOLD_RESULT_LIMIT = 100;
const MAX_SEARCH_LENGTH = 80;

export class ChairmanAdjustmentForbiddenError extends Error {}
export class InvalidChairmanAdjustmentInputError extends Error {}
export class ChairmanAdjustmentNotFoundError extends Error {}
export class ChairmanAdjustmentConflictError extends Error {}
export class ChairmanAdjustmentIdempotencyConflictError extends ChairmanAdjustmentConflictError {}
export class ChairmanAdjustmentInvariantError extends Error {}

export interface CreateChairmanAdjustmentInput {
  monthlyDueId: string;
  amountDelta: number;
  reason: string;
  idempotencyKey: string;
}

export interface ChairmanAdjustmentResult {
  id: string;
  monthlyDueId: string;
  amountDelta: number;
  effectiveTargetAfter: number;
  idempotentReplay: boolean;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function householdLabel(names: string[]) {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  return unique.slice(0, 2).join(", ") + (unique.length > 2 ? ` +${unique.length - 2}` : "");
}

function canonicalPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function normalizeAdjustmentInput(input: CreateChairmanAdjustmentInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidChairmanAdjustmentInputError("Data penyesuaian belum lengkap.");
  }
  const allowed = new Set(["monthlyDueId", "amountDelta", "reason", "idempotencyKey"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new InvalidChairmanAdjustmentInputError("Data penyesuaian belum lengkap.");
  }
  if (!uuidV4Pattern.test(input.monthlyDueId) || !uuidV4Pattern.test(input.idempotencyKey)) {
    throw new InvalidChairmanAdjustmentInputError("Tagihan atau kunci permintaan tidak valid.");
  }
  if (!Number.isSafeInteger(input.amountDelta) || input.amountDelta === 0 || Math.abs(input.amountDelta) > MAX_AMOUNT) {
    throw new InvalidChairmanAdjustmentInputError("Nominal penyesuaian harus berupa rupiah bulat dan tidak boleh nol.");
  }
  if (typeof input.reason !== "string") {
    throw new InvalidChairmanAdjustmentInputError("Alasan penyesuaian wajib diisi.");
  }
  let reason: string | null;
  try {
    reason = normalizeAuditReason(input.reason);
  } catch {
    throw new InvalidChairmanAdjustmentInputError("Alasan belum dapat digunakan. Periksa kembali isinya.");
  }
  if (!reason) throw new InvalidChairmanAdjustmentInputError("Alasan penyesuaian wajib diisi.");
  return { monthlyDueId: input.monthlyDueId, amountDelta: input.amountDelta, reason, idempotencyKey: input.idempotencyKey };
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
    !canPerform(principal, "due_adjustment:manage", { rtUnitId })
  ) {
    throw new ChairmanAdjustmentForbiddenError("Penyesuaian hanya tersedia untuk Ketua RT aktif.");
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
    throw new ChairmanAdjustmentForbiddenError("Penyesuaian hanya tersedia untuk Ketua RT aktif.");
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
    throw new ChairmanAdjustmentForbiddenError("Penyesuaian hanya tersedia untuk Ketua RT aktif.");
  }
  return { rtUnitId, appAccountId: principal.appAccountId };
}

export async function searchChairmanAdjustmentHouseholds(
  database: AppDatabase,
  principal: Principal,
  query = "",
  businessDate = jakartaBusinessDate(),
) {
  const { rtUnitId } = await assertActiveChairman(database, principal, businessDate);
  if (typeof query !== "string" || query.trim().length > MAX_SEARCH_LENGTH) {
    throw new InvalidChairmanAdjustmentInputError("Pencarian rumah terlalu panjang.");
  }
  const normalizedQuery = query.trim();
  const clauses = [eq(households.rtUnitId, rtUnitId)];
  if (normalizedQuery) {
    const pattern = `%${escapeLike(normalizedQuery)}%`;
    clauses.push(or(
      ilike(houses.number, pattern),
      ilike(houses.label, pattern),
      ilike(people.fullName, pattern),
    )!);
  }
  const rows = await database
    .selectDistinct({
      id: households.id,
      houseNumber: houses.number,
      status: households.status,
    })
    .from(households)
    .innerJoin(houses, and(eq(houses.rtUnitId, households.rtUnitId), eq(houses.id, households.houseId)))
    .leftJoin(people, and(eq(people.rtUnitId, households.rtUnitId), eq(people.householdId, households.id)))
    .where(and(...clauses))
    .orderBy(asc(houses.number), asc(households.id))
    .limit(HOUSEHOLD_RESULT_LIMIT);

  if (rows.length === 0) return { households: [] };
  const residentRows = await database
    .select({ householdId: people.householdId, name: people.fullName })
    .from(people)
    .where(and(eq(people.rtUnitId, rtUnitId), inArray(people.householdId, rows.map((row) => row.id))))
    .orderBy(asc(people.fullName), asc(people.id));
  const residentsByHousehold = new Map<string, string[]>();
  for (const resident of residentRows) {
    if (!resident.householdId) continue;
    const names = residentsByHousehold.get(resident.householdId) ?? [];
    names.push(resident.name);
    residentsByHousehold.set(resident.householdId, names);
  }
  return {
    households: rows.map((row) => ({
      id: row.id,
      houseNumber: row.houseNumber,
      residentLabel: householdLabel(residentsByHousehold.get(row.id) ?? []),
      status: row.status,
    })),
  };
}

export async function getChairmanAdjustmentHousehold(
  database: AppDatabase,
  principal: Principal,
  householdId: string,
  businessDate = jakartaBusinessDate(),
) {
  const { rtUnitId } = await assertActiveChairman(database, principal, businessDate);
  if (!uuidV4Pattern.test(householdId)) throw new ChairmanAdjustmentNotFoundError("Rumah tidak ditemukan.");
  const [household] = await database
    .select({ id: households.id, houseNumber: houses.number, status: households.status })
    .from(households)
    .innerJoin(houses, and(eq(houses.rtUnitId, households.rtUnitId), eq(houses.id, households.houseId)))
    .where(and(eq(households.rtUnitId, rtUnitId), eq(households.id, householdId)))
    .limit(1);
  if (!household) throw new ChairmanAdjustmentNotFoundError("Rumah tidak ditemukan.");
  const residents = await database
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.rtUnitId, rtUnitId), eq(people.householdId, householdId)))
    .orderBy(asc(people.fullName), asc(people.id));

  const dueRows = await database
    .select({ id: monthlyDues.id, year: billingYears.year, month: monthlyDues.month, status: monthlyDues.status })
    .from(monthlyDues)
    .innerJoin(billingYears, and(
      eq(billingYears.id, monthlyDues.billingYearId),
      eq(billingYears.rtUnitId, monthlyDues.rtUnitId),
    ))
    .where(and(eq(monthlyDues.rtUnitId, rtUnitId), eq(monthlyDues.householdId, householdId)))
    .orderBy(asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id));
  const balances = await getDueFinancialBalances(database, dueRows.map((due) => due.id));
  const balanceByDue = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));
  if (balanceByDue.size !== dueRows.length) {
    throw new ChairmanAdjustmentInvariantError("Saldo tagihan tidak cocok dengan daftar periode.");
  }

  const dueIds = dueRows.map((due) => due.id);
  const adjustmentRows = dueIds.length === 0 ? [] : await database
    .select({
      monthlyDueId: dueAdjustments.monthlyDueId,
      amountDelta: dueAdjustments.amountDelta,
      reason: dueAdjustments.reason,
      createdAt: dueAdjustments.createdAt,
    })
    .from(dueAdjustments)
    .where(and(eq(dueAdjustments.rtUnitId, rtUnitId), inArray(dueAdjustments.monthlyDueId, dueIds)))
    .orderBy(asc(dueAdjustments.createdAt), asc(dueAdjustments.id));
  const adjustmentsByDue = new Map<string, typeof adjustmentRows>();
  for (const adjustment of adjustmentRows) {
    const list = adjustmentsByDue.get(adjustment.monthlyDueId) ?? [];
    list.push(adjustment);
    adjustmentsByDue.set(adjustment.monthlyDueId, list);
  }

  const dues = dueRows.map((due) => {
    const balance = balanceByDue.get(due.id);
    if (!balance || balance.rtUnitId !== rtUnitId || balance.householdId !== householdId) {
      throw new ChairmanAdjustmentInvariantError("Saldo tagihan tidak cocok dengan rumah yang dipilih.");
    }
    return {
      id: due.id,
      period: canonicalPeriod(due.year, due.month),
      status: due.status,
      originalAmount: balance.originalAmount,
      adjustmentTotal: balance.adjustmentTotal,
      effectiveTarget: balance.effectiveTarget,
      activeReceived: balance.activeReceived,
      outstanding: balance.outstanding,
      hasPendingRequest: balance.hasPendingRequest,
      adjustments: (adjustmentsByDue.get(due.id) ?? []).map((row) => ({
        amountDelta: row.amountDelta,
        reason: row.reason,
        createdAt: row.createdAt,
      })),
    };
  });

  return {
    household: {
      id: household.id,
      houseNumber: household.houseNumber,
      residentLabel: householdLabel(residents.map((resident) => resident.name)),
      status: household.status,
    },
    dues,
  };
}

function requestFingerprint(monthlyDueId: string, amountDelta: number, reason: string) {
  return createHash("sha256").update(JSON.stringify({ version: 1, monthlyDueId, amountDelta, reason })).digest("hex");
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

export async function createChairmanAdjustment(
  database: AppDatabase,
  principal: Principal,
  input: CreateChairmanAdjustmentInput,
  businessDate = jakartaBusinessDate(),
): Promise<ChairmanAdjustmentResult> {
  const normalized = normalizeAdjustmentInput(input);
  const rtUnitId = principal.rtUnitId;
  if (principal.role !== "rt_chairman" || !rtUnitId || !canPerform(principal, "due_adjustment:manage", { rtUnitId })) {
    throw new ChairmanAdjustmentForbiddenError("Penyesuaian hanya tersedia untuk Ketua RT aktif.");
  }
  const fingerprint = requestFingerprint(normalized.monthlyDueId, normalized.amountDelta, normalized.reason);

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
          id: dueAdjustments.id,
          monthlyDueId: dueAdjustments.monthlyDueId,
          amountDelta: dueAdjustments.amountDelta,
          effectiveTargetAfter: dueAdjustments.effectiveTargetAfter,
          requestFingerprint: dueAdjustments.requestFingerprint,
        })
        .from(dueAdjustments)
        .where(and(
          eq(dueAdjustments.rtUnitId, rtUnitId),
          eq(dueAdjustments.adjustedByAccountId, appAccountId),
          eq(dueAdjustments.idempotencyKey, normalized.idempotencyKey),
        ))
        .limit(1)
        .for("update");
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          throw new ChairmanAdjustmentIdempotencyConflictError("Kunci permintaan ini sudah dipakai untuk penyesuaian berbeda.");
        }
        return {
          id: existing.id,
          monthlyDueId: existing.monthlyDueId,
          amountDelta: existing.amountDelta,
          effectiveTargetAfter: existing.effectiveTargetAfter,
          idempotentReplay: true,
        };
      }

      const [due] = await transaction
        .select({ id: monthlyDues.id, rtUnitId: monthlyDues.rtUnitId, householdId: monthlyDues.householdId })
        .from(monthlyDues)
        .where(and(eq(monthlyDues.id, normalized.monthlyDueId), eq(monthlyDues.rtUnitId, rtUnitId)))
        .limit(1)
        .for("update");
      if (!due) throw new ChairmanAdjustmentNotFoundError("Tagihan tidak ditemukan.");

      const [balance] = await getDueFinancialBalances(transactionDatabase, [due.id]);
      if (!balance || balance.rtUnitId !== rtUnitId || balance.householdId !== due.householdId) {
        throw new ChairmanAdjustmentNotFoundError("Tagihan tidak ditemukan.");
      }
      if (balance.status !== "paid" && balance.status !== "unpaid") {
        throw new ChairmanAdjustmentConflictError("Tagihan dibebaskan atau belum jatuh tempo dan tidak dapat disesuaikan.");
      }
      if (balance.hasPendingRequest) {
        throw new ChairmanAdjustmentConflictError("Permintaan pembayaran yang menunggu melindungi nominal tagihan ini.");
      }
      const effectiveTargetAfter = balance.effectiveTarget + normalized.amountDelta;
      if (!Number.isSafeInteger(effectiveTargetAfter) || effectiveTargetAfter <= 0 || effectiveTargetAfter > MAX_AMOUNT) {
        throw new InvalidChairmanAdjustmentInputError("Target kewajiban setelah penyesuaian harus tetap lebih besar dari Rp0.");
      }
      if (effectiveTargetAfter < balance.activeReceived) {
        throw new ChairmanAdjustmentConflictError("Penyesuaian tidak boleh membuat pembayaran melebihi kewajiban.");
      }

      const [created] = await transaction
        .insert(dueAdjustments)
        .values({
          rtUnitId,
          householdId: due.householdId,
          monthlyDueId: due.id,
          amountDelta: normalized.amountDelta,
          effectiveTargetAfter,
          reason: normalized.reason,
          adjustedByAccountId: appAccountId,
          adjustedByAccountType: "official",
          idempotencyKey: normalized.idempotencyKey,
          requestFingerprint: fingerprint,
        })
        .returning({
          id: dueAdjustments.id,
          monthlyDueId: dueAdjustments.monthlyDueId,
          amountDelta: dueAdjustments.amountDelta,
          effectiveTargetAfter: dueAdjustments.effectiveTargetAfter,
        });

      const nextStatus = balance.activeReceived === effectiveTargetAfter ? "paid" : "unpaid";
      await transaction
        .update(monthlyDues)
        .set({ status: nextStatus })
        .where(and(eq(monthlyDues.id, due.id), eq(monthlyDues.rtUnitId, rtUnitId)));

      await appendAuditEvent(transaction, {
        actorAppAccountId: appAccountId,
        action: "billing.adjustment_created",
        entityType: "due_adjustment",
        entityId: created.id,
        reason: normalized.reason,
        context: {
          amountDelta: created.amountDelta,
          effectiveTargetAfter: created.effectiveTargetAfter,
          originalAmount: balance.originalAmount,
        },
      });

      return { ...created, idempotentReplay: false };
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error, "due_adjustments_rt_actor_idempotency_uq")) {
      throw new ChairmanAdjustmentConflictError("Penyesuaian dengan kunci ini sudah diproses. Muat ulang rincian tagihan.");
    }
    throw error;
  }
}
