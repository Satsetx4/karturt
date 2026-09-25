import { headers } from "next/headers";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/db/client";
import { appAccounts, authUser, officialAssignments } from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";

export class UnauthenticatedError extends Error {}
export class MfaEnrollmentRequiredError extends Error {}

function todayInJakarta() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function resolvePrincipalForUser(database: AppDatabase, authUserId: string): Promise<Principal> {
  const [account] = await database
    .select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      accountType: appAccounts.accountType,
      status: appAccounts.status,
      rtUnitId: appAccounts.rtUnitId,
      householdId: appAccounts.householdId,
      personId: appAccounts.personId,
      twoFactorEnabled: authUser.twoFactorEnabled,
    })
    .from(appAccounts)
    .innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
    .where(eq(appAccounts.authUserId, authUserId))
    .limit(1);

  if (!account || account.status !== "active") throw new UnauthenticatedError("This account is not active.");
  if (account.accountType === "system_admin" && !account.twoFactorEnabled) {
    throw new MfaEnrollmentRequiredError("System Admin accounts must enable two-factor authentication first.");
  }

  if (account.accountType === "resident") {
    return {
      authUserId: account.authUserId,
      appAccountId: account.id,
      role: "resident",
      rtUnitId: account.rtUnitId,
      householdId: account.householdId,
      personId: account.personId,
    };
  }

  if (account.accountType === "system_admin") {
    return {
      authUserId: account.authUserId,
      appAccountId: account.id,
      role: "system_admin",
      rtUnitId: null,
      householdId: null,
      personId: null,
    };
  }

  const [assignment] = await database
    .select({ role: officialAssignments.role })
    .from(officialAssignments)
    .where(
      and(
        eq(officialAssignments.appAccountId, account.id),
        eq(officialAssignments.rtUnitId, account.rtUnitId!),
        isNull(officialAssignments.endsOn),
        lte(officialAssignments.startsOn, todayInJakarta()),
      ),
    )
    .limit(1);
  if (!assignment) throw new UnauthenticatedError("There is no active official assignment for this account.");

  return {
    authUserId: account.authUserId,
    appAccountId: account.id,
    role: assignment.role,
    rtUnitId: account.rtUnitId,
    householdId: null,
    personId: account.personId,
  };
}

export async function getCurrentPrincipal(): Promise<Principal> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) throw new UnauthenticatedError("Please sign in first.");
  return resolvePrincipalForUser(getDb(), session.user.id);
}
