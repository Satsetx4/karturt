import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import type { AppDatabase } from "../../src/db/client";
import { appAccounts, authAccount, authUser, officialAssignments } from "../../src/db/schema";
import { createAuth } from "../../src/lib/auth/server";
import { MfaEnrollmentRequiredError, resolvePrincipalForUser } from "../../src/lib/auth/principal";
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

  it("holds System Admin outside the app until the account has enabled two-factor authentication", async () => {
    const { db } = testDatabase;
    const adminUser = await createAuthUser(db, "System Admin fixture");
    const [adminAccount] = await db.insert(appAccounts).values({
      authUserId: adminUser.id,
      accountType: "system_admin",
      loginIdentifier: `system-${randomUUID().slice(0, 8)}`,
    }).returning({ id: appAccounts.id });

    await expect(resolvePrincipalForUser(db as unknown as AppDatabase, adminUser.id)).rejects.toBeInstanceOf(MfaEnrollmentRequiredError);
    await db.update(authUser).set({ twoFactorEnabled: true }).where((await import("drizzle-orm")).eq(authUser.id, adminUser.id));
    const principal = await resolvePrincipalForUser(db as unknown as AppDatabase, adminUser.id);

    expect(principal.role).toBe("system_admin");
    expect(principal.appAccountId).toBe(adminAccount.id);
    expect(principal.rtUnitId).toBeNull();
  });
});
