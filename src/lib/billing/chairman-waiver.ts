import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  activeDueSettlements,
  appAccounts,
  billingYears,
  houses,
  households,
  monthlyDues,
  officialAssignments,
  paymentRequestClaims,
  paymentRequests,
  people,
  waiverActions,
  waiverItems,
} from "@/db/schema";
import { appendAuditEvent, normalizeAuditReason } from "@/lib/audit/writer";
import { canPerform, type Principal } from "@/lib/auth/permissions";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { jakartaBusinessDate, officialAssignmentActiveOn } from "@/lib/officials/lifecycle";

const periodPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PERIODS = 120;
const MAX_SEARCH_LENGTH = 80;
const HOUSEHOLD_RESULT_LIMIT = 100;
const HISTORY_RESULT_LIMIT = 100;

export class ChairmanWaiverForbiddenError extends Error {}
export class InvalidChairmanWaiverInputError extends Error {}
export class ChairmanWaiverHouseholdNotFoundError extends Error {}
export class ChairmanWaiverPeriodUnavailableError extends Error {}
export class ChairmanWaiverConflictError extends Error {}
export class ChairmanWaiverIdempotencyConflictError extends ChairmanWaiverConflictError {}
export class ChairmanWaiverLedgerInvariantError extends Error {}

export interface CreateChairmanWaiverInput {
  householdId: string;
  periods: string[];
  reason: string;
  idempotencyKey: string;
}

export interface ChairmanWaiverResult {
  periods: string[];
  totalAmount: number;
  reason: string;
  createdAt: Date;
  idempotentReplay: boolean;
}

export interface ChairmanWaiverHouseholdSummary {
  id: string;
  houseNumber: string;
  houseLabel: string;
  householdStatus: "active" | "inactive";
  residents: string[];
}

export interface ChairmanWaiverDueView {
  period: string;
  amount: number;
  statusLabel:
    | "Belum bayar"
    | "Sudah bayar"
    | "Menunggu konfirmasi"
    | "Tidak perlu bayar"
    | "Dibebaskan"
    | "Tidak dapat diproses";
  selectable: boolean;
}

export interface ChairmanWaiverHouseholdDetail {
  household: ChairmanWaiverHouseholdSummary;
  dues: ChairmanWaiverDueView[];
}

export interface ChairmanWaiverHistoryItem {
  houseNumber: string;
  houseLabel: string;
  householdStatus: "active" | "inactive";
  residents: string[];
  periods: string[];
  amount: number;
  reason: string;
  createdAt: Date;
  statusLabel: "Dibebaskan";
}

function parsedPeriod(period: string) {
  const match = periodPattern.exec(period);
  if (!match) throw new InvalidChairmanWaiverInputError("Pilih periode iuran yang valid.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2200) {
    throw new InvalidChairmanWaiverInputError("Pilih periode iuran yang valid.");
  }
  return { year, month };
}

function canonicalPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function normalizeCreateInput(input: CreateChairmanWaiverInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidChairmanWaiverInputError("Data pemutihan belum lengkap.");
  }
  if (!uuidV4Pattern.test(input.householdId) || !uuidV4Pattern.test(input.idempotencyKey)) {
    throw new InvalidChairmanWaiverInputError("Data rumah atau permintaan tidak valid.");
  }
  if (!Array.isArray(input.periods) || input.periods.length < 1 || input.periods.length > MAX_PERIODS) {
    throw new InvalidChairmanWaiverInputError("Pilih satu sampai 120 periode pemutihan.");
  }

  const periods = input.periods.map((period) => {
    if (typeof period !== "string") throw new InvalidChairmanWaiverInputError("Pilih periode iuran yang valid.");
    parsedPeriod(period);
    return period;
  }).sort();
  if (periods.some((period, index) => index > 0 && periods[index - 1] === period)) {
    throw new InvalidChairmanWaiverInputError("Periode yang sama tidak boleh dipilih lebih dari sekali.");
  }

  if (typeof input.reason !== "string") {
    throw new InvalidChairmanWaiverInputError("Alasan pemutihan wajib diisi.");
  }
  let reason: string | null;
  try {
    reason = normalizeAuditReason(input.reason);
  } catch {
    throw new InvalidChairmanWaiverInputError("Alasan belum dapat digunakan. Periksa kembali isinya.");
  }
  if (!reason) throw new InvalidChairmanWaiverInputError("Alasan pemutihan wajib diisi.");

  return {
    householdId: input.householdId,
    periods,
    parsedPeriods: periods.map((period) => ({ period, ...parsedPeriod(period) })),
    reason,
    idempotencyKey: input.idempotencyKey,
  };
}

