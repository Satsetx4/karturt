import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  authSession,
  authUser,
  billingYears,
  dueAdjustments,
  feeRates,
  houses,
  households,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequestItems,
  people,
  rtSettings,
  waiverItems,
} from "@/db/schema";
import { appendAuditEvent, normalizeAuditReason } from "@/lib/audit/writer";
import { resolveResidentProvisioningTarget } from "@/lib/accounts/resident-provisioning";
import { createResidentAuthRecords } from "@/lib/accounts/resident-auth-records";
import { canPerform, type Principal } from "@/lib/auth/permissions";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { buildAnnualDues } from "@/lib/billing/generator";
import { jakartaBusinessDate, officialAssignmentActiveOn } from "@/lib/officials/lifecycle";

type LifecycleTransaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
type SelectExecutor = Pick<AppDatabase, "select">;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^(20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/;
const HOUSEHOLD_LIST_LIMIT = 250;
const MAX_SEARCH_LENGTH = 80;

export class InvalidHouseholdInputError extends Error {}
export class HouseholdForbiddenError extends Error {}
export class HouseholdNotFoundError extends Error {}
export class HouseholdConflictError extends Error {}
export class HouseholdLifecycleInvariantError extends Error {}

const InvalidHouseholdLifecycleInputError = InvalidHouseholdInputError;
const HouseholdLifecycleForbiddenError = HouseholdForbiddenError;
const HouseholdLifecycleNotFoundError = HouseholdNotFoundError;
const HouseholdLifecycleConflictError = HouseholdConflictError;

export interface CreateHouseholdResidentInput {
  houseId?: string;
  newHouse?: { number: string; label?: string | null };
  startsOn: string;
  fullName: string;
  phone?: string | null;
  initialPin: string;
}

export interface CreateHouseholdResidentResult {
  houseId: string;
  householdId: string;
  personId: string;
  residentAccountId: string;
  startsOn: string;
  generatedDueCount: number;
}

export interface UpdateHouseholdResidentInput {
  householdId: string;
  personId: string;
  fullName?: string;
  phone?: string | null;
  houseLabel?: string | null;
}

export interface UpdateHouseholdResidentResult {
  householdId: string;
  personId: string;
  changedFields: string[];
}

export interface DeactivateHouseholdInput {
  householdId: string;
  effectiveMonth: string;
  reason: string;
}

export interface HouseholdLifecycleResult {
  householdId: string;
  effectiveDate: string;
  disabledAccountCount: number;
  revokedSessionCount: number;
  transitionedDueCount: number;
}

export interface ReplaceHouseholdResidentInput {
  householdId: string;
  effectiveMonth: string;
  fullName: string;
  phone?: string | null;
  initialPin: string;
  reason: string;
}

export interface ReplaceHouseholdResidentResult extends HouseholdLifecycleResult {
  newHouseholdId: string;
  newPersonId: string;
  newResidentAccountId: string;
  generatedDueCount: number;
}

export interface HouseholdManagementResident {
  personId: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  residentAccountId: string | null;
}

export interface HouseholdManagementItem {
  householdId: string;
  houseId: string;
  houseNumber: string;
  houseLabel: string | null;
  status: "active" | "inactive";
  startsOn: string;
  endsOn: string | null;
  residents: HouseholdManagementResident[];
  financialHistory: {
    dueCount: number;
    unpaidCount: number;
    paidCount: number;
    waivedCount: number;
    notDueCount: number;
    outstandingAmount: number;
    arrearsAmount: number;
  };
}

export interface HouseholdManagementListResult {
  households: HouseholdManagementItem[];
  availableHouses: Array<{ houseId: string; houseNumber: string; houseLabel: string | null }>;
}

type NormalizedCreateInput = {
  houseId: string | null;
  houseNumber: string | null;
  houseLabel: string | null;
  startsOn: string;
  fullName: string;
  phone: string | null;
  initialPin: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new InvalidHouseholdLifecycleInputError("Data rumah belum dapat diproses. Periksa kembali isian yang tersedia.");
  }
}

function canonicalDate(value: unknown, label: string) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    throw new InvalidHouseholdLifecycleInputError(`${label} harus berupa tanggal yang valid.`);
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new InvalidHouseholdLifecycleInputError(`${label} harus berupa tanggal yang valid.`);
  }
  return value;
}

function canonicalMonth(value: unknown) {
  if (typeof value !== "string" || !MONTH_PATTERN.test(value)) {
    throw new InvalidHouseholdLifecycleInputError("Pilih bulan yang valid.");
  }
  return value;
}

function monthPeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function lastDayOfMonth(month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function firstDayOfMonth(month: string) {
  return `${month}-01`;
}

function normalizeRequiredText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new InvalidHouseholdLifecycleInputError(`${label} wajib diisi.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) {
    throw new InvalidHouseholdLifecycleInputError(`${label} wajib diisi dan tidak boleh melebihi ${maximum} karakter.`);
  }
  return trimmed;
}

function normalizeNullableText(value: unknown, label: string, maximum: number) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new InvalidHouseholdLifecycleInputError(`${label} belum valid.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maximum) throw new InvalidHouseholdLifecycleInputError(`${label} terlalu panjang.`);
  return trimmed;
}

function normalizePhone(value: unknown, optional = true): string | null | undefined {
  if (value === undefined) {
    if (optional) return undefined;
    return null;
  }
  if (value === null) return null;
  if (typeof value !== "string") throw new InvalidHouseholdLifecycleInputError("Nomor telepon belum valid.");
  const phone = value.trim();
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (phone.length > 32 || !/^[+0-9(). -]+$/.test(phone) || digits.length < 8 || digits.length > 15) {
    throw new InvalidHouseholdLifecycleInputError("Periksa kembali nomor telepon.");
  }
  return phone;
}

function normalizePin(value: unknown) {
  if (typeof value !== "string" || !/^\d{6}$/.test(value)) {
    throw new InvalidHouseholdLifecycleInputError("PIN awal harus terdiri dari enam angka.");
  }
  return value;
}

