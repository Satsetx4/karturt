import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: getDbMock }));

import type { AppDatabase } from "@/db/client";
import { POST as residentLogin } from "@/app/api/login/[type]/route";
import { appAccounts, authAccount, authSession } from "@/db/schema";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

const environmentNames = [
  "APP_ENV",
  "DATABASE_ENV",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "KARTURT_STAGING_DEMO_LOGIN_BURST",
] as const;
const originalEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

describe("explicit staging demo login burst", () => {
  let testDatabase: TestDatabase;

  async function createResident(number: string, pin = "593817") {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId, { number });
    const user = await createAuthUser(testDatabase.db, `Synthetic resident ${number}`);
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(pin),
    });
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "resident",
      loginIdentifier: number,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      loginIdentifier: appAccounts.loginIdentifier,
    });
    return { account: account!, user };
  }

  async function login(identifier: string, password: string, ip: string) {
    return residentLogin(new Request("https://demo.example/api/login/resident", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://demo.example",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ identifier, password }),
    }), { params: Promise.resolve({ type: "resident" }) });
  }

  beforeAll(async () => {
    process.env.APP_ENV = "staging";
    process.env.DATABASE_ENV = "staging";
    process.env.DATABASE_URL = "postgresql://test.invalid/karturt";
    process.env.BETTER_AUTH_SECRET = "integration-test-secret-with-at-least-32-characters";
    process.env.NEXT_PUBLIC_APP_URL = "https://demo.example";
    process.env.KARTURT_STAGING_DEMO_LOGIN_BURST = "true";
    testDatabase = await createTestDatabase();
    getDbMock.mockReturnValue(testDatabase.db as unknown as AppDatabase);
  });

  afterAll(async () => {
    if (testDatabase) await testDatabase.close();
    for (const name of environmentNames) {
      const original = originalEnvironment.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  it("allows more than the default five correct same-egress Resident logins without changing failure counters", async () => {
    const residents = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      createResident(`BURST-${String(index + 1).padStart(2, "0")}`)));
    const ip = "203.0.113.80";
    const responses: Response[] = [];

    for (const resident of residents) {
      responses.push(await login(resident.account.loginIdentifier, "593817", ip));
    }

    expect(
      responses.map(({ status }) => status),
      JSON.stringify(await Promise.all(responses.map((response) => response.clone().text()))),
    ).toEqual(Array.from({ length: 8 }, () => 200));
    expect(responses.every((response) => response.headers.getSetCookie().some((cookie) => cookie.includes("session_token=")))).toBe(true);

    const accountIds = residents.map(({ account }) => account.id);
    const userIds = residents.map(({ user }) => user.id);
    const accountRows = await testDatabase.db.select({
      id: appAccounts.id,
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(inArray(appAccounts.id, accountIds));
    const sessions = await testDatabase.db.select({ userId: authSession.userId })
      .from(authSession).where(inArray(authSession.userId, userIds));

    expect(accountRows).toHaveLength(8);
    expect(accountRows.every(({ failedLoginAttempts, lockedUntil }) => failedLoginAttempts === 0 && lockedUntil === null)).toBe(true);
    expect(sessions).toHaveLength(8);
    expect(new Set(sessions.map(({ userId }) => userId))).toEqual(new Set(userIds));
  });

  it("keeps wrong-PIN Resident lockout active while the staging burst limit is enabled", async () => {
    const resident = await createResident("LOCKOUT-01");
    const ip = "203.0.113.81";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(resident.account.loginIdentifier, "000000", ip)).status).toBe(401);
    }

    const [locked] = await testDatabase.db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, resident.account.id));
    expect(locked?.failedLoginAttempts).toBe(5);
    expect(locked?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    const blockedCorrectPin = await login(resident.account.loginIdentifier, "593817", ip);
    expect(blockedCorrectPin.status).toBe(401);
    const [stillLocked] = await testDatabase.db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, resident.account.id));
    expect(stillLocked).toEqual(locked);
    expect(await testDatabase.db.select().from(authSession).where(eq(authSession.userId, resident.user.id))).toHaveLength(0);
  });
});
