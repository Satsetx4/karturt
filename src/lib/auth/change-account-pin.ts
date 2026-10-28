import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appAccounts, authAccount, authSession, households, officialAssignments, people } from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";
import type { Principal } from "@/lib/auth/permissions";
import { lockOfficialPinAccounts, officialPinIsUsedByAnotherAccount } from "@/lib/auth/official-pin-uniqueness";
import { officialAssignmentActiveOn, jakartaBusinessDate } from "@/lib/officials/lifecycle";

const MAX_PIN_CHANGE_FAILURES = 5;
const PIN_CHANGE_LOCKOUT_MILLISECONDS = 15 * 60 * 1000;

export interface ChangeAccountPinInput {
  currentPin: string;
  newPin: string;
}

export class AccountPinLockedError extends Error {
  constructor() {
    super("PIN changes are temporarily locked. Try again later.");
    this.name = "AccountPinLockedError";
  }
}

export class InvalidCurrentAccountPinError extends Error {
  constructor() {
    super("The current PIN is incorrect.");
    this.name = "InvalidCurrentAccountPinError";
  }
}

export class AccountPinNotConfiguredError extends Error {
  constructor() {
    super("The account PIN is not configured.");
    this.name = "AccountPinNotConfiguredError";
  }
}

export class InvalidAccountPinFormatError extends Error {
  constructor() {
    super("Account PINs must be exactly six digits.");
    this.name = "InvalidAccountPinFormatError";
  }
}

export class DuplicateOfficialAccountPinError extends Error {
  constructor() {
    super("Official account PINs must be unique.");
    this.name = "DuplicateOfficialAccountPinError";
  }
}

type ChangeOutcome =
  | { kind: "changed"; sessionsRevoked: number }
  | { kind: "locked" }
  | { kind: "invalid_current_pin" }
  | { kind: "duplicate_pin" }
  | { kind: "not_configured" };

function accountTypeForPrincipal(principal: Principal) {
  if (principal.role === "resident") return "resident" as const;
  if (principal.role === "system_admin") return "system_admin" as const;
  return "official" as const;
}

