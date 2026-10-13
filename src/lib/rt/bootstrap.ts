import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  authAccount,
  authUser,
  billingYears,
  houses,
  households,
  monthlyDues,
  officialAssignments,
  people,
  rtSettings,
  rtUnits,
} from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";
import type { Principal } from "@/lib/auth/permissions";
import { jakartaBusinessDate, officialAssignmentActiveOn } from "@/lib/officials/lifecycle";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InitialChairmanBootstrapConflictError extends Error {}
export class InitialChairmanBootstrapNotFoundError extends Error {}
export class InvalidInitialChairmanBootstrapInputError extends Error {}
export class InitialRtBootstrapConflictError extends Error {}

export async function bootstrapRtUnit(database: AppDatabase, values: typeof rtUnits.$inferInsert) {
  return database.transaction(async (transaction) => {
    const [inserted] = await transaction
      .insert(rtUnits)
      .values(values)
      .onConflictDoNothing({ target: [rtUnits.code, rtUnits.rwCode, rtUnits.village] })
      .returning({ id: rtUnits.id });

    let id = inserted?.id;
    if (!id) {
      const [existing] = await transaction
        .select({ id: rtUnits.id })
        .from(rtUnits)
        .where(and(
          eq(rtUnits.code, values.code),
          eq(rtUnits.rwCode, values.rwCode),
          eq(rtUnits.village, values.village),
        ))
        .limit(1);
      id = existing?.id;
    }
    if (!id) throw new Error("RT unit could not be created or found after the insert.");

    await transaction
      .insert(rtSettings)
      .values({ rtUnitId: id })
      .onConflictDoNothing({ target: rtSettings.rtUnitId });
    return { id, created: Boolean(inserted) };
  });
}

