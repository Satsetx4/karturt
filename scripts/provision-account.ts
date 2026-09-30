import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { closeDb, getDb } from "@/db/client";
import { appAccounts, authAccount, authUser, officialAssignments, people } from "@/db/schema";
import { resolveResidentProvisioningTarget } from "@/lib/accounts/resident-provisioning";
import { isValidAccountPassword } from "@/lib/auth/account-password";
import { requireDatabaseEnvironment } from "@/lib/env";

const inputSchema = z.object({
  type: z.enum(["resident", "official", "system_admin"]),
  identifier: z.string().trim().min(1).max(100).optional(),
  displayName: z.string().trim().min(1).max(160),
  password: z.string().min(6).max(128),
  rtUnitId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  householdId: z.string().uuid().optional(),
  officialRole: z.enum(["treasurer", "rt_chairman"]).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function envValue(name: string) {
  return process.env[name];
}

function todayInJakarta() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

async function main() {
  loadEnvConfig(process.cwd());
  requireDatabaseEnvironment();
  const parsed = inputSchema.safeParse({
    type: envValue("KARTURT_ACCOUNT_TYPE"),
    identifier: envValue("KARTURT_LOGIN_IDENTIFIER")?.trim() || undefined,
    displayName: envValue("KARTURT_DISPLAY_NAME"),
    password: envValue("KARTURT_ACCOUNT_PASSWORD"),
    rtUnitId: envValue("KARTURT_RT_UNIT_ID") || undefined,
    personId: envValue("KARTURT_PERSON_ID") || undefined,
    householdId: envValue("KARTURT_HOUSEHOLD_ID") || undefined,
    officialRole: envValue("KARTURT_OFFICIAL_ROLE") || undefined,
    startsOn: envValue("KARTURT_ASSIGNMENT_STARTS_ON") || undefined,
  });
  if (!parsed.success) {
    throw new Error("Account variables are incomplete or invalid. Read the account provisioning section in README.md.");
  }
  const input = parsed.data;
  if (!isValidAccountPassword(input.type, input.password)) {
    throw new Error("Resident PIN must be exactly six digits.");
  }
  if (input.type !== "system_admin" && (!input.rtUnitId || !input.personId)) {
    throw new Error("Resident and official accounts require an RT unit and a person record.");
  }
  if (input.type === "resident" && (!input.householdId || input.identifier)) {
    throw new Error("Resident accounts require an active household and derive the login identifier from its house number.");
  }
  if (input.type !== "resident" && !input.identifier) throw new Error("Official and System Admin accounts require a login identifier.");
  if (input.type === "official" && !input.officialRole) {
    throw new Error("Official accounts require an active official role.");
  }
  if (input.type !== "official" && input.officialRole) {
    throw new Error("Only official accounts can be assigned an official role.");
  }

  const db = getDb();
  const target = input.type === "resident"
    ? await resolveResidentProvisioningTarget(db, {
      rtUnitId: input.rtUnitId!,
      householdId: input.householdId!,
      personId: input.personId!,
    })
    : null;
  if (input.type === "official") {
    const [person] = await db.select({ id: people.id }).from(people).where(and(
      eq(people.id, input.personId!),
      eq(people.rtUnitId, input.rtUnitId!),
      eq(people.isActive, true),
    )).limit(1);
    if (!person) throw new Error("Official provisioning requires an active person in the selected RT.");
  }
  const loginIdentifier = target?.loginIdentifier ?? input.identifier!.toLowerCase();
  const [existing] = await db
    .select({ id: appAccounts.id })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.accountType, input.type),
      sql`lower(${appAccounts.loginIdentifier}) = ${loginIdentifier.toLowerCase()}`,
      input.rtUnitId ? eq(appAccounts.rtUnitId, input.rtUnitId) : sql`${appAccounts.rtUnitId} is null`,
    ))
    .limit(1);
  if (existing) throw new Error("An account already uses that login identifier in this RT.");

  const userId = randomUUID();
  const email = `${randomUUID()}@accounts.karturt.invalid`;
  const passwordHash = await hashPassword(input.password);
  const appAccountId = await db.transaction(async (transaction) => {
    await transaction.insert(authUser).values({
      id: userId,
      name: input.displayName,
      email,
      emailVerified: true,
    });
    await transaction.insert(authAccount).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
    });
    const [account] = await transaction.insert(appAccounts).values({
      authUserId: userId,
      accountType: input.type,
      status: "active",
      loginIdentifier,
      rtUnitId: input.type === "system_admin" ? null : input.rtUnitId!,
      personId: input.type === "system_admin" ? null : input.personId!,
      householdId: input.type === "resident" ? input.householdId! : null,
    }).returning({ id: appAccounts.id });

    if (input.type === "official") {
      await transaction.insert(officialAssignments).values({
        rtUnitId: input.rtUnitId!,
        appAccountId: account.id,
        appAccountType: "official",
        role: input.officialRole!,
        startsOn: input.startsOn ?? todayInJakarta(),
      });
    }
    return account.id;
  });

  console.info(JSON.stringify({ event: "account.provisioned", accountType: input.type, appAccountId }));
}

main()
  .catch((error: unknown) => {
    console.error("Account provisioning failed.", error instanceof Error ? error.message : "Unexpected failure.");
    process.exitCode = 1;
  })
  .finally(closeDb);