function fingerprint(householdId: string, periods: string[], reason: string) {
  const canonicalRequest = JSON.stringify({
    version: 1,
    householdId,
    periods,
    reason,
  });
  return createHash("sha256").update(canonicalRequest).digest("hex");
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
    !canPerform(principal, "waiver:manage", { rtUnitId })
  ) {
    throw new ChairmanWaiverForbiddenError("Pemutihan hanya tersedia untuk Ketua RT aktif.");
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
    throw new ChairmanWaiverForbiddenError("Pemutihan hanya tersedia untuk Ketua RT aktif.");
  }

  const lockedAssignments = await database
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

  if (lockedAssignments.length !== 1 || lockedAssignments[0]?.role !== "rt_chairman") {
    throw new ChairmanWaiverForbiddenError("Pemutihan hanya tersedia untuk Ketua RT aktif.");
  }
  return { rtUnitId, appAccountId: principal.appAccountId };
}

function labelHouse(number: string, label: string | null) {
  return label?.trim() || `Rumah ${number}`;
}

function sortUniqueNames(names: string[]) {
  return [...new Set(names)].sort((left, right) => left.localeCompare(right, "id"));
}

function assertSearchQuery(query: string) {
  if (typeof query !== "string" || query.trim().length > MAX_SEARCH_LENGTH) {
    throw new InvalidChairmanWaiverInputError("Pencarian terlalu panjang.");
  }
  return query.trim();
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function searchChairmanWaiverHouseholds(
  database: AppDatabase,
  principal: Principal,
  query = "",
  businessDate = jakartaBusinessDate(),
): Promise<ChairmanWaiverHouseholdSummary[]> {
  const { rtUnitId } = await assertActiveChairman(database, principal, businessDate);
  const normalizedQuery = assertSearchQuery(query);
  const clauses = [
    eq(households.rtUnitId, rtUnitId),
  ];
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
      houseLabel: houses.label,
      householdStatus: households.status,
    })
    .from(households)
    .innerJoin(houses, and(
      eq(houses.rtUnitId, households.rtUnitId),
      eq(houses.id, households.houseId),
    ))
    .leftJoin(people, and(
      eq(people.rtUnitId, households.rtUnitId),
      eq(people.householdId, households.id),
    ))
    .where(and(...clauses))
    .orderBy(asc(houses.number), asc(households.id))
    .limit(HOUSEHOLD_RESULT_LIMIT);

  if (rows.length === 0) return [];
  const residentRows = await database
    .select({ householdId: people.householdId, name: people.fullName })
    .from(people)
    .where(and(
      eq(people.rtUnitId, rtUnitId),
      inArray(people.householdId, rows.map((row) => row.id)),
    ))
    .orderBy(asc(people.fullName), asc(people.id));
  const residentsByHousehold = new Map<string, string[]>();
  for (const resident of residentRows) {
    if (!resident.householdId) continue;
    const names = residentsByHousehold.get(resident.householdId) ?? [];
    names.push(resident.name);
    residentsByHousehold.set(resident.householdId, names);
  }

  return rows.map((row) => ({
    id: row.id,
    houseNumber: row.houseNumber,
    houseLabel: labelHouse(row.houseNumber, row.houseLabel),
    householdStatus: row.householdStatus,
    residents: sortUniqueNames(residentsByHousehold.get(row.id) ?? []),
  }));
}

async function readHouseholdSummary(database: AppDatabase, rtUnitId: string, householdId: string) {
  const [household] = await database
    .select({
      id: households.id,
      houseNumber: houses.number,
      houseLabel: houses.label,
      householdStatus: households.status,
    })
    .from(households)
    .innerJoin(houses, and(
      eq(houses.rtUnitId, households.rtUnitId),
      eq(houses.id, households.houseId),
    ))
    .where(and(eq(households.rtUnitId, rtUnitId), eq(households.id, householdId)))
    .limit(1);
  return household;
}