function normalizeReason(value: unknown) {
  if (typeof value !== "string") throw new InvalidHouseholdLifecycleInputError("Alasan wajib diisi.");
  const reason = value.trim();
  if (!reason || reason.length > 500) {
    throw new InvalidHouseholdLifecycleInputError("Alasan wajib diisi dan maksimal 500 karakter.");
  }
  try {
    const normalized = normalizeAuditReason(reason);
    if (!normalized) throw new Error("empty");
    return normalized;
  } catch {
    throw new InvalidHouseholdLifecycleInputError("Alasan belum dapat digunakan. Periksa kembali isinya.");
  }
}

function normalizeHouseNumber(value: unknown) {
  const number = normalizeRequiredText(value, "Nomor rumah", 40);
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/.test(number)) {
    throw new InvalidHouseholdLifecycleInputError("Nomor rumah memuat karakter yang belum didukung.");
  }
  return number;
}

function normalizeCreateInput(input: CreateHouseholdResidentInput): NormalizedCreateInput {
  if (!isPlainObject(input)) throw new InvalidHouseholdLifecycleInputError("Data penghuni belum lengkap.");
  rejectUnknownKeys(input, ["houseId", "newHouse", "startsOn", "fullName", "phone", "initialPin"]);
  const hasHouseId = input.houseId !== undefined;
  const hasNewHouse = input.newHouse !== undefined;
  if (hasHouseId === hasNewHouse) {
    throw new InvalidHouseholdLifecycleInputError("Pilih rumah yang tersedia atau masukkan nomor untuk rumah baru.");
  }
  let houseId: string | null = null;
  let houseNumber: string | null = null;
  let houseLabel: string | null = null;
  if (hasHouseId) {
    if (typeof input.houseId !== "string" || !UUID_PATTERN.test(input.houseId)) {
      throw new InvalidHouseholdLifecycleInputError("Rumah yang dipilih belum valid.");
    }
    houseId = input.houseId;
  } else {
    if (!isPlainObject(input.newHouse)) {
      throw new InvalidHouseholdLifecycleInputError("Data rumah baru belum lengkap.");
    }
    rejectUnknownKeys(input.newHouse, ["number", "label"]);
    houseNumber = normalizeHouseNumber(input.newHouse.number);
    const label = normalizeNullableText(input.newHouse.label, "Label rumah", 120);
    houseLabel = label ?? null;
  }
  const startsOn = canonicalDate(input.startsOn, "Tanggal mulai");
  const fullName = normalizeRequiredText(input.fullName, "Nama penghuni", 160);
  const phone = normalizePhone(input.phone) ?? null;
  const initialPin = normalizePin(input.initialPin);
  return { houseId, houseNumber, houseLabel, startsOn, fullName, phone, initialPin };
}

function assertPrincipalIsChairman(principal: Principal) {
  const rtUnitId = principal.rtUnitId;
  if (
    principal.role !== "rt_chairman" ||
    !rtUnitId ||
    !UUID_PATTERN.test(principal.appAccountId) ||
    !canPerform(principal, "resident:manage", { rtUnitId })
  ) {
    throw new HouseholdLifecycleForbiddenError("Pengelolaan rumah hanya tersedia untuk Ketua RT aktif.");
  }
  return { rtUnitId, appAccountId: principal.appAccountId };
}

async function assertActiveChairman(
  database: SelectExecutor,
  principal: Principal,
  businessDate: string,
) {
  const { rtUnitId, appAccountId } = assertPrincipalIsChairman(principal);
  const [account] = await database
    .select({ id: appAccounts.id, status: appAccounts.status })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.id, appAccountId),
      eq(appAccounts.authUserId, principal.authUserId),
      eq(appAccounts.rtUnitId, rtUnitId),
      eq(appAccounts.accountType, "official"),
    ))
    .limit(1);
  if (!account || account.status !== "active") {
    throw new HouseholdLifecycleForbiddenError("Pengelolaan rumah hanya tersedia untuk Ketua RT aktif.");
  }
  const assignments = await database
    .select({ id: officialAssignments.id, role: officialAssignments.role })
    .from(officialAssignments)
    .where(and(
      eq(officialAssignments.appAccountId, appAccountId),
      eq(officialAssignments.rtUnitId, rtUnitId),
      officialAssignmentActiveOn(businessDate),
    ))
    .orderBy(asc(officialAssignments.id))
    .limit(2);
  if (assignments.length !== 1 || assignments[0]?.role !== "rt_chairman") {
    throw new HouseholdLifecycleForbiddenError("Pengelolaan rumah hanya tersedia untuk Ketua RT aktif.");
  }
  return { rtUnitId, appAccountId };
}

async function lockHouse(
  transaction: LifecycleTransaction,
  rtUnitId: string,
  houseId: string,
) {
  const [house] = await transaction
    .select({ id: houses.id, number: houses.number, label: houses.label })
    .from(houses)
    .where(and(eq(houses.id, houseId), eq(houses.rtUnitId, rtUnitId)))
    .limit(1)
    .for("update");
  if (!house) throw new HouseholdLifecycleNotFoundError("Rumah tidak ditemukan.");
  return house;
}

async function lockHouseholdsForHouse(
  transaction: LifecycleTransaction,
  rtUnitId: string,
  houseId: string,
) {
  return transaction
    .select({
      id: households.id,
      status: households.status,
      startsOn: households.startsOn,
      endsOn: households.endsOn,
    })
    .from(households)
    .where(and(eq(households.rtUnitId, rtUnitId), eq(households.houseId, houseId)))
    .orderBy(asc(households.id))
    .for("update");
}

