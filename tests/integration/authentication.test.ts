import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { base32 } from "@better-auth/utils/base32";
import { hashPassword } from "better-auth/crypto";
import type { AppDatabase } from "../../src/db/client";
import { appAccounts, authAccount, authUser, households, officialAssignments, people } from "../../src/db/schema";
import { createAuth } from "../../src/lib/auth/server";
import { findUniqueLoginAccount } from "../../src/lib/auth/login-account";
import { MfaEnrollmentRequiredError, resolvePrincipalForUser, UnauthenticatedError } from "../../src/lib/auth/principal";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("authentication and account-role integration", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => { testDatabase = await createTestDatabase(); });
  afterAll(async () => { if (testDatabase) await testDatabase.close(); });

  it("signs residents and officials into separate Better Auth identities with database-derived roles", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const residentHousehold = await createHousehold(db, rtUnitId, { number: "C-01" });
    const officialHousehold = await createHousehold(db, rtUnitId, { number: "C-02" });
    const residentUser = await createAuthUser(db, "Resident fixture");
    const officialUser = await createAuthUser(db, "Official fixture");
    const residentPassword = "593817";
    const officialPassword = "Treasurer fixture password";

    await db.insert(authAccount).values({ id: randomUUID(), accountId: residentUser.id, providerId: "credential", userId: residentUser.id, password: await hashPassword(residentPassword) });
    await db.insert(authAccount).values({ id: randomUUID(), accountId: officialUser.id, providerId: "credential", userId: officialUser.id, password: await hashPassword(officialPassword) });
    const [residentAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: "C-01",
      personId: residentHousehold.personId,
      householdId: residentHousehold.householdId,
    }).returning({ id: appAccounts.id });
    const [officialAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: officialUser.id,
      accountType: "official",
      loginIdentifier: "c-01",
      personId: officialHousehold.personId,
    }).returning({ id: appAccounts.id });
    await db.insert(officialAssignments).values({ rtUnitId, appAccountId: officialAccount.id, role: "treasurer", startsOn: "2020-01-01" });

    const auth = createAuth(db as unknown as AppDatabase, { secret: "test-only-secret-with-at-least-32-characters", baseURL: "http://localhost:3000" });
    const residentSignIn = await auth.api.signInEmail({ body: { email: residentUser.email, password: residentPassword } });
    const officialSignIn = await auth.api.signInEmail({ body: { email: officialUser.email, password: officialPassword } });
    const residentPrincipal = await resolvePrincipalForUser(db as unknown as AppDatabase, residentUser.id);
    const officialPrincipal = await resolvePrincipalForUser(db as unknown as AppDatabase, officialUser.id);

    expect(residentSignIn.user.id).toBe(residentUser.id);
    expect(officialSignIn.user.id).toBe(officialUser.id);
    expect(residentPrincipal.appAccountId).toBe(residentAccount.id);
    expect(residentPrincipal.role).toBe("resident");
    expect(residentPrincipal.householdId).toBe(residentHousehold.householdId);
    expect(officialPrincipal.role).toBe("treasurer");
    expect(officialPrincipal.householdId).toBeNull();
  });

  it("holds System Admin outside the app until a TOTP factor is verified", async () => {
    const { db } = testDatabase;
    const adminUser = await createAuthUser(db, "System Admin fixture");
    const [adminAccount] = await db.insert(appAccounts).values({
      authUserId: adminUser.id,
      accountType: "system_admin",
      loginIdentifier: `system-${randomUUID().slice(0, 8)}`,
    }).returning({ id: appAccounts.id });

    await expect(resolvePrincipalForUser(db as unknown as AppDatabase, adminUser.id)).rejects.toBeInstanceOf(MfaEnrollmentRequiredError);
    await db.update(authUser).set({ twoFactorEnabled: true }).where((await import("drizzle-orm")).eq(authUser.id, adminUser.id));
    await expect(resolvePrincipalForUser(db as unknown as AppDatabase, adminUser.id)).rejects.toBeInstanceOf(MfaEnrollmentRequiredError);
    expect(adminAccount.id).toBeTruthy();
  });

  it("enrolls and verifies a real System Admin TOTP factor before granting the principal", async () => {
    const { db } = testDatabase;
    const password = "system-admin-test-password";
    const adminUser = await createAuthUser(db, "System Admin TOTP fixture");
    await db.insert(authAccount).values({
      id: randomUUID(),
      accountId: adminUser.id,
      providerId: "credential",
      userId: adminUser.id,
      password: await hashPassword(password),
    });
    await db.insert(appAccounts).values({ authUserId: adminUser.id, accountType: "system_admin", loginIdentifier: `mfa-${randomUUID().slice(0, 8)}` });

    const auth = createAuth(db as unknown as AppDatabase, { secret: "totp-test-secret-with-at-least-32-characters", baseURL: "http://localhost:3000" });
    const signIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: adminUser.email, password, rememberMe: false }),
    }));
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(cookie).toContain("session_token");

    const enrollment = await auth.api.enableTwoFactor({
      body: { password, method: "totp", issuer: "KartuRT" },
      headers: new Headers({ cookie }),
    });
    expect(enrollment.method).toBe("totp");
    if (enrollment.method !== "totp") throw new Error("System Admin TOTP enrollment did not return a TOTP factor.");
    expect(enrollment.backupCodes.length).toBeGreaterThan(0);
    const encodedSecret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(encodedSecret).toBeTruthy();
    const secret = new TextDecoder().decode(base32.decode(encodedSecret!));

    await expect(resolvePrincipalForUser(db as unknown as AppDatabase, adminUser.id))
      .rejects.toBeInstanceOf(MfaEnrollmentRequiredError);
    const generated = await auth.api.generateTOTP({ body: { secret: secret! } });
    const verification = await auth.api.verifyTOTP({
      body: { code: generated.code, trustDevice: false },
      headers: new Headers({ cookie }),
    });
    expect("token" in verification).toBe(true);
    await expect(resolvePrincipalForUser(db as unknown as AppDatabase, adminUser.id)).resolves.toMatchObject({ role: "system_admin" });

    const backupCode = enrollment.backupCodes[0]!;
    const challenge = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: adminUser.email, password, rememberMe: false }),
    }));
    expect(challenge.status).toBe(200);
    const challengeCookies = challenge.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(challengeCookies).toContain("two_factor=");

    const backupVerification = await auth.handler(new Request("http://localhost:3000/api/auth/two-factor/verify-backup-code", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: challengeCookies,
      },
      body: JSON.stringify({ code: backupCode, trustDevice: false }),
    }));
    expect(backupVerification.status).toBe(200);
    await expect(resolvePrincipalForUser(db as unknown as AppDatabase, adminUser.id)).resolves.toMatchObject({ role: "system_admin" });

    const repeatedChallenge = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: adminUser.email, password, rememberMe: false }),
    }));
    const repeatedCookies = repeatedChallenge.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const reusedBackupCode = await auth.handler(new Request("http://localhost:3000/api/auth/two-factor/verify-backup-code", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: repeatedCookies,
      },
      body: JSON.stringify({ code: backupCode, trustDevice: false }),
    }));
    expect(reusedBackupCode.status).toBe(401);
  });

  it("rejects an existing resident session after the person or household becomes inactive", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const residentUser = await createAuthUser(db);
    await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `H-${randomUUID().slice(0, 6)}`,
      personId: household.personId,
      householdId: household.householdId,
    });

    await db.update(households).set({ status: "inactive", endsOn: "2026-09-25" }).where(eq(households.id, household.householdId));
    await expect(resolvePrincipalForUser(db as unknown as AppDatabase, residentUser.id)).rejects.toBeInstanceOf(UnauthenticatedError);

    await db.update(households).set({ status: "active", endsOn: null }).where(eq(households.id, household.householdId));
    await db.update(people).set({ isActive: false }).where(eq(people.id, household.personId));
    await expect(resolvePrincipalForUser(db as unknown as AppDatabase, residentUser.id)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("refuses an ambiguous resident login identifier shared by two RT units", async () => {
    const { db } = testDatabase;
    const firstRt = await createRt(db);
    const secondRt = await createRt(db);
    const firstHousehold = await createHousehold(db, firstRt, { number: "C-01" });
    const secondHousehold = await createHousehold(db, secondRt, { number: "C-01" });
    const firstUser = await createAuthUser(db);
    const secondUser = await createAuthUser(db);
    await db.insert(appAccounts).values({
      rtUnitId: firstRt,
      authUserId: firstUser.id,
      accountType: "resident",
      loginIdentifier: "C-01",
      personId: firstHousehold.personId,
      householdId: firstHousehold.householdId,
    });
    await db.insert(appAccounts).values({
      rtUnitId: secondRt,
      authUserId: secondUser.id,
      accountType: "resident",
      loginIdentifier: "C-01",
      personId: secondHousehold.personId,
      householdId: secondHousehold.householdId,
    });

    await expect(findUniqueLoginAccount(db as unknown as AppDatabase, "resident", "C-01")).resolves.toBeNull();
  });

  it("rate limits unmatched login identities through the same Better Auth guard", async () => {
    const { db } = testDatabase;
    const auth = createAuth(db as unknown as AppDatabase, { secret: "test-only-secret-with-at-least-32-characters", baseURL: "http://localhost:3000" });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "x-forwarded-for": "203.0.113.42",
        },
        body: JSON.stringify({ email: "unmatched-login@accounts.karturt.invalid", password: "invalid-password" }),
      }));
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});