async function readHouseholdResidents(database: AppDatabase, rtUnitId: string, householdId: string) {
  const residents = await database
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.rtUnitId, rtUnitId), eq(people.householdId, householdId)))
    .orderBy(asc(people.fullName), asc(people.id));
  return sortUniqueNames(residents.map((resident) => resident.name));
}

export async function getChairmanWaiverHousehold(
  database: AppDatabase,
  principal: Principal,
  householdId: string,
  businessDate = jakartaBusinessDate(),
): Promise<ChairmanWaiverHouseholdDetail> {
  const { rtUnitId } = await assertActiveChairman(database, principal, businessDate);
  if (!uuidV4Pattern.test(householdId)) throw new ChairmanWaiverHouseholdNotFoundError("Rumah tidak ditemukan.");
  const household = await readHouseholdSummary(database, rtUnitId, householdId);
  if (!household) throw new ChairmanWaiverHouseholdNotFoundError("Rumah tidak ditemukan.");
  const residents = await readHouseholdResidents(database, rtUnitId, householdId);
  const dueRows = await database
    .select({
      id: monthlyDues.id,
      year: billingYears.year,
      month: monthlyDues.month,
      status: monthlyDues.status,
    })
    .from(monthlyDues)
    .innerJoin(billingYears, and(
      eq(billingYears.id, monthlyDues.billingYearId),
      eq(billingYears.rtUnitId, monthlyDues.rtUnitId),
    ))
    .where(and(eq(monthlyDues.rtUnitId, rtUnitId), eq(monthlyDues.householdId, householdId)))
    .orderBy(asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id));
  const balances = await getDueFinancialBalances(database, dueRows.map((due) => due.id));
  const balancesByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));
  if (balancesByDueId.size !== dueRows.length) {
    throw new ChairmanWaiverLedgerInvariantError("Waiver household balance read did not match the due list.");
  }

  const dues: ChairmanWaiverDueView[] = dueRows.map((due) => {
    const balance = balancesByDueId.get(due.id);
    if (!balance || balance.rtUnitId !== rtUnitId || balance.householdId !== householdId) {
      throw new ChairmanWaiverLedgerInvariantError("Waiver household balance scope did not match the selected household.");
    }
    let statusLabel: ChairmanWaiverDueView["statusLabel"];
    let selectable = false;
    if (due.status === "unpaid" && balance.outstanding > 0 && balance.activeReceived === 0 && !balance.hasPendingRequest) {
      statusLabel = "Belum bayar";
      selectable = balance.effectiveTarget > 0;
    } else if (due.status === "unpaid" && balance.hasPendingRequest) {
      statusLabel = "Menunggu konfirmasi";
    } else if (due.status === "paid") {
      statusLabel = "Sudah bayar";
    } else if (due.status === "not_due") {
      statusLabel = "Tidak perlu bayar";
    } else if (due.status === "waived") {
      statusLabel = "Dibebaskan";
    } else {
      statusLabel = "Tidak dapat diproses";
    }
    return {
      period: canonicalPeriod(due.year, due.month),
      amount: balance.effectiveTarget,
      statusLabel,
      selectable,
    };
  });

  return {
    household: {
      id: household.id,
      houseNumber: household.houseNumber,
      houseLabel: labelHouse(household.houseNumber, household.houseLabel),
      householdStatus: household.householdStatus,
      residents,
    },
    dues,
  };
}