async function lockHouseholdDues(
  transaction: LifecycleTransaction,
  rtUnitId: string,
  householdIds: string | readonly string[],
) {
  const ids = typeof householdIds === "string" ? [householdIds] : [...householdIds];
  if (ids.length === 0) return [];
  return transaction
    .select({
      id: monthlyDues.id,
      billingYearId: monthlyDues.billingYearId,
      year: billingYears.year,
      month: monthlyDues.month,
      dueDate: monthlyDues.dueDate,
      status: monthlyDues.status,
      householdId: monthlyDues.householdId,
    })
    .from(monthlyDues)
    .innerJoin(billingYears, and(
      eq(billingYears.id, monthlyDues.billingYearId),
      eq(billingYears.rtUnitId, monthlyDues.rtUnitId),
    ))
    .where(and(eq(monthlyDues.rtUnitId, rtUnitId), inArray(monthlyDues.householdId, ids)))
    .orderBy(asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id))
    .for("update", { of: monthlyDues });
}

async function lockHouseholdResidentAccounts(
  transaction: LifecycleTransaction,
  rtUnitId: string,
  householdIds: readonly string[],
) {
  if (householdIds.length === 0) return [];
  return transaction
    .select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      householdId: appAccounts.householdId,
      personId: appAccounts.personId,
      status: appAccounts.status,
    })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.rtUnitId, rtUnitId),
      eq(appAccounts.accountType, "resident"),
      inArray(appAccounts.householdId, [...householdIds]),
    ))
    .orderBy(asc(appAccounts.id))
    .for("update");
}

async function lockHouseholdPeople(
  transaction: LifecycleTransaction,
  rtUnitId: string,
  householdId: string,
) {
  return transaction
    .select({ id: people.id, isActive: people.isActive })
    .from(people)
    .where(and(eq(people.rtUnitId, rtUnitId), eq(people.householdId, householdId)))
    .orderBy(asc(people.id))
    .for("update");
}