export async function bootstrapFirstOperationalRt(database: AppDatabase, values: typeof rtUnits.$inferInsert) {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended('karturt:first_operational_rt', 0))`);
    const units = await transaction.select({
      id: rtUnits.id,
      code: rtUnits.code,
      rwCode: rtUnits.rwCode,
      name: rtUnits.name,
      village: rtUnits.village,
      district: rtUnits.district,
      city: rtUnits.city,
      province: rtUnits.province,
    }).from(rtUnits).limit(2);
    if (units.length > 1) {
      throw new InitialRtBootstrapConflictError("Initial setup is restricted to the first operational RT; multiple RTs already exist.");
    }
    const existing = units[0];
    if (existing) {
      if (
        existing.code !== values.code || existing.rwCode !== values.rwCode ||
        existing.name !== values.name || existing.village !== values.village ||
        existing.district !== (values.district ?? null) || existing.city !== (values.city ?? null) ||
        existing.province !== (values.province ?? null)
      ) {
        throw new InitialRtBootstrapConflictError("Initial setup is restricted to the first operational RT; another RT identity already exists.");
      }
      await transaction.insert(rtSettings)
        .values({ rtUnitId: existing.id })
        .onConflictDoNothing({ target: rtSettings.rtUnitId });
      return { id: existing.id, created: false };
    }

    const [created] = await transaction.insert(rtUnits).values(values).returning({ id: rtUnits.id });
    if (!created) throw new InitialRtBootstrapConflictError("The first operational RT could not be created.");
    await transaction.insert(rtSettings).values({ rtUnitId: created.id });
    return { id: created.id, created: true };
  });
}

export interface BootstrapInitialChairmanInput {
  rtUnitId: string;
  loginIdentifier: string;
  displayName: string;
  passwordHash: string;
  startsOn?: string;
}

export interface BootstrapInitialChairmanResult {
  rtUnitId: string;
  authUserId: string;
  appAccountId: string;
  personId: string;
  assignmentId: string;
  created: boolean;
  principal: Principal;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Creates the first same-RT Chairman from the operator-only setup CLI.
 * No web route calls this function. It requires a pristine RT identity graph,
 * creates the Chairman as a standalone person, and commits all auth and role
 * records together so a failed setup can be retried without partial accounts.
 */
export async function bootstrapInitialChairman(
  database: AppDatabase,
  input: BootstrapInitialChairmanInput,
): Promise<BootstrapInitialChairmanResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidInitialChairmanBootstrapInputError("Initial Chairman setup values are incomplete or invalid.");
  }
  const allowedKeys = new Set(["rtUnitId", "loginIdentifier", "displayName", "passwordHash", "startsOn"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new InvalidInitialChairmanBootstrapInputError("Initial Chairman setup values are incomplete or invalid.");
  }
  const rtUnitId = input.rtUnitId?.trim();
  const loginIdentifier = input.loginIdentifier?.trim().toLowerCase();
  const displayName = input.displayName?.trim();
  const passwordHash = input.passwordHash;
  const startsOn = input.startsOn ?? jakartaBusinessDate();
  if (
    !rtUnitId || !UUID_PATTERN.test(rtUnitId) ||
    !loginIdentifier || loginIdentifier.length > 100 || /\s/.test(loginIdentifier) ||
    !displayName || displayName.length > 160 ||
    typeof passwordHash !== "string" || passwordHash.length < 16 || passwordHash.length > 4096 ||
    !validDate(startsOn)
  ) {
    throw new InvalidInitialChairmanBootstrapInputError("Initial Chairman setup values are incomplete or invalid.");
  }

  return database.transaction(async (transaction) => {
    const [rtUnit] = await transaction
      .select({ id: rtUnits.id })
      .from(rtUnits)
      .where(eq(rtUnits.id, rtUnitId))
      .limit(1)
      .for("update");
    if (!rtUnit) throw new InitialChairmanBootstrapNotFoundError("The RT unit must be created before its first Chairman.");

    const settings = await transaction
      .select({ id: rtSettings.id })
      .from(rtSettings)
      .where(eq(rtSettings.rtUnitId, rtUnitId))
      .limit(1);
    if (settings.length !== 1) {
      throw new InitialChairmanBootstrapConflictError("The RT must have exactly one settings row before its first Chairman can be created.");
    }

    const accounts = await transaction
      .select({
        id: appAccounts.id,
        authUserId: appAccounts.authUserId,
        personId: appAccounts.personId,
        accountType: appAccounts.accountType,
        status: appAccounts.status,
        loginIdentifier: appAccounts.loginIdentifier,
        householdId: appAccounts.householdId,
      })
      .from(appAccounts)
      .where(eq(appAccounts.rtUnitId, rtUnitId))
      .limit(2);
    if (accounts.length > 0) {
      const existing = accounts.length === 1 && accounts[0]!.accountType === "official" &&
        accounts[0]!.status === "active" &&
        accounts[0]!.loginIdentifier.toLowerCase() === loginIdentifier
        ? accounts[0]
        : undefined;
      if (existing) {
        const [person] = await transaction
          .select({ id: people.id, householdId: people.householdId, isActive: people.isActive })
          .from(people)
          .where(and(eq(people.id, existing.personId!), eq(people.rtUnitId, rtUnitId)))
          .limit(1);
        const peopleForRt = await transaction
          .select({ id: people.id })
          .from(people)
          .where(eq(people.rtUnitId, rtUnitId))
          .limit(2);
        const [user] = await transaction
          .select({ id: authUser.id })
          .from(authUser)
          .where(eq(authUser.id, existing.authUserId))
          .limit(1);
        const credentials = await transaction
          .select({ id: authAccount.id })
          .from(authAccount)
          .where(and(eq(authAccount.userId, existing.authUserId), eq(authAccount.providerId, "credential")))
          .limit(2);
        const [house] = await transaction.select({ id: houses.id }).from(houses).where(eq(houses.rtUnitId, rtUnitId)).limit(1);
        const [household] = await transaction.select({ id: households.id }).from(households).where(eq(households.rtUnitId, rtUnitId)).limit(1);
        const assignments = await transaction
          .select({ id: officialAssignments.id, role: officialAssignments.role })
          .from(officialAssignments)
          .where(and(
            eq(officialAssignments.rtUnitId, rtUnitId),
            eq(officialAssignments.appAccountId, existing.id),
            officialAssignmentActiveOn(startsOn),
          ))
          .limit(2);
        if (
          peopleForRt.length === 1 && person?.isActive && person.householdId === null &&
          existing.householdId === null && user && credentials.length === 1 && !house && !household &&
          assignments.length === 1 && assignments[0]?.role === "rt_chairman"
        ) {
          const principal: Principal = {
            authUserId: existing.authUserId,
            appAccountId: existing.id,
            role: "rt_chairman",
            rtUnitId,
            householdId: null,
            personId: person.id,
          };
          return {
            rtUnitId,
            authUserId: existing.authUserId,
            appAccountId: existing.id,
            personId: person.id,
            assignmentId: assignments[0]!.id,
            created: false,
            principal,
          };
        }
      }
      throw new InitialChairmanBootstrapConflictError("This RT already has account state; first-Chairman setup cannot replace or add to it.");
    }

    const [existingPerson] = await transaction
      .select({ id: people.id })
      .from(people)
      .where(eq(people.rtUnitId, rtUnitId))
      .limit(1);
    if (existingPerson) {
      throw new InitialChairmanBootstrapConflictError("This RT already has person records; first-Chairman setup requires the initial empty state.");
    }
    const [existingHouse] = await transaction.select({ id: houses.id }).from(houses).where(eq(houses.rtUnitId, rtUnitId)).limit(1);
    const [existingHousehold] = await transaction.select({ id: households.id }).from(households).where(eq(households.rtUnitId, rtUnitId)).limit(1);
    if (existingHouse || existingHousehold) {
      throw new InitialChairmanBootstrapConflictError("This RT already has household records; first-Chairman setup requires the initial empty state.");
    }
    const [existingBillingYear] = await transaction.select({ id: billingYears.id })
      .from(billingYears).where(eq(billingYears.rtUnitId, rtUnitId)).limit(1);
    const [existingDue] = await transaction.select({ id: monthlyDues.id })
      .from(monthlyDues).where(eq(monthlyDues.rtUnitId, rtUnitId)).limit(1);
    if (existingBillingYear || existingDue) {
      throw new InitialChairmanBootstrapConflictError("This RT already has billing records; first-Chairman setup requires the initial empty state.");
    }

    const authUserId = randomUUID();
    const email = `${randomUUID()}@accounts.karturt.invalid`;
    const [createdPerson] = await transaction
      .insert(people)
      .values({ rtUnitId, householdId: null, fullName: displayName, isActive: true })
      .returning({ id: people.id });
    if (!createdPerson) throw new InitialChairmanBootstrapConflictError("The initial Chairman person could not be created.");

    await transaction.insert(authUser).values({
      id: authUserId,
      name: displayName,
      email,
      emailVerified: true,
    });
    await transaction.insert(authAccount).values({
      id: randomUUID(),
      accountId: authUserId,
      providerId: "credential",
      userId: authUserId,
      password: passwordHash,
    });
    const [createdAccount] = await transaction
      .insert(appAccounts)
      .values({
        authUserId,
        accountType: "official",
        status: "active",
        loginIdentifier,
        rtUnitId,
        personId: createdPerson.id,
        householdId: null,
      })
      .returning({ id: appAccounts.id });
    if (!createdAccount) throw new InitialChairmanBootstrapConflictError("The initial Chairman account could not be created.");

    const [assignment] = await transaction
      .insert(officialAssignments)
      .values({
        rtUnitId,
        appAccountId: createdAccount.id,
        appAccountType: "official",
        role: "rt_chairman",
        startsOn,
      })
      .returning({ id: officialAssignments.id });
    if (!assignment) throw new InitialChairmanBootstrapConflictError("The initial Chairman assignment could not be created.");

    await appendAuditEvent(transaction, {
      actorAppAccountId: createdAccount.id,
      action: "rt.initial_chairman_provisioned",
      entityType: "official_assignment",
      entityId: assignment.id,
      reason: null,
      context: { source: "protected_cli_bootstrap" },
    });

    const principal: Principal = {
      authUserId,
      appAccountId: createdAccount.id,
      role: "rt_chairman",
      rtUnitId,
      householdId: null,
      personId: createdPerson.id,
    };
    return {
      rtUnitId,
      authUserId,
      appAccountId: createdAccount.id,
      personId: createdPerson.id,
      assignmentId: assignment.id,
      created: true,
      principal,
    };
  });
}
