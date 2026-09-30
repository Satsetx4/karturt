import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appAccounts, officialAssignments } from "../../src/db/schema";
import { resolvePrincipalForUser, UnauthenticatedError } from "../../src/lib/auth/principal";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("official assignment business-date lifecycle", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  async function createOfficial(role: "treasurer" | "rt_chairman", startsOn: string, endsOn: string | null) {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const user = await createAuthUser(db);
    const [account] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: role + "-" + user.id.slice(0, 8),
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    const [assignment] = await db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account.id,
      role,
      startsOn,
      endsOn,
    }).returning({ id: officialAssignments.id });
    return { rtUnitId, accountId: account.id, userId: user.id, assignmentId: assignment.id };
  }

  it("treats the start and end dates as inclusive on the Jakarta business date", async () => {
    const active = await createOfficial("treasurer", "2026-06-01", "2026-06-15");
    await expect(resolvePrincipalForUser(testDatabase.db as never, active.userId, "2026-06-15"))
      .resolves.toMatchObject({ role: "treasurer", rtUnitId: active.rtUnitId });
    await expect(resolvePrincipalForUser(testDatabase.db as never, active.userId, "2026-06-16"))
      .rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("does not activate a scheduled future official assignment early", async () => {
    const future = await createOfficial("rt_chairman", "2026-06-16", null);
    await expect(resolvePrincipalForUser(testDatabase.db as never, future.userId, "2026-06-15"))
      .rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(resolvePrincipalForUser(testDatabase.db as never, future.userId, "2026-06-16"))
      .resolves.toMatchObject({ role: "rt_chairman" });
  });

  it("rejects overlapping active roles for one official account", async () => {
    const active = await createOfficial("treasurer", "2026-01-01", null);
    const [account] = await testDatabase.db.select({ rtUnitId: appAccounts.rtUnitId })
      .from(appAccounts).where(eq(appAccounts.id, active.accountId));
    if (!account?.rtUnitId) throw new Error("Official fixture is missing its RT.");

    await expect(testDatabase.db.insert(officialAssignments).values({
      rtUnitId: account.rtUnitId,
      appAccountId: active.accountId,
      role: "rt_chairman",
      startsOn: "2026-01-01",
    })).rejects.toThrow();
    await expect(resolvePrincipalForUser(testDatabase.db as never, active.userId, "2026-06-15"))
      .resolves.toMatchObject({ role: "treasurer" });
  });
});
