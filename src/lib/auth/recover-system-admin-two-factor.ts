import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appendAuditEvent } from "@/lib/audit/writer";
import { appAccounts, authSession, authTwoFactor, authUser } from "@/db/schema";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";

export interface RecoverSystemAdminTwoFactorInput {
  targetAccountId: string;
  reason: string;
  recoveryReference: string;
}

export async function recoverSystemAdminTwoFactor(
  database: AppDatabase,
  principal: Principal,
  input: RecoverSystemAdminTwoFactorInput,
) {
  assertCanPerform(principal, "system:recover");
  if (principal.role !== "system_admin") throw new Error("Forbidden: System Admin recovery requires a System Admin principal.");

  const reason = input.reason.trim();
  const recoveryReference = input.recoveryReference.trim();
  if (!reason || reason.length > 500) throw new Error("A reason of 1 to 500 characters is required for recovery.");
  if (!recoveryReference || recoveryReference.length > 100) {
    throw new Error("A recovery reference of 1 to 100 characters is required.");
  }
  if (input.targetAccountId === principal.appAccountId) {
    throw new Error("Forbidden: another verified System Admin must authorize emergency recovery.");
  }

  return database.transaction(async (transaction) => {
    const [target] = await transaction
      .select({ id: appAccounts.id, authUserId: appAccounts.authUserId })
      .from(appAccounts)
      .where(and(
        eq(appAccounts.id, input.targetAccountId),
        eq(appAccounts.accountType, "system_admin"),
        eq(appAccounts.status, "active"),
      ))
      .limit(1)
      .for("update");
    if (!target) throw new Error("System Admin account was not found.");

    await transaction.delete(authTwoFactor).where(eq(authTwoFactor.userId, target.authUserId));
    await transaction.update(authUser)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(authUser.id, target.authUserId));
    const revokedSessions = await transaction.delete(authSession)
      .where(eq(authSession.userId, target.authUserId))
      .returning({ id: authSession.id });

    await appendAuditEvent(transaction, {
      actorAppAccountId: principal.appAccountId,
      action: "system_admin.two_factor.emergency_recovery",
      entityType: "system_admin_account",
      entityId: target.id,
      reason,
      context: { recoveryReference, revokedSessionCount: revokedSessions.length },
    });

    return { targetAccountId: target.id, sessionsRevoked: revokedSessions.length };
  });
}
