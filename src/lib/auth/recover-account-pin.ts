import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appendAuditEvent } from "@/lib/audit/writer";
import { appAccounts, authAccount, authSession, officialAssignments } from "@/db/schema";
import { isValidAccountPassword } from "@/lib/auth/account-password";
import { lockOfficialPinAccounts, officialPinIsUsedByAnotherAccount } from "@/lib/auth/official-pin-uniqueness";
import type { Principal } from "@/lib/auth/permissions";
import { officialAssignmentActiveOn, jakartaBusinessDate } from "@/lib/officials/lifecycle";

const MAX_PIN_RECOVERY_FAILURES = 5;
const PIN_RECOVERY_LOCKOUT_MILLISECONDS = 15 * 60 * 1000;

export class AccountPinRecoveryLockedError extends Error {
  constructor() {
    super("PIN recovery is temporarily locked.");
    this.name = "AccountPinRecoveryLockedError";
  }
}

export class InvalidAccountPasswordForPinRecoveryError extends Error {
  constructor() {
    super("The account password is incorrect.");
    this.name = "InvalidAccountPasswordForPinRecoveryError";
  }
}

export class AccountPinRecoveryNotAvailableError extends Error {
  constructor() {
    super("PIN recovery is available only to authenticated officials and System Admins.");
    this.name = "AccountPinRecoveryNotAvailableError";
  }
}

export class InvalidPinRecoveryInputError extends Error {
  constructor() {
    super("The password or new PIN does not meet account policy.");
    this.name = "InvalidPinRecoveryInputError";
  }
}

export class DuplicateOfficialAccountPinError extends Error {
  constructor() {
    super("Official account PINs must be unique.");
    this.name = "DuplicateOfficialAccountPinError";
  }
}

type RecoveryOutcome =
  | { kind: "recovered"; sessionsRevoked: number }
  | { kind: "locked" }
  | { kind: "invalid_password" }
  | { kind: "duplicate_pin" }
  | { kind: "not_available" };

function accountTypeForPrincipal(principal: Principal) {
  if (principal.role === "system_admin") return "system_admin" as const;
  if (principal.role === "resident") return "resident" as const;
  return "official" as const;
}

export async function recoverAccountPin(
  database: AppDatabase,
  principal: Principal,
  input: { currentPassword: string; newPin: string },
) {
  if (principal.role === "resident") throw new AccountPinRecoveryNotAvailableError();
  if (
    !isValidAccountPassword(accountTypeForPrincipal(principal), input.currentPassword) ||
    !/^\d{6}$/.test(input.newPin)
  ) throw new InvalidPinRecoveryInputError();

  const outcome = await database.transaction<RecoveryOutcome>(async (transaction) => {
    if (principal.role !== "system_admin") await lockOfficialPinAccounts(transaction);
    const [account] = await transaction.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      rtUnitId: appAccounts.rtUnitId,
      personId: appAccounts.personId,
      householdId: appAccounts.householdId,
      pinChangeFailedAttempts: appAccounts.pinChangeFailedAttempts,
      pinChangeLockedUntil: appAccounts.pinChangeLockedUntil,
    }).from(appAccounts).where(and(
      eq(appAccounts.id, principal.appAccountId),
      eq(appAccounts.authUserId, principal.authUserId),
      eq(appAccounts.accountType, accountTypeForPrincipal(principal)),
      eq(appAccounts.status, "active"),
    )).limit(1).for("update");
    if (!account) return { kind: "not_available" };

    if (principal.role === "system_admin") {
      if (account.rtUnitId !== null || account.personId !== null || account.householdId !== null) {
        return { kind: "not_available" };
      }
    } else {
      if (
        !principal.rtUnitId || !principal.personId ||
        account.rtUnitId !== principal.rtUnitId ||
        account.personId !== principal.personId ||
        account.householdId !== null
      ) return { kind: "not_available" };
      const assignments = await transaction.select({ id: officialAssignments.id, role: officialAssignments.role })
        .from(officialAssignments).where(and(
          eq(officialAssignments.appAccountId, account.id),
          eq(officialAssignments.rtUnitId, principal.rtUnitId),
          officialAssignmentActiveOn(jakartaBusinessDate()),
        )).limit(2);
      if (assignments.length !== 1 || assignments[0]?.role !== principal.role) {
        return { kind: "not_available" };
      }
    }

    const now = new Date();
    if (account.pinChangeLockedUntil && account.pinChangeLockedUntil > now) return { kind: "locked" };

    const credentials = await transaction.select({ id: authAccount.id, password: authAccount.password })
      .from(authAccount).where(and(
        eq(authAccount.userId, account.authUserId),
        eq(authAccount.providerId, "credential"),
      )).limit(2).for("update");
    if (credentials.length !== 1 || !credentials[0]?.password) return { kind: "not_available" };

    let matches = false;
    try {
      matches = await verifyPassword({ hash: credentials[0].password, password: input.currentPassword });
    } catch {
      return { kind: "not_available" };
    }
    if (!matches) {
      const previousFailures = account.pinChangeLockedUntil && account.pinChangeLockedUntil <= now
        ? 0
        : account.pinChangeFailedAttempts;
      const nextFailures = Math.min(previousFailures + 1, MAX_PIN_RECOVERY_FAILURES);
      const lockedUntil = nextFailures >= MAX_PIN_RECOVERY_FAILURES
        ? new Date(now.getTime() + PIN_RECOVERY_LOCKOUT_MILLISECONDS)
        : null;
      await transaction.update(appAccounts).set({
        pinChangeFailedAttempts: nextFailures,
        pinChangeLockedUntil: lockedUntil,
      }).where(eq(appAccounts.id, account.id));
      return { kind: "invalid_password" };
    }

    if (
      principal.role !== "system_admin" &&
      await officialPinIsUsedByAnotherAccount(transaction, account.id, input.newPin)
    ) return { kind: "duplicate_pin" };

    const pinHash = await hashPassword(input.newPin);
    await transaction.update(appAccounts).set({
      pinHash,
      pinChangeFailedAttempts: 0,
      pinChangeLockedUntil: null,
    }).where(eq(appAccounts.id, account.id));
    const revokedSessions = await transaction.delete(authSession)
      .where(eq(authSession.userId, account.authUserId))
      .returning({ id: authSession.id });

    await appendAuditEvent(transaction, {
      actorAppAccountId: account.id,
      action: "account.pin.recovered",
      entityType: "account_pin",
      entityId: account.id,
      reason: null,
      context: { recoveryMethod: "strong_account_password", revokedSessionCount: revokedSessions.length },
    });
    return { kind: "recovered", sessionsRevoked: revokedSessions.length };
  });

  if (outcome.kind === "locked") throw new AccountPinRecoveryLockedError();
  if (outcome.kind === "invalid_password") throw new InvalidAccountPasswordForPinRecoveryError();
  if (outcome.kind === "duplicate_pin") throw new DuplicateOfficialAccountPinError();
  if (outcome.kind === "not_available") throw new AccountPinRecoveryNotAvailableError();
  return { sessionsRevoked: outcome.sessionsRevoked };
}
