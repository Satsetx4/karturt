import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../src/db/client";
import {
  appAccounts,
  auditEvents,
  authAccount,
  authSession,
  authTwoFactor,
  authUser,
  rtUnits,
} from "../../src/db/schema";
import { appendAuditEvent } from "../../src/lib/audit/writer";
import { resetResidentPin } from "../../src/lib/auth/reset-resident-pin";
import { recoverSystemAdminTwoFactor } from "../../src/lib/auth/recover-system-admin-two-factor";
import { MfaEnrollmentRequiredError, resolvePrincipalForUser } from "../../src/lib/auth/principal";
import type { Principal } from "../../src/lib/auth/permissions";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("Audit Core and resident PIN recovery", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  async function createResident(rtUnitId: string) {
    const household = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db);
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "resident",
      loginIdentifier: "H-" + randomUUID().slice(0, 8),
      personId: household.personId,
      householdId: household.householdId,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword("123456"),
    });
    return { userId: user.id, accountId: account.id };
  }

  async function createOfficialPrincipal(rtUnitId: string, role: "treasurer" | "rt_chairman" | "system_admin"): Promise<Principal> {
    const user = await createAuthUser(testDatabase.db);
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId: role === "system_admin" ? null : rtUnitId,
      authUserId: user.id,
      accountType: role === "system_admin" ? "system_admin" : "official",
      loginIdentifier: role + "-" + randomUUID().slice(0, 8),
      personId: role === "system_admin" ? null : (await createHousehold(testDatabase.db, rtUnitId)).personId,
    }).returning({ id: appAccounts.id });
    return {
      authUserId: user.id,
      appAccountId: account.id,
      role,
      rtUnitId: role === "system_admin" ? null : rtUnitId,
      householdId: null,
      personId: role === "system_admin" ? null : "fixture-person",
    };
  }

  it("resets a resident PIN only for the authorized Chairman and revokes all resident sessions", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const chairman = await createOfficialPrincipal(rtUnitId, "rt_chairman");
    const resident = await createResident(rtUnitId);
    const secondResident = await createResident(rtUnitId);
    const expiredAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(authSession).values([
      { id: randomUUID(), token: randomUUID(), userId: resident.userId, expiresAt: expiredAt },
      { id: randomUUID(), token: randomUUID(), userId: resident.userId, expiresAt: expiredAt },
      { id: randomUUID(), token: randomUUID(), userId: secondResident.userId, expiresAt: expiredAt },
    ]);

    const result = await resetResidentPin(db as unknown as AppDatabase, chairman, {
      residentAccountId: resident.accountId,
      pin: "804216",
      reason: "Resident requested a replacement PIN.",
    });
    expect(result).toMatchObject({ residentAccountId: resident.accountId, sessionsRevoked: 2 });

    const [credential] = await db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, resident.userId));
    expect(credential?.password).toBeTruthy();
    await expect(verifyPassword({ hash: credential!.password!, password: "804216" })).resolves.toBe(true);
    await expect(verifyPassword({ hash: credential!.password!, password: "123456" })).resolves.toBe(false);

    const remainingSessions = await db.select({ id: authSession.id }).from(authSession)
      .where(eq(authSession.userId, resident.userId));
    expect(remainingSessions).toHaveLength(0);
    const otherSessions = await db.select({ id: authSession.id }).from(authSession)
      .where(eq(authSession.userId, secondResident.userId));
    expect(otherSessions).toHaveLength(1);

    const [account] = await db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, resident.accountId));
    expect(account).toMatchObject({ failedLoginAttempts: 0, lockedUntil: null });

    const [event] = await db.select().from(auditEvents).where(and(
      eq(auditEvents.entityId, resident.accountId),
      eq(auditEvents.action, "resident.pin.reset"),
    ));
    expect(event).toMatchObject({
      actorAppAccountId: chairman.appAccountId,
      reason: "Resident requested a replacement PIN.",
      context: { recoveryReference: null, revokedSessionCount: 2 },
    });
    await expect(db.update(auditEvents).set({ reason: "tampered" }).where(eq(auditEvents.id, event.id))).rejects.toThrow();
    await expect(db.delete(auditEvents).where(eq(auditEvents.id, event.id))).rejects.toThrow();
    await expect(testDatabase.client.exec("TRUNCATE audit_events")).rejects.toThrow();
  });

  it("denies Treasurer and cross-RT reset attempts and requires System Admin recovery context", async () => {
    const { db } = testDatabase;
    const firstRt = await createRt(db);
    const secondRt = await createRt(db);
    const resident = await createResident(firstRt);
    const treasurer = await createOfficialPrincipal(firstRt, "treasurer");
    const otherChairman = await createOfficialPrincipal(secondRt, "rt_chairman");
    const systemAdmin = await createOfficialPrincipal(firstRt, "system_admin");

    await expect(resetResidentPin(db as unknown as AppDatabase, treasurer, {
      residentAccountId: resident.accountId,
      pin: "123456",
      reason: "Not authorized.",
    })).rejects.toThrow("Forbidden");
    await expect(resetResidentPin(db as unknown as AppDatabase, otherChairman, {
      residentAccountId: resident.accountId,
      pin: "123456",
      reason: "Cross-RT check.",
    })).rejects.toThrow("not found in the authorized scope");
    await expect(resetResidentPin(db as unknown as AppDatabase, systemAdmin, {
      residentAccountId: resident.accountId,
      pin: "123456",
      reason: "Emergency PIN recovery.",
    })).rejects.toThrow("recovery reference");

    await expect(resetResidentPin(db as unknown as AppDatabase, systemAdmin, {
      residentAccountId: resident.accountId,
      pin: "123456",
      reason: "Emergency PIN recovery.",
      recoveryReference: "REC-2026-001",
    })).resolves.toMatchObject({ residentAccountId: resident.accountId });
    await expect(db.select().from(auditEvents).where(and(
      eq(auditEvents.entityId, resident.accountId),
      eq(auditEvents.action, "resident.pin.structured_recovery"),
    ))).resolves.toMatchObject([{
      actorAppAccountId: systemAdmin.appAccountId,
      context: { recoveryReference: "REC-2026-001", revokedSessionCount: 0 },
    }]);
  });

  it("commits a service mutation and its audit event together, and rolls both back on failure", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const principal = await createOfficialPrincipal(rtUnitId, "rt_chairman");
    const [before] = await db.select({ name: rtUnits.name }).from(rtUnits).where(eq(rtUnits.id, rtUnitId));
    const committedName = "Audit Core commit fixture";

    await db.transaction(async (transaction) => {
      await transaction.update(rtUnits).set({ name: committedName }).where(eq(rtUnits.id, rtUnitId));
      await appendAuditEvent(transaction, {
        actorAppAccountId: principal.appAccountId,
        action: "test.service.commit",
        entityType: "rt_unit",
        entityId: rtUnitId,
        reason: "Verify same-transaction audit.",
      });
    });
    const [committed] = await db.select({ name: rtUnits.name }).from(rtUnits).where(eq(rtUnits.id, rtUnitId));
    expect(committed?.name).toBe(committedName);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "test.service.commit"))).toHaveLength(1);

    await expect(db.transaction(async (transaction) => {
      await transaction.update(rtUnits).set({ name: "Must roll back" }).where(eq(rtUnits.id, rtUnitId));
      await appendAuditEvent(transaction, {
        actorAppAccountId: principal.appAccountId,
        action: "test.service.rollback",
        entityType: "rt_unit",
        entityId: rtUnitId,
      });
      throw new Error("Force transaction rollback.");
    })).rejects.toThrow("Force transaction rollback");
    const [rolledBack] = await db.select({ name: rtUnits.name }).from(rtUnits).where(eq(rtUnits.id, rtUnitId));
    expect(rolledBack?.name).toBe(committedName);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "test.service.rollback"))).toHaveLength(0);
    expect(before?.name).toBeTruthy();
  });

  it("recovers a locked-out System Admin only through another verified admin and requires fresh TOTP enrollment", async () => {
    const { db } = testDatabase;
    const actorUser = await createAuthUser(db, "Verified recovery actor");
    const targetUser = await createAuthUser(db, "System Admin recovery target");
    const [actorAccount] = await db.insert(appAccounts).values({
      authUserId: actorUser.id,
      accountType: "system_admin",
      loginIdentifier: "recovery-actor-" + randomUUID().slice(0, 8),
    }).returning({ id: appAccounts.id });
    const [targetAccount] = await db.insert(appAccounts).values({
      authUserId: targetUser.id,
      accountType: "system_admin",
      loginIdentifier: "recovery-target-" + randomUUID().slice(0, 8),
    }).returning({ id: appAccounts.id });
    await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, actorUser.id));
    await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, targetUser.id));
    await db.insert(authTwoFactor).values([
      { id: randomUUID(), userId: actorUser.id, secret: "actor-secret", backupCodes: "actor-codes", verified: true },
      { id: randomUUID(), userId: targetUser.id, secret: "target-secret", backupCodes: "target-codes", verified: true },
    ]);
    const validUntil = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(authSession).values([
      { id: randomUUID(), token: randomUUID(), userId: actorUser.id, expiresAt: validUntil },
      { id: randomUUID(), token: randomUUID(), userId: targetUser.id, expiresAt: validUntil },
      { id: randomUUID(), token: randomUUID(), userId: targetUser.id, expiresAt: validUntil },
    ]);

    const verifiedActor = await resolvePrincipalForUser(db as unknown as AppDatabase, actorUser.id);
    expect(verifiedActor).toMatchObject({ appAccountId: actorAccount.id, role: "system_admin" });
    await expect(recoverSystemAdminTwoFactor(db as unknown as AppDatabase, verifiedActor, {
      targetAccountId: actorAccount.id,
      reason: "Self recovery is not allowed.",
      recoveryReference: "INC-2026-002",
    })).rejects.toThrow("another verified System Admin");

    await expect(recoverSystemAdminTwoFactor(db as unknown as AppDatabase, verifiedActor, {
      targetAccountId: targetAccount.id,
      reason: "Authenticator and all backup codes were lost.",
      recoveryReference: "INC-2026-002",
    })).resolves.toMatchObject({ targetAccountId: targetAccount.id, sessionsRevoked: 2 });

    await expect(db.select().from(authTwoFactor).where(eq(authTwoFactor.userId, targetUser.id))).resolves.toHaveLength(0);
    await expect(db.select({ enabled: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, targetUser.id)))
      .resolves.toMatchObject([{ enabled: false }]);
    await expect(db.select().from(authSession).where(eq(authSession.userId, targetUser.id))).resolves.toHaveLength(0);
    await expect(db.select().from(authSession).where(eq(authSession.userId, actorUser.id))).resolves.toHaveLength(1);
    await expect(resolvePrincipalForUser(db as unknown as AppDatabase, targetUser.id)).rejects.toBeInstanceOf(MfaEnrollmentRequiredError);
    await expect(db.select().from(auditEvents).where(and(
      eq(auditEvents.entityId, targetAccount.id),
      eq(auditEvents.action, "system_admin.two_factor.emergency_recovery"),
    ))).resolves.toMatchObject([{
      actorAppAccountId: actorAccount.id,
      reason: "Authenticator and all backup codes were lost.",
      context: { recoveryReference: "INC-2026-002", revokedSessionCount: 2 },
    }]);
  });
});