async function assertNoCurrentLoginCollision(
  transaction: LifecycleTransaction,
  loginIdentifier: string,
) {
  await transaction.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`karturt:resident-login:${loginIdentifier.toLowerCase()}`}, 0)
    )
  `);
  const matches = await transaction
    .select({ id: appAccounts.id, rtUnitId: appAccounts.rtUnitId })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.accountType, "resident"),
      ne(appAccounts.status, "disabled"),
      sql`lower(${appAccounts.loginIdentifier}) = ${loginIdentifier.toLowerCase()}`,
    ))
    .limit(2);
  if (matches.length > 0) {
    throw new HouseholdLifecycleConflictError("Nomor rumah ini masih dipakai sebagai login warga aktif. Selesaikan siklus rumah lama terlebih dahulu.");
  }
}

async function addOpenYearDues(
  transaction: LifecycleTransaction,
  input: { rtUnitId: string; householdId: string; startsOn: string; endsOn?: string | null },
): Promise<number> {
  const openYears = await transaction
    .select({ id: billingYears.id, year: billingYears.year })
    .from(billingYears)
    .where(and(eq(billingYears.rtUnitId, input.rtUnitId), eq(billingYears.status, "open")))
    .orderBy(asc(billingYears.id))
    .limit(2)
    .for("share");
  if (openYears.length === 0) return 0;
  if (openYears.length !== 1) throw new HouseholdLifecycleInvariantError("RT memiliki lebih dari satu tahun tagihan terbuka.");
  const year = openYears[0]!;
  const [settings] = await transaction
    .select({ dueDay: rtSettings.dueDay })
    .from(rtSettings)
    .where(eq(rtSettings.rtUnitId, input.rtUnitId))
    .limit(1);
  if (!settings) throw new HouseholdLifecycleInvariantError("Pengaturan tagihan RT tidak tersedia.");
  const rates = await transaction
    .select({ id: feeRates.id, effectiveMonth: feeRates.effectiveMonth, monthlyAmount: feeRates.monthlyAmount })
    .from(feeRates)
    .where(and(eq(feeRates.rtUnitId, input.rtUnitId), eq(feeRates.billingYearId, year.id)))
    .orderBy(asc(feeRates.effectiveMonth));

  let dueRows: ReturnType<typeof buildAnnualDues>;
  try {
    dueRows = buildAnnualDues({
      rtUnitId: input.rtUnitId,
      householdId: input.householdId,
      billingYearId: year.id,
      year: year.year,
      householdStartsOn: input.startsOn,
      householdEndsOn: input.endsOn,
      dueDay: settings.dueDay,
      feeRates: rates,
    });
  } catch (error) {
    // A missing applicable tariff is an expected setup conflict for this
    // operation. Preserve all other generator errors as invariant failures.
    if (error instanceof Error && /^No fee rate is configured for \d{4}-(0[1-9]|1[0-2])\.$/.test(error.message)) {
      throw new HouseholdLifecycleConflictError("Tarif belum tersedia untuk salah satu bulan masa huni. Atur tarif sebelum menambahkan penghuni.");
    }
    throw error;
  }
  const inserted = await transaction.insert(monthlyDues).values(dueRows).returning({ id: monthlyDues.id });
  return inserted.length;
}

type LockedDue = Awaited<ReturnType<typeof lockHouseholdDues>>[number];

async function futureDuesSafeToTransition(
  transaction: LifecycleTransaction,
  rtUnitId: string,
  dueRows: readonly LockedDue[],
  endMonth: string,
  businessDate: string,
) {
  const postEndRows = dueRows.filter((due) => monthPeriod(due.year, due.month) > endMonth);
  const candidates = postEndRows.filter((due) => due.status === "unpaid");
  if (postEndRows.length === 0) return [];
  if (postEndRows.some((due) => due.status !== "not_due" && due.status !== "unpaid")) {
    throw new HouseholdLifecycleConflictError("Ada tagihan pasca-akhir masa huni yang sudah memiliki status keuangan. Perubahan masa huni dibatalkan.");
  }
  if (candidates.some((due) => due.dueDate <= businessDate)) {
    throw new HouseholdLifecycleConflictError("Tagihan pasca-akhir masa huni yang jatuh tempo tidak dapat diubah. Perubahan dibatalkan.");
  }

  // A NOT_DUE row with lingering request or ledger history is inconsistent
  // with the safe lifecycle boundary too, so inspect every post-end period.
  const postEndIds = postEndRows.map((due) => due.id);
  const [allocationHistory] = await transaction.select({ id: paymentAllocations.monthlyDueId })
    .from(paymentAllocations).where(and(
      eq(paymentAllocations.rtUnitId, rtUnitId),
      inArray(paymentAllocations.monthlyDueId, postEndIds),
    )).limit(1);
  const [requestItemHistory] = await transaction.select({ id: paymentRequestItems.monthlyDueId })
    .from(paymentRequestItems).where(and(
      eq(paymentRequestItems.rtUnitId, rtUnitId),
      inArray(paymentRequestItems.monthlyDueId, postEndIds),
    )).limit(1);
  const [requestClaim] = await transaction.select({ id: paymentRequestClaims.monthlyDueId })
    .from(paymentRequestClaims).where(inArray(paymentRequestClaims.monthlyDueId, postEndIds)).limit(1);
  const [waiverHistory] = await transaction.select({ id: waiverItems.monthlyDueId })
    .from(waiverItems).where(and(
      eq(waiverItems.rtUnitId, rtUnitId),
      inArray(waiverItems.monthlyDueId, postEndIds),
    )).limit(1);
  const [adjustmentHistory] = await transaction.select({ id: dueAdjustments.monthlyDueId })
    .from(dueAdjustments).where(and(
      eq(dueAdjustments.rtUnitId, rtUnitId),
      inArray(dueAdjustments.monthlyDueId, postEndIds),
    )).limit(1);
  if (allocationHistory || requestItemHistory || requestClaim || waiverHistory || adjustmentHistory) {
    throw new HouseholdLifecycleConflictError("Ada riwayat pembayaran atau perubahan keuangan pada tagihan pasca-akhir masa huni. Perubahan masa huni dibatalkan.");
  }
  return candidates;
}

async function transitionFutureDuesToNotDue(
  transaction: LifecycleTransaction,
  dueRows: readonly LockedDue[],
) {
  for (const due of dueRows) {
    await transaction
      .update(monthlyDues)
      .set({ status: "not_due", amount: 0, feeRateId: null, waivedReason: null })
      .where(and(eq(monthlyDues.id, due.id), eq(monthlyDues.status, "unpaid")));
  }
  return dueRows.length;
}

async function revokeSessions(transaction: LifecycleTransaction, userIds: readonly string[]) {
  if (userIds.length === 0) return 0;
  const uniqueUserIds = [...new Set(userIds)];
  const deleted = await transaction
    .delete(authSession)
    .where(inArray(authSession.userId, uniqueUserIds))
    .returning({ id: authSession.id });
  return deleted.length;
}

async function validateNoOverlappingHousehold(
  existing: readonly { id: string; startsOn: string; endsOn: string | null }[],
  startsOn: string,
  excludeHouseholdId?: string,
) {
  const overlaps = existing.some((household) =>
    household.id !== excludeHouseholdId &&
    (household.endsOn === null || household.endsOn >= startsOn),
  );
  if (overlaps) throw new HouseholdLifecycleConflictError("Rumah sudah memiliki masa huni yang bertumpang tindih pada tanggal tersebut.");
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function translateLifecycleConstraint<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    let candidate: unknown = error;
    for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
      const dbError = candidate as { code?: unknown; constraint?: unknown; cause?: unknown };
      if (
        (dbError.code === "23505" && typeof dbError.constraint === "string") ||
        (dbError.code === "23514" && ["households_period_overlap", "households_one_active_per_house_uq"].includes(String(dbError.constraint)))
      ) {
        throw new HouseholdLifecycleConflictError("Rumah, masa huni, atau nomor login berubah bersamaan. Muat ulang lalu coba kembali.");
      }
      candidate = dbError.cause;
    }
    throw error;
  }
}

export async function createHouseholdResident(
  database: AppDatabase,
  principal: Principal,
  input: CreateHouseholdResidentInput,
  businessDate = jakartaBusinessDate(),
): Promise<CreateHouseholdResidentResult> {
  assertPrincipalIsChairman(principal);
  const normalized = normalizeCreateInput(input);
  const date = canonicalDate(businessDate, "Tanggal saat ini");
  if (normalized.startsOn < date) throw new InvalidHouseholdLifecycleInputError("Tanggal mulai tidak boleh berada sebelum hari ini.");
  const rtUnitId = principal.rtUnitId!;

  return translateLifecycleConstraint(() => database.transaction(async (transaction) => {
    let houseId = normalized.houseId;
    if (houseId === null) {
      const canonicalHouseNumber = normalized.houseNumber!;
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`karturt:new-house:${rtUnitId}:${canonicalHouseNumber.toUpperCase()}`}, 0)
        )
      `);
      const [createdHouse] = await transaction.insert(houses).values({
        rtUnitId,
        number: canonicalHouseNumber,
        label: normalized.houseLabel,
      }).returning({ id: houses.id });
      if (!createdHouse) throw new HouseholdLifecycleInvariantError("Rumah baru tidak dapat dibuat.");
      houseId = createdHouse.id;
    }
    const house = await lockHouse(transaction, rtUnitId, houseId);
    const existingHouseholds = await lockHouseholdsForHouse(transaction, rtUnitId, house.id);
    await validateNoOverlappingHousehold(existingHouseholds, normalized.startsOn);
    await lockHouseholdDues(transaction, rtUnitId, existingHouseholds.map((household) => household.id));
    await lockHouseholdResidentAccounts(
      transaction,
      rtUnitId,
      existingHouseholds.map((household) => household.id),
    );
    await assertActiveChairman(transaction, principal, date);

    const loginIdentifier = house.number.trim().toUpperCase();
    await assertNoCurrentLoginCollision(transaction, loginIdentifier);
    const [createdHousehold] = await transaction.insert(households).values({
      rtUnitId,
      houseId: house.id,
      startsOn: normalized.startsOn,
      status: "active",
    }).returning({ id: households.id });
    if (!createdHousehold) throw new HouseholdLifecycleInvariantError("Masa huni baru tidak dapat dibuat.");
    const [createdPerson] = await transaction.insert(people).values({
      rtUnitId,
      householdId: createdHousehold.id,
      fullName: normalized.fullName,
      phone: normalized.phone,
      isActive: true,
    }).returning({ id: people.id });
    if (!createdPerson) throw new HouseholdLifecycleInvariantError("Data penghuni baru tidak dapat dibuat.");

    const provisioningTarget = await resolveResidentProvisioningTarget(transaction as unknown as AppDatabase, {
      rtUnitId,
      householdId: createdHousehold.id,
      personId: createdPerson.id,
    });
    const residentAuth = await createResidentAuthRecords(transaction as unknown as Pick<AppDatabase, "insert">, {
      ...provisioningTarget,
      fullName: normalized.fullName,
      pin: normalized.initialPin,
    });
    const generatedDueCount = await addOpenYearDues(transaction, {
      rtUnitId,
      householdId: createdHousehold.id,
      startsOn: normalized.startsOn,
      endsOn: null,
    });

    await appendAuditEvent(transaction, {
      actorAppAccountId: principal.appAccountId,
      action: "household.created",
      entityType: "household",
      entityId: createdHousehold.id,
      context: {
        createdResidentAccountId: residentAuth.appAccountId,
        generatedDueCount,
        startsOn: normalized.startsOn,
      },
    });

    return {
      houseId: house.id,
      householdId: createdHousehold.id,
      personId: createdPerson.id,
      residentAccountId: residentAuth.appAccountId,
      startsOn: normalized.startsOn,
      generatedDueCount,
    };
  }));
}

