import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appendAuditEvent } from "@/lib/audit/writer";
import { authAccount, authSession, appAccounts } from "@/db/schema";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
import { isValidAccountPassword } from "@/lib/auth/account-password";

export interface ResetResidentPinInput {
  residentAccountId: string;
  pin: string;
  reason: string;
  recoveryReference?: string;
}

export async function resetResidentPin(
  database: AppDatabase,
  principal: Principal,
  input: ResetResidentPinInput,
) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw new Error("A reason of 1 to 500 characters is required for credential reset.");
  if (!isValidAccountPassword("resident", input.pin)) throw new Error("Resident PIN must be exactly six digits.");

  let rtUnitId: string | null = null;
  let action: string;
  if (principal.role === "rt_chairman") {
    rtUnitId = principal.rtUnitId;
    if (!rtUnitId) throw new Error("Forbidden: Chairman reset requires an RT principal.");
    assertCanPerform(principal, "resident:reset_credential", { rtUnitId });
    action = "resident.pin.reset";
  } else if (principal.role === "system_admin") {
    assertCanPerform(principal, "system:recover");
    if (!input.recoveryReference?.trim() || input.recoveryReference.trim().length > 100) {
      throw new Error("System Admin recovery reference must contain 1 to 100 characters.");
    }
    action = "resident.pin.structured_recovery";
  } else {
    throw new Error("Forbidden: only the RT Chairman or System Admin recovery role may reset a resident PIN.");
  }

  const passwordHash = await hashPassword(input.pin);
  return database.transaction(async (transaction) => {
    const targetConditions = [
      eq(appAccounts.id, input.residentAccountId),
      eq(appAccounts.accountType, "resident"),
      eq(appAccounts.status, "active"),
    ];
    if (rtUnitId) targetConditions.push(eq(appAccounts.rtUnitId, rtUnitId));
    const [target] = await transaction
      .select({ id: appAccounts.id, authUserId: appAccounts.authUserId })
      .from(appAccounts)
      .where(and(...targetConditions))
      .limit(1)
      .for("update");
    if (!target) throw new Error("Resident account was not found in the authorized scope.");

    const [credential] = await transaction
      .update(authAccount)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(and(eq(authAccount.userId, target.authUserId), eq(authAccount.providerId, "credential")))
      .returning({ id: authAccount.id });
    if (!credential) throw new Error("Resident credential was not found.");

    await transaction
      .update(appAccounts)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(appAccounts.id, target.id));
    const revokedSessions = await transaction
      .delete(authSession)
      .where(eq(authSession.userId, target.authUserId))
      .returning({ id: authSession.id });

    await appendAuditEvent(transaction, {
      actorAppAccountId: principal.appAccountId,
      action,
      entityType: "resident_account",
      entityId: target.id,
      reason,
      context: {
        recoveryReference: principal.role === "system_admin" ? input.recoveryReference!.trim() : null,
        revokedSessionCount: revokedSessions.length,
      },
    });

    return { residentAccountId: target.id, sessionsRevoked: revokedSessions.length };
  });
}
