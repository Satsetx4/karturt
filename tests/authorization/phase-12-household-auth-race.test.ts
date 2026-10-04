import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  handler: vi.fn(),
}));

vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ handler: mocks.handler }) }));

import type { AppDatabase } from "@/db/client";
import { POST as residentLogin } from "@/app/api/login/[type]/route";
import { appAccounts, authSession, houses, officialAssignments } from "@/db/schema";
import { createResidentAuthRecords } from "@/lib/accounts/resident-auth-records";
import { resolvePrincipalForUser, UnauthenticatedError } from "@/lib/auth/principal";
import { resetResidentPin } from "@/lib/auth/reset-resident-pin";
import type { Principal } from "@/lib/auth/permissions";
import { replaceHouseholdResident } from "@/lib/households/lifecycle";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
const businessDate = "2026-10-03";
const oldPin = "123456";

describe("F12 resident sign-in races with lifecycle and PIN reset", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
    mocks.getDb.mockReturnValue(database);
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(database);
  });

  async function createRaceFixture() {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId, {
      number: `RACE-${randomUUID().slice(0, 8)}`,
    });
    const chairmanUser = await createAuthUser(testDatabase.db, "F12 race Chairman");
    const [chairmanAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: chairmanUser.id,
      accountType: "official",
      loginIdentifier: `race-chair-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: chairmanAccount!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });
    const chairman: Principal = {
      authUserId: chairmanUser.id,
      appAccountId: chairmanAccount!.id,
      role: "rt_chairman",
      rtUnitId,
      householdId: null,
      personId: household.personId,
    };
    const [house] = await testDatabase.db.select({ number: houses.number }).from(houses)
      .where(eq(houses.id, household.houseId)).limit(1);
    const resident = await createResidentAuthRecords(testDatabase.db as unknown as Pick<AppDatabase, "insert">, {
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
      loginIdentifier: house!.number,
      fullName: "Penghuni Lama",
      pin: oldPin,
    });
    return { rtUnitId, household, chairman, houseNumber: house!.number, resident };
  }

  async function beginPausedSignIn(houseNumber: string, userId: string) {
    let notifyHandlerReached!: () => void;
    let releaseHandler!: () => void;
    const handlerReached = new Promise<void>((resolve) => { notifyHandlerReached = resolve; });
    const handlerRelease = new Promise<void>((resolve) => { releaseHandler = resolve; });
    mocks.handler.mockImplementation(async () => {
      // The custom login route has already checked that the resident account,
      // household, and person are active. Pause at the boundary after Better
      // Auth would have accepted the credential but before it persists session.
      notifyHandlerReached();
      await handlerRelease;
      await testDatabase.db.insert(authSession).values({
        id: randomUUID(),
        token: randomUUID(),
        userId,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      });
      return new Response(JSON.stringify({ twoFactorRedirect: false }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "session_token=race-token; Path=/; HttpOnly" },
      });
    });

    const responsePromise = residentLogin(new Request("http://localhost:3000/api/login/resident", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.22",
      },
      body: JSON.stringify({ identifier: houseNumber, password: oldPin }),
    }), { params: Promise.resolve({ type: "resident" }) });

    await handlerReached;
    return { responsePromise, releaseHandler };
  }

  async function finishPausedSignIn(
    paused: Awaited<ReturnType<typeof beginPausedSignIn>>,
  ) {
    paused.releaseHandler();
    return paused.responsePromise;
  }

  it("rejects and removes a session inserted after household replacement revokes sessions", async () => {
    const fixture = await createRaceFixture();
    const paused = await beginPausedSignIn(fixture.houseNumber, fixture.resident.authUserId);

    await replaceHouseholdResident(database, fixture.chairman, {
      householdId: fixture.household.householdId,
      effectiveMonth: "2026-11",
      fullName: "Penghuni Pengganti",
      initialPin: "654321",
      reason: "Pergantian penghuni sesuai serah terima",
    }, businessDate);
    const response = await finishPausedSignIn(paused);
    const sessions = await testDatabase.db.select().from(authSession)
      .where(eq(authSession.userId, fixture.resident.authUserId));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ message: "Data masuk belum cocok atau akun belum aktif." });
    expect(sessions).toHaveLength(0);
    await expect(resolvePrincipalForUser(database, fixture.resident.authUserId, businessDate))
      .rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects and removes a session inserted after a six-digit PIN reset", async () => {
    const fixture = await createRaceFixture();
    const paused = await beginPausedSignIn(fixture.houseNumber, fixture.resident.authUserId);

    const resetResult = await resetResidentPin(database, fixture.chairman, {
      residentAccountId: fixture.resident.appAccountId,
      pin: "654321",
      reason: "PIN direset atas permintaan Ketua RT",
    });
    const response = await finishPausedSignIn(paused);
    const sessions = await testDatabase.db.select().from(authSession)
      .where(eq(authSession.userId, fixture.resident.authUserId));

    expect(resetResult.sessionsRevoked).toBe(0);
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ message: "Data masuk belum cocok atau akun belum aktif." });
    expect(sessions).toHaveLength(0);
    // Reset leaves the household active; rejection here must come from the
    // credential-snapshot check rather than household lifecycle checks.
    await expect(resolvePrincipalForUser(database, fixture.resident.authUserId, businessDate))
      .resolves.toMatchObject({ role: "resident", householdId: fixture.household.householdId });
  });
});
