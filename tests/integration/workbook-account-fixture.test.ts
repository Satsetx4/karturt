import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import { appAccounts, authAccount, authSession, authUser, officialAssignments, rtUnits, auditEvents } from "@/db/schema";
import {
  AccountPinLockedError,
  changeAccountPin,
  InvalidCurrentAccountPinError,
} from "@/lib/auth/change-account-pin";
import {
  AccountPinRecoveryNotAvailableError,
  recoverAccountPin,
} from "@/lib/auth/recover-account-pin";
import type { WorkbookAccountRole, WorkbookAccountRosterEntry } from "../fixtures/workbook-account-roster";
import { bootstrapWorkbookSyntheticAccountFixture } from "../fixtures/workbook-account-fixture";
import { createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
const roles: WorkbookAccountRole[] = ["system_admin", "rt_chairman", "treasurer", "resident", "resident"];

function makeRoster(): WorkbookAccountRosterEntry[] {
  const token = randomUUID().replace(/-/g, "");
  const sharedResidentPin = String(100_000 + Number.parseInt(token.slice(0, 6), 16) % 900_000);
  return roles.map((role, index) => ({
    identifier: `WB-${token}-${index}`,
    name: `Fixture Person ${token}-${index}`,
    role,
    accountStatus: "active",
    pin: role === "resident"
      ? sharedResidentPin
      : String(100_000 + (Number.parseInt(token.slice(6 + index, 12 + index), 16) % 900_000)),
  }));
}

function newPinDifferentFrom(value: string) {
  let candidate = String(100_000 + Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 6), 16) % 900_000);
  while (candidate === value) candidate = String((Number(candidate) + 1) % 900_000 + 100_000);
  return candidate;
}

