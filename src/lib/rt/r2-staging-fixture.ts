import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, count, eq, getTableName, isNotNull, isNull, sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  authAccount,
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
  schema,
} from "@/db/schema";
import { activateBillingYear } from "@/lib/billing/activation";
import { createChairmanFeeRate } from "@/lib/billing/chairman-fee-rates";
import { createHouseholdResident } from "@/lib/households/lifecycle";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { bootstrapRtUnit } from "@/lib/rt/bootstrap";
import type { Principal } from "@/lib/auth/permissions";

const fixture = {
  rt: {
    code: "R2-SYNTH-01",
    rwCode: "R2-SYNTH",
    name: "KartuRT R2 Synthetic",
    village: "Synthetic Staging",
  },
  houseNumber: "R2-101",
  houseLabel: "Rumah sintetis",
  residentName: "Warga Sintetis 101",
  residentLogin: "R2-101",
  chairmanLogin: "r2-chairman",
  chairmanName: "Ketua RT Sintetis",
  chairmanDisplayName: "Ketua RT Uji",
  chairmanEmail: "r2-chairman@accounts.karturt.invalid",
  treasurerLogin: "r2-treasurer",
  treasurerName: "Bendahara Sintetis",
  treasurerDisplayName: "Bendahara Uji",
  treasurerEmail: "r2-treasurer@accounts.karturt.invalid",
  systemAdminLogin: "r2-system-admin",
  systemAdminDisplayName: "Admin Sistem Uji",
  systemAdminEmail: "r2-system-admin@accounts.karturt.invalid",
  monthlyAmount: 50_000,
};

export type R2StagingFixtureCredentials = {
  residentPin: string;
  chairmanPassword: string;
  treasurerPassword: string;
  systemAdminPassword: string;
};

export type R2StagingFixtureResult = {
  status: "created" | "already_present";
  counts: {
    rtUnits: 1;
    residents: 1;
    treasurers: 1;
    chairmen: 1;
    systemAdmins: 1;
    billingYears: 1;
    feeRates: 1;
    monthlyDues: 12;
  };
};

type FixtureDb = AppDatabase;

const expectedFixtureTableCounts: Readonly<Record<string, number>> = {
  rt_units: 1,
  rt_settings: 1,
  houses: 1,
  households: 1,
  people: 3,
  user: 4,
  session: 0,
  account: 4,
  verification: 0,
  twoFactor: 0,
  rateLimit: 0,
  app_accounts: 4,
  official_assignments: 2,
  billing_years: 1,
  fee_rates: 1,
  monthly_dues: 12,
  due_adjustments: 0,
  payment_requests: 0,
  payments: 0,
  payment_reversals: 0,
  payment_request_items: 0,
  payment_allocations: 0,
  active_due_settlements: 0,
  payment_request_claims: 0,
  audit_events: 2,
  waiver_actions: 0,
  waiver_items: 0,
};

async function readTableCounts(database: FixtureDb) {
  const tables = Object.values(schema) as AnyPgTable[];
  const counts = await Promise.all(tables.map(async (table) => {
    const [row] = await database.select({ value: count() }).from(table);
    return [getTableName(table), row?.value ?? 0] as const;
  }));
  return Object.fromEntries(counts);
}

async function assertExactTableCounts(database: FixtureDb, expected: Readonly<Record<string, number>>) {
  const actual = await readTableCounts(database);
  const differences = Object.entries(expected)
    .filter(([tableName, expectedCount]) => actual[tableName] !== expectedCount)
    .map(([tableName]) => tableName);
  if (differences.length > 0 || Object.keys(actual).length !== Object.keys(expected).length) {
    throw new Error(`Canonical staging row counts do not match the expected fixture in: ${differences.join(", ") || "application schema"}.`);
  }
}

function emptyTableCounts() {
  return Object.fromEntries(Object.keys(expectedFixtureTableCounts).map((tableName) => [tableName, 0]));
}

