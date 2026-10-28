import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { base32 } from "@better-auth/utils/base32";
import { hashPassword, verifyPassword } from "better-auth/crypto";

const mocks = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));

import type { AppDatabase } from "@/db/client";
import { POST as authCatchAllPost } from "@/app/api/auth/[...all]/route";
import { POST as accountLogin } from "@/app/api/login/[type]/route";
import {
  appAccounts,
  auditEvents,
  authAccount,
  authSession,
  authUser,
  officialAssignments,
} from "@/db/schema";
import { createAuth } from "@/lib/auth/server";
import { changeAccountPin, DuplicateOfficialAccountPinError } from "@/lib/auth/change-account-pin";
import { MfaEnrollmentRequiredError, resolvePrincipalForUser } from "@/lib/auth/principal";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

const environmentNames = ["APP_ENV", "DATABASE_ENV", "DATABASE_URL", "BETTER_AUTH_SECRET", "NEXT_PUBLIC_APP_URL"] as const;
const originalEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));
type FixtureDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

describe("official username and six-digit PIN authentication", () => {
  let testDatabase: FixtureDatabase;
  let auth: ReturnType<typeof createAuth>;
  let ipCounter = 0;
  const syntheticPins = new Set<string>();

  function nextSyntheticPin(leadingZero = false) {
    const create = () => leadingZero
      ? `0${String(randomInt(0, 100_000)).padStart(5, "0")}`
      : String(randomInt(0, 1_000_000)).padStart(6, "0");
    let pin = create();
    while (syntheticPins.has(pin)) pin = create();
    syntheticPins.add(pin);
    return pin;
  }

  function nextIp() {
    ipCounter += 1;
    return `198.51.100.${(ipCounter % 250) + 1}`;
  }

  function authRequest(path: string, body: unknown, ip = nextIp(), cookie?: string) {
    return new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": ip,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function cookieFrom(response: Response) {
    return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  }

  async function createOfficial(input: {
    identifier: string;
    pin?: string;
    role?: "rt_chairman" | "treasurer";
    rtUnitId?: string;
    status?: "active" | "disabled";
  }) {
    const rtUnitId = input.rtUnitId ?? await createRt(testDatabase.db);
    const person = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db, `Official fixture ${randomUUID().slice(0, 8)}`);
    const password = `Official-Recovery-${randomUUID()}`;
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(password),
    });
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      status: input.status ?? "active",
      loginIdentifier: input.identifier,
      personId: person.personId,
      pinHash: input.pin ? await hashPassword(input.pin) : null,
    }).returning({ id: appAccounts.id });
    if (input.role) {
      await testDatabase.db.insert(officialAssignments).values({
        rtUnitId,
        appAccountId: account!.id,
        role: input.role,
        startsOn: "2000-01-01",
      });
    }
    return { user, account: { ...account!, loginIdentifier: input.identifier }, password, rtUnitId, personId: person.personId };
  }

  async function login(identifier: string, pin: string, ip = nextIp()) {
    return accountLogin(new Request("http://localhost:3000/api/login/official", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ identifier, pin }),
    }), { params: Promise.resolve({ type: "official" }) });
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

  afterAll(async () => {
    if (testDatabase) await testDatabase.close();
    for (const name of environmentNames) {
      const original = originalEnvironment.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  it("logs in the active Chairman and Treasurer with separate PINs, including leading zeroes", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const chairmanPin = nextSyntheticPin(true);
    const treasurerPin = nextSyntheticPin();
    const changedChairmanPin = nextSyntheticPin();
    const chairman = await createOfficial({ identifier: `chair-${randomUUID()}`, pin: chairmanPin, role: "rt_chairman", rtUnitId });
    const treasurer = await createOfficial({ identifier: `treas-${randomUUID()}`, pin: treasurerPin, role: "treasurer", rtUnitId });
    const [chairmanCredentialBefore] = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, chairman.user.id));

    const chairmanResponse = await login(chairman.account.loginIdentifier, chairmanPin);
    const treasurerResponse = await login(treasurer.account.loginIdentifier, treasurerPin);
    for (const [fixture, response] of [[chairman, chairmanResponse], [treasurer, treasurerResponse]] as const) {
      expect(response.status, await response.clone().text()).toBe(200);
      await expect(response.json()).resolves.toEqual({ twoFactorRedirect: false });
      expect(response.headers.get("cache-control")).toBe("no-store");
      const cookie = cookieFrom(response);
      expect(cookie).toContain("session_token=");
      const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
      expect(session?.user.id).toBe(fixture.user.id);
    }
    const strongPasswordAttempt = await accountLogin(new Request("http://localhost:3000/api/login/official", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ identifier: chairman.account.loginIdentifier, password: chairman.password }),
    }), { params: Promise.resolve({ type: "official" }) });
    expect(strongPasswordAttempt.status).toBe(400);
    expect(strongPasswordAttempt.headers.getSetCookie()).toEqual([]);

    const chairmanPrincipal = {
      authUserId: chairman.user.id,
      appAccountId: chairman.account.id,
      role: "rt_chairman" as const,
      rtUnitId,
      householdId: null,
      personId: chairman.personId,
    };
    await expect(changeAccountPin(testDatabase.db as unknown as AppDatabase, chairmanPrincipal, {
      currentPin: chairmanPin,
      newPin: treasurerPin,
    })).rejects.toBeInstanceOf(DuplicateOfficialAccountPinError);
    await changeAccountPin(testDatabase.db as unknown as AppDatabase, chairmanPrincipal, {
      currentPin: chairmanPin,
      newPin: changedChairmanPin,
    });
    const [changedPin] = await testDatabase.db.select({ pinHash: appAccounts.pinHash })
      .from(appAccounts).where(eq(appAccounts.id, chairman.account.id));
    expect(await verifyPassword({ hash: changedPin!.pinHash!, password: changedChairmanPin })).toBe(true);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(chairmanResponse) }) })).toBeNull();

    const [chairmanCredentialAfter] = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, chairman.user.id));
    expect(chairmanCredentialAfter?.password).toBe(chairmanCredentialBefore?.password);
    expect((await login(chairman.account.loginIdentifier, changedChairmanPin)).status).toBe(200);
  });

  it("blocks wrong PINs after five failures, rejects a PIN used by another official, and safely recovers", async () => {
    const firstPin = nextSyntheticPin();
    const secondPin = nextSyntheticPin();
    const wrongPin = nextSyntheticPin();
    const recoveredPin = nextSyntheticPin();
    const first = await createOfficial({ identifier: `treas-${randomUUID()}`, pin: firstPin, role: "treasurer" });
    const second = await createOfficial({ identifier: `chair-${randomUUID()}`, pin: secondPin, role: "rt_chairman" });
    const signedIn = await login(first.account.loginIdentifier, firstPin);
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    const oldCookie = cookieFrom(signedIn);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(first.account.loginIdentifier, wrongPin, nextIp());
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    const locked = await login(first.account.loginIdentifier, firstPin, nextIp());
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBe("900");

    const duplicateRecovery = await auth.handler(authRequest("/official-pin/recover", {
      identifier: first.account.loginIdentifier,
      currentPassword: first.password,
      newPin: secondPin,
    }));
    expect(duplicateRecovery.status).toBe(400);
    expect(duplicateRecovery.headers.getSetCookie()).toEqual([]);
    const [unchanged] = await testDatabase.db.select({ pinHash: appAccounts.pinHash })
      .from(appAccounts).where(eq(appAccounts.id, first.account.id));
    expect(await verifyPassword({ hash: unchanged!.pinHash!, password: firstPin })).toBe(true);

    const before = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, first.user.id));
    const recovered = await auth.handler(authRequest("/official-pin/recover", {
      identifier: first.account.loginIdentifier,
      currentPassword: first.password,
      newPin: recoveredPin,
    }));
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toEqual({ status: true });
    expect(recovered.headers.getSetCookie()).toEqual([]);
    const [after] = await testDatabase.db.select({
      pinHash: appAccounts.pinHash,
      failedLoginAttempts: appAccounts.failedLoginAttempts,
      lockedUntil: appAccounts.lockedUntil,
      pinChangeFailedAttempts: appAccounts.pinChangeFailedAttempts,
      pinChangeLockedUntil: appAccounts.pinChangeLockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, first.account.id));
    expect(await verifyPassword({ hash: after!.pinHash!, password: recoveredPin })).toBe(true);
    expect(after).toMatchObject({ failedLoginAttempts: 0, lockedUntil: null, pinChangeFailedAttempts: 0, pinChangeLockedUntil: null });
    expect(await auth.api.getSession({ headers: new Headers({ cookie: oldCookie }) })).toBeNull();
    expect(await login(first.account.loginIdentifier, recoveredPin)).toHaveProperty("status", 200);

    const audit = await testDatabase.db.select({ action: auditEvents.action, context: auditEvents.context })
      .from(auditEvents).where(eq(auditEvents.actorAppAccountId, first.account.id));
    expect(audit).toContainEqual({
      action: "account.pin.recovered",
      context: { recoveryMethod: "strong_account_password", revokedSessionCount: 1 },
    });
    const auditText = JSON.stringify(audit);
    for (const credential of [firstPin, secondPin, wrongPin, recoveredPin, first.password]) {
      expect(auditText).not.toContain(credential);
    }
    expect(await testDatabase.db.select({ password: authAccount.password }).from(authAccount).where(eq(authAccount.userId, first.user.id)))
      .toEqual(before);
    expect(await testDatabase.db.select({ id: appAccounts.id }).from(appAccounts).where(eq(appAccounts.id, second.account.id))).toHaveLength(1);
  });

  it("fails closed on duplicate existing official PINs and lets each official recover a unique PIN", async () => {
    const sharedPin = nextSyntheticPin();
    const chairmanPin = nextSyntheticPin();
    const treasurerPin = nextSyntheticPin();
    const chairman = await createOfficial({ identifier: `chair-${randomUUID()}`, pin: sharedPin, role: "rt_chairman" });
    const treasurer = await createOfficial({ identifier: `treas-${randomUUID()}`, pin: sharedPin, role: "treasurer" });

    expect((await login(chairman.account.loginIdentifier, sharedPin)).status).toBe(401);
    expect((await login(treasurer.account.loginIdentifier, sharedPin)).status).toBe(401);

    const chairmanRecovery = await auth.handler(authRequest("/official-pin/recover", {
      identifier: chairman.account.loginIdentifier,
      currentPassword: chairman.password,
      newPin: chairmanPin,
    }));
    expect(chairmanRecovery.status).toBe(200);
    expect((await login(chairman.account.loginIdentifier, chairmanPin)).status).toBe(200);
    expect((await login(treasurer.account.loginIdentifier, sharedPin)).status).toBe(200);

    const treasurerRecovery = await auth.handler(authRequest("/official-pin/recover", {
      identifier: treasurer.account.loginIdentifier,
      currentPassword: treasurer.password,
      newPin: treasurerPin,
    }));
    expect(treasurerRecovery.status).toBe(200);
    expect((await login(treasurer.account.loginIdentifier, treasurerPin)).status).toBe(200);
  });

  it("lets an official with no configured PIN recover from the existing strong password", async () => {
    const official = await createOfficial({ identifier: `imported-${randomUUID()}`, role: "rt_chairman" });
    const recoveredPin = nextSyntheticPin();
    const [credentialBefore] = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, official.user.id));

    const recovered = await auth.handler(authRequest("/official-pin/recover", {
      identifier: official.account.loginIdentifier,
      currentPassword: official.password,
      newPin: recoveredPin,
    }));
    expect(recovered.status).toBe(200);
    expect(recovered.headers.getSetCookie()).toEqual([]);
    const [account] = await testDatabase.db.select({ pinHash: appAccounts.pinHash })
      .from(appAccounts).where(eq(appAccounts.id, official.account.id));
    expect(await verifyPassword({ hash: account!.pinHash!, password: recoveredPin })).toBe(true);
    expect(await login(official.account.loginIdentifier, recoveredPin)).toHaveProperty("status", 200);
    expect(await testDatabase.db.select({ password: authAccount.password }).from(authAccount).where(eq(authAccount.userId, official.user.id)))
      .toEqual([credentialBefore]);
  });

  it("rejects a filled recovery honeypot without changing account data", async () => {
    const official = await createOfficial({ identifier: `imported-${randomUUID()}`, role: "rt_chairman" });
    const response = await auth.handler(authRequest("/official-pin/recover", {
      identifier: official.account.loginIdentifier,
      currentPassword: official.password,
      newPin: nextSyntheticPin(),
      website: "automated submission",
    }));
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
    const [account] = await testDatabase.db.select({
      pinHash: appAccounts.pinHash,
      pinChangeFailedAttempts: appAccounts.pinChangeFailedAttempts,
      pinChangeLockedUntil: appAccounts.pinChangeLockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, official.account.id));
    expect(account).toMatchObject({ pinHash: null, pinChangeFailedAttempts: 0, pinChangeLockedUntil: null });
    expect(await testDatabase.db.select({ id: auditEvents.id }).from(auditEvents)
      .where(eq(auditEvents.actorAppAccountId, official.account.id))).toHaveLength(0);
  });

  it("locks PIN recovery after five wrong strong-password attempts", async () => {
    const official = await createOfficial({ identifier: `recover-lock-${randomUUID()}`, role: "treasurer" });
    const newPin = nextSyntheticPin();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await auth.handler(authRequest("/official-pin/recover", {
        identifier: official.account.loginIdentifier,
        currentPassword: `Wrong-Recovery-${randomUUID()}`,
        newPin,
      }));
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    const [locked] = await testDatabase.db.select({
      pinChangeFailedAttempts: appAccounts.pinChangeFailedAttempts,
      pinChangeLockedUntil: appAccounts.pinChangeLockedUntil,
    }).from(appAccounts).where(eq(appAccounts.id, official.account.id));
    expect(locked?.pinChangeFailedAttempts).toBe(5);
    expect(locked?.pinChangeLockedUntil?.getTime()).toBeGreaterThan(Date.now());

    const correctPasswordStillLocked = await auth.handler(authRequest("/official-pin/recover", {
      identifier: official.account.loginIdentifier,
      currentPassword: official.password,
      newPin,
    }));
    expect(correctPasswordStillLocked.status).toBe(429);
    expect(correctPasswordStillLocked.headers.get("retry-after")).toBe("900");
    expect(correctPasswordStillLocked.headers.getSetCookie()).toEqual([]);
  });

  it("does not leave a session when PIN login races with a PIN change", async () => {
    const oldPin = nextSyntheticPin();
    const newPin = nextSyntheticPin();
    const official = await createOfficial({ identifier: `pin-race-${randomUUID()}`, pin: oldPin, role: "treasurer" });
    const principal = {
      authUserId: official.user.id,
      appAccountId: official.account.id,
      role: "treasurer" as const,
      rtUnitId: official.rtUnitId,
      householdId: null,
      personId: official.personId,
    };

    const [loginResponse] = await Promise.all([
      login(official.account.loginIdentifier, oldPin),
      changeAccountPin(testDatabase.db as unknown as AppDatabase, principal, { currentPin: oldPin, newPin }),
    ]);
    expect([200, 401, 429]).toContain(loginResponse!.status);
    expect(await testDatabase.db.select({ id: authSession.id }).from(authSession)
      .where(eq(authSession.userId, official.user.id))).toHaveLength(0);
    expect((await login(official.account.loginIdentifier, oldPin)).status).toBe(401);
    expect((await login(official.account.loginIdentifier, newPin)).status).toBe(200);
  });

  it("keeps System Admin on strong password login and still requires verified TOTP", async () => {
    const user = await createAuthUser(testDatabase.db, `System Admin fixture ${randomUUID().slice(0, 8)}`);
    const password = `System-Admin-Password-${randomUUID()}`;
    const identifier = `admin-${randomUUID()}`;
    const adminPinAttempt = nextSyntheticPin();
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(password),
    });
    const [account] = await testDatabase.db.insert(appAccounts).values({
      authUserId: user.id,
      accountType: "system_admin",
      loginIdentifier: identifier,
    }).returning({ id: appAccounts.id });

    const pinAttempt = await accountLogin(new Request("http://localhost:3000/api/login/system_admin", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ identifier, password: adminPinAttempt }),
    }), { params: Promise.resolve({ type: "system_admin" }) });
    expect(pinAttempt.status).toBe(401);
    expect(pinAttempt.headers.getSetCookie()).toEqual([]);

    const adminLogin = await accountLogin(new Request("http://localhost:3000/api/login/system_admin", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ identifier, password }),
    }), { params: Promise.resolve({ type: "system_admin" }) });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.headers.getSetCookie().join(";")).toContain("session_token=");
    await expect(resolvePrincipalForUser(testDatabase.db as unknown as AppDatabase, user.id))
      .rejects.toBeInstanceOf(MfaEnrollmentRequiredError);
    expect(account?.id).toBeTruthy();
  });

  it("fails closed for missing, inactive, unassigned, or ambiguous usernames and rejects non-six-digit PINs", async () => {
    const disabledPin = nextSyntheticPin();
    const unassignedPin = nextSyntheticPin();
    const duplicateOnePin = nextSyntheticPin();
    const duplicateTwoPin = nextSyntheticPin();
    const lookupPin = nextSyntheticPin();
    const malformedPin = String(randomInt(0, 100_000)).padStart(5, "0");
    const disabled = await createOfficial({ identifier: `disabled-${randomUUID()}`, pin: disabledPin, role: "treasurer", status: "disabled" });
    const unassigned = await createOfficial({ identifier: `unassigned-${randomUUID()}`, pin: unassignedPin });
    const firstRt = await createRt(testDatabase.db);
    const secondRt = await createRt(testDatabase.db);
    const duplicateName = `duplicate-${randomUUID()}`;
    const duplicateOne = await createOfficial({ identifier: duplicateName, pin: duplicateOnePin, role: "treasurer", rtUnitId: firstRt });
    await createOfficial({ identifier: duplicateName, pin: duplicateTwoPin, role: "rt_chairman", rtUnitId: secondRt });

    for (const identifier of ["missing-user", disabled.account.loginIdentifier, unassigned.account.loginIdentifier, duplicateName]) {
      const response = await login(identifier, lookupPin);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ message: "Data masuk belum cocok atau akun belum aktif." });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    const malformed = await auth.handler(authRequest("/sign-in/official-pin", {
      identifier: duplicateOne.account.loginIdentifier,
      pin: malformedPin,
    }));
    expect(malformed.status).toBe(400);
    expect(malformed.headers.getSetCookie()).toEqual([]);
  });

  it("keeps a verified official TOTP challenge and blocks direct public email-password sign-in", async () => {
    const officialPin = nextSyntheticPin();
    const official = await createOfficial({ identifier: `mfa-${randomUUID()}`, pin: officialPin, role: "treasurer" });
    const passwordLogin = await auth.handler(authRequest("/sign-in/email", {
      email: official.user.email,
      password: official.password,
      rememberMe: false,
    }));
    expect(passwordLogin.status).toBe(200);
    const setupCookie = cookieFrom(passwordLogin);
    const enrollment = await auth.api.enableTwoFactor({
      body: { password: official.password, method: "totp", issuer: "KartuRT" },
      headers: new Headers({ cookie: setupCookie }),
    });
    expect(enrollment.method).toBe("totp");
    if (enrollment.method !== "totp") throw new Error("TOTP fixture setup did not produce a TOTP method.");
    const encodedSecret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(encodedSecret).toBeTruthy();
    const secret = new TextDecoder().decode(base32.decode(encodedSecret!));
    const generated = await auth.api.generateTOTP({ body: { secret } });
    const verification = await auth.api.verifyTOTP({
      body: { code: generated.code, trustDevice: false },
      headers: new Headers({ cookie: setupCookie }),
    });
    expect("token" in verification).toBe(true);

    const challenge = await login(official.account.loginIdentifier, officialPin);
    expect(challenge.status).toBe(200);
    await expect(challenge.json()).resolves.toEqual({ twoFactorRedirect: true });
    const challengeCookie = cookieFrom(challenge);
    expect(challengeCookie).toContain("two_factor=");
    expect(challengeCookie).not.toContain("session_token=");

    const totp = await auth.handler(authRequest("/two-factor/verify-totp", {
      code: generated.code,
      trustDevice: false,
    }, nextIp(), challengeCookie));
    expect(totp.status).toBe(200);
    expect(cookieFrom(totp)).toContain("session_token=");

    const directEmailSignIn = await authCatchAllPost(authRequest("/sign-in/email", {
      email: official.user.email,
      password: official.password,
    }));
    expect(directEmailSignIn.status).toBe(403);
    expect(directEmailSignIn.headers.getSetCookie()).toEqual([]);

    const [enabled] = await testDatabase.db.select({ enabled: authUser.twoFactorEnabled })
      .from(authUser).where(eq(authUser.id, official.user.id));
    expect(enabled?.enabled).toBe(true);
    expect(await testDatabase.db.select({ id: authSession.id }).from(authSession).where(eq(authSession.userId, official.user.id))).toHaveLength(2);
  });

  it("rejects a pending official TOTP challenge after the PIN changes", async () => {
    const officialPin = nextSyntheticPin();
    const newPin = nextSyntheticPin();
    const official = await createOfficial({ identifier: `mfa-race-${randomUUID()}`, pin: officialPin, role: "treasurer" });
    const passwordLogin = await auth.handler(authRequest("/sign-in/email", {
      email: official.user.email,
      password: official.password,
      rememberMe: false,
    }));
    expect(passwordLogin.status).toBe(200);
    const setupCookie = cookieFrom(passwordLogin);
    const enrollment = await auth.api.enableTwoFactor({
      body: { password: official.password, method: "totp", issuer: "KartuRT" },
      headers: new Headers({ cookie: setupCookie }),
    });
    if (enrollment.method !== "totp") throw new Error("TOTP fixture setup did not produce a TOTP method.");
    const encodedSecret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(encodedSecret).toBeTruthy();
    const secret = new TextDecoder().decode(base32.decode(encodedSecret!));
    const generated = await auth.api.generateTOTP({ body: { secret } });
    const verification = await auth.api.verifyTOTP({
      body: { code: generated.code, trustDevice: false },
      headers: new Headers({ cookie: setupCookie }),
    });
    expect("token" in verification).toBe(true);

    const challenge = await login(official.account.loginIdentifier, officialPin);
    expect(challenge.status).toBe(200);
    const challengeCookie = cookieFrom(challenge);
    const principal = {
      authUserId: official.user.id,
      appAccountId: official.account.id,
      role: "treasurer" as const,
      rtUnitId: official.rtUnitId,
      householdId: null,
      personId: official.personId,
    };
    await changeAccountPin(testDatabase.db as unknown as AppDatabase, principal, { currentPin: officialPin, newPin });

    const staleChallenge = await auth.handler(authRequest("/two-factor/verify-totp", {
      code: generated.code,
      trustDevice: false,
    }, nextIp(), challengeCookie));
    expect(staleChallenge.status).toBe(401);
    expect(await testDatabase.db.select({ id: authSession.id }).from(authSession)
      .where(eq(authSession.userId, official.user.id))).toHaveLength(0);
  });
});
