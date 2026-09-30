import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getResidentProfile } from "../../src/lib/billing/resident-profile";
import {
  createAuthUser,
  createHousehold,
  createRt,
  createTestDatabase,
} from "../helpers/database";
import type { Principal } from "../../src/lib/auth/permissions";
describe("resident safe profile", () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(async () => {
    await test.close();
  });
  it("returns only safe own-household fields and rejects mixed tenant or person scope", async () => {
    const rt = await createRt(test.db),
      otherRt = await createRt(test.db);
    const own = await createHousehold(test.db, rt, { number: "Own-07" }),
      other = await createHousehold(test.db, rt),
      outside = await createHousehold(test.db, otherRt);
    const user = await createAuthUser(test.db);
    const principal: Principal = {
      role: "resident",
      authUserId: user.id,
      appAccountId: "fixture",
      rtUnitId: rt,
      householdId: own.householdId,
      personId: own.personId,
    };
    const profile = await getResidentProfile(test.db as never, principal);
    expect(Object.keys(profile).sort()).toEqual([
      "houseNumber",
      "name",
      "rtName",
      "startsOn",
    ]);
    expect(profile.houseNumber).toBe("Own-07");
    await expect(
      getResidentProfile(test.db as never, {
        ...principal,
        personId: other.personId,
      }),
    ).rejects.toThrow();
    await expect(
      getResidentProfile(test.db as never, {
        ...principal,
        householdId: outside.householdId,
      }),
    ).rejects.toThrow();
    await expect(
      getResidentProfile(test.db as never, {
        ...principal,
        role: "system_admin",
      }),
    ).rejects.toThrow("Forbidden");
  });
});