async function createOfficial(
  database: FixtureDb,
  input: {
    rtUnitId: string | null;
    personName: string | null;
    loginIdentifier: string;
    email: string;
    displayName: string;
    password: string;
    role?: "rt_chairman" | "treasurer";
    startsOn?: string;
  },
) {
  const person = input.role && input.rtUnitId
    ? (await database.insert(people).values({
      rtUnitId: input.rtUnitId,
      fullName: input.personName!,
      householdId: null,
    }).returning({ id: people.id }))[0]
    : undefined;
  const authUserId = randomUUID();
  const now = new Date();
  await database.insert(authUser).values({
    id: authUserId,
    name: input.displayName,
    email: input.email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(authAccount).values({
    id: randomUUID(),
    accountId: authUserId,
    providerId: "credential",
    userId: authUserId,
    password: await hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  });
  const [account] = await database.insert(appAccounts).values({
    rtUnitId: input.rtUnitId,
    authUserId,
    accountType: input.role ? "official" : "system_admin",
    loginIdentifier: input.loginIdentifier,
    personId: person?.id ?? null,
  }).returning({ id: appAccounts.id });
  if (!account) throw new Error("Synthetic account could not be created.");

  if (input.role && input.rtUnitId) {
    await database.insert(officialAssignments).values({
      rtUnitId: input.rtUnitId,
      appAccountId: account.id,
      role: input.role,
      startsOn: input.startsOn!,
    });
  }
  return { appAccountId: account.id, authUserId, personId: person?.id ?? null };
}

function validateCredentials(credentials: R2StagingFixtureCredentials) {
  if (typeof credentials.residentPin !== "string" || !/^\d{6}$/.test(credentials.residentPin)) {
    throw new Error("R2 resident credential must be a six-digit synthetic PIN.");
  }
  const officialPasswords = [credentials.chairmanPassword, credentials.treasurerPassword, credentials.systemAdminPassword];
  if (officialPasswords.some((password) => typeof password !== "string" || password.trim() !== password || password.length < 16 || password.length > 128)) {
    throw new Error("R2 official synthetic passwords must be 16 to 128 characters without surrounding whitespace.");
  }
  if (new Set(officialPasswords).size !== officialPasswords.length) {
    throw new Error("Each R2 synthetic official account must use a distinct password.");
  }
}

async function assertEmptySeedTarget(database: FixtureDb) {
  await assertExactTableCounts(database, emptyTableCounts());
}

async function verifyFixture(
  database: FixtureDb,
  businessDate: string,
  credentials: R2StagingFixtureCredentials,
): Promise<boolean> {
  const [unitCountRow] = await database.select({ value: count() }).from(rtUnits);
  const unitCount = unitCountRow?.value ?? 0;
  if (unitCount === 0) {
    await assertEmptySeedTarget(database);
    return false;
  }
  if (unitCount !== 1) throw new Error("R2 bootstrap requires exactly one RT in canonical staging.");

  const [unit] = await database.select({
    id: rtUnits.id,
    code: rtUnits.code,
    rwCode: rtUnits.rwCode,
    name: rtUnits.name,
    village: rtUnits.village,
  }).from(rtUnits).where(eq(rtUnits.code, fixture.rt.code)).limit(1);
  if (!unit || unit.rwCode !== fixture.rt.rwCode || unit.name !== fixture.rt.name || unit.village !== fixture.rt.village) {
    throw new Error("An unrelated RT occupies the canonical staging target; refusing to seed.");
  }
  await assertExactTableCounts(database, expectedFixtureTableCounts);
  const settings = await database.select({ id: rtSettings.id, dueDay: rtSettings.dueDay, currency: rtSettings.currency })
    .from(rtSettings).where(eq(rtSettings.rtUnitId, unit.id)).limit(2);
  if (settings.length !== 1 || settings[0]?.dueDay !== 10 || settings[0]?.currency !== "IDR") {
    throw new Error("The canonical R2 fixture settings do not match; refusing to change existing staging data.");
  }

  const [house] = await database.select({ id: houses.id, label: houses.label }).from(houses).where(and(
    eq(houses.rtUnitId, unit.id), eq(houses.number, fixture.houseNumber),
  )).limit(1);
  if (!house || house.label !== fixture.houseLabel) {
    throw new Error("The canonical R2 fixture house does not match; refusing to change existing staging data.");
  }
  const [household] = await database.select({
    id: households.id,
    startsOn: households.startsOn,
    endsOn: households.endsOn,
    status: households.status,
  }).from(households).where(and(
    eq(households.rtUnitId, unit.id), eq(households.houseId, house.id),
  )).limit(1);
  if (!household || household.status !== "active" || household.endsOn !== null) {
    throw new Error("The canonical R2 fixture is incomplete or inactive; refusing to change existing staging data.");
  }

  const year = Number(household.startsOn.slice(0, 4));
  if (household.startsOn !== `${year}-01-01`) throw new Error("The canonical R2 fixture has an invalid household start date.");
  const [billingYear] = await database.select({ id: billingYears.id, year: billingYears.year, status: billingYears.status }).from(billingYears).where(and(
    eq(billingYears.rtUnitId, unit.id), eq(billingYears.year, year),
  )).limit(1);
  if (!billingYear || billingYear.year !== year || billingYear.status !== "open") {
    throw new Error("The canonical R2 fixture billing year is not active; refusing to change existing staging data.");
  }
  const months = await database.select({
    month: monthlyDues.month,
    amount: monthlyDues.amount,
    dueDate: monthlyDues.dueDate,
    status: monthlyDues.status,
  }).from(monthlyDues).where(and(
    eq(monthlyDues.rtUnitId, unit.id),
    eq(monthlyDues.householdId, household.id),
    eq(monthlyDues.billingYearId, billingYear.id),
  )).orderBy(monthlyDues.month).limit(13);
  if (months.length !== 12 || months.some((due, index) => (
    due.month !== index + 1 ||
    due.amount !== fixture.monthlyAmount ||
    due.dueDate !== `${year}-${String(index + 1).padStart(2, "0")}-10` ||
    due.status !== "unpaid"
  ))) {
    throw new Error("The canonical R2 fixture is incomplete; refusing to change existing staging data.");
  }
  const baselineRates = await database.select({ id: feeRates.id }).from(feeRates).where(and(
    eq(feeRates.rtUnitId, unit.id),
    eq(feeRates.billingYearId, billingYear.id),
    eq(feeRates.effectiveMonth, 1),
    eq(feeRates.monthlyAmount, fixture.monthlyAmount),
  )).limit(2);
  if (baselineRates.length !== 1) throw new Error("The canonical R2 fixture is incomplete; refusing to change existing staging data.");

  const [resident] = await database.select({
    id: appAccounts.id,
    authUserId: appAccounts.authUserId,
    householdId: appAccounts.householdId,
    personId: appAccounts.personId,
    status: appAccounts.status,
  }).from(appAccounts).where(and(
    eq(appAccounts.rtUnitId, unit.id), eq(appAccounts.accountType, "resident"), eq(appAccounts.loginIdentifier, fixture.residentLogin),
  )).limit(1);
  const [chairman] = await database.select({ id: appAccounts.id, authUserId: appAccounts.authUserId, personId: appAccounts.personId, status: appAccounts.status }).from(appAccounts).where(and(
    eq(appAccounts.rtUnitId, unit.id), eq(appAccounts.accountType, "official"), eq(appAccounts.loginIdentifier, fixture.chairmanLogin),
  )).limit(1);
  const [treasurer] = await database.select({ id: appAccounts.id, authUserId: appAccounts.authUserId, personId: appAccounts.personId, status: appAccounts.status }).from(appAccounts).where(and(
    eq(appAccounts.rtUnitId, unit.id), eq(appAccounts.accountType, "official"), eq(appAccounts.loginIdentifier, fixture.treasurerLogin),
  )).limit(1);
  const [systemAdmin] = await database.select({ id: appAccounts.id, authUserId: appAccounts.authUserId, status: appAccounts.status }).from(appAccounts).where(and(
    isNull(appAccounts.rtUnitId), eq(appAccounts.accountType, "system_admin"), eq(appAccounts.loginIdentifier, fixture.systemAdminLogin),
  )).limit(1);
  if (
    !resident || resident.householdId !== household.id || resident.status !== "active" ||
    !chairman || chairman.status !== "active" || !treasurer || treasurer.status !== "active" ||
    !systemAdmin || systemAdmin.status !== "active"
  ) {
    throw new Error("The canonical R2 fixture has missing or inactive accounts; refusing to change existing staging data.");
  }

  for (const [account, role] of [[chairman, "rt_chairman"], [treasurer, "treasurer"]] as const) {
    const assignments = await database.select({
      id: officialAssignments.id,
      startsOn: officialAssignments.startsOn,
      endsOn: officialAssignments.endsOn,
      appAccountType: officialAssignments.appAccountType,
    }).from(officialAssignments).where(and(
      eq(officialAssignments.rtUnitId, unit.id),
      eq(officialAssignments.appAccountId, account.id),
      eq(officialAssignments.role, role),
    )).limit(2);
    if (assignments.length !== 1 || assignments[0]?.appAccountType !== "official" ||
      assignments[0].startsOn > businessDate || (assignments[0].endsOn !== null && assignments[0].endsOn < businessDate)) {
      throw new Error("The canonical R2 fixture has missing or inactive official assignments; refusing to change existing staging data.");
    }
  }
  const peopleRows = await database.select({
    id: people.id,
    fullName: people.fullName,
    phone: people.phone,
    isActive: people.isActive,
    householdId: people.householdId,
  })
    .from(people).where(eq(people.rtUnitId, unit.id));
  const expectedPeople = [
    { id: resident.personId, fullName: fixture.residentName, householdId: household.id },
    { id: chairman.personId, fullName: fixture.chairmanName, householdId: null },
    { id: treasurer.personId, fullName: fixture.treasurerName, householdId: null },
  ];
  if (peopleRows.length !== expectedPeople.length || expectedPeople.some((expected) => {
    const actual = peopleRows.find(({ id }) => id === expected.id);
    return !actual || !actual.isActive || actual.fullName !== expected.fullName ||
      actual.phone !== null || actual.householdId !== expected.householdId;
  })) {
    throw new Error("The canonical R2 fixture people do not match the expected synthetic profiles; refusing to change existing staging data.");
  }
  const expectedAuthUsers = [
    { id: resident.authUserId, name: fixture.residentName, emailVerified: false, residentEmail: true },
    { id: chairman.authUserId, name: fixture.chairmanDisplayName, email: fixture.chairmanEmail, emailVerified: true },
    { id: treasurer.authUserId, name: fixture.treasurerDisplayName, email: fixture.treasurerEmail, emailVerified: true },
    { id: systemAdmin.authUserId, name: fixture.systemAdminDisplayName, email: fixture.systemAdminEmail, emailVerified: true },
  ] as const;
  for (const expected of expectedAuthUsers) {
    const [actual] = await database.select({
      name: authUser.name,
      email: authUser.email,
      emailVerified: authUser.emailVerified,
      image: authUser.image,
      twoFactorEnabled: authUser.twoFactorEnabled,
    }).from(authUser).where(eq(authUser.id, expected.id)).limit(2);
    const validResidentEmail = "residentEmail" in expected &&
      /^resident-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}@accounts\.karturt\.invalid$/i.test(actual?.email ?? "");
    if (!actual || actual.name !== expected.name ||
      ("email" in expected && actual.email !== expected.email) ||
      ("residentEmail" in expected && !validResidentEmail) ||
      actual.emailVerified !== expected.emailVerified || actual.image !== null || actual.twoFactorEnabled) {
      throw new Error("The canonical R2 fixture authentication profiles do not match the expected synthetic identities; refusing to change existing staging data.");
    }
  }
  const expectedCredentials = [
    [resident, credentials.residentPin],
    [chairman, credentials.chairmanPassword],
    [treasurer, credentials.treasurerPassword],
    [systemAdmin, credentials.systemAdminPassword],
  ] as const;
  for (const [account, expectedPassword] of expectedCredentials) {
    const credentialRows = await database.select({ password: authAccount.password }).from(authAccount).where(and(
      eq(authAccount.userId, account.authUserId), eq(authAccount.providerId, "credential"), isNotNull(authAccount.password),
    )).limit(2);
    const passwordHash = credentialRows[0]?.password;
    if (credentialRows.length !== 1 || !passwordHash) {
      throw new Error("The canonical R2 fixture is incomplete; refusing to change existing staging data.");
    }
    let matches = false;
    try {
      matches = await verifyPassword({ hash: passwordHash, password: expectedPassword });
    } catch {
      matches = false;
    }
    if (!matches) throw new Error("R2 fixture credentials do not match the existing synthetic fixture.");
  }
  return true;
}

export async function bootstrapR2SyntheticFixture(
  database: FixtureDb,
  credentials: R2StagingFixtureCredentials,
  businessDate = jakartaBusinessDate(),
): Promise<R2StagingFixtureResult> {
  const parsedDate = Date.parse(`${businessDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== businessDate) {
    throw new Error("R2 fixture business date must be a valid YYYY-MM-DD date.");
  }
  validateCredentials(credentials);
  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as FixtureDb;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('karturt:r2:canonical-synthetic-fixture:v1', 0))`);
    if (await verifyFixture(tx, businessDate, credentials)) {
      return { status: "already_present", counts: { rtUnits: 1, residents: 1, treasurers: 1, chairmen: 1, systemAdmins: 1, billingYears: 1, feeRates: 1, monthlyDues: 12 } };
    }

    const { id: rtUnitId } = await bootstrapRtUnit(tx, fixture.rt);
    const year = Number(businessDate.slice(0, 4)) + 1;
    if (year < 2000 || year > 2200) throw new Error("R2 fixture billing year is outside the supported range.");
    const [billingYear] = await tx.insert(billingYears).values({ rtUnitId, year, status: "draft" }).returning({ id: billingYears.id });
    if (!billingYear) throw new Error("R2 fixture billing year could not be created.");
    const startsOn = `${year}-01-01`;
    const chairmanRecords = await createOfficial(tx, {
      rtUnitId,
      personName: fixture.chairmanName,
      loginIdentifier: fixture.chairmanLogin,
      email: fixture.chairmanEmail,
      displayName: fixture.chairmanDisplayName,
      password: credentials.chairmanPassword,
      role: "rt_chairman",
      startsOn: businessDate,
    });
    await createOfficial(tx, {
      rtUnitId,
      personName: fixture.treasurerName,
      loginIdentifier: fixture.treasurerLogin,
      email: fixture.treasurerEmail,
      displayName: fixture.treasurerDisplayName,
      password: credentials.treasurerPassword,
      role: "treasurer",
      startsOn: businessDate,
    });
    await createOfficial(tx, {
      rtUnitId: null,
      personName: null,
      loginIdentifier: fixture.systemAdminLogin,
      email: fixture.systemAdminEmail,
      displayName: fixture.systemAdminDisplayName,
      password: credentials.systemAdminPassword,
    });

    const chairman: Principal = {
      authUserId: chairmanRecords.authUserId,
      appAccountId: chairmanRecords.appAccountId,
      role: "rt_chairman",
      rtUnitId,
      householdId: null,
      personId: chairmanRecords.personId,
    };
    await createChairmanFeeRate(tx, chairman, {
      billingYearId: billingYear.id,
      effectiveMonth: 1,
      monthlyAmount: fixture.monthlyAmount,
      idempotencyKey: randomUUID(),
    }, businessDate);
    await activateBillingYear(tx, chairman, { billingYearId: billingYear.id });
    await createHouseholdResident(tx, chairman, {
      newHouse: { number: fixture.houseNumber, label: fixture.houseLabel },
      startsOn,
      fullName: fixture.residentName,
      initialPin: credentials.residentPin,
    }, businessDate);

    if (!(await verifyFixture(tx, businessDate, credentials))) throw new Error("R2 synthetic fixture verification did not pass after seeding.");
    return { status: "created", counts: { rtUnits: 1, residents: 1, treasurers: 1, chairmen: 1, systemAdmins: 1, billingYears: 1, feeRates: 1, monthlyDues: 12 } };
  });
}