describe("five-account workbook identity fixture", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterEach(async () => {
    await testDatabase?.close();
  });

  it("creates five active roles from one roster, stores PIN hashes, and replays idempotently", async () => {
    const roster = makeRoster();
    const fixture = await bootstrapWorkbookSyntheticAccountFixture(database, roster);
    const replay = await bootstrapWorkbookSyntheticAccountFixture(database, roster);

    expect(fixture.status).toBe("created");
    expect(replay.status).toBe("already_present");
    expect(fixture.counts).toEqual({
      accounts: 5,
      systemAdmins: 1,
      chairmen: 1,
      treasurers: 1,
      residents: 2,
      activeAccounts: 5,
    });
    expect(fixture.principals.residents).toHaveLength(2);
    expect(new Set(fixture.principals.residents.map((principal) => principal.householdId)).size).toBe(2);

    const accounts = await testDatabase.db.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      type: appAccounts.accountType,
      status: appAccounts.status,
      identifier: appAccounts.loginIdentifier,
      pinHash: appAccounts.pinHash,
    }).from(appAccounts);
    expect(accounts).toHaveLength(5);
    expect(accounts.every((account) => account.status === "active" && account.pinHash !== null)).toBe(true);
    expect(new Set(accounts.map((account) => account.pinHash)).size).toBe(5);

    for (const entry of roster) {
      const account = accounts.find((candidate) => candidate.identifier === entry.identifier);
      expect(account).toBeDefined();
      if (!account?.pinHash) throw new Error("A synthetic workbook account is missing its PIN hash.");
      expect(await verifyPassword({ hash: account.pinHash, password: entry.pin })).toBe(true);

      const [credential] = await testDatabase.db.select({ password: authAccount.password })
        .from(authAccount)
        .where(and(eq(authAccount.userId, account.authUserId), eq(authAccount.providerId, "credential")))
        .limit(1);
      expect(credential?.password).toBeTruthy();
      if (entry.role === "resident") {
        expect(credential?.password).toBe(account.pinHash);
      } else {
        expect(await verifyPassword({ hash: credential!.password!, password: entry.pin })).toBe(false);
      }
    }

    const residentAccounts = accounts.filter((account) => account.type === "resident");
    expect(residentAccounts).toHaveLength(2);
    expect(residentAccounts[0]?.pinHash).not.toBe(residentAccounts[1]?.pinHash);
    const assignments = await testDatabase.db.select({ role: officialAssignments.role }).from(officialAssignments);
    expect(assignments.map(({ role }) => role).sort()).toEqual(["rt_chairman", "treasurer"]);

    const treasurerEntry = roster.find((entry) => entry.role === "treasurer");
    if (!treasurerEntry) throw new Error("The treasurer workbook entry is missing.");
    const [treasurerCredentialBefore] = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount)
      .where(and(
        eq(authAccount.userId, fixture.principals.treasurer.authUserId),
        eq(authAccount.providerId, "credential"),
      ))
      .limit(1);
    const changedTreasurerPin = newPinDifferentFrom(treasurerEntry.pin);
    await changeAccountPin(database, fixture.principals.treasurer, {
      currentPin: treasurerEntry.pin,
      newPin: changedTreasurerPin,
    });
    const [treasurerAccountAfter] = await testDatabase.db.select({ pinHash: appAccounts.pinHash })
      .from(appAccounts).where(eq(appAccounts.id, fixture.principals.treasurer.appAccountId)).limit(1);
    const [treasurerCredentialAfter] = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount)
      .where(and(
        eq(authAccount.userId, fixture.principals.treasurer.authUserId),
        eq(authAccount.providerId, "credential"),
      ))
      .limit(1);
    expect(await verifyPassword({ hash: treasurerAccountAfter!.pinHash!, password: changedTreasurerPin })).toBe(true);
    expect(treasurerCredentialAfter?.password).toBe(treasurerCredentialBefore?.password);
    expect(await verifyPassword({ hash: treasurerCredentialAfter!.password!, password: changedTreasurerPin })).toBe(false);
  });

  it("changes a resident PIN with current-PIN verification, session revocation, audit, and account lockout", async () => {
    const roster = makeRoster();
    const fixture = await bootstrapWorkbookSyntheticAccountFixture(database, roster);
    const principal = fixture.principals.residents[0];
    const entry = roster.find((row) => row.role === "resident");
    if (!principal || !entry) throw new Error("A resident fixture is missing.");

    const token = randomUUID();
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await testDatabase.db.insert(authSession).values({
      id: randomUUID(),
      token,
      userId: principal.authUserId,
      expiresAt: expiry,
    });
    const samePinResult = await changeAccountPin(database, principal, {
      currentPin: entry.pin,
      newPin: entry.pin,
    });
    expect(samePinResult.sessionsRevoked).toBe(1);

    const [updatedAccount] = await testDatabase.db.select({ pinHash: appAccounts.pinHash })
      .from(appAccounts).where(eq(appAccounts.id, principal.appAccountId)).limit(1);
    const [updatedCredential] = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(and(
        eq(authAccount.userId, principal.authUserId),
        eq(authAccount.providerId, "credential"),
      )).limit(1);
    expect(updatedAccount?.pinHash).toBe(updatedCredential?.password);
    expect(await verifyPassword({ hash: updatedAccount!.pinHash!, password: entry.pin })).toBe(true);
    await expect(testDatabase.db.select({ id: authSession.id }).from(authSession)
      .where(eq(authSession.userId, principal.authUserId))).resolves.toHaveLength(0);

    const [audit] = await testDatabase.db.select({
      action: auditEvents.action,
      context: auditEvents.context,
    }).from(auditEvents).where(and(
      eq(auditEvents.entityId, principal.appAccountId),
      eq(auditEvents.action, "account.pin.changed"),
    )).limit(1);
    expect(audit?.context).toEqual({ revokedSessionCount: 1 });

    const wrongPin = newPinDifferentFrom(entry.pin);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(changeAccountPin(database, principal, {
        currentPin: wrongPin,
        newPin: entry.pin,
      })).rejects.toBeInstanceOf(InvalidCurrentAccountPinError);
    }
    await expect(changeAccountPin(database, principal, {
      currentPin: entry.pin,
      newPin: newPinDifferentFrom(entry.pin),
    })).rejects.toBeInstanceOf(AccountPinLockedError);
  });

  it("fails closed on unrelated rows and conflicting fixture identities", async () => {
    const roster = makeRoster();
    await createRt(testDatabase.db);
    await expect(bootstrapWorkbookSyntheticAccountFixture(database, roster))
      .rejects.toThrow("Workbook account fixture is invalid or the disposable database is not isolated.");
    expect(await testDatabase.db.select({ id: rtUnits.id }).from(rtUnits)).toHaveLength(1);
    expect(await testDatabase.db.select({ id: appAccounts.id }).from(appAccounts)).toHaveLength(0);

    const conflictDatabase = await createTestDatabase();
    try {
      const conflictDb = conflictDatabase.db as unknown as AppDatabase;
      const fixture = await bootstrapWorkbookSyntheticAccountFixture(conflictDb, roster);
      const resident = fixture.principals.residents[0];
      if (!resident) throw new Error("A resident fixture is missing.");
      await conflictDatabase.db.update(authUser)
        .set({ name: `Conflicting ${randomUUID()}` })
        .where(eq(authUser.id, resident.authUserId));
      await expect(bootstrapWorkbookSyntheticAccountFixture(conflictDb, roster))
        .rejects.toThrow("Workbook account fixture is invalid or the disposable database is not isolated.");
      expect(await conflictDatabase.db.select({ id: appAccounts.id }).from(appAccounts)).toHaveLength(5);
    } finally {
      await conflictDatabase.close();
    }
  });

  it("recovers a privileged account PIN with its strong password and keeps that password unchanged", async () => {
    const roster = makeRoster();
    const fixture = await bootstrapWorkbookSyntheticAccountFixture(database, roster);
    const treasurerEntry = roster.find((entry) => entry.role === "treasurer");
    if (!treasurerEntry) throw new Error("The treasurer workbook entry is missing.");
    const freshPassword = `Fixture-Pass-${randomUUID()}-9!`;
    const credentialHash = await hashPassword(freshPassword);
    await testDatabase.db.update(authAccount).set({ password: credentialHash })
      .where(and(
        eq(authAccount.userId, fixture.principals.treasurer.authUserId),
        eq(authAccount.providerId, "credential"),
      ));
    await testDatabase.db.insert(authSession).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: fixture.principals.treasurer.authUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const nextPin = newPinDifferentFrom(treasurerEntry.pin);
    const result = await recoverAccountPin(database, fixture.principals.treasurer, {
      currentPassword: freshPassword,
      newPin: nextPin,
    });
    expect(result.sessionsRevoked).toBe(1);

    const [account] = await testDatabase.db.select({ pinHash: appAccounts.pinHash })
      .from(appAccounts).where(eq(appAccounts.id, fixture.principals.treasurer.appAccountId)).limit(1);
    const [credential] = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(and(
        eq(authAccount.userId, fixture.principals.treasurer.authUserId),
        eq(authAccount.providerId, "credential"),
      )).limit(1);
    expect(await verifyPassword({ hash: account!.pinHash!, password: nextPin })).toBe(true);
    expect(credential?.password).toBe(credentialHash);
    expect(await verifyPassword({ hash: credential!.password!, password: nextPin })).toBe(false);
    await expect(testDatabase.db.select({ id: authSession.id }).from(authSession)
      .where(eq(authSession.userId, fixture.principals.treasurer.authUserId))).resolves.toHaveLength(0);

    const [audit] = await testDatabase.db.select({ action: auditEvents.action, context: auditEvents.context })
      .from(auditEvents).where(and(
        eq(auditEvents.entityId, fixture.principals.treasurer.appAccountId),
        eq(auditEvents.action, "account.pin.recovered"),
      )).limit(1);
    expect(audit?.context).toEqual({ recoveryMethod: "strong_account_password", revokedSessionCount: 1 });
    await expect(recoverAccountPin(database, fixture.principals.residents[0]!, {
      currentPassword: freshPassword,
      newPin: nextPin,
    })).rejects.toBeInstanceOf(AccountPinRecoveryNotAvailableError);
  });
});
