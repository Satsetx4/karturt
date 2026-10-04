import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "better-auth/crypto";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  auth: undefined as unknown,
  requestHeaders: new Headers(),
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "https://karturt.test" }));
vi.mock("@/lib/auth/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/server")>("@/lib/auth/server");
  return { ...actual, getAuth: () => mocks.auth };
});

import type { AppDatabase } from "@/db/client";
import { GET as getResidentDues } from "@/app/api/resident/monthly-dues/route";
import { appAccounts, authAccount } from "@/db/schema";
import { createAuth } from "@/lib/auth/server";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("Launch Safety session fixation and cookie attributes", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let database: AppDatabase;
  let auth: ReturnType<typeof createAuth>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
    auth = createAuth(database, {
      secret: "test-only-secret-with-at-least-32-characters",
      baseURL: "https://karturt.test",
    });
    mocks.database = database;
    mocks.auth = auth;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  it("rejects an attacker-selected pre-auth cookie and issues a fresh HTTPS session cookie", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db, "Session fixation Resident");
    const password = `Test-${randomUUID()}-Password`;
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(password),
    });
    await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "resident",
      loginIdentifier: `session-fixation-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    });

    const cookieName = "__Secure-better-auth.session_token";
    const attackerCookie = `${cookieName}=attacker-selected-pre-auth-token`;
    expect(await auth.api.getSession({ headers: new Headers({ cookie: attackerCookie }) })).toBeNull();

    mocks.requestHeaders = new Headers({ cookie: attackerCookie });
    const preAuthProtectedResponse = await getResidentDues();
    expect(preAuthProtectedResponse.status).toBe(401);

    const signIn = await auth.handler(new Request("https://karturt.test/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://karturt.test",
        cookie: attackerCookie,
        "x-forwarded-for": "203.0.113.221",
      },
      body: JSON.stringify({ email: user.email, password, rememberMe: false }),
    }));
    expect(signIn.status).toBe(200);

    const setCookies = signIn.headers.getSetCookie();
    const sessionCookieLine = setCookies.find((value) => value.startsWith(`${cookieName}=`));
    expect(Boolean(sessionCookieLine)).toBe(true);
    if (!sessionCookieLine) throw new Error("Better Auth did not issue its HTTPS session cookie.");

    const [nameAndValue, ...attributes] = sessionCookieLine.split(";").map((part) => part.trim());
    const [, issuedToken] = nameAndValue!.split("=", 2);
    const freshCookie = `${nameAndValue}`;
    expect(issuedToken === "attacker-selected-pre-auth-token").toBe(false);
    expect(attributes.some((attribute) => /^httponly$/i.test(attribute))).toBe(true);
    expect(attributes.some((attribute) => /^secure$/i.test(attribute))).toBe(true);
    const sameSite = attributes.find((attribute) => /^samesite=/i.test(attribute))?.split("=", 2)[1]?.toLowerCase();
    expect(["lax", "strict", "none"].includes(sameSite ?? "")).toBe(true);

    expect(await auth.api.getSession({ headers: new Headers({ cookie: freshCookie }) })).toBeTruthy();
    expect(await auth.api.getSession({ headers: new Headers({ cookie: attackerCookie }) })).toBeNull();
    mocks.requestHeaders = new Headers({ cookie: freshCookie });
    const authenticatedResponse = await getResidentDues();
    expect(authenticatedResponse.status).toBe(200);
  });
});
