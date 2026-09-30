import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/db/client";
import { appAccounts, authTwoFactor, authUser, households, officialAssignments, people } from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { officialAssignmentActiveOn, jakartaBusinessDate } from "@/lib/officials/lifecycle";

export class UnauthenticatedError extends Error {}
export class MfaEnrollmentRequiredError extends Error {}

export async function resolvePrincipalForUser(
  database: AppDatabase,
  authUserId: string,
  businessDate = jakartaBusinessDate(),
): Promise<Principal> {
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
  if (account.accountType === "system_admin") {
    const [factor] = await database
      .select({ verified: authTwoFactor.verified })
      .from(authTwoFactor)
      .where(eq(authTwoFactor.userId, authUserId))
      .limit(1);
    if (!account.twoFactorEnabled || !factor?.verified) {
      throw new MfaEnrollmentRequiredError("System Admin access requires a verified TOTP factor.");
    }
  }

  if (account.accountType === "resident") {
    if (!account.rtUnitId || !account.householdId || !account.personId) {
      throw new UnauthenticatedError("This resident account has no valid household membership.");
    }
    const [membership] = await database
      .select({ householdStatus: households.status, personIsActive: people.isActive })
      .from(households)
      .innerJoin(people, and(
        eq(people.rtUnitId, households.rtUnitId),
        eq(people.householdId, households.id),
        eq(people.id, account.personId),
      ))
      .where(and(eq(households.rtUnitId, account.rtUnitId), eq(households.id, account.householdId)))
      .limit(1);
    if (!membership || membership.householdStatus !== "active" || !membership.personIsActive) {
      throw new UnauthenticatedError("This resident account no longer has an active household membership.");
    }
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

  const assignments = await database
    .select({ role: officialAssignments.role })
    .from(officialAssignments)
    .where(
      and(
        eq(officialAssignments.appAccountId, account.id),
        eq(officialAssignments.rtUnitId, account.rtUnitId!),
        officialAssignmentActiveOn(businessDate),
      ),
    )
    .limit(2);
  if (assignments.length !== 1) throw new UnauthenticatedError("There is no unique active official assignment for this account.");
  const [assignment] = assignments;

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