export async function changeAccountPin(
  database: AppDatabase,
  principal: Principal,
  input: ChangeAccountPinInput,
) {
  if (!/^\d{6}$/.test(input.currentPin) || !/^\d{6}$/.test(input.newPin)) {
    throw new InvalidAccountPinFormatError();
  }

  const outcome = await database.transaction<ChangeOutcome>(async (transaction) => {
    if (principal.role !== "resident" && principal.role !== "system_admin") {
      await lockOfficialPinAccounts(transaction);
    }
    const businessDate = jakartaBusinessDate();
    const [account] = await transaction
      .select({
        id: appAccounts.id,
        authUserId: appAccounts.authUserId,
        rtUnitId: appAccounts.rtUnitId,
        householdId: appAccounts.householdId,
        personId: appAccounts.personId,
        pinHash: appAccounts.pinHash,
        pinChangeFailedAttempts: appAccounts.pinChangeFailedAttempts,
        pinChangeLockedUntil: appAccounts.pinChangeLockedUntil,
      })
      .from(appAccounts)
      .where(and(
        eq(appAccounts.id, principal.appAccountId),
        eq(appAccounts.authUserId, principal.authUserId),
        eq(appAccounts.accountType, accountTypeForPrincipal(principal)),
        eq(appAccounts.status, "active"),
      ))
      .limit(1)
      .for("update");

    if (!account) return { kind: "not_configured" };

    if (principal.role === "resident") {
      if (!principal.rtUnitId || !principal.householdId || !principal.personId) {
        return { kind: "not_configured" };
      }
      const [membership] = await transaction
        .select({ householdId: households.id })
        .from(appAccounts)
        .innerJoin(households, and(
          eq(appAccounts.householdId, households.id),
          eq(appAccounts.rtUnitId, households.rtUnitId),
        ))
        .innerJoin(people, and(
          eq(people.id, appAccounts.personId),
          eq(people.rtUnitId, households.rtUnitId),
          eq(people.householdId, households.id),
        ))
        .where(and(
          eq(appAccounts.id, account.id),
          eq(appAccounts.rtUnitId, principal.rtUnitId),
          eq(appAccounts.householdId, principal.householdId),
          eq(appAccounts.personId, principal.personId),
          eq(households.status, "active"),
          isNull(households.endsOn),
          lte(households.startsOn, businessDate),
          eq(people.isActive, true),
        ))
        .limit(1);
      if (!membership) return { kind: "not_configured" };
    } else if (principal.role !== "system_admin") {
      if (
        !principal.rtUnitId ||
        !principal.personId ||
        account.rtUnitId !== principal.rtUnitId ||
        account.personId !== principal.personId
      ) return { kind: "not_configured" };
      const assignments = await transaction
        .select({ id: officialAssignments.id, role: officialAssignments.role })
        .from(officialAssignments)
        .where(and(
          eq(officialAssignments.appAccountId, account.id),
          eq(officialAssignments.rtUnitId, principal.rtUnitId),
          officialAssignmentActiveOn(businessDate),
        ))
        .limit(2);
      if (assignments.length !== 1 || assignments[0]?.role !== principal.role) {
        return { kind: "not_configured" };
      }
    }

    const now = new Date();
    if (account.pinChangeLockedUntil && account.pinChangeLockedUntil > now) {
      return { kind: "locked" };
    }

    let residentCredential: { id: string; password: string | null } | null = null;
    if (principal.role === "resident") {
      const credentials = await transaction
        .select({ id: authAccount.id, password: authAccount.password })
        .from(authAccount)
        .where(and(
          eq(authAccount.userId, account.authUserId),
          eq(authAccount.providerId, "credential"),
        ))
        .limit(2)
        .for("update");
      if (
        credentials.length !== 1 ||
        !credentials[0]?.password ||
        !account.pinHash ||
        account.pinHash !== credentials[0].password
      ) {
        return { kind: "not_configured" };
      }
      residentCredential = credentials[0];
    } else if (!account.pinHash) {
      return { kind: "not_configured" };
    }

    let currentPinMatches = false;
    try {
      currentPinMatches = await verifyPassword({
        hash: account.pinHash!,
        password: input.currentPin,
      });
    } catch {
      return { kind: "not_configured" };
    }
    if (!currentPinMatches) {
      const previousFailures = account.pinChangeLockedUntil && account.pinChangeLockedUntil <= now
        ? 0
        : account.pinChangeFailedAttempts;
      const nextFailures = Math.min(previousFailures + 1, MAX_PIN_CHANGE_FAILURES);
      const lockedUntil = nextFailures >= MAX_PIN_CHANGE_FAILURES
        ? new Date(now.getTime() + PIN_CHANGE_LOCKOUT_MILLISECONDS)
        : null;
      await transaction
        .update(appAccounts)
        .set({
          pinChangeFailedAttempts: nextFailures,
          pinChangeLockedUntil: lockedUntil,
        })
        .where(eq(appAccounts.id, account.id));
      return { kind: "invalid_current_pin" };
    }

    if (
      principal.role !== "resident" &&
      principal.role !== "system_admin" &&
      await officialPinIsUsedByAnotherAccount(transaction, account.id, input.newPin)
    ) return { kind: "duplicate_pin" };

    const passwordHash = await hashPassword(input.newPin);
    if (residentCredential) {
      const [updatedCredential] = await transaction
        .update(authAccount)
        .set({ password: passwordHash, updatedAt: now })
        .where(and(
          eq(authAccount.id, residentCredential.id),
          eq(authAccount.userId, account.authUserId),
          eq(authAccount.providerId, "credential"),
        ))
        .returning({ id: authAccount.id });
      if (!updatedCredential) return { kind: "not_configured" };
    }

    const [updatedAccount] = await transaction
      .update(appAccounts)
      .set({
        pinHash: passwordHash,
        pinChangeFailedAttempts: 0,
        pinChangeLockedUntil: null,
      })
      .where(eq(appAccounts.id, account.id))
      .returning({ id: appAccounts.id });
    if (!updatedAccount) throw new AccountPinNotConfiguredError();

    const revokedSessions = await transaction
      .delete(authSession)
      .where(eq(authSession.userId, account.authUserId))
      .returning({ id: authSession.id });

    await appendAuditEvent(transaction, {
      actorAppAccountId: account.id,
      action: "account.pin.changed",
      entityType: "account_pin",
      entityId: account.id,
      reason: null,
      context: { revokedSessionCount: revokedSessions.length },
    });

    return { kind: "changed", sessionsRevoked: revokedSessions.length };
  });

  if (outcome.kind === "locked") throw new AccountPinLockedError();
  if (outcome.kind === "invalid_current_pin") throw new InvalidCurrentAccountPinError();
  if (outcome.kind === "duplicate_pin") throw new DuplicateOfficialAccountPinError();
  if (outcome.kind === "not_configured") throw new AccountPinNotConfiguredError();
  return { sessionsRevoked: outcome.sessionsRevoked };
}
