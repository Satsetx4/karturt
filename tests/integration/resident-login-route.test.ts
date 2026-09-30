import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "better-auth/crypto";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: getDbMock }));

import type { AppDatabase } from "../../src/db/client";
import { POST } from "../../src/app/api/login/[type]/route";
import { appAccounts, authAccount } from "../../src/db/schema";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

const environmentNames = ["APP_ENV", "DATABASE_ENV", "DATABASE_URL", "BETTER_AUTH_SECRET", "NEXT_PUBLIC_APP_URL"] as const;
const originalEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));

describe("resident house-number and PIN login route", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test.invalid/karturt";
    process.env.BETTER_AUTH_SECRET = "integration-test-secret-with-at-least-32-characters";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
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

  it("authenticates a resident with the provisioned house number and exact numeric PIN", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId, { number: "C-01" });
    const user = await createAuthUser(testDatabase.db, "Resident route fixture");
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword("593817"),
    });
    await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "resident",
      loginIdentifier: "C-01",
      personId: household.personId,
      householdId: household.householdId,
    });

    const response = await POST(new Request("http://localhost:3000/api/login/resident", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": "203.0.113.77",
      },
      body: JSON.stringify({ identifier: "c-01", password: "593817" }),
    }), { params: Promise.resolve({ type: "resident" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ twoFactorRedirect: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie().join("; ")).toContain("session_token=");
    const [account] = await testDatabase.db.select({ failedLoginAttempts: appAccounts.failedLoginAttempts })
      .from(appAccounts);
    expect(account?.failedLoginAttempts).toBe(0);
  });
});
