import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, count, eq, getTableName, sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  authAccount,
  authUser,
  households,
  houses,
  officialAssignments,
  people,
  rtSettings,
  rtUnits,
  schema,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import {
  validateSyntheticAccountRoster,
  type WorkbookAccountRole,
  type WorkbookAccountRosterEntry,
} from "./workbook-account-roster";

const INVALID_FIXTURE_MESSAGE = "Workbook account fixture is invalid or the disposable database is not isolated.";
const FIXTURE_LOCK_KEY = "karturt:workbook:five-account-synthetic-fixture:v1";

type FixtureStatus = "created" | "already_present";

export interface WorkbookAccountFixturePrincipals {
  systemAdmin: Principal;
  chairman: Principal;
  treasurer: Principal;
  residents: Principal[];
}

export interface WorkbookAccountFixtureResult {
  status: FixtureStatus;
  counts: {
    accounts: 5;
    systemAdmins: 1;
    chairmen: 1;
    treasurers: 1;
    residents: 2;
    activeAccounts: 5;
  };
  rtUnitId: string;
  principals: WorkbookAccountFixturePrincipals;
}

type FixtureDatabase = AppDatabase;

const expectedCounts = Object.fromEntries(
  (Object.values(schema) as AnyPgTable[]).map((table) => [getTableName(table), 0]),
);
Object.assign(expectedCounts, {
  rt_units: 1,
  rt_settings: 1,
  houses: 2,
  households: 2,
  people: 4,
  user: 5,
  account: 5,
  app_accounts: 5,
  official_assignments: 2,
});

function accountTypeForRole(role: WorkbookAccountRole) {
  return role === "resident" ? "resident" as const : role === "system_admin" ? "system_admin" as const : "official" as const;
}

function expectedOfficialRole(role: WorkbookAccountRole) {
  return role === "rt_chairman" || role === "treasurer" ? role : null;
}

async function readTableCounts(database: FixtureDatabase) {
  const tables = Object.values(schema) as AnyPgTable[];
  const rows = await Promise.all(tables.map(async (table) => {
    const [row] = await database.select({ value: count() }).from(table);
    return [getTableName(table), row?.value ?? 0] as const;
  }));
  return Object.fromEntries(rows);
}

function hasExactCounts(actual: Record<string, number>, expected: Record<string, number>) {
  return Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([tableName, expectedCount]) => actual[tableName] === expectedCount);
}

function roleForAccount(entry: WorkbookAccountRosterEntry, accountType: string) {
  if (accountType !== accountTypeForRole(entry.role)) return false;
  if (entry.role === "rt_chairman" || entry.role === "treasurer") return accountType === "official";
  return true;
}

async function verifyRosterRows(database: FixtureDatabase, roster: WorkbookAccountRosterEntry[]) {
  const accounts = await database.select({
    id: appAccounts.id,
    authUserId: appAccounts.authUserId,
    accountType: appAccounts.accountType,
    status: appAccounts.status,
    loginIdentifier: appAccounts.loginIdentifier,
    rtUnitId: appAccounts.rtUnitId,
    householdId: appAccounts.householdId,
    personId: appAccounts.personId,
    pinHash: appAccounts.pinHash,
  }).from(appAccounts);
  const users = await database.select({ id: authUser.id, name: authUser.name }).from(authUser);
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const pinHashes = new Set<string>();

  for (const entry of roster) {
    const matches = accounts.filter((account) => account.loginIdentifier === entry.identifier);
    const account = matches[0];
    if (
      matches.length !== 1 ||
      !account ||
      !roleForAccount(entry, account.accountType) ||
      account.status !== "active" ||
      !account.pinHash ||
      userNames.get(account.authUserId) !== entry.name
    ) return false;

    const credentialRows = await database.select({ id: authAccount.id, password: authAccount.password })
      .from(authAccount)
      .where(and(eq(authAccount.userId, account.authUserId), eq(authAccount.providerId, "credential")))
      .limit(2);
    const credential = credentialRows[0];
    if (credentialRows.length !== 1 || !credential?.password) return false;
    if (!await verifyPassword({ hash: account.pinHash, password: entry.pin })) return false;
    if (pinHashes.has(account.pinHash)) return false;
    pinHashes.add(account.pinHash);

    if (entry.role === "resident") {
      if (
        !account.rtUnitId || !account.householdId || !account.personId ||
        credentialRows[0].password !== account.pinHash
      ) return false;
      const householdRows = await database.select({
        houseNumber: houses.number,
        householdStatus: households.status,
        endsOn: households.endsOn,
        personName: people.fullName,
        personIsActive: people.isActive,
      }).from(households)
        .innerJoin(houses, and(
          eq(houses.id, households.houseId),
          eq(houses.rtUnitId, households.rtUnitId),
        ))
        .innerJoin(people, and(
          eq(people.rtUnitId, households.rtUnitId),
          eq(people.householdId, households.id),
          eq(people.id, account.personId),
        ))
        .where(and(
          eq(households.id, account.householdId),
          eq(households.rtUnitId, account.rtUnitId),
        ))
        .limit(2);
      if (
        householdRows.length !== 1 ||
        householdRows[0]?.houseNumber !== entry.identifier ||
        householdRows[0]?.householdStatus !== "active" ||
        householdRows[0]?.endsOn !== null ||
        householdRows[0]?.personName !== entry.name ||
        householdRows[0]?.personIsActive !== true
      ) return false;
      continue;
    }

    if (entry.role === "system_admin") {
      if (account.rtUnitId !== null || account.householdId !== null || account.personId !== null) return false;
      if (await verifyPassword({ hash: credential.password, password: entry.pin })) return false;
      continue;
    }

    if (!account.rtUnitId || !account.personId || account.householdId !== null) return false;
    const [person] = await database.select({ name: people.fullName, active: people.isActive })
      .from(people)
      .where(and(eq(people.id, account.personId), eq(people.rtUnitId, account.rtUnitId)))
      .limit(1);
    const assignments = await database.select({ role: officialAssignments.role })
      .from(officialAssignments)
      .where(and(
        eq(officialAssignments.appAccountId, account.id),
        eq(officialAssignments.rtUnitId, account.rtUnitId),
      ))
      .limit(2);
    if (
      person?.name !== entry.name || person.active !== true ||
      assignments.length !== 1 || assignments[0]?.role !== expectedOfficialRole(entry.role) ||
      await verifyPassword({ hash: credential.password, password: entry.pin })
    ) return false;
  }
  return true;
}

