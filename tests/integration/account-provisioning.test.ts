import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { households, people } from "../../src/db/schema";
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
});
