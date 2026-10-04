import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { AppDatabase } from "@/db/client";
import { appAccounts, authAccount, authUser } from "@/db/schema";
import { isValidAccountPassword } from "@/lib/auth/account-password";

export interface CreateResidentAuthRecordsInput {
  rtUnitId: string;
  householdId: string;
  personId: string;
  loginIdentifier: string;
  fullName: string;
  pin: string;
}

export async function createResidentAuthRecords(
  transaction: Pick<AppDatabase, "insert">,
  input: CreateResidentAuthRecordsInput,
) {
  if (!isValidAccountPassword("resident", input.pin)) {
    throw new Error("Resident PIN must be exactly six digits.");
  }

  const fullName = input.fullName.trim();
  const loginIdentifier = input.loginIdentifier.trim().toUpperCase();
  if (!fullName || fullName.length > 160) throw new Error("Resident name must contain 1 to 160 characters.");
  if (!loginIdentifier || loginIdentifier.length > 100) throw new Error("Resident login identifier is invalid.");

  const authUserId = randomUUID();
  const passwordHash = await hashPassword(input.pin);
  const now = new Date();

  await transaction.insert(authUser).values({
    id: authUserId,
    name: fullName,
    email: `resident-${randomUUID()}@accounts.karturt.invalid`,
    createdAt: now,
    updatedAt: now,
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
    accountType: "resident",
    loginIdentifier,
    personId: input.personId,
    householdId: input.householdId,
  }).returning({ id: appAccounts.id });

  if (!account) throw new Error("Resident account could not be created.");
  return { appAccountId: account.id, authUserId };
}
