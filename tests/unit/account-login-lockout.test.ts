import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import { appAccounts } from "@/db/schema";
import {
  clearAccountLoginFailures,
  isAccountLoginLocked,
  recordFailedAccountLogin,
} from "@/lib/auth/login-lockout";
import { createAuthUser, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

describe("account-scoped login lockout", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;
  let accountId: string;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
    const user = await createAuthUser(testDatabase.db);
    const [account] = await testDatabase.db.insert(appAccounts).values({
      authUserId: user.id,
      accountType: "system_admin",
      loginIdentifier: `lockout-${randomUUID()}`,
      status: "active",
    }).returning({ id: appAccounts.id });
    if (!account) throw new Error("The isolated account lockout fixture could not be created.");
    accountId = account.id;
  });

  afterEach(async () => {
    await testDatabase?.close();
  });

  it("locks a privileged account after five failures and resets the counter after expiry", async () => {
    const firstAttemptAt = new Date("2026-10-27T00:00:00.000Z");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await recordFailedAccountLogin(database, accountId, "system_admin", firstAttemptAt);
      expect(await isAccountLoginLocked(database, accountId, "system_admin", firstAttemptAt)).toBe(false);
    }
    await recordFailedAccountLogin(database, accountId, "system_admin", firstAttemptAt);
    expect(await isAccountLoginLocked(database, accountId, "system_admin", firstAttemptAt)).toBe(true);

    const afterExpiry = new Date(firstAttemptAt.getTime() + 15 * 60 * 1000 + 1);
    expect(await isAccountLoginLocked(database, accountId, "system_admin", afterExpiry)).toBe(false);
    await recordFailedAccountLogin(database, accountId, "system_admin", afterExpiry);
    const [account] = await testDatabase.db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, accountId)).limit(1);
    expect(account).toEqual({ failedLoginAttempts: 1, lockedUntil: null });

    await clearAccountLoginFailures(database, accountId, "system_admin");
    const [cleared] = await testDatabase.db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, accountId)).limit(1);
    expect(cleared).toEqual({ failedLoginAttempts: 0, lockedUntil: null });
  });
});
