import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../src/db/client";
import { appAccounts, auditEvents, authAccount, authSession } from "../../src/db/schema";
import { bootstrapR2SyntheticFixture } from "../../src/lib/rt/r2-staging-fixture";
import {
  rekeyPreviewSyntheticCredentials,
  validatePreviewSyntheticRekeyCredentials,
  type PreviewSyntheticRekeyCredentials,
} from "../../src/lib/rt/preview-synthetic-credential-rekey";
import { createTestDatabase } from "../helpers/database";

const originalCredentials: PreviewSyntheticRekeyCredentials = {
  residentPin: "284613",
  chairmanPassword: "old-chairman-preview-synthetic-2026",
  treasurerPassword: "old-treasurer-preview-synthetic-2026",
  systemAdminPassword: "old-system-admin-preview-synthetic-2026",
};

const replacementCredentials: PreviewSyntheticRekeyCredentials = {
  residentPin: "731604",
  chairmanPassword: "new-chairman-preview-synthetic-2026",
  treasurerPassword: "new-treasurer-preview-synthetic-2026",
  systemAdminPassword: "new-system-admin-preview-synthetic-2026",
};

const previewEnvironment = {
  NODE_ENV: "test",
  APP_ENV: "preview",
  DATABASE_ENV: "preview",
  KARTURT_PREVIEW_REKEY_SHA: "a".repeat(40),
  KARTURT_COMPILED_RELEASE_SHA: "a".repeat(40),
  KARTURT_PREVIEW_TARGET_ID: "misty-king-95262980/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview",
  KARTURT_PRODUCTION_TARGET_ID: "holy-term-22410117/br-jolly-bonus-azzd71cl/ep-empty-rain-azwe3eb3/karturt_production",
} as NodeJS.ProcessEnv;

describe("Preview synthetic credential rekey", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    await bootstrapR2SyntheticFixture(testDatabase.db as unknown as AppDatabase, originalCredentials, "2026-10-26");
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  it("accepts only four valid, distinct synthetic credentials", () => {
    expect(() => validatePreviewSyntheticRekeyCredentials(replacementCredentials)).not.toThrow();
    expect(() => validatePreviewSyntheticRekeyCredentials({
      ...replacementCredentials,
      residentPin: "not-a-pin",
    })).toThrow("Resident credential must be a six-digit synthetic PIN.");
    expect(() => validatePreviewSyntheticRekeyCredentials({
      ...replacementCredentials,
      treasurerPassword: replacementCredentials.chairmanPassword,
    })).toThrow("Each synthetic official account must use a distinct password.");
  });

  it("rekeys only the four canonical Preview accounts, revokes their sessions, and preserves the fixture contract", async () => {
    const { db } = testDatabase;
    const canonicalLogins = ["R2-101", "r2-chairman", "r2-treasurer", "r2-system-admin"];
    const accounts = await db.select({
      id: appAccounts.id,
      accountType: appAccounts.accountType,
      authUserId: appAccounts.authUserId,
      loginIdentifier: appAccounts.loginIdentifier,
    }).from(appAccounts).where(inArray(appAccounts.loginIdentifier, canonicalLogins));
    expect(accounts).toHaveLength(4);

    await db.insert(authSession).values(accounts.flatMap(({ authUserId }) => [
      { id: randomUUID(), token: randomUUID(), userId: authUserId, expiresAt: new Date(Date.now() + 60_000) },
      { id: randomUUID(), token: randomUUID(), userId: authUserId, expiresAt: new Date(Date.now() + 60_000) },
    ]));

    const result = await rekeyPreviewSyntheticCredentials(
      db as unknown as AppDatabase,
      replacementCredentials,
      previewEnvironment.KARTURT_COMPILED_RELEASE_SHA!,
      previewEnvironment,
    );

    expect(result).toMatchObject({ accountsRekeyed: 4, sessionsRevoked: 8 });
    expect(await db.select({ id: authSession.id }).from(authSession)).toHaveLength(0);

    const expectedByLogin = new Map<string, string>([
      ["R2-101", replacementCredentials.residentPin],
      ["r2-chairman", replacementCredentials.chairmanPassword],
      ["r2-treasurer", replacementCredentials.treasurerPassword],
      ["r2-system-admin", replacementCredentials.systemAdminPassword],
    ]);
    for (const account of accounts) {
      const [credential] = await db.select({ password: authAccount.password }).from(authAccount).where(and(
        eq(authAccount.userId, account.authUserId),
        eq(authAccount.providerId, "credential"),
      ));
      expect(credential?.password).toBeTruthy();
      await expect(verifyPassword({ hash: credential!.password!, password: expectedByLogin.get(account.loginIdentifier)! })).resolves.toBe(true);
      await expect(verifyPassword({ hash: credential!.password!, password: originalCredentials[account.loginIdentifier === "R2-101"
        ? "residentPin"
        : account.loginIdentifier === "r2-chairman"
          ? "chairmanPassword"
          : account.loginIdentifier === "r2-treasurer"
            ? "treasurerPassword"
            : "systemAdminPassword"] })).resolves.toBe(false);
    }

    const rekeyEvents = await db.select({
      actorAppAccountId: auditEvents.actorAppAccountId,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      context: auditEvents.context,
    }).from(auditEvents).where(eq(auditEvents.action, "preview.synthetic_credential.rekeyed"));
    expect(rekeyEvents).toHaveLength(4);
    expect(new Set(rekeyEvents.map(({ entityId }) => entityId))).toEqual(new Set(accounts.map(({ id }) => id)));
    await expect(rekeyPreviewSyntheticCredentials(
      db as unknown as AppDatabase,
      replacementCredentials,
      previewEnvironment.KARTURT_COMPILED_RELEASE_SHA!,
      previewEnvironment,
    )).rejects.toThrow("Preview rekey is restricted to the unchanged canonical synthetic fixture before UAT.");

    await expect(bootstrapR2SyntheticFixture(
      db as unknown as AppDatabase,
      replacementCredentials,
      "2026-10-26",
    )).resolves.toMatchObject({ status: "already_present" });
  });

  it("rejects a noncanonical Preview target before opening a transaction", async () => {
    const database = testDatabase.db as unknown as AppDatabase;
    await expect(rekeyPreviewSyntheticCredentials(
      database,
      replacementCredentials,
      previewEnvironment.KARTURT_COMPILED_RELEASE_SHA!,
      { ...previewEnvironment, KARTURT_PREVIEW_TARGET_ID: "other-preview-proj/br-preview-123456/ep-preview-123456/karturt_preview" },
    )).rejects.toThrow("R3 business-date override is restricted to the approved Preview database target.");
  });
});
