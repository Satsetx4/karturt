import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  authAccount,
  authTwoFactor,
  authUser,
  billingYears,
  feeRates,
  houses,
  households,
  monthlyDues,
  officialAssignments,
  people,
  rtSettings,
  rtUnits,
  sheet2ImportBatches,
  sheet2OpeningBalanceItems,
} from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";
import { createResidentAuthRecords } from "@/lib/accounts/resident-auth-records";
import { buildAnnualDues } from "@/lib/billing/generator";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
import { isValidAccountPassword } from "@/lib/auth/account-password";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";

const SHEET2_AS_OF_DATE = "2026-10-27";
const SHEET2_YEAR = 2026;
const RESIDENT_COUNT = 73;
const OFFICIAL_COUNT = 2;
const OPENING_BALANCE_COUNT = 626;
const DUE_COUNT = 876;
const SYSTEM_ADMIN_COUNT = 1;
const TARIFF_GROUP_COUNTS = [57, 16] as const;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

export type Sheet2ResidentImportRow = {
  houseNumber: string;
  fullName: string;
  username: string;
  pin: string;
  monthlyAmount: number;
  paidFromMonth: number | null;
  paidThroughMonth: number | null;
  officialRole?: "rt_chairman" | "treasurer";
};

export type Sheet2OfficialCredential = {
  role: "rt_chairman" | "treasurer";
  loginIdentifier: string;
  password: string;
};

export type Sheet2SystemAdminCredential = {
  loginIdentifier: string;
  displayName: string;
  password: string;
};

export type Sheet2ImportInput = {
  rtUnitId: string;
  importBatchId: string;
  actor: Principal;
  residents: readonly Sheet2ResidentImportRow[];
  officials: readonly Sheet2OfficialCredential[];
  systemAdmin: Sheet2SystemAdminCredential;
};

export type Sheet2ImportResult = {
  importBatchId: string;
  idempotentReplay: boolean;
  householdCount: 73;
  residentAccountCount: 73;
  officialAccountCount: 2;
  systemAdminAccountCount: 1;
  monthlyDueCount: 876;
  openingBalanceCount: 626;
  arrearsCount: 138;
  futureUnpaidCount: 112;
  prepaidNovemberCount: 18;
  prepaidDecemberCount: 16;
  tariffClassCounts: readonly [57, 16];
};

type NormalizedResident = Omit<Sheet2ResidentImportRow, "officialRole"> & {
  officialRole: "rt_chairman" | "treasurer" | null;
  houseKey: string;
  loginKey: string;
};

export class Sheet2ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Sheet2ImportError";
  }
}

function isMonth(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 12;
}

