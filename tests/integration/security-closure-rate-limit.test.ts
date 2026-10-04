import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { base32 } from "@better-auth/utils/base32";
import { hashPassword } from "better-auth/crypto";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  requestHeaders: new Headers(),
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));

import type { AppDatabase } from "@/db/client";
import { POST as residentLogin } from "@/app/api/login/[type]/route";
import { POST as resetResidentPin } from "@/app/api/residents/[accountId]/reset-pin/route";
import {
  appAccounts,
  authAccount,
  authRateLimit,
  authSession,
  officialAssignments,
} from "@/db/schema";
import { createAuth } from "@/lib/auth/server";
import {
  RESIDENT_LOGIN_LOCKOUT_MILLISECONDS,
  RESIDENT_LOGIN_MAX_FAILURES,
} from "@/lib/auth/login-lockout";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

const environmentNames = ["APP_ENV", "DATABASE_ENV", "DATABASE_URL", "BETTER_AUTH_SECRET", "NEXT_PUBLIC_APP_URL"] as const;
const originalEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));

type FixtureDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

describe("F2.1 S14/S15 rate limiting and Resident PIN lockout", () => {
  let testDatabase: FixtureDatabase;
  let auth: ReturnType<typeof createAuth>;
  let ipCounter = 0;

  function nextIp() {
    ipCounter += 1;
    return `198.51.100.${(ipCounter % 250) + 1}`;
  }

  function authRequest(
    path: string,
    body: unknown,
    options: { ip?: string; cookie?: string } = {},
  ) {
    return new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": options.ip ?? nextIp(),
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function createResident(label: string, pin = "593817", status: "active" | "disabled" = "active") {
    const rtUnitId = await createRt(testDatabase.db);
    const loginIdentifier = `R-${randomUUID().slice(0, 8)}`;
    const household = await createHousehold(testDatabase.db, rtUnitId, { number: loginIdentifier });
    const user = await createAuthUser(testDatabase.db, label);
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
      status,
      loginIdentifier,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id, loginIdentifier: appAccounts.loginIdentifier });
    return { user, account: account! };
  }

  async function login(identifier: string, password: string, ip = nextIp()) {
    return residentLogin(new Request("http://localhost:3000/api/login/resident", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ identifier, password }),
    }), { params: Promise.resolve({ type: "resident" }) });
  }

  async function signIn(email: string, password: string, ip = nextIp()) {
    return auth.handler(authRequest("/sign-in/email", { email, password, rememberMe: false }, { ip }));
  }

  function cookieFrom(response: Response) {
    return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  }

  async function rateLimitRow(ip: string) {
    const rows = await testDatabase.db.select({ key: authRateLimit.key, count: authRateLimit.count })
      .from(authRateLimit).where(like(authRateLimit.key, `${ip}|%`));
    return rows;
  }

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test.invalid/karturt";
    process.env.BETTER_AUTH_SECRET = "integration-test-secret-with-at-least-32-characters";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    testDatabase = await createTestDatabase();
    mocks.database = testDatabase.db as unknown as AppDatabase;
    auth = createAuth(testDatabase.db as unknown as AppDatabase, {
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.NEXT_PUBLIC_APP_URL,
    });
  });

  beforeEach(() => {
    mocks.requestHeaders = new Headers();
  });

  afterAll(async () => {
    if (testDatabase) await testDatabase.close();
    for (const name of environmentNames) {
      const original = originalEnvironment.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  it("enforces the configured email sign-in limit for known and unknown identities with database-backed parity", async () => {
    const configuredLimit = auth.options.rateLimit?.customRules?.["/sign-in/email"];
    expect(configuredLimit).toMatchObject({ window: 60, max: 5 });
    const max = configuredLimit?.max;
    if (max === undefined) throw new Error("The email sign-in rate limit is not configured.");

    const user = await createAuthUser(testDatabase.db, "Known rate-limit identity");
    const knownIp = nextIp();
    const unknownIp = nextIp();
    const knownResponses: Array<{ status: number; body: string }> = [];
    const unknownResponses: Array<{ status: number; body: string }> = [];

    for (let attempt = 0; attempt < max; attempt += 1) {
      const knownResponse = await signIn(user.email, "wrong-password", knownIp);
      const unknownResponse = await signIn("missing-rate-limit@accounts.test.invalid", "wrong-password", unknownIp);
      knownResponses.push({ status: knownResponse.status, body: await knownResponse.text() });
      unknownResponses.push({ status: unknownResponse.status, body: await unknownResponse.text() });
    }

    expect(knownResponses).toEqual(Array.from({ length: max }, () => ({
      status: knownResponses[0]!.status,
      body: knownResponses[0]!.body,
    })));
    expect(unknownResponses).toEqual(knownResponses);
    expect(knownResponses[0]?.status).not.toBe(429);
    const knownNext = await signIn(user.email, "wrong-password", knownIp);
    const unknownNext = await signIn("missing-rate-limit@accounts.test.invalid", "wrong-password", unknownIp);
    expect(knownNext.status).toBe(429);
    expect(unknownNext.status).toBe(429);

    for (const ip of [knownIp, unknownIp]) {
      const rows = await rateLimitRow(ip);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.count).toBe(max);
      expect(rows[0]?.key).toContain("/sign-in/email");
    }
  });

  it("enforces the configured System Admin TOTP verification limit at N and N+1", async () => {
    const configuredLimit = auth.options.rateLimit?.customRules?.["/two-factor/verify-totp"];
    expect(configuredLimit).toMatchObject({ window: 60, max: 5 });
    const max = configuredLimit?.max;
    if (max === undefined) throw new Error("The TOTP verification rate limit is not configured.");

    const user = await createAuthUser(testDatabase.db, "TOTP rate-limit identity");
    const password = `Ephemeral-${randomUUID()}-Pass`;
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(password),
    });
    await testDatabase.db.insert(appAccounts).values({
      authUserId: user.id,
      accountType: "system_admin",
      loginIdentifier: `admin-${randomUUID()}`,
    });

    const initialSignIn = await signIn(user.email, password);
    expect(initialSignIn.status).toBe(200);
    const initialCookie = cookieFrom(initialSignIn);
    const enrollment = await auth.api.enableTwoFactor({
      body: { password, method: "totp", issuer: "KartuRT" },
      headers: new Headers({ cookie: initialCookie }),
    });
    if (enrollment.method !== "totp") throw new Error("TOTP fixture enrollment failed.");
    const encodedSecret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(encodedSecret).toBeTruthy();
    const secret = new TextDecoder().decode(base32.decode(encodedSecret!));
    const enrollmentCode = await auth.api.generateTOTP({ body: { secret } });
    await auth.api.verifyTOTP({
      body: { code: enrollmentCode.code, trustDevice: false },
      headers: new Headers({ cookie: initialCookie }),
    });

    const challenge = await signIn(user.email, password);
    expect(challenge.status).toBe(200);
    const challengeCookie = cookieFrom(challenge);
    expect(challengeCookie).toContain("two_factor=");

    const verifyIp = nextIp();
    const badCode = String((Number(enrollmentCode.code) + 333_333) % 1_000_000).padStart(6, "0");
    const responses: Array<{ status: number; body: string }> = [];
    for (let attempt = 0; attempt < max; attempt += 1) {
      const response = await auth.handler(authRequest("/two-factor/verify-totp", {
        code: badCode,
        trustDevice: false,
      }, { ip: verifyIp, cookie: challengeCookie }));
      responses.push({ status: response.status, body: await response.text() });
    }
    expect(responses).toEqual(Array.from({ length: max }, () => ({
      status: responses[0]!.status,
      body: responses[0]!.body,
    })));
    expect(responses[0]?.status).not.toBe(429);
    const next = await auth.handler(authRequest("/two-factor/verify-totp", {
      code: badCode,
      trustDevice: false,
    }, { ip: verifyIp, cookie: challengeCookie }));
    expect(next.status).toBe(429);

    const rows = await rateLimitRow(verifyIp);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(max);
    expect(rows[0]?.key).toContain("/two-factor/verify-totp");
  });

  it("locks the actual Resident login at the configured threshold, rejects while locked, then permits a valid PIN after expiry", async () => {
    const resident = await createResident("Resident lockout expiry fixture");
    const [accountBefore] = await testDatabase.db.select({ id: appAccounts.id })
      .from(appAccounts).where(eq(appAccounts.id, resident.account.id));
    expect(accountBefore?.id).toBe(resident.account.id);

    for (let attempt = 0; attempt < RESIDENT_LOGIN_MAX_FAILURES; attempt += 1) {
      const response = await login(resident.account.loginIdentifier, "000000");
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
    }

    const [locked] = await testDatabase.db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, resident.account.id));
    expect(locked?.failedLoginAttempts).toBe(RESIDENT_LOGIN_MAX_FAILURES);
    expect(locked?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(locked?.lockedUntil?.getTime()).toBeLessThanOrEqual(Date.now() + RESIDENT_LOGIN_LOCKOUT_MILLISECONDS + 2_000);

    const lockedResponse = await login(resident.account.loginIdentifier, "593817");
    expect(lockedResponse.status).toBe(401);
    expect(await lockedResponse.json()).toEqual({ message: "Data masuk belum cocok atau akun belum aktif." });
    expect(lockedResponse.headers.getSetCookie()).toEqual([]);
    const [stillLocked] = await testDatabase.db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, resident.account.id));
    expect(stillLocked).toEqual(locked);

    const expiryBase = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(expiryBase + RESIDENT_LOGIN_LOCKOUT_MILLISECONDS + 1);
      const afterExpiry = await login(resident.account.loginIdentifier, "593817");
      expect(afterExpiry.status).toBe(200);
      expect(await afterExpiry.json()).toEqual({ twoFactorRedirect: false });
      expect(afterExpiry.headers.getSetCookie().join(";")).toContain("session_token=");
      const [cleared] = await testDatabase.db.select({
        failedLoginAttempts: appAccounts.failedLoginAttempts,
        lockedUntil: appAccounts.lockedUntil,
      }).from(appAccounts).where(eq(appAccounts.id, resident.account.id));
      expect(cleared).toEqual({ failedLoginAttempts: 0, lockedUntil: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats unknown and disabled Resident identifiers uniformly without creating sessions or changing lockout state", async () => {
    const disabled = await createResident("Disabled lockout fixture", "593817", "disabled");
    await testDatabase.db.update(appAccounts).set({ failedLoginAttempts: 2 }).where(eq(appAccounts.id, disabled.account.id));
    const unknown = await login(`UNKNOWN-${randomUUID().slice(0, 8)}`, "593817");
    const disabledResponse = await login(disabled.account.loginIdentifier, "593817");
    expect(unknown.status).toBe(401);
    expect(disabledResponse.status).toBe(401);
    expect(await unknown.json()).toEqual(await disabledResponse.json());
    expect(unknown.headers.getSetCookie()).toEqual([]);
    expect(disabledResponse.headers.getSetCookie()).toEqual([]);
    const [after] = await testDatabase.db.select({
      status: appAccounts.status,
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, disabled.account.id));
    expect(after).toMatchObject({ status: "disabled", failedLoginAttempts: 2, lockedUntil: null });
    expect(await testDatabase.db.select().from(authSession).where(eq(authSession.userId, disabled.user.id))).toHaveLength(0);
  });

  it("clears a lockout through the authenticated Chairman PIN-reset route", async () => {
    const resident = await createResident("Resident authorized reset fixture");
    for (let attempt = 0; attempt < RESIDENT_LOGIN_MAX_FAILURES; attempt += 1) {
      expect((await login(resident.account.loginIdentifier, "000000")).status).toBe(401);
    }

    const rtUnit = await testDatabase.db.select({ rtUnitId: appAccounts.rtUnitId })
      .from(appAccounts).where(eq(appAccounts.id, resident.account.id)).then((rows) => rows[0]);
    const chairmanUser = await createAuthUser(testDatabase.db, "Chairman lockout reset fixture");
    const chairmanPassword = `Ephemeral-${randomUUID()}-Pass`;
    const chairmanHousehold = await createHousehold(testDatabase.db, rtUnit!.rtUnitId!);
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: chairmanUser.id,
      providerId: "credential",
      userId: chairmanUser.id,
      password: await hashPassword(chairmanPassword),
    });
    const [chairmanAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId: rtUnit!.rtUnitId!,
      authUserId: chairmanUser.id,
      accountType: "official",
      loginIdentifier: `chairman-${randomUUID()}`,
      personId: chairmanHousehold.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId: rtUnit!.rtUnitId!,
      appAccountId: chairmanAccount!.id,
      role: "rt_chairman",
      startsOn: "2000-01-01",
    });
    const chairmanSignIn = await signIn(chairmanUser.email, chairmanPassword);
    expect(chairmanSignIn.status).toBe(200);
    const chairmanCookie = cookieFrom(chairmanSignIn);
    expect(chairmanCookie).toContain("session_token=");

    mocks.requestHeaders = new Headers({ cookie: chairmanCookie });
    const reset = await resetResidentPin(new Request(
      `http://localhost:3000/api/residents/${resident.account.id}/reset-pin`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie: chairmanCookie,
        },
        body: JSON.stringify({ pin: "804216", reason: "Clear lockout through authorized PIN reset." }),
      },
    ), { params: Promise.resolve({ accountId: resident.account.id }) });
    expect(reset.status).toBe(200);
    const [afterReset] = await testDatabase.db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, resident.account.id));
    expect(afterReset).toEqual({ failedLoginAttempts: 0, lockedUntil: null });

    const accepted = await login(resident.account.loginIdentifier, "804216");
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ twoFactorRedirect: false });
  });

  it("does not allow concurrent wrong-PIN attempts to bypass the atomic failure threshold", async () => {
    const resident = await createResident("Resident concurrent lockout fixture");
    const attempts = await Promise.all(Array.from({ length: RESIDENT_LOGIN_MAX_FAILURES + 2 }, () =>
      login(resident.account.loginIdentifier, "000000", nextIp())));
    expect(attempts.every((response) => response.status === 401)).toBe(true);

    const [afterRace] = await testDatabase.db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, resident.account.id));
    expect(afterRace?.failedLoginAttempts).toBe(RESIDENT_LOGIN_MAX_FAILURES);
    expect(afterRace?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    const blocked = await login(resident.account.loginIdentifier, "593817", nextIp());
    expect(blocked.status).toBe(401);
    expect(blocked.headers.getSetCookie()).toEqual([]);
    const [afterBlocked] = await testDatabase.db.select({
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, resident.account.id));
    expect(afterBlocked).toEqual(afterRace);
  });
});
