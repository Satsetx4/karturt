import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appAccounts } from "../../src/db/schema";
import {
  clearResidentLoginFailures,
  isResidentLoginLocked,
  recordFailedResidentLogin,
} from "../../src/lib/auth/login-lockout";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("resident PIN account lockout", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  it("locks on the fifth failure for fifteen minutes and clears after a successful/reset credential flow", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const user = await createAuthUser(db);
    const [account] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "resident",
      loginIdentifier: "07",
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id });
    const now = new Date("2026-09-30T00:00:00.000Z");

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await recordFailedResidentLogin(db as never, account.id, now);
    }
    expect(await isResidentLoginLocked(db as never, account.id, now)).toBe(false);

    const fifthFailure = await recordFailedResidentLogin(db as never, account.id, now);
    expect(fifthFailure?.failedLoginAttempts).toBe(5);
    expect(fifthFailure?.lockedUntil?.getTime()).toBe(now.getTime() + 15 * 60 * 1000);
    expect(await isResidentLoginLocked(db as never, account.id, new Date(now.getTime() + 14 * 60 * 1000))).toBe(true);
    expect(await isResidentLoginLocked(db as never, account.id, new Date(now.getTime() + 15 * 60 * 1000))).toBe(false);

    await clearResidentLoginFailures(db as never, account.id);
    const [cleared] = await db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, account.id));
    expect(cleared).toMatchObject({ failedLoginAttempts: 0, lockedUntil: null });
  });
});