async function loadPrincipals(database: FixtureDatabase, roster: WorkbookAccountRosterEntry[]) {
  const accounts = await database.select({
    id: appAccounts.id,
    authUserId: appAccounts.authUserId,
    accountType: appAccounts.accountType,
    loginIdentifier: appAccounts.loginIdentifier,
    rtUnitId: appAccounts.rtUnitId,
    householdId: appAccounts.householdId,
    personId: appAccounts.personId,
  }).from(appAccounts);

  let systemAdmin: Principal | null = null;
  let chairman: Principal | null = null;
  let treasurer: Principal | null = null;
  const residents: Principal[] = [];
  for (const entry of roster) {
    const account = accounts.find((candidate) => candidate.loginIdentifier === entry.identifier);
    if (!account || !roleForAccount(entry, account.accountType)) throw new Error(INVALID_FIXTURE_MESSAGE);
    if (entry.role === "system_admin") {
      if (account.rtUnitId !== null || account.householdId !== null || account.personId !== null || systemAdmin) {
        throw new Error(INVALID_FIXTURE_MESSAGE);
      }
      systemAdmin = {
        authUserId: account.authUserId,
        appAccountId: account.id,
        role: "system_admin",
        rtUnitId: null,
        householdId: null,
        personId: null,
      };
      continue;
    }
    if (!account.rtUnitId || !account.personId) throw new Error(INVALID_FIXTURE_MESSAGE);
    if (entry.role === "resident") {
      if (!account.householdId) throw new Error(INVALID_FIXTURE_MESSAGE);
      residents.push({
        authUserId: account.authUserId,
        appAccountId: account.id,
        role: "resident",
        rtUnitId: account.rtUnitId,
        householdId: account.householdId,
        personId: account.personId,
      });
      continue;
    }
    if (account.householdId !== null) throw new Error(INVALID_FIXTURE_MESSAGE);
    const principal: Principal = {
      authUserId: account.authUserId,
      appAccountId: account.id,
      role: entry.role,
      rtUnitId: account.rtUnitId,
      householdId: null,
      personId: account.personId,
    };
    if (entry.role === "rt_chairman") {
      if (chairman) throw new Error(INVALID_FIXTURE_MESSAGE);
      chairman = principal;
    } else {
      if (treasurer) throw new Error(INVALID_FIXTURE_MESSAGE);
      treasurer = principal;
    }
  }
  if (!chairman || !treasurer || !systemAdmin || residents.length !== 2) throw new Error(INVALID_FIXTURE_MESSAGE);
  return { chairman, treasurer, systemAdmin, residents };
}

