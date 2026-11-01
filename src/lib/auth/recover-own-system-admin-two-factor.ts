import { randomInt, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import type { AppDatabase } from "@/db/client";
import { appAccounts, authAccount, authSession, authTwoFactor, authUser, authVerification } from "@/db/schema";
import { appendAuditEvent, normalizeAuditReason } from "@/lib/audit/writer";
import { isValidAccountPassword } from "@/lib/auth/account-password";
import { ACCOUNT_LOGIN_LOCKOUT_MILLISECONDS, ACCOUNT_LOGIN_MAX_FAILURES } from "@/lib/auth/login-lockout";
import { OWNER_RECOVERY_PENDING_EXPIRY, ownerRecoveryPendingIdentifier } from "@/lib/auth/owner-recovery-state";

export interface RecoverOwnSystemAdminTwoFactorInput {
  identifier: string;
  password: string;
  reason: string;
}

export type RecoverOwnSystemAdminTwoFactorResult =
  | { kind: "ready"; authUserId: string; recoveryReference: string; sessionsRevoked: number }
  | { kind: "invalid" }
  | { kind: "unavailable" }
  | { kind: "locked"; retryAfterSeconds: number };

function createRecoveryReference(now = new Date()) {
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
  }).format(now);
  return `OWN-${year}-${randomInt(0, 100_000_000).toString().padStart(8, "0")}`;
}

export async function recoverOwnSystemAdminTwoFactor(
  database: AppDatabase,
  input: RecoverOwnSystemAdminTwoFactorInput,
): Promise<RecoverOwnSystemAdminTwoFactorResult> {
  const identifier = input.identifier.trim().toLowerCase();
  const reason = normalizeAuditReason(input.reason);
  if (!identifier || identifier.length > 100 || !isValidAccountPassword("system_admin", input.password)) {
    return { kind: "invalid" };
  }

  return database.transaction(async (transaction) => {
    const accounts = await transaction.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      loginIdentifier: appAccounts.loginIdentifier,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(and(
      eq(appAccounts.accountType, "system_admin"),
      eq(appAccounts.status, "active"),
    )).limit(2).for("update");

    // Recovery is only available for the single active System Admin documented
    // for this production database. If that changes, require the normal
    // two-person recovery process instead of choosing an account implicitly.
    if (accounts.length !== 1 || !accounts[0]) return { kind: "unavailable" };
    const target = accounts[0];
    const now = new Date();
    if (target.lockedUntil && target.lockedUntil > now) {
      return {
        kind: "locked",
        retryAfterSeconds: Math.max(1, Math.ceil((target.lockedUntil.getTime() - now.getTime()) / 1000)),
      };
    }

    const [user] = await transaction.select({
      twoFactorEnabled: authUser.twoFactorEnabled,
    }).from(authUser).where(eq(authUser.id, target.authUserId)).limit(1).for("update");
    const credentials = await transaction.select({ password: authAccount.password })
      .from(authAccount).where(and(
        eq(authAccount.userId, target.authUserId),
        eq(authAccount.providerId, "credential"),
        eq(authAccount.accountId, target.authUserId),
      )).limit(2).for("update");
    const [factor] = await transaction.select({
      id: authTwoFactor.id,
      verified: authTwoFactor.verified,
    }).from(authTwoFactor).where(eq(authTwoFactor.userId, target.authUserId)).limit(1).for("update");

    if (!user || credentials.length !== 1 || !credentials[0]?.password) return { kind: "unavailable" };

    let passwordMatches = false;
    try {
      passwordMatches = await verifyPassword({ hash: credentials[0].password, password: input.password });
    } catch {
      passwordMatches = false;
    }
    if (!passwordMatches || target.loginIdentifier.toLowerCase() !== identifier) {
      const nextLockUntil = new Date(now.getTime() + ACCOUNT_LOGIN_LOCKOUT_MILLISECONDS);
      await transaction.update(appAccounts).set({
        failedLoginAttempts: sql`case
          when ${appAccounts.lockedUntil} is not null and ${appAccounts.lockedUntil} <= ${now} then 1
          else least(${appAccounts.failedLoginAttempts} + 1, ${ACCOUNT_LOGIN_MAX_FAILURES})
        end`,
        lockedUntil: sql`case
          when ${appAccounts.lockedUntil} is not null and ${appAccounts.lockedUntil} <= ${now} then null
          when ${appAccounts.failedLoginAttempts} + 1 >= ${ACCOUNT_LOGIN_MAX_FAILURES} then ${nextLockUntil}
          else ${appAccounts.lockedUntil}
        end`,
      }).where(eq(appAccounts.id, target.id));
      return { kind: "invalid" };
    }

    const pendingIdentifier = ownerRecoveryPendingIdentifier(target.authUserId);
    const [pendingRecovery] = await transaction.select({ value: authVerification.value })
      .from(authVerification).where(eq(authVerification.identifier, pendingIdentifier)).limit(1).for("update");
    if (!user.twoFactorEnabled) return { kind: "unavailable" };

    // A retry after the factor was removed can only recreate the temporary
    // setup session while the pending recovery marker exists.
    if (pendingRecovery && !factor?.verified) {
      await transaction.update(appAccounts).set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(appAccounts.id, target.id));
      return {
        kind: "ready",
        authUserId: target.authUserId,
        recoveryReference: pendingRecovery.value,
        sessionsRevoked: 0,
      };
    }
    if (!factor?.verified) return { kind: "unavailable" };

    const recoveryReference = createRecoveryReference(now);
    await transaction.delete(authTwoFactor).where(eq(authTwoFactor.userId, target.authUserId));
    await transaction.delete(authVerification).where(eq(authVerification.identifier, pendingIdentifier));
    await transaction.insert(authVerification).values({
      id: randomUUID(),
      identifier: pendingIdentifier,
      value: recoveryReference,
      expiresAt: OWNER_RECOVERY_PENDING_EXPIRY,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.update(appAccounts).set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(appAccounts.id, target.id));
    const revokedSessions = await transaction.delete(authSession)
      .where(eq(authSession.userId, target.authUserId))
      .returning({ id: authSession.id });

    await appendAuditEvent(transaction, {
      actorAppAccountId: target.id,
      action: "system_admin.two_factor.owner_recovery",
      entityType: "system_admin_account",
      entityId: target.id,
      reason,
      context: { recoveryReference, revokedSessionCount: revokedSessions.length },
    });

    return {
      kind: "ready",
      authUserId: target.authUserId,
      recoveryReference,
      sessionsRevoked: revokedSessions.length,
    };
  });
}