export async function getChairmanWaiverHistory(
  database: AppDatabase,
  principal: Principal,
  businessDate = jakartaBusinessDate(),
): Promise<ChairmanWaiverHistoryItem[]> {
  const { rtUnitId } = await assertActiveChairman(database, principal, businessDate);
  const actions = await database
    .select({
      id: waiverActions.id,
      householdId: waiverActions.householdId,
      houseNumber: houses.number,
      houseLabel: houses.label,
      householdStatus: households.status,
      amount: waiverActions.totalAmount,
      reason: waiverActions.reason,
      createdAt: waiverActions.createdAt,
    })
    .from(waiverActions)
    .innerJoin(households, and(
      eq(households.rtUnitId, waiverActions.rtUnitId),
      eq(households.id, waiverActions.householdId),
    ))
    .innerJoin(houses, and(
      eq(houses.rtUnitId, households.rtUnitId),
      eq(houses.id, households.houseId),
    ))
    .where(eq(waiverActions.rtUnitId, rtUnitId))
    .orderBy(desc(waiverActions.createdAt), desc(waiverActions.id))
    .limit(HISTORY_RESULT_LIMIT);
  if (actions.length === 0) return [];

  const actionIds = actions.map((action) => action.id);
  const householdIds = [...new Set(actions.map((action) => action.householdId))];
  const [items, residentRows] = await Promise.all([
    database
      .select({ actionId: waiverItems.waiverActionId, period: waiverItems.period })
      .from(waiverItems)
      .where(inArray(waiverItems.waiverActionId, actionIds))
      .orderBy(asc(waiverItems.period)),
    database
      .select({ householdId: people.householdId, name: people.fullName })
      .from(people)
      .where(and(eq(people.rtUnitId, rtUnitId), inArray(people.householdId, householdIds)))
      .orderBy(asc(people.fullName), asc(people.id)),
  ]);
  const periodsByAction = new Map<string, string[]>();
  for (const item of items) {
    const periods = periodsByAction.get(item.actionId) ?? [];
    periods.push(item.period);
    periodsByAction.set(item.actionId, periods);
  }
  const residentsByHousehold = new Map<string, string[]>();
  for (const resident of residentRows) {
    if (!resident.householdId) continue;
    const residents = residentsByHousehold.get(resident.householdId) ?? [];
    residents.push(resident.name);
    residentsByHousehold.set(resident.householdId, residents);
  }

  return actions.map((action) => ({
    houseNumber: action.houseNumber,
    houseLabel: labelHouse(action.houseNumber, action.houseLabel),
    householdStatus: action.householdStatus,
    residents: sortUniqueNames(residentsByHousehold.get(action.householdId) ?? []),
    periods: (periodsByAction.get(action.id) ?? []).sort(),
    amount: action.amount,
    reason: action.reason,
    createdAt: action.createdAt,
    statusLabel: "Dibebaskan",
  }));
}

function postgresError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === "string" ? candidate.constraint : "",
        message: typeof candidate.message === "string" ? candidate.message : "",
      };
    }
    current = candidate.cause;
  }
  return { code: "", constraint: "", message: "" };
}

async function findIdempotentWaiver(
  database: AppDatabase,
  rtUnitId: string,
  appAccountId: string,
  idempotencyKey: string,
  requestFingerprint: string,
): Promise<ChairmanWaiverResult | null> {
  const [action] = await database
    .select({
      id: waiverActions.id,
      requestFingerprint: waiverActions.requestFingerprint,
      totalAmount: waiverActions.totalAmount,
      reason: waiverActions.reason,
      createdAt: waiverActions.createdAt,
      itemCount: waiverActions.itemCount,
    })
    .from(waiverActions)
    .where(and(
      eq(waiverActions.rtUnitId, rtUnitId),
      eq(waiverActions.waivedByAccountId, appAccountId),
      eq(waiverActions.idempotencyKey, idempotencyKey),
    ))
    .limit(1);
  if (!action) return null;
  if (action.requestFingerprint !== requestFingerprint) {
    throw new ChairmanWaiverIdempotencyConflictError("Kunci pemutihan sudah dipakai untuk pilihan yang berbeda.");
  }
  const items = await database
    .select({ period: waiverItems.period })
    .from(waiverItems)
    .where(eq(waiverItems.waiverActionId, action.id))
    .orderBy(asc(waiverItems.period));
  if (items.length !== action.itemCount) {
    throw new ChairmanWaiverLedgerInvariantError("Stored waiver action does not match its item count.");
  }
  return {
    periods: items.map((item) => item.period),
    totalAmount: action.totalAmount,
    reason: action.reason,
    createdAt: action.createdAt,
    idempotentReplay: true,
  };
}