async function seedRoster(
  database: FixtureDatabase,
  roster: WorkbookAccountRosterEntry[],
  onStage: (stage: string) => void,
) {
  onStage("seed-rt");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  const [unit] = await database.insert(rtUnits).values({
    code: `WB-${suffix}`,
    rwCode: `WB-RW-${suffix}`,
    name: `Workbook Synthetic Fixture ${suffix}`,
    village: "Synthetic Test Fixture",
  }).returning({ id: rtUnits.id });
  if (!unit) throw new Error(INVALID_FIXTURE_MESSAGE);
  onStage("seed-settings");
  await database.insert(rtSettings).values({ rtUnitId: unit.id });

  for (const entry of roster) {
    onStage("seed-identity-records");
    const isResident = entry.role === "resident";
    const officialRole = expectedOfficialRole(entry.role);
    onStage("seed-resident-records");
    const residentRecords = isResident ? await (async () => {
      onStage("seed-resident-house");
      const [house] = await database.insert(houses).values({
        rtUnitId: unit.id,
        number: entry.identifier,
      }).returning({ id: houses.id });
      if (!house) throw new Error(INVALID_FIXTURE_MESSAGE);
      onStage("seed-resident-household");
      const [household] = await database.insert(households).values({
        rtUnitId: unit.id,
        houseId: house.id,
        startsOn: "2000-01-01",
      }).returning({ id: households.id });
      if (!household) throw new Error(INVALID_FIXTURE_MESSAGE);
      onStage("seed-resident-person");
      const [person] = await database.insert(people).values({
        rtUnitId: unit.id,
        householdId: household.id,
        fullName: entry.name,
      }).returning({ id: people.id });
      if (!person) throw new Error(INVALID_FIXTURE_MESSAGE);
      return { householdId: household.id, personId: person.id };
    })() : null;

    onStage("seed-account-person");
    const personId = residentRecords?.personId ?? (officialRole ? await (async () => {
      onStage("seed-official-person");
      const [person] = await database.insert(people).values({
        rtUnitId: unit.id,
        fullName: entry.name,
      }).returning({ id: people.id });
      if (!person) throw new Error(INVALID_FIXTURE_MESSAGE);
      return person.id;
    })() : null);
    const authUserId = randomUUID();
    const now = new Date();
    const pinHash = await hashPassword(entry.pin);
    const authPasswordHash = isResident
      ? pinHash
      : await hashPassword(randomBytes(32).toString("base64url"));
    onStage("seed-auth-user");
    await database.insert(authUser).values({
      id: authUserId,
      name: entry.name,
      email: `workbook-${randomUUID()}@accounts.karturt.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    onStage("seed-auth-credential");
    await database.insert(authAccount).values({
      id: randomUUID(),
      accountId: authUserId,
      providerId: "credential",
      userId: authUserId,
      password: authPasswordHash,
      createdAt: now,
      updatedAt: now,
    });
    onStage("seed-app-account");
    const [account] = await database.insert(appAccounts).values({
      rtUnitId: entry.role === "system_admin" ? null : unit.id,
      authUserId,
      accountType: accountTypeForRole(entry.role),
      status: "active",
      loginIdentifier: entry.identifier,
      personId,
      householdId: residentRecords?.householdId ?? null,
      pinHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      pinChangeFailedAttempts: 0,
      pinChangeLockedUntil: null,
    }).returning({ id: appAccounts.id });
    if (!account) throw new Error(INVALID_FIXTURE_MESSAGE);

    if (officialRole) {
      onStage("seed-official-assignment");
      await database.insert(officialAssignments).values({
        rtUnitId: unit.id,
        appAccountId: account.id,
        role: officialRole,
        startsOn: "2000-01-01",
      });
    }
  }
  return unit.id;
}

export async function bootstrapWorkbookSyntheticAccountFixture(
  database: AppDatabase,
  inputRoster: unknown,
): Promise<WorkbookAccountFixtureResult> {
  const roster = validateSyntheticAccountRoster(inputRoster);
  let stage = "start";
  try {
    return await database.transaction(async (transaction) => {
      const target = transaction as unknown as FixtureDatabase;
      stage = "lock";
      await target.execute(sql`select pg_advisory_xact_lock(hashtextextended(${FIXTURE_LOCK_KEY}, 0))`);

      stage = "counts";
      const actualCounts = await readTableCounts(target);
      let status: FixtureStatus;
      let rtUnitId: string;
      if (Object.values(actualCounts).every((value) => value === 0)) {
        rtUnitId = await seedRoster(target, roster, (nextStage) => { stage = nextStage; });
        stage = "verify-created-counts";
        const seededCounts = await readTableCounts(target);
        if (!hasExactCounts(seededCounts, expectedCounts)) {
          throw new Error(INVALID_FIXTURE_MESSAGE);
        }
        stage = "verify-created-rows";
        if (!await verifyRosterRows(target, roster)) throw new Error(INVALID_FIXTURE_MESSAGE);
        status = "created";
      } else {
        stage = "verify-existing-counts";
        if (!hasExactCounts(actualCounts, expectedCounts)) {
          throw new Error(INVALID_FIXTURE_MESSAGE);
        }
        stage = "verify-existing-rows";
        if (!await verifyRosterRows(target, roster)) throw new Error(INVALID_FIXTURE_MESSAGE);
        stage = "load-existing-unit";
        const [unit] = await target.select({ id: rtUnits.id }).from(rtUnits).limit(2);
        if (!unit) throw new Error(INVALID_FIXTURE_MESSAGE);
        rtUnitId = unit.id;
        status = "already_present";
      }

      stage = "load-principals";
      const principals = await loadPrincipals(target, roster);
      return {
        status,
        counts: {
          accounts: 5,
          systemAdmins: 1,
          chairmen: 1,
          treasurers: 1,
          residents: 2,
          activeAccounts: 5,
        },
        rtUnitId,
        principals,
      };
    });
  } catch {
    throw new Error(`${INVALID_FIXTURE_MESSAGE} (${stage}).`);
  }
}