function normalizeInput(input: Sheet2ImportInput) {
  if (
    !input || typeof input !== "object" ||
    !UUID_V4.test(input.rtUnitId) || !UUID_V4.test(input.importBatchId) ||
    !Array.isArray(input.residents) || !Array.isArray(input.officials) ||
    input.residents.length !== RESIDENT_COUNT || input.officials.length !== OFFICIAL_COUNT ||
    !input.systemAdmin || typeof input.systemAdmin !== "object"
  ) throw new Sheet2ImportError("Sheet2 import contract is invalid.");

  const residents: NormalizedResident[] = input.residents.map((row) => {
    const allowedKeys = new Set([
      "houseNumber", "fullName", "username", "pin", "monthlyAmount",
      "paidFromMonth", "paidThroughMonth", "officialRole",
    ]);
    if (!row || typeof row !== "object" || Object.keys(row).some((key) => !allowedKeys.has(key))) {
      throw new Sheet2ImportError("Sheet2 resident rows contain unsupported fields.");
    }
    const houseNumber = row.houseNumber?.trim();
    const fullName = row.fullName?.trim();
    const username = row.username?.trim().toUpperCase();
    const paidFromMonth = row.paidFromMonth;
    const paidThroughMonth = row.paidThroughMonth;
    const officialRole = row.officialRole ?? null;
    if (
      houseNumber && username &&
      (!/^[-A-Z0-9/ ]{1,40}$/.test(username) || username !== houseNumber.toLocaleUpperCase("id-ID"))
    ) {
      throw new Sheet2ImportError("The resident login identifier does not match the house number used for sign-in.");
    }
    if (
      !houseNumber || houseNumber.length > 40 || !fullName || fullName.length > 160 ||
      !username || !LOGIN_IDENTIFIER.test(username) ||
      typeof row.pin !== "string" || !/^\d{6}$/.test(row.pin) ||
      !Number.isSafeInteger(row.monthlyAmount) || row.monthlyAmount <= 0 || row.monthlyAmount > MAX_POSTGRES_INTEGER ||
      !((paidFromMonth === null && paidThroughMonth === null) ||
        (isMonth(paidFromMonth) && isMonth(paidThroughMonth) && paidFromMonth <= paidThroughMonth)) ||
      (officialRole !== null && officialRole !== "rt_chairman" && officialRole !== "treasurer")
    ) throw new Sheet2ImportError("Sheet2 resident rows failed validation.");
    return {
      houseNumber,
      fullName,
      username,
      pin: row.pin,
      monthlyAmount: row.monthlyAmount,
      paidFromMonth,
      paidThroughMonth,
      officialRole,
      houseKey: houseNumber.normalize("NFKC").toLocaleLowerCase("id-ID"),
      loginKey: username.toLocaleLowerCase("id-ID"),
    };
  });

  if (
    new Set(residents.map((row) => row.houseKey)).size !== RESIDENT_COUNT ||
    new Set(residents.map((row) => row.loginKey)).size !== RESIDENT_COUNT
  ) throw new Sheet2ImportError("Sheet2 house and resident identifiers must be unique.");

  const paidRanges = residents.filter((row) => row.paidFromMonth !== null);
  const openingBalanceCount = paidRanges.reduce((sum, row) => sum + row.paidThroughMonth! - row.paidFromMonth! + 1, 0);
  const roleRows = residents.filter((row) => row.officialRole !== null);
  if (
    paidRanges.length !== 65 || openingBalanceCount !== OPENING_BALANCE_COUNT ||
    roleRows.length !== OFFICIAL_COUNT ||
    new Set(roleRows.map((row) => row.officialRole)).size !== OFFICIAL_COUNT
  ) throw new Sheet2ImportError("Sheet2 paid ranges or official role mapping failed the approved aggregate contract.");

  const tariffClassCounts = [...new Map(
    residents.map(({ monthlyAmount }) => [monthlyAmount, 0] as const),
  ).keys()]
    .map((amount) => residents.filter((row) => row.monthlyAmount === amount).length)
    .sort((left, right) => right - left);
  if (tariffClassCounts[0] !== 57 || tariffClassCounts[1] !== 16 || tariffClassCounts.length !== 2) {
    throw new Sheet2ImportError("Sheet2 tariff groups failed the approved aggregate contract.");
  }

  const officials = input.officials.map((credential) => ({
    role: credential?.role,
    loginIdentifier: credential?.loginIdentifier?.trim(),
    password: credential?.password,
  }));
  if (
    officials.some(({ role, loginIdentifier, password }) =>
      (role !== "rt_chairman" && role !== "treasurer") ||
      !loginIdentifier || !LOGIN_IDENTIFIER.test(loginIdentifier) ||
      !isValidAccountPassword("official", password)
    ) ||
    new Set(officials.map(({ role }) => role)).size !== OFFICIAL_COUNT ||
    new Set(officials.map(({ loginIdentifier }) => loginIdentifier!.toLocaleLowerCase("id-ID"))).size !== OFFICIAL_COUNT ||
    new Set(officials.map(({ password }) => password)).size !== OFFICIAL_COUNT
  ) throw new Sheet2ImportError("Separate official account credentials failed validation.");

  const systemAdmin = {
    loginIdentifier: input.systemAdmin.loginIdentifier?.trim(),
    displayName: input.systemAdmin.displayName?.trim(),
    password: input.systemAdmin.password,
  };
  if (
    !systemAdmin.loginIdentifier || !LOGIN_IDENTIFIER.test(systemAdmin.loginIdentifier) ||
    !systemAdmin.displayName || systemAdmin.displayName.length > 160 ||
    !isValidAccountPassword("system_admin", systemAdmin.password) ||
    officials.some(({ loginIdentifier }) => loginIdentifier!.toLocaleLowerCase("id-ID") === systemAdmin.loginIdentifier!.toLocaleLowerCase("id-ID")) ||
    new Set([...officials.map(({ password }) => password), systemAdmin.password]).size !== 3 ||
    residents.some((row) => row.pin === systemAdmin.password)
  ) throw new Sheet2ImportError("Separate System Admin credentials failed validation.");

  if (residents.some((row) => officials.some(({ password }) => password === row.pin))) {
    throw new Sheet2ImportError("Resident PINs cannot be reused as privileged account passwords.");
  }
  const allLogins = [
    ...residents.map(({ loginKey }) => loginKey),
    ...officials.map(({ loginIdentifier }) => loginIdentifier!.toLocaleLowerCase("id-ID")),
    systemAdmin.loginIdentifier.toLocaleLowerCase("id-ID"),
  ];
  if (new Set(allLogins).size !== allLogins.length) {
    throw new Sheet2ImportError("Account login identifiers must be unique across imported roles.");
  }

  return {
    rtUnitId: input.rtUnitId,
    importBatchId: input.importBatchId,
    actor: input.actor,
    residents,
    officials,
    systemAdmin,
    tariffClassCounts: TARIFF_GROUP_COUNTS,
  };
}