export async function updateHouseholdResident(
  database: AppDatabase,
  principal: Principal,
  input: UpdateHouseholdResidentInput,
  businessDate = jakartaBusinessDate(),
): Promise<UpdateHouseholdResidentResult> {
  assertPrincipalIsChairman(principal);
  if (!isPlainObject(input)) throw new InvalidHouseholdLifecycleInputError("Data penghuni belum lengkap.");
  rejectUnknownKeys(input, ["householdId", "personId", "fullName", "phone", "houseLabel"]);
  if (typeof input.householdId !== "string" || !UUID_PATTERN.test(input.householdId) || typeof input.personId !== "string" || !UUID_PATTERN.test(input.personId)) {
    throw new InvalidHouseholdLifecycleInputError("Data penghuni belum valid.");
  }
  if (input.fullName === undefined && input.phone === undefined && input.houseLabel === undefined) {
    throw new InvalidHouseholdLifecycleInputError("Pilih data yang ingin diperbarui.");
  }
  const changes: { fullName?: string; phone?: string | null; houseLabel?: string | null } = {};
  if (input.fullName !== undefined) changes.fullName = normalizeRequiredText(input.fullName, "Nama penghuni", 160);
  const normalizedPhone = normalizePhone(input.phone);
  if (normalizedPhone !== undefined) changes.phone = normalizedPhone;
  const normalizedHouseLabel = normalizeNullableText(input.houseLabel, "Label rumah", 120);
  if (normalizedHouseLabel !== undefined) changes.houseLabel = normalizedHouseLabel;
  const date = canonicalDate(businessDate, "Tanggal saat ini");
  const rtUnitId = principal.rtUnitId!;

  return database.transaction(async (transaction) => {
    const [targetHousehold] = await transaction
      .select({ houseId: households.houseId })
      .from(households)
      .where(and(eq(households.id, input.householdId), eq(households.rtUnitId, rtUnitId)))
      .limit(1);
    if (!targetHousehold) throw new HouseholdLifecycleNotFoundError("Masa huni tidak ditemukan.");
    const house = await lockHouse(transaction, rtUnitId, targetHousehold.houseId);
    const householdRows = await lockHouseholdsForHouse(transaction, rtUnitId, house.id);
    const household = householdRows.find((row) => row.id === input.householdId);
    if (!household) throw new HouseholdLifecycleNotFoundError("Masa huni tidak ditemukan.");
    await lockHouseholdDues(transaction, rtUnitId, household.id);
    await lockHouseholdPeople(transaction, rtUnitId, household.id);
    const residentAccounts = await lockHouseholdResidentAccounts(transaction, rtUnitId, [household.id]);
    await assertActiveChairman(transaction, principal, date);
    if (household.status !== "active") throw new HouseholdLifecycleConflictError("Data penghuni pada masa huni yang sudah berakhir tidak dapat diedit.");

    const [person] = await transaction
      .select({ id: people.id, fullName: people.fullName, phone: people.phone, isActive: people.isActive })
      .from(people)
      .where(and(
        eq(people.id, input.personId),
        eq(people.rtUnitId, rtUnitId),
        eq(people.householdId, household.id),
      ))
      .limit(1);
    if (!person) throw new HouseholdLifecycleNotFoundError("Penghuni tidak ditemukan.");
    if (!person.isActive) throw new HouseholdLifecycleConflictError("Data penghuni yang sudah tidak aktif tidak dapat diedit.");

    const changedFields: string[] = [];
    if (changes.fullName !== undefined && changes.fullName !== person.fullName) changedFields.push("fullName");
    if (changes.phone !== undefined && changes.phone !== person.phone) changedFields.push("phone");
    if (changes.houseLabel !== undefined && changes.houseLabel !== house.label) changedFields.push("houseLabel");
    if (changedFields.length === 0) throw new InvalidHouseholdLifecycleInputError("Tidak ada perubahan yang perlu disimpan.");

    if (changes.fullName !== undefined || changes.phone !== undefined) {
      await transaction.update(people).set({
        ...(changes.fullName !== undefined ? { fullName: changes.fullName } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
      }).where(and(eq(people.id, person.id), eq(people.rtUnitId, rtUnitId)));
    }
    if (changes.fullName !== undefined) {
      const activeAuthUserIds = residentAccounts
        .filter((account) => account.personId === person.id && account.status !== "disabled")
        .map((account) => account.authUserId);
      if (activeAuthUserIds.length > 0) {
        await transaction.update(authUser)
          .set({ name: changes.fullName })
          .where(inArray(authUser.id, activeAuthUserIds));
      }
    }
    if (changes.houseLabel !== undefined) {
      await transaction.update(houses).set({ label: changes.houseLabel }).where(and(
        eq(houses.id, house.id),
        eq(houses.rtUnitId, rtUnitId),
      ));
    }

    const sortedFields = changedFields.sort();
    await appendAuditEvent(transaction, {
      actorAppAccountId: principal.appAccountId,
      action: "household.updated",
      entityType: "household",
      entityId: household.id,
      context: { changedFields: sortedFields.join(",") },
    });
    return { householdId: household.id, personId: person.id, changedFields: sortedFields };
  });
}

async function closeHousehold(
  transaction: LifecycleTransaction,
  principal: Principal,
  input: {
    rtUnitId: string;
    householdId: string;
    endDate: string;
    businessDate: string;
    requireCurrentResidentAccount: boolean;
  },
) {
  const [target] = await transaction
    .select({ houseId: households.houseId })
    .from(households)
    .where(and(eq(households.id, input.householdId), eq(households.rtUnitId, input.rtUnitId)))
    .limit(1);
  if (!target) {
    throw new HouseholdLifecycleNotFoundError("Masa huni tidak ditemukan.");
  }
  const house = await lockHouse(transaction, input.rtUnitId, target.houseId);
  const householdRows = await lockHouseholdsForHouse(transaction, input.rtUnitId, house.id);
  const household = householdRows.find((row) => row.id === input.householdId);
  if (!household) throw new HouseholdLifecycleNotFoundError("Masa huni tidak ditemukan.");
  if (household.status !== "active") throw new HouseholdLifecycleConflictError("Masa huni ini sudah berakhir.");
  if (input.endDate < household.startsOn) throw new HouseholdLifecycleConflictError("Tanggal akhir tidak boleh mendahului tanggal mulai masa huni.");

  const dueRows = await lockHouseholdDues(transaction, input.rtUnitId, household.id);
  const transitionCandidates = await futureDuesSafeToTransition(
    transaction,
    input.rtUnitId,
    dueRows,
    input.endDate.slice(0, 7),
    input.businessDate,
  );
  const peopleRows = await lockHouseholdPeople(transaction, input.rtUnitId, household.id);
  const allAccounts = await lockHouseholdResidentAccounts(transaction, input.rtUnitId, [household.id]);
  if (peopleRows.length === 0) throw new HouseholdLifecycleInvariantError("Masa huni aktif tidak memiliki data penghuni.");
  const currentResidentAccounts = allAccounts.filter((account) => account.status !== "disabled");
  if (input.requireCurrentResidentAccount && currentResidentAccounts.length !== 1) {
    throw new HouseholdLifecycleConflictError("Akun penghuni lama belum memiliki satu status yang dapat dipindahkan dengan aman.");
  }
  await assertActiveChairman(transaction, principal, input.businessDate);

  const [closed] = await transaction.update(households)
    .set({ status: "inactive", endsOn: input.endDate })
    .where(and(
      eq(households.id, household.id),
      eq(households.rtUnitId, input.rtUnitId),
      eq(households.status, "active"),
    ))
    .returning({ id: households.id });
  if (!closed) throw new HouseholdLifecycleConflictError("Status masa huni berubah sebelum tindakan selesai.");

  await transaction.update(people).set({ isActive: false }).where(and(
    eq(people.rtUnitId, input.rtUnitId),
    eq(people.householdId, household.id),
    eq(people.isActive, true),
  ));
  const accountsToDisable = currentResidentAccounts.map((account) => account.id);
  if (accountsToDisable.length > 0) {
    await transaction.update(appAccounts).set({ status: "disabled" }).where(and(
      eq(appAccounts.rtUnitId, input.rtUnitId),
      eq(appAccounts.accountType, "resident"),
      inArray(appAccounts.id, accountsToDisable),
      ne(appAccounts.status, "disabled"),
    ));
  }
  const revokedSessionCount = await revokeSessions(transaction, allAccounts.map((account) => account.authUserId));
  const transitionedDueCount = await transitionFutureDuesToNotDue(transaction, transitionCandidates);

  return {
    house,
    householdRows,
    household,
    currentResidentAccounts,
    disabledAccountCount: accountsToDisable.length,
    revokedSessionCount,
    transitionedDueCount,
  };
}

export async function deactivateHousehold(
  database: AppDatabase,
  principal: Principal,
  input: DeactivateHouseholdInput,
  businessDate = jakartaBusinessDate(),
): Promise<HouseholdLifecycleResult> {
  assertPrincipalIsChairman(principal);
  if (!isPlainObject(input)) throw new InvalidHouseholdLifecycleInputError("Data penutupan masa huni belum lengkap.");
  rejectUnknownKeys(input, ["householdId", "effectiveMonth", "reason"]);
  if (typeof input.householdId !== "string" || !UUID_PATTERN.test(input.householdId)) {
    throw new InvalidHouseholdLifecycleInputError("Masa huni belum valid.");
  }
  const effectiveMonth = canonicalMonth(input.effectiveMonth);
  const date = canonicalDate(businessDate, "Tanggal saat ini");
  if (effectiveMonth < date.slice(0, 7)) throw new InvalidHouseholdLifecycleInputError("Bulan akhir masa huni tidak boleh sebelum bulan berjalan.");
  const endDate = lastDayOfMonth(effectiveMonth);
  const reason = normalizeReason(input.reason);
  const rtUnitId = principal.rtUnitId!;

  return translateLifecycleConstraint(() => database.transaction(async (transaction) => {
    const result = await closeHousehold(transaction, principal, {
      rtUnitId,
      householdId: input.householdId,
      endDate,
      businessDate: date,
      requireCurrentResidentAccount: false,
    });
    await appendAuditEvent(transaction, {
      actorAppAccountId: principal.appAccountId,
      action: "household.deactivated",
      entityType: "household",
      entityId: result.household.id,
      reason,
      context: {
        disabledAccountCount: result.disabledAccountCount,
        effectiveEndDate: endDate,
        revokedSessionCount: result.revokedSessionCount,
        transitionedDueCount: result.transitionedDueCount,
      },
    });
    return {
      householdId: result.household.id,
      effectiveDate: endDate,
      disabledAccountCount: result.disabledAccountCount,
      revokedSessionCount: result.revokedSessionCount,
      transitionedDueCount: result.transitionedDueCount,
    };
  }));
}

export async function replaceHouseholdResident(
  database: AppDatabase,
  principal: Principal,
  input: ReplaceHouseholdResidentInput,
  businessDate = jakartaBusinessDate(),
): Promise<ReplaceHouseholdResidentResult> {
  assertPrincipalIsChairman(principal);
  if (!isPlainObject(input)) throw new InvalidHouseholdLifecycleInputError("Data penggantian penghuni belum lengkap.");
  rejectUnknownKeys(input, ["householdId", "effectiveMonth", "fullName", "phone", "initialPin", "reason"]);
  if (typeof input.householdId !== "string" || !UUID_PATTERN.test(input.householdId)) {
    throw new InvalidHouseholdLifecycleInputError("Masa huni belum valid.");
  }
  const effectiveMonth = canonicalMonth(input.effectiveMonth);
  const date = canonicalDate(businessDate, "Tanggal saat ini");
  if (effectiveMonth <= date.slice(0, 7)) throw new InvalidHouseholdLifecycleInputError("Bulan penggantian harus setelah bulan berjalan.");
  const startsOn = firstDayOfMonth(effectiveMonth);
  const endDate = new Date(Date.parse(`${startsOn}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const fullName = normalizeRequiredText(input.fullName, "Nama penghuni baru", 160);
  const phone = normalizePhone(input.phone) ?? null;
  const initialPin = normalizePin(input.initialPin);
  const reason = normalizeReason(input.reason);
  const rtUnitId = principal.rtUnitId!;

  return translateLifecycleConstraint(() => database.transaction(async (transaction) => {
    const closure = await closeHousehold(transaction, principal, {
      rtUnitId,
      householdId: input.householdId,
      endDate,
      businessDate: date,
      requireCurrentResidentAccount: true,
    });
    const oldAccount = closure.currentResidentAccounts[0]!;
    await validateNoOverlappingHousehold(closure.householdRows, startsOn, closure.household.id);

    const loginIdentifier = closure.house.number.trim().toUpperCase();
    await assertNoCurrentLoginCollision(transaction, loginIdentifier);
    const [newHousehold] = await transaction.insert(households).values({
      rtUnitId,
      houseId: closure.house.id,
      startsOn,
      status: "active",
    }).returning({ id: households.id });
    if (!newHousehold) throw new HouseholdLifecycleInvariantError("Masa huni pengganti tidak dapat dibuat.");
    const [newPerson] = await transaction.insert(people).values({
      rtUnitId,
      householdId: newHousehold.id,
      fullName,
      phone,
      isActive: true,
    }).returning({ id: people.id });
    if (!newPerson) throw new HouseholdLifecycleInvariantError("Data penghuni pengganti tidak dapat dibuat.");

    const provisioningTarget = await resolveResidentProvisioningTarget(transaction as unknown as AppDatabase, {
      rtUnitId,
      householdId: newHousehold.id,
      personId: newPerson.id,
    });
    const residentAuth = await createResidentAuthRecords(transaction as unknown as Pick<AppDatabase, "insert">, {
      ...provisioningTarget,
      fullName,
      pin: initialPin,
    });
    const generatedDueCount = await addOpenYearDues(transaction, {
      rtUnitId,
      householdId: newHousehold.id,
      startsOn,
      endsOn: null,
    });

    await appendAuditEvent(transaction, {
      actorAppAccountId: principal.appAccountId,
      action: "household.resident_replaced",
      entityType: "household",
      entityId: closure.household.id,
      reason,
      context: {
        effectiveDate: startsOn,
        newAccountId: residentAuth.appAccountId,
        newHouseholdId: newHousehold.id,
        oldAccountId: oldAccount.id,
        oldHouseholdId: closure.household.id,
        revokedSessionCount: closure.revokedSessionCount,
        transitionedDueCount: closure.transitionedDueCount,
      },
    });

    return {
      householdId: closure.household.id,
      effectiveDate: startsOn,
      disabledAccountCount: closure.disabledAccountCount,
      revokedSessionCount: closure.revokedSessionCount,
      transitionedDueCount: closure.transitionedDueCount,
      newHouseholdId: newHousehold.id,
      newPersonId: newPerson.id,
      newResidentAccountId: residentAuth.appAccountId,
      generatedDueCount,
    };
  }));
}

export async function listHouseholdManagement(
  database: AppDatabase,
  principal: Principal,
  search = "",
  businessDate = jakartaBusinessDate(),
): Promise<HouseholdManagementListResult> {
  const { rtUnitId } = await assertActiveChairman(database, principal, canonicalDate(businessDate, "Tanggal saat ini"));
  if (typeof search !== "string" || search.trim().length > MAX_SEARCH_LENGTH) {
    throw new InvalidHouseholdLifecycleInputError("Pencarian rumah terlalu panjang.");
  }
  const query = search.trim();
  const clauses = [eq(households.rtUnitId, rtUnitId)];
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    clauses.push(or(
      ilike(houses.number, pattern),
      ilike(houses.label, pattern),
      sql`exists (
        select 1 from public.people matched_person
        where matched_person.rt_unit_id = ${households.rtUnitId}
          and matched_person.household_id = ${households.id}
          and matched_person.full_name ilike ${pattern}
      )`,
    )!);
  }
  const rows = await database
    .select({
      householdId: households.id,
      houseId: houses.id,
      houseNumber: houses.number,
      houseLabel: houses.label,
      status: households.status,
      startsOn: households.startsOn,
      endsOn: households.endsOn,
    })
    .from(households)
    .innerJoin(houses, and(
      eq(houses.rtUnitId, households.rtUnitId),
      eq(houses.id, households.houseId),
    ))
    .where(and(...clauses))
    .orderBy(asc(houses.number), desc(households.startsOn), asc(households.id))
    .limit(HOUSEHOLD_LIST_LIMIT);
  const availableHouseClauses = [
    eq(houses.rtUnitId, rtUnitId),
    sql`not exists (
      select 1 from public.households active_household
      where active_household.rt_unit_id = ${houses.rtUnitId}
        and active_household.house_id = ${houses.id}
        and active_household.status = 'active'
    )`,
  ];
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    availableHouseClauses.push(or(ilike(houses.number, pattern), ilike(houses.label, pattern))!);
  }
  const availableHouses = await database
    .select({ houseId: houses.id, houseNumber: houses.number, houseLabel: houses.label })
    .from(houses)
    .where(and(...availableHouseClauses))
    .orderBy(asc(houses.number), asc(houses.id))
    .limit(HOUSEHOLD_LIST_LIMIT);
  if (rows.length === 0) {
    return {
      households: [],
      availableHouses: availableHouses.map((house) => ({ ...house, houseLabel: house.houseLabel })),
    };
  }

  const householdIds = rows.map((row) => row.householdId);
  const [residentRows, residentAccounts, dueRows] = await Promise.all([
    database.select({
      personId: people.id,
      householdId: people.householdId,
      fullName: people.fullName,
      phone: people.phone,
      isActive: people.isActive,
    }).from(people).where(and(
      eq(people.rtUnitId, rtUnitId),
      inArray(people.householdId, householdIds),
    )).orderBy(asc(people.fullName), asc(people.id)),
    database.select({
      id: appAccounts.id,
      householdId: appAccounts.householdId,
      personId: appAccounts.personId,
      status: appAccounts.status,
    }).from(appAccounts).where(and(
      eq(appAccounts.rtUnitId, rtUnitId),
      eq(appAccounts.accountType, "resident"),
      eq(appAccounts.status, "active"),
      inArray(appAccounts.householdId, householdIds),
    )),
    database.select({
      id: monthlyDues.id,
      householdId: monthlyDues.householdId,
      year: billingYears.year,
      month: monthlyDues.month,
      dueDate: monthlyDues.dueDate,
      status: monthlyDues.status,
    }).from(monthlyDues).innerJoin(billingYears, and(
      eq(billingYears.id, monthlyDues.billingYearId),
      eq(billingYears.rtUnitId, monthlyDues.rtUnitId),
    )).where(and(
      eq(monthlyDues.rtUnitId, rtUnitId),
      inArray(monthlyDues.householdId, householdIds),
    )).orderBy(asc(billingYears.year), asc(monthlyDues.month), asc(monthlyDues.id)),
  ]);

  const duesByHousehold = new Map<string, typeof dueRows>();
  for (const due of dueRows) {
    const householdDues = duesByHousehold.get(due.householdId) ?? [];
    householdDues.push(due);
    duesByHousehold.set(due.householdId, householdDues);
  }
  const allDueIds = dueRows.map((due) => due.id);
  const balances = await getDueFinancialBalances(database, allDueIds);
  if (balances.length !== dueRows.length) {
    throw new HouseholdLifecycleInvariantError("Ringkasan riwayat tagihan tidak cocok dengan data rumah.");
  }
  const balanceByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));
  const residentsByHousehold = new Map<string, HouseholdManagementResident[]>();
  const activeHouseholdIds = new Set(rows.filter((row) => row.status === "active").map((row) => row.householdId));
  const accountByPerson = new Map(residentAccounts
    .filter((account) => account.householdId && account.personId)
    .map((account) => [account.personId!, account.id]));
  for (const resident of residentRows) {
    if (!resident.householdId) continue;
    const list = residentsByHousehold.get(resident.householdId) ?? [];
    list.push({
      personId: resident.personId,
      fullName: resident.fullName,
      phone: resident.phone,
      isActive: resident.isActive,
      residentAccountId: resident.isActive && activeHouseholdIds.has(resident.householdId)
        ? accountByPerson.get(resident.personId) ?? null
        : null,
    });
    residentsByHousehold.set(resident.householdId, list);
  }

  const date = canonicalDate(businessDate, "Tanggal saat ini");
  return {
    availableHouses,
    households: rows.map((household) => {
      const householdDues = duesByHousehold.get(household.householdId) ?? [];
      let unpaidCount = 0;
      let paidCount = 0;
      let waivedCount = 0;
      let notDueCount = 0;
      let outstandingAmount = 0;
      let arrearsAmount = 0;
      for (const due of householdDues) {
        const balance = balanceByDueId.get(due.id);
        if (!balance || balance.rtUnitId !== rtUnitId || balance.householdId !== household.householdId) {
          throw new HouseholdLifecycleInvariantError("Saldo tagihan tidak sesuai dengan rumah yang dipilih.");
        }
        if (due.status === "unpaid") {
          unpaidCount += 1;
          outstandingAmount += balance.outstanding;
          if (due.dueDate < date) arrearsAmount += balance.outstanding;
        } else if (due.status === "paid") paidCount += 1;
        else if (due.status === "waived") waivedCount += 1;
        else notDueCount += 1;
      }
      return {
        householdId: household.householdId,
        houseId: household.houseId,
        houseNumber: household.houseNumber,
        houseLabel: household.houseLabel,
        status: household.status,
        startsOn: household.startsOn,
        endsOn: household.endsOn,
        residents: residentsByHousehold.get(household.householdId) ?? [],
        financialHistory: {
          dueCount: householdDues.length,
          unpaidCount,
          paidCount,
          waivedCount,
          notDueCount,
          outstandingAmount,
          arrearsAmount,
        },
      };
    }),
  };
}
