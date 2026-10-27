import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import { appAccounts, authAccount, authSession, auditEvents } from "@/db/schema";
import { rekeyPreviewWorkbookSyntheticCredentials } from "@/lib/rt/preview-workbook-synthetic-credential-rekey";
import { bootstrapWorkbookSyntheticAccountFixture } from "../fixtures/workbook-account-fixture";
import type { WorkbookAccountRosterEntry } from "../fixtures/workbook-account-roster";
import { createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
const releaseSha = "a".repeat(40);
const previewEnvironment = {
  NODE_ENV: "test",
  APP_ENV: "preview",
  DATABASE_ENV: "preview",
  KARTURT_PREVIEW_REKEY_SHA: releaseSha,
  KARTURT_PREVIEW_TARGET_ID: "rough-queen-62552713/br-fragrant-poetry-aousu14b/ep-green-smoke-aobgfksu/karturt_preview",
  KARTURT_PRODUCTION_TARGET_ID: "holy-term-22410117/br-jolly-bonus-azzd71cl/ep-empty-rain-azwe3eb3/karturt_production",
} as NodeJS.ProcessEnv;

const passwords = {
  chairmanPassword: `Chair-${randomUUID()}-Password9!`,
  treasurerPassword: `Treasurer-${randomUUID()}-Password9!`,
  systemAdminPassword: `Admin-${randomUUID()}-Password9!`,
};

function makeRoster(): WorkbookAccountRosterEntry[] {
  const token = randomUUID().replace(/-/g, "");
  return (["system_admin", "rt_chairman", "treasurer", "resident", "resident"] as const).map((role, index) => ({
    identifier: `WB-${token}-${index}`,
    name: `Fixture Person ${token}-${index}`,
    role,
    accountStatus: "active",
    pin: String(100_000 + Number.parseInt(token.slice(index, index + 6), 16) % 900_000),
  }));
}

describe("Preview workbook synthetic credential rekey", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterEach(async () => {
    await testDatabase?.close();
  });

  it("rekeys only the three privileged passwords, preserves resident PIN login, revokes sessions, and audits safely", async () => {
    const roster = makeRoster();
    const fixture = await bootstrapWorkbookSyntheticAccountFixture(database, roster);
    const principals = [fixture.principals.systemAdmin, fixture.principals.chairman, fixture.principals.treasurer, ...fixture.principals.residents];
    for (const principal of principals) {
      await testDatabase.db.insert(authSession).values({
        id: randomUUID(),
        token: randomUUID(),
        userId: principal.authUserId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    }
    const pinHashesBefore = await testDatabase.db.select({ id: appAccounts.id, pinHash: appAccounts.pinHash }).from(appAccounts);
    const residentCredentialsBefore = await testDatabase.db.select({ userId: authAccount.userId, password: authAccount.password })
      .from(authAccount).where(eq(authAccount.providerId, "credential"));

    const result = await rekeyPreviewWorkbookSyntheticCredentials(database, passwords, releaseSha, previewEnvironment);
    expect(result.accountsRekeyed).toBe(3);
    expect(result.sessionsRevoked).toBe(3);

    const credentials = await testDatabase.db.select({ userId: authAccount.userId, password: authAccount.password })
      .from(authAccount).where(eq(authAccount.providerId, "credential"));
    const accountRows = await testDatabase.db.select({ id: appAccounts.id, authUserId: appAccounts.authUserId, type: appAccounts.accountType, pinHash: appAccounts.pinHash })
      .from(appAccounts);
    expect(accountRows.map(({ id, pinHash }) => [id, pinHash]).sort()).toEqual(pinHashesBefore.map(({ id, pinHash }) => [id, pinHash]).sort());

    const expectedPasswords = new Map([
      [fixture.principals.chairman.authUserId, passwords.chairmanPassword],
      [fixture.principals.treasurer.authUserId, passwords.treasurerPassword],
      [fixture.principals.systemAdmin.authUserId, passwords.systemAdminPassword],
    ]);
    for (const [userId, password] of expectedPasswords) {
      const credential = credentials.find((row) => row.userId === userId);
      expect(credential?.password).toBeTruthy();
      expect(await verifyPassword({ hash: credential!.password!, password })).toBe(true);
      const account = accountRows.find((row) => row.authUserId === userId);
      const pinEntry = roster.find((row) => row.role === (userId === fixture.principals.chairman.authUserId ? "rt_chairman" : userId === fixture.principals.treasurer.authUserId ? "treasurer" : "system_admin"));
      expect(account?.pinHash).toBeTruthy();
      expect(await verifyPassword({ hash: credential!.password!, password: pinEntry!.pin })).toBe(false);
    }

    for (const principal of fixture.principals.residents) {
      const after = credentials.find((row) => row.userId === principal.authUserId);
      const before = residentCredentialsBefore.find((row) => row.userId === principal.authUserId);
      expect(after?.password).toBe(before?.password);
      expect(await testDatabase.db.select({ id: authSession.id }).from(authSession)
        .where(eq(authSession.userId, principal.authUserId))).toHaveLength(1);
    }
    for (const principal of [fixture.principals.systemAdmin, fixture.principals.chairman, fixture.principals.treasurer]) {
      expect(await testDatabase.db.select({ id: authSession.id }).from(authSession)
        .where(eq(authSession.userId, principal.authUserId))).toHaveLength(0);
    }

    const audits = await testDatabase.db.select({ action: auditEvents.action, context: auditEvents.context })
      .from(auditEvents).where(eq(auditEvents.action, "preview.synthetic_credential.rekeyed"));
    expect(audits).toHaveLength(3);
    expect(audits.every(({ context }) => Object.keys(context).sort().join(",") === "credentialRole,executionMethod,revokedSessionCount")).toBe(true);
    expect(audits.every(({ context }) => context.executionMethod === "owner_authorized_preview_cli")).toBe(true);
  });

  it("fails closed for a non-Preview target and a database outside the five-account fixture", async () => {
    const roster = makeRoster();
    const fixture = await bootstrapWorkbookSyntheticAccountFixture(database, roster);
    const before = await testDatabase.db.select({ id: authAccount.id, password: authAccount.password }).from(authAccount);
    await expect(rekeyPreviewWorkbookSyntheticCredentials(database, passwords, releaseSha, {
      ...previewEnvironment,
      APP_ENV: "production",
    })).rejects.toThrow("Preview environment");
    expect(await testDatabase.db.select({ id: authAccount.id, password: authAccount.password }).from(authAccount)).toEqual(before);

    await createRt(testDatabase.db);
    await expect(rekeyPreviewWorkbookSyntheticCredentials(database, passwords, releaseSha, previewEnvironment))
      .rejects.toThrow("exactly one synthetic RT unit");
    expect(await testDatabase.db.select({ id: authAccount.id, password: authAccount.password }).from(authAccount)).toEqual(before);
    expect(fixture.counts.accounts).toBe(5);
  });
});