function result(importBatchId: string, idempotentReplay: boolean): Sheet2ImportResult {
  return {
    importBatchId,
    idempotentReplay,
    householdCount: 73,
    residentAccountCount: 73,
    officialAccountCount: 2,
    systemAdminAccountCount: 1,
    monthlyDueCount: 876,
    openingBalanceCount: 626,
    arrearsCount: 138,
    futureUnpaidCount: 112,
    prepaidNovemberCount: 18,
    prepaidDecemberCount: 16,
    tariffClassCounts: TARIFF_GROUP_COUNTS,
  };
}

async function createPrivilegedAccount(
  transaction: Pick<AppDatabase, "insert">,
  input: { rtUnitId: string | null; accountType: "official" | "system_admin"; loginIdentifier: string; displayName: string; password: string; personId?: string; role?: "rt_chairman" | "treasurer" },
) {
  const authUserId = randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword(input.password);
  await transaction.insert(authUser).values({
    id: authUserId,
    name: input.displayName,
    email: `sheet2-${randomUUID()}@accounts.karturt.invalid`,
    createdAt: now,
    updatedAt: now,
    twoFactorEnabled: false,
  });
  await transaction.insert(authAccount).values({
    id: randomUUID(),
    accountId: authUserId,
    providerId: "credential",
    userId: authUserId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  const [account] = await transaction.insert(appAccounts).values({
    rtUnitId: input.rtUnitId,
    authUserId,
    accountType: input.accountType,
    loginIdentifier: input.loginIdentifier.toUpperCase(),
    pinHash: null,
    personId: input.personId ?? null,
    householdId: null,
  }).returning({ id: appAccounts.id });
  if (!account) throw new Sheet2ImportError("A privileged account could not be created.");
  return account.id;
}

async function assertActiveMfaActor(database: AppDatabase, actor: Principal) {
  assertCanPerform(actor, "system:manage");
  if (actor.role !== "system_admin" || actor.rtUnitId !== null || actor.householdId !== null || actor.personId !== null) {
    throw new Sheet2ImportError("Sheet2 import requires an active System Admin with verified MFA.");
  }
  const [account] = await database.select({
    id: appAccounts.id,
  }).from(appAccounts)
    .innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
    .innerJoin(authTwoFactor, eq(authTwoFactor.userId, authUser.id))
    .where(and(
      eq(appAccounts.id, actor.appAccountId),
      eq(appAccounts.authUserId, actor.authUserId),
      eq(appAccounts.accountType, "system_admin"),
      eq(appAccounts.status, "active"),
      eq(authUser.twoFactorEnabled, true),
      eq(authTwoFactor.verified, true),
    )).limit(1);
  if (!account) throw new Sheet2ImportError("Sheet2 import requires an active System Admin with verified MFA.");
}

async function assertNoCollidingKeys(
  transaction: Pick<AppDatabase, "select">,
  rtUnitId: string,
  residents: NormalizedResident[],
  officials: { loginIdentifier: string }[],
  systemAdmin: { loginIdentifier: string },
) {
  const houseKeys = new Set(residents.map(({ houseKey }) => houseKey));
  const loginKeys = new Set([
    ...residents.map(({ loginKey }) => loginKey),
    ...officials.map(({ loginIdentifier }) => loginIdentifier.toLocaleLowerCase("id-ID")),
  ]);
  const existingHouses = await transaction.select({ number: houses.number })
    .from(houses).where(eq(houses.rtUnitId, rtUnitId));
  const existingRtLogins = await transaction.select({ loginIdentifier: appAccounts.loginIdentifier })
    .from(appAccounts).where(eq(appAccounts.rtUnitId, rtUnitId));
  const existingAdminLogin = await transaction.select({ id: appAccounts.id })
    .from(appAccounts)
    .where(and(eq(appAccounts.accountType, "system_admin"), sql`lower(${appAccounts.loginIdentifier}) = lower(${systemAdmin.loginIdentifier})`))
    .limit(1);
  if (
    existingHouses.some(({ number }) => houseKeys.has(number.normalize("NFKC").toLocaleLowerCase("id-ID"))) ||
    existingRtLogins.some(({ loginIdentifier }) => loginKeys.has(loginIdentifier.toLocaleLowerCase("id-ID"))) ||
    existingAdminLogin.length > 0
  ) {
    throw new Sheet2ImportError("Sheet2 import conflicts with an existing house or account key.");
  }
}

async function assertReplayMatchesInput(
  transaction: Pick<AppDatabase, "select">,
  input: ReturnType<typeof normalizeInput>,
  existingAdminAccountId: string,
) {
  const residentRows = await transaction.select({
    houseNumber: houses.number,
    fullName: people.fullName,
    personId: people.id,
    username: appAccounts.loginIdentifier,
    monthlyAmount: feeRates.monthlyAmount,
  }).from(households)
    .innerJoin(houses, and(eq(houses.id, households.houseId), eq(houses.rtUnitId, households.rtUnitId)))
    .innerJoin(people, and(eq(people.householdId, households.id), eq(people.rtUnitId, households.rtUnitId)))
    .innerJoin(appAccounts, and(
      eq(appAccounts.householdId, households.id),
      eq(appAccounts.personId, people.id),
      eq(appAccounts.rtUnitId, households.rtUnitId),
      eq(appAccounts.accountType, "resident"),
    ))
    .innerJoin(feeRates, and(
      eq(feeRates.householdId, households.id),
      eq(feeRates.rtUnitId, households.rtUnitId),
      eq(feeRates.sheet2ImportBatchId, input.importBatchId),
    ))
    .where(eq(households.rtUnitId, input.rtUnitId));
  if (residentRows.length !== RESIDENT_COUNT) throw new Sheet2ImportError("Existing Sheet2 batch does not match the requested replay.");
  const actualResidents = new Map(residentRows.map((row) => [row.houseNumber.normalize("NFKC").toLocaleLowerCase("id-ID"), row]));
  if (actualResidents.size !== RESIDENT_COUNT) throw new Sheet2ImportError("Existing Sheet2 batch does not match the requested replay.");
  for (const expected of input.residents) {
    const actual = actualResidents.get(expected.houseKey);
    if (
      !actual || actual.fullName !== expected.fullName ||
      actual.username.toLocaleLowerCase("id-ID") !== expected.loginKey ||
      actual.monthlyAmount !== expected.monthlyAmount
    ) throw new Sheet2ImportError("Existing Sheet2 batch does not match the requested replay.");
  }

  const actualOfficials = await transaction.select({
    loginIdentifier: appAccounts.loginIdentifier,
    role: officialAssignments.role,
    personId: appAccounts.personId,
    fullName: people.fullName,
    houseNumber: houses.number,
  }).from(officialAssignments)
    .innerJoin(appAccounts, and(
      eq(appAccounts.id, officialAssignments.appAccountId),
      eq(appAccounts.rtUnitId, officialAssignments.rtUnitId),
      eq(appAccounts.accountType, "official"),
    ))
    .innerJoin(people, and(eq(people.id, appAccounts.personId), eq(people.rtUnitId, appAccounts.rtUnitId)))
    .innerJoin(households, and(eq(households.id, people.householdId), eq(households.rtUnitId, people.rtUnitId)))
    .innerJoin(houses, and(eq(houses.id, households.houseId), eq(houses.rtUnitId, households.rtUnitId)))
    .innerJoin(feeRates, and(
      eq(feeRates.householdId, households.id),
      eq(feeRates.sheet2ImportBatchId, input.importBatchId),
    ))
    .where(eq(officialAssignments.rtUnitId, input.rtUnitId));
  if (actualOfficials.length !== OFFICIAL_COUNT || input.officials.some((expected) =>
    !actualOfficials.some((actual) => actual.role === expected.role &&
      actual.loginIdentifier.toLocaleLowerCase("id-ID") === expected.loginIdentifier.toLocaleLowerCase("id-ID") &&
      input.residents.some((row) => row.officialRole === expected.role &&
        row.fullName === actual.fullName && row.houseKey === actual.houseNumber.normalize("NFKC").toLocaleLowerCase("id-ID"))
    )
  )) throw new Sheet2ImportError("Existing Sheet2 batch does not match the requested replay.");

  const [admin] = await transaction.select({ loginIdentifier: appAccounts.loginIdentifier })
    .from(appAccounts)
    .where(and(eq(appAccounts.id, existingAdminAccountId), eq(appAccounts.accountType, "system_admin")))
    .limit(1);
  if (admin?.loginIdentifier.toLocaleLowerCase("id-ID") !== input.systemAdmin.loginIdentifier.toLocaleLowerCase("id-ID")) {
    throw new Sheet2ImportError("Existing Sheet2 batch does not match the requested replay.");
  }

  const actualOpeningRows = await transaction.select({
    houseNumber: houses.number,
    month: monthlyDues.month,
    amount: sheet2OpeningBalanceItems.amount,
    startsOn: sheet2OpeningBalanceItems.sourceRangeStartMonth,
    endsOn: sheet2OpeningBalanceItems.sourceRangeEndMonth,
  }).from(sheet2OpeningBalanceItems)
    .innerJoin(households, and(eq(households.id, sheet2OpeningBalanceItems.householdId), eq(households.rtUnitId, sheet2OpeningBalanceItems.rtUnitId)))
    .innerJoin(houses, and(eq(houses.id, households.houseId), eq(houses.rtUnitId, households.rtUnitId)))
    .innerJoin(monthlyDues, and(eq(monthlyDues.id, sheet2OpeningBalanceItems.monthlyDueId), eq(monthlyDues.rtUnitId, sheet2OpeningBalanceItems.rtUnitId)))
    .where(and(
      eq(sheet2OpeningBalanceItems.rtUnitId, input.rtUnitId),
      eq(sheet2OpeningBalanceItems.importBatchId, input.importBatchId),
    ));
  const expectedOpeningKeys = input.residents.flatMap((resident) => {
    if (resident.paidFromMonth === null || resident.paidThroughMonth === null) return [];
    return Array.from({ length: resident.paidThroughMonth - resident.paidFromMonth + 1 }, (_, offset) => {
      const month = resident.paidFromMonth! + offset;
      return `${resident.houseKey}:${month}:${resident.monthlyAmount}:${resident.paidFromMonth}:${resident.paidThroughMonth}`;
    });
  }).sort();
  const actualOpeningKeys = actualOpeningRows.map((row) =>
    `${row.houseNumber.normalize("NFKC").toLocaleLowerCase("id-ID")}:${row.month}:${row.amount}:${row.startsOn}:${row.endsOn}`
  ).sort();
  if (actualOpeningKeys.length !== OPENING_BALANCE_COUNT || actualOpeningKeys.some((key, index) => key !== expectedOpeningKeys[index])) {
    throw new Sheet2ImportError("Existing Sheet2 batch does not match the requested replay.");
  }
}

/**
 * Imports the validated Sheet2 aggregate contract as a single database
 * transaction. Historical Sheet2 paid spans are opening balances, never
 * verified payments or resident receipts.
 */
export async function importSheet2(database: AppDatabase, rawInput: Sheet2ImportInput): Promise<Sheet2ImportResult> {
  const input = normalizeInput(rawInput);
  assertCanPerform(input.actor, "system:manage");
  if (input.actor.role !== "system_admin" || input.actor.rtUnitId !== null) {
    throw new Sheet2ImportError("Sheet2 import requires an active System Admin with verified MFA.");
  }

  try {
    return await database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`karturt:sheet2-import:${input.rtUnitId}`}, 0))`);
      const [unit] = await transaction.select({ id: rtUnits.id })
        .from(rtUnits).where(eq(rtUnits.id, input.rtUnitId)).limit(1).for("update");
      if (!unit) throw new Sheet2ImportError("The target RT unit was not found.");
      await assertActiveMfaActor(transaction as unknown as AppDatabase, input.actor);
      const [settings] = await transaction.select({ dueDay: rtSettings.dueDay, currency: rtSettings.currency })
        .from(rtSettings).where(eq(rtSettings.rtUnitId, input.rtUnitId)).limit(1).for("share");
      if (!settings || settings.dueDay !== 10 || settings.currency !== "IDR") {
        throw new Sheet2ImportError("The RT billing settings do not match the Sheet2 import contract.");
      }

      const [existingBatch] = await transaction.select({
        id: sheet2ImportBatches.id,
        rtUnitId: sheet2ImportBatches.rtUnitId,
        createdByAccountId: sheet2ImportBatches.createdByAccountId,
        importedSystemAdminAccountId: sheet2ImportBatches.importedSystemAdminAccountId,
      }).from(sheet2ImportBatches)
        .where(eq(sheet2ImportBatches.id, input.importBatchId)).limit(1);
      if (existingBatch) {
        if (existingBatch.rtUnitId !== input.rtUnitId || existingBatch.createdByAccountId !== input.actor.appAccountId) {
          throw new Sheet2ImportError("Existing Sheet2 batch does not match the requested replay.");
        }
        await assertReplayMatchesInput(transaction as unknown as AppDatabase, input, existingBatch.importedSystemAdminAccountId);
        return result(input.importBatchId, true);
      }

      const [otherBatch] = await transaction.select({ id: sheet2ImportBatches.id })
        .from(sheet2ImportBatches)
        .where(and(
          eq(sheet2ImportBatches.rtUnitId, input.rtUnitId),
          sql`${sheet2ImportBatches.billingYearId} IN (
            SELECT id FROM public.billing_years WHERE rt_unit_id = ${input.rtUnitId} AND year = ${SHEET2_YEAR}
          )`,
        )).limit(1);
      if (otherBatch) throw new Sheet2ImportError("A Sheet2 batch already exists for this RT and billing year.");

      const officialAssignmentStartsOn = jakartaBusinessDate();
      const activeOfficialAssignments = await transaction.select({ id: officialAssignments.id })
        .from(officialAssignments)
        .innerJoin(appAccounts, and(
          eq(appAccounts.id, officialAssignments.appAccountId),
          eq(appAccounts.rtUnitId, officialAssignments.rtUnitId),
          eq(appAccounts.accountType, "official"),
          eq(appAccounts.status, "active"),
        ))
        .where(and(
          eq(officialAssignments.rtUnitId, input.rtUnitId),
          sql`${officialAssignments.role} IN ('rt_chairman', 'treasurer')`,
          sql`${officialAssignments.startsOn} <= ${officialAssignmentStartsOn}`,
          sql`(${officialAssignments.endsOn} IS NULL OR ${officialAssignments.endsOn} >= ${officialAssignmentStartsOn})`,
        ))
        .limit(1);
      if (activeOfficialAssignments.length > 0) {
        throw new Sheet2ImportError("An active official role already exists for this RT on the import date.");
      }

      await assertNoCollidingKeys(transaction as unknown as AppDatabase, input.rtUnitId, input.residents, input.officials, input.systemAdmin);

      const [existingYear] = await transaction.select({
        id: billingYears.id,
        status: billingYears.status,
      }).from(billingYears)
        .where(and(eq(billingYears.rtUnitId, input.rtUnitId), eq(billingYears.year, SHEET2_YEAR)))
        .limit(1).for("update");
      let billingYearId = existingYear?.id;
      if (existingYear && existingYear.status !== "open") {
        throw new Sheet2ImportError("The existing 2026 billing year is not open for import.");
      }
      if (!billingYearId) {
        const [openYear] = await transaction.select({ id: billingYears.id })
          .from(billingYears)
          .where(and(eq(billingYears.rtUnitId, input.rtUnitId), eq(billingYears.status, "open")))
          .limit(1).for("update");
        if (openYear) throw new Sheet2ImportError("A different open billing year blocks the 2026 import.");
        const [createdYear] = await transaction.insert(billingYears).values({
          rtUnitId: input.rtUnitId,
          year: SHEET2_YEAR,
          status: "open",
        }).returning({ id: billingYears.id });
        if (!createdYear) throw new Sheet2ImportError("The 2026 billing year could not be created.");
        billingYearId = createdYear.id;
      }

      const createdHouseholds: Array<{
        row: NormalizedResident;
        householdId: string;
        personId: string;
        residentAccountId: string;
        feeRateId: string | null;
      }> = [];
      for (const row of input.residents) {
        const [house] = await transaction.insert(houses).values({
          rtUnitId: input.rtUnitId,
          number: row.houseNumber,
        }).returning({ id: houses.id });
        if (!house) throw new Sheet2ImportError("A household record could not be created.");
        const [household] = await transaction.insert(households).values({
          rtUnitId: input.rtUnitId,
          houseId: house.id,
          startsOn: "2026-01-01",
        }).returning({ id: households.id });
        if (!household) throw new Sheet2ImportError("A household record could not be created.");
        const [person] = await transaction.insert(people).values({
          rtUnitId: input.rtUnitId,
          householdId: household.id,
          fullName: row.fullName,
        }).returning({ id: people.id });
        if (!person) throw new Sheet2ImportError("A resident record could not be created.");
        const resident = await createResidentAuthRecords(transaction, {
          rtUnitId: input.rtUnitId,
          householdId: household.id,
          personId: person.id,
          loginIdentifier: row.username,
          fullName: row.fullName,
          pin: row.pin,
        });
        createdHouseholds.push({
          row,
          householdId: household.id,
          personId: person.id,
          residentAccountId: resident.appAccountId,
          feeRateId: null,
        });
      }

      const officialAccountIds: string[] = [];
      for (const credential of input.officials) {
        const resident = createdHouseholds.find(({ row }) => row.officialRole === credential.role);
        if (!resident) throw new Sheet2ImportError("An official role is not linked to a resident household.");
        const accountId = await createPrivilegedAccount(transaction, {
          rtUnitId: input.rtUnitId,
          accountType: "official",
          loginIdentifier: credential.loginIdentifier!,
          displayName: resident.row.fullName,
          password: credential.password!,
          personId: resident.personId,
        });
        officialAccountIds.push(accountId);
        await transaction.insert(officialAssignments).values({
          rtUnitId: input.rtUnitId,
          appAccountId: accountId,
          appAccountType: "official",
          role: credential.role!,
          startsOn: officialAssignmentStartsOn,
        });
      }

      const importedSystemAdminAccountId = await createPrivilegedAccount(transaction, {
        rtUnitId: null,
        accountType: "system_admin",
        loginIdentifier: input.systemAdmin.loginIdentifier!,
        displayName: input.systemAdmin.displayName!,
        password: input.systemAdmin.password!,
      });
      const [batch] = await transaction.insert(sheet2ImportBatches).values({
        id: input.importBatchId,
        rtUnitId: input.rtUnitId,
        billingYearId,
        createdByAccountId: input.actor.appAccountId,
        importedSystemAdminAccountId,
        sourceSheet: "Sheet2",
        asOfDate: SHEET2_AS_OF_DATE,
        householdCount: RESIDENT_COUNT,
        residentAccountCount: RESIDENT_COUNT,
        officialAccountCount: OFFICIAL_COUNT,
        systemAdminAccountCount: SYSTEM_ADMIN_COUNT,
        monthlyDueCount: DUE_COUNT,
        openingBalanceCount: OPENING_BALANCE_COUNT,
        tariffClassCounts: [...TARIFF_GROUP_COUNTS],
      }).returning({ id: sheet2ImportBatches.id });
      if (!batch) throw new Sheet2ImportError("The Sheet2 import batch could not be recorded.");

      for (const household of createdHouseholds) {
        const [rate] = await transaction.insert(feeRates).values({
          rtUnitId: input.rtUnitId,
          billingYearId,
          householdId: household.householdId,
          effectiveMonth: 1,
          monthlyAmount: household.row.monthlyAmount,
          sheet2ImportBatchId: input.importBatchId,
        }).returning({ id: feeRates.id });
        if (!rate) throw new Sheet2ImportError("A household tariff could not be created.");
        household.feeRateId = rate.id;
      }

      const allDueIds: string[] = [];
      const openingItems: Array<typeof sheet2OpeningBalanceItems.$inferInsert> = [];
      let prepaidNovemberCount = 0;
      let prepaidDecemberCount = 0;
      for (const { row, householdId, feeRateId } of createdHouseholds) {
        if (!feeRateId) throw new Sheet2ImportError("A household tariff could not be created.");
        const dues = buildAnnualDues({
          rtUnitId: input.rtUnitId,
          householdId,
          billingYearId,
          year: SHEET2_YEAR,
          householdStartsOn: "2026-01-01",
          dueDay: 10,
          feeRates: [{
            id: feeRateId,
            effectiveMonth: 1,
            monthlyAmount: row.monthlyAmount,
            householdId,
          }],
        });
        const inserted = await transaction.insert(monthlyDues).values(dues)
          .returning({ id: monthlyDues.id, month: monthlyDues.month, amount: monthlyDues.amount });
        if (inserted.length !== 12) throw new Sheet2ImportError("The monthly dues could not be generated completely.");
        allDueIds.push(...inserted.map(({ id }) => id));
        if (row.paidFromMonth !== null && row.paidThroughMonth !== null) {
          const rangeDueRows = inserted.filter(({ month }) => month >= row.paidFromMonth! && month <= row.paidThroughMonth!);
          if (rangeDueRows.length !== row.paidThroughMonth - row.paidFromMonth + 1) {
            throw new Sheet2ImportError("A paid Sheet2 month range does not match generated dues.");
          }
          for (const due of rangeDueRows) {
            openingItems.push({
              rtUnitId: input.rtUnitId,
              importBatchId: input.importBatchId,
              householdId,
              monthlyDueId: due.id,
              amount: due.amount,
              sourceRangeStartMonth: row.paidFromMonth,
              sourceRangeEndMonth: row.paidThroughMonth,
            });
            if (due.month === 11) prepaidNovemberCount += 1;
            if (due.month === 12) prepaidDecemberCount += 1;
          }
        }
      }
      if (allDueIds.length !== DUE_COUNT || openingItems.length !== OPENING_BALANCE_COUNT ||
          prepaidNovemberCount !== 18 || prepaidDecemberCount !== 16) {
        throw new Sheet2ImportError("Generated Sheet2 dues failed the approved aggregate contract.");
      }

      await transaction.insert(sheet2OpeningBalanceItems).values(openingItems);
      const paidDueIds = openingItems.map(({ monthlyDueId }) => monthlyDueId);
      await transaction.update(monthlyDues).set({ status: "paid" })
        .where(inArray(monthlyDues.id, paidDueIds));
      await appendAuditEvent(transaction, {
        actorAppAccountId: input.actor.appAccountId,
        action: "billing.sheet2_opening_balance_imported",
        entityType: "sheet2_import_batch",
        entityId: input.importBatchId,
        context: {
          asOfDate: SHEET2_AS_OF_DATE,
          householdCount: RESIDENT_COUNT,
          monthlyDueCount: DUE_COUNT,
          officialAccountCount: OFFICIAL_COUNT,
          openingBalanceCount: OPENING_BALANCE_COUNT,
          residentAccountCount: RESIDENT_COUNT,
          sourceSheet: "Sheet2",
          systemAdminAccountCount: SYSTEM_ADMIN_COUNT,
          tariffGroupOneCount: TARIFF_GROUP_COUNTS[0],
          tariffGroupTwoCount: TARIFF_GROUP_COUNTS[1],
          year: SHEET2_YEAR,
        },
      });

      const [overdue] = await transaction.select({ value: count() }).from(monthlyDues)
        .where(and(inArray(monthlyDues.id, allDueIds), eq(monthlyDues.status, "unpaid"), sql`${monthlyDues.dueDate} <= ${SHEET2_AS_OF_DATE}`));
      const [future] = await transaction.select({ value: count() }).from(monthlyDues)
        .where(and(inArray(monthlyDues.id, allDueIds), eq(monthlyDues.status, "unpaid"), sql`${monthlyDues.dueDate} > ${SHEET2_AS_OF_DATE}`));
      if ((overdue?.value ?? 0) !== 138 || (future?.value ?? 0) !== 112) {
        throw new Sheet2ImportError("Generated Sheet2 due statuses failed the approved aggregate contract.");
      }
      return result(input.importBatchId, false);
    }, { isolationLevel: "serializable" });
  } catch (error) {
    if (error instanceof Sheet2ImportError) throw error;
    throw new Sheet2ImportError("Sheet2 import failed atomically; no personal values were recorded in diagnostics.");
  }
}
