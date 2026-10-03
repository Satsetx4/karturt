import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { appAccounts, authAccount, authUser, households, people } from "../../src/db/schema";
import { createResidentAuthRecords } from "../../src/lib/accounts/resident-auth-records";
import { resolveResidentProvisioningTarget } from "../../src/lib/accounts/resident-provisioning";
import { createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("resident account provisioning", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  it("derives the resident login identifier from the selected household's house", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId, { number: "  07-B  " });

    await expect(resolveResidentProvisioningTarget(db as never, {
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
    })).resolves.toMatchObject({
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
      loginIdentifier: "07-B",
    });
  });

  it("rejects a person from another household or RT", async () => {
    const { db } = testDatabase;
    const firstRt = await createRt(db);
    const secondRt = await createRt(db);
    const firstHousehold = await createHousehold(db, firstRt);
    const secondHousehold = await createHousehold(db, secondRt);

    await expect(resolveResidentProvisioningTarget(db as never, {
      rtUnitId: firstRt,
      householdId: firstHousehold.householdId,
      personId: secondHousehold.personId,
    })).rejects.toThrow("active person and household");
    await expect(resolveResidentProvisioningTarget(db as never, {
      rtUnitId: firstRt,
      householdId: secondHousehold.householdId,
      personId: secondHousehold.personId,
    })).rejects.toThrow("active person and household");
  });

  it("rejects inactive households and inactive people", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);

    await db.update(households).set({ status: "inactive", endsOn: "2026-09-01" }).where(eq(households.id, household.householdId));
    await expect(resolveResidentProvisioningTarget(db as never, {
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
    })).rejects.toThrow("active person and household");

    await db.update(households).set({ status: "active", endsOn: null }).where(eq(households.id, household.householdId));
    await db.update(people).set({ isActive: false }).where(eq(people.id, household.personId));
    await expect(resolveResidentProvisioningTarget(db as never, {
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
    })).rejects.toThrow("active person and household");
  });

  it("creates a resident credential inside the caller transaction and returns only account identifiers", async () => {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId, { number: "AUTH-01" });
    const result = await db.transaction((transaction) => createResidentAuthRecords(transaction as never, {
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
      loginIdentifier: " auth-01 ",
      fullName: "Test Resident",
      pin: "804216",
    }));

    expect(result).toEqual({ appAccountId: expect.any(String), authUserId: expect.any(String) });
    expect(Object.keys(result).sort()).toEqual(["appAccountId", "authUserId"]);

    const [account] = await db.select({
      authUserId: appAccounts.authUserId,
      loginIdentifier: appAccounts.loginIdentifier,
      householdId: appAccounts.householdId,
      personId: appAccounts.personId,
    }).from(appAccounts).where(eq(appAccounts.id, result.appAccountId));
    expect(account).toEqual({
      authUserId: result.authUserId,
      loginIdentifier: "AUTH-01",
      householdId: household.householdId,
      personId: household.personId,
    });

    const [user] = await db.select({ id: authUser.id, email: authUser.email })
      .from(authUser).where(eq(authUser.id, result.authUserId));
    expect(user?.email).toMatch(/^resident-[0-9a-f-]+@accounts\.karturt\.invalid$/i);
    const [credential] = await db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, result.authUserId));
    expect(credential?.password).toBeTruthy();
    expect(credential?.password).not.toBe("804216");
    await expect(verifyPassword({ hash: credential!.password!, password: "804216" })).resolves.toBe(true);
    for (const pin of ["80421", "8042167", "80a216"]) {
      await expect(createResidentAuthRecords(db as never, {
        rtUnitId,
        householdId: household.householdId,
        personId: household.personId,
        loginIdentifier: "AUTH-01",
        fullName: "Invalid PIN Resident",
        pin,
      })).rejects.toThrow("exactly six digits");
    }
  });
});