export async function createChairmanWaiver(
  database: AppDatabase,
  principal: Principal,
  input: CreateChairmanWaiverInput,
  businessDate = jakartaBusinessDate(),
): Promise<ChairmanWaiverResult> {
  const normalized = normalizeCreateInput(input);
  const rtUnitId = principal.rtUnitId;
  if (principal.role !== "rt_chairman" || !rtUnitId || !canPerform(principal, "waiver:manage", { rtUnitId })) {
    throw new ChairmanWaiverForbiddenError("Pemutihan hanya tersedia untuk Ketua RT aktif.");
  }
  const requestFingerprint = fingerprint(normalized.householdId, normalized.periods, normalized.reason);

  try {
    return await database.transaction(async (transaction) => {
      const transactionDatabase = transaction as unknown as AppDatabase;
      const { appAccountId } = await assertActiveChairman(transactionDatabase, principal, businessDate);
      const [household] = await transaction
        .select({ id: households.id })
        .from(households)
        .where(and(
          eq(households.rtUnitId, rtUnitId),
          eq(households.id, normalized.householdId),
        ))
        .limit(1)
        .for("share");
      if (!household) throw new ChairmanWaiverHouseholdNotFoundError("Rumah tidak ditemukan.");

      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`${rtUnitId}:${appAccountId}:${normalized.idempotencyKey}`}, 0)
        )
      `);

      const replay = await findIdempotentWaiver(
        transactionDatabase,
        rtUnitId,
        appAccountId,
        normalized.idempotencyKey,
        requestFingerprint,
      );
      if (replay) return replay;

      const periodFilter = or(...normalized.parsedPeriods.map(({ year, month }) => and(
        eq(billingYears.year, year),
        eq(monthlyDues.month, month),
      )!));
      const dues = await transaction
        .select({
          id: monthlyDues.id,
          rtUnitId: monthlyDues.rtUnitId,
          householdId: monthlyDues.householdId,
          year: billingYears.year,
          month: monthlyDues.month,
          status: monthlyDues.status,
        })
        .from(monthlyDues)
        .innerJoin(billingYears, and(
          eq(billingYears.id, monthlyDues.billingYearId),
          eq(billingYears.rtUnitId, monthlyDues.rtUnitId),
        ))
        .where(and(
          eq(monthlyDues.rtUnitId, rtUnitId),
          eq(monthlyDues.householdId, normalized.householdId),
          periodFilter,
        ))
        .orderBy(asc(monthlyDues.id))
        .for("update", { of: monthlyDues });

      const duesByPeriod = new Map(dues.map((due) => [canonicalPeriod(due.year, due.month), due]));
      if (dues.length !== normalized.periods.length || normalized.periods.some((period) => !duesByPeriod.has(period))) {
        throw new ChairmanWaiverPeriodUnavailableError("Satu atau beberapa periode tidak tersedia untuk rumah ini.");
      }
      if (dues.some((due) =>
        due.rtUnitId !== rtUnitId ||
        due.householdId !== normalized.householdId ||
        due.status !== "unpaid"
      )) {
        throw new ChairmanWaiverConflictError("Satu atau beberapa periode bukan tagihan belum bayar yang dapat diputihkan.");
      }

      const dueIds = dues.map((due) => due.id);
      const claims = await transaction
        .select({
          monthlyDueId: paymentRequestClaims.monthlyDueId,
          requestId: paymentRequestClaims.requestId,
          requestStatus: paymentRequests.status,
        })
        .from(paymentRequestClaims)
        .innerJoin(paymentRequests, and(
          eq(paymentRequests.id, paymentRequestClaims.requestId),
          eq(paymentRequests.rtUnitId, rtUnitId),
          eq(paymentRequests.householdId, normalized.householdId),
        ))
        .where(inArray(paymentRequestClaims.monthlyDueId, dueIds))
        .orderBy(asc(paymentRequestClaims.monthlyDueId), asc(paymentRequestClaims.requestId))
        .for("update", { of: paymentRequestClaims });
      if (claims.some((claim) => claim.requestStatus === "pending")) {
        throw new ChairmanWaiverConflictError("Ada permintaan pembayaran yang masih menunggu untuk salah satu periode.");
      }
      if (claims.length > 0) {
        throw new ChairmanWaiverLedgerInvariantError("A terminal payment request retained an active claim.");
      }

      const settlements = await transaction
        .select({
          monthlyDueId: activeDueSettlements.monthlyDueId,
          allocationId: activeDueSettlements.allocationId,
        })
        .from(activeDueSettlements)
        .where(inArray(activeDueSettlements.monthlyDueId, dueIds))
        .orderBy(asc(activeDueSettlements.monthlyDueId), asc(activeDueSettlements.allocationId))
        .for("update");
      const balances = await getDueFinancialBalances(transactionDatabase, dueIds);
      const balancesByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));
      if (
        balancesByDueId.size !== dues.length ||
        dues.some((due) => {
          const balance = balancesByDueId.get(due.id);
          return !balance ||
            balance.rtUnitId !== rtUnitId ||
            balance.householdId !== normalized.householdId ||
            balance.status !== "unpaid" ||
            balance.outstanding <= 0 ||
            balance.effectiveTarget <= 0 ||
            balance.activeReceived > 0 ||
            balance.hasPendingRequest;
        })
      ) {
        throw new ChairmanWaiverConflictError("Satu atau beberapa periode bukan tagihan belum bayar yang dapat diputihkan.");
      }
      if (settlements.length > 0) {
        throw new ChairmanWaiverConflictError("Satu atau beberapa periode sedang dimiliki pembayaran aktif.");
      }

      const totalAmount = dues.reduce((total, due) => total + (balancesByDueId.get(due.id)?.effectiveTarget ?? 0), 0);
      if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
        throw new ChairmanWaiverPeriodUnavailableError("Jumlah pemutihan belum dapat dihitung.");
      }

      const [action] = await transaction
        .insert(waiverActions)
        .values({
          rtUnitId,
          householdId: normalized.householdId,
          waivedByAccountId: appAccountId,
          waivedByAccountType: "official",
          reason: normalized.reason,
          itemCount: dues.length,
          totalAmount,
          idempotencyKey: normalized.idempotencyKey,
          requestFingerprint,
        })
        .returning({ id: waiverActions.id, createdAt: waiverActions.createdAt });
      if (!action) throw new ChairmanWaiverLedgerInvariantError("Waiver action could not be recorded.");

      await transaction.insert(waiverItems).values(dues.map((due) => ({
        waiverActionId: action.id,
        rtUnitId,
        householdId: normalized.householdId,
        monthlyDueId: due.id,
        period: canonicalPeriod(due.year, due.month),
        amount: balancesByDueId.get(due.id)!.effectiveTarget,
      })));

      const updatedDues = await transaction
        .update(monthlyDues)
        .set({ status: "waived", waivedReason: normalized.reason })
        .where(and(
          eq(monthlyDues.rtUnitId, rtUnitId),
          eq(monthlyDues.householdId, normalized.householdId),
          inArray(monthlyDues.id, dueIds),
          eq(monthlyDues.status, "unpaid"),
        ))
        .returning({ id: monthlyDues.id });
      if (updatedDues.length !== dueIds.length) {
        throw new ChairmanWaiverConflictError("Status salah satu periode berubah. Muat ulang data rumah.");
      }

      await appendAuditEvent(transaction, {
        actorAppAccountId: appAccountId,
        action: "waiver.created",
        entityType: "waiver_action",
        entityId: action.id,
        reason: normalized.reason,
        context: {
          itemCount: dues.length,
          periods: normalized.periods.join(","),
          totalAmount,
        },
      });

      return {
        periods: normalized.periods,
        totalAmount,
        reason: normalized.reason,
        createdAt: action.createdAt,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if (
      error instanceof ChairmanWaiverForbiddenError ||
      error instanceof InvalidChairmanWaiverInputError ||
      error instanceof ChairmanWaiverHouseholdNotFoundError ||
      error instanceof ChairmanWaiverPeriodUnavailableError ||
      error instanceof ChairmanWaiverConflictError ||
      error instanceof ChairmanWaiverLedgerInvariantError
    ) throw error;
    const databaseError = postgresError(error);
    if (databaseError.code === "23505" && databaseError.constraint.includes("waiver")) {
      throw new ChairmanWaiverConflictError("Satu atau beberapa periode sudah diproses. Muat ulang data rumah.");
    }
    throw error;
  }
}
