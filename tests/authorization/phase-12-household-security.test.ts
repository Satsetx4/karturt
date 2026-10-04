import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  houses,
  households,
  officialAssignments,
} from "@/db/schema";
import { createResidentAuthRecords } from "@/lib/accounts/resident-auth-records";
import type { Principal } from "@/lib/auth/permissions";
import {
  createHouseholdResident,
  deactivateHousehold,
  HouseholdConflictError,
  HouseholdForbiddenError,
  InvalidHouseholdInputError,
  listHouseholdManagement,
  replaceHouseholdResident,
  updateHouseholdResident,
} from "@/lib/households/lifecycle";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
const businessDate = "2026-10-03";
const validPin = "482913";

describe("F12 household lifecycle authorization and adversarial input", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createChairmanFixture() {
    const rtUnitId = await createRt(testDatabase.db);
    const resident = await createHousehold(testDatabase.db, rtUnitId, {
      number: `F12-${randomUUID().slice(0, 8)}`,
    });
    const user = await createAuthUser(testDatabase.db, "F12 authorization fixture");
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `chair-${randomUUID()}`,
      personId: resident.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });
    const chairman: Principal = {
      authUserId: user.id,
      appAccountId: account!.id,
      role: "rt_chairman",
      rtUnitId,
      householdId: null,
      personId: resident.personId,
    };
    return { rtUnitId, resident, chairman };
  }

  const createInput = {
    newHouse: { number: `NEW-${randomUUID().slice(0, 8)}` },
    startsOn: businessDate,
    fullName: "Penghuni Baru",
    initialPin: validPin,
  };

  it.each([
    ["Treasurer", "treasurer" as const, "00000000-0000-4000-8000-000000000001"],
    ["resident", "resident" as const, "00000000-0000-4000-8000-000000000001"],
    ["System Admin", "system_admin" as const, null],
  ])("denies %s all household management operations", async (_roleName, role, rtUnitId) => {
    const { rtUnitId: ownRt } = await createChairmanFixture();
    const principal: Principal = {
      authUserId: `auth-${role}`,
      appAccountId: `account-${role}`,
      role,
      rtUnitId: role === "system_admin" ? null : ownRt,
      householdId: role === "resident" ? "00000000-0000-4000-8000-000000000099" : null,
      personId: null,
    };
    // Keep the tuple's declared RT value referenced so each role case records
    // the intended tenant posture: System Admin has no RT, ordinary roles do.
    expect(role === "system_admin" ? principal.rtUnitId : rtUnitId).toBe(role === "system_admin" ? null : "00000000-0000-4000-8000-000000000001");
    const createPayload = { ...createInput, newHouse: { number: `DENIED-${role}-${randomUUID().slice(0, 6)}` } };

    await expect(createHouseholdResident(database, principal, createPayload, businessDate))
      .rejects.toBeInstanceOf(HouseholdForbiddenError);
    await expect(updateHouseholdResident(database, principal, {
      householdId: randomUUID(), personId: randomUUID(), fullName: "Tidak boleh",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdForbiddenError);
    await expect(deactivateHousehold(database, principal, {
      householdId: randomUUID(), effectiveMonth: "2026-10", reason: "Alasan yang valid",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdForbiddenError);
    await expect(replaceHouseholdResident(database, principal, {
      householdId: randomUUID(), effectiveMonth: "2026-11", fullName: "Tidak boleh",
      initialPin: validPin, reason: "Alasan yang valid",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdForbiddenError);
    await expect(listHouseholdManagement(database, principal, "", businessDate))
      .rejects.toBeInstanceOf(HouseholdForbiddenError);

    const deniedHouse = await testDatabase.db.select({ id: houses.id }).from(houses)
      .where(eq(houses.number, createPayload.newHouse.number));
    expect(deniedHouse).toHaveLength(0);
  });

  it("returns the same scoped not-found result for foreign and nonexistent household IDs", async () => {
    const { chairman } = await createChairmanFixture();
    const foreignRt = await createRt(testDatabase.db);
    const foreignHousehold = await createHousehold(testDatabase.db, foreignRt, {
      number: `FOREIGN-${randomUUID().slice(0, 8)}`,
    });
    const missingId = randomUUID();

    const attempts = [
      (householdId: string) => updateHouseholdResident(database, chairman, {
        householdId,
        personId: randomUUID(),
        fullName: "Tidak boleh terlihat",
      }, businessDate),
      (householdId: string) => deactivateHousehold(database, chairman, {
        householdId,
        effectiveMonth: "2026-10",
        reason: "Menguji batas cakupan RT",
      }, businessDate),
      (householdId: string) => replaceHouseholdResident(database, chairman, {
        householdId,
        effectiveMonth: "2026-11",
        fullName: "Tidak boleh terlihat",
        initialPin: validPin,
        reason: "Menguji batas cakupan RT",
      }, businessDate),
    ];
    for (const attempt of attempts) {
      const [foreignError, missingError] = await Promise.all([
        attempt(foreignHousehold.householdId).catch((error: unknown) => error),
        attempt(missingId).catch((error: unknown) => error),
      ]);
      expect(foreignError).toMatchObject({ message: "Masa huni tidak ditemukan." });
      expect(missingError).toMatchObject({ message: "Masa huni tidak ditemukan." });
      expect((foreignError as Error).message).toBe((missingError as Error).message);
      expect((foreignError as Error).message).not.toContain(foreignHousehold.householdId);
    }
    expect(await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.entityId, foreignHousehold.householdId),
      eq(auditEvents.action, "household.updated"),
    ))).toHaveLength(0);
  });

  it.each([
    ["RT scope", { rtUnitId: "00000000-0000-4000-8000-000000000001" }],
    ["lifecycle state", { status: "active" }],
    ["account type", { accountType: "official" }],
    ["financial amount", { amount: 1 }],
    ["tariff snapshot", { feeRateId: randomUUID() }],
    ["auth identity", { authUserId: "attacker-controlled" }],
    ["membership identity", { householdId: randomUUID() }],
  ])("rejects direct-service mass assignment of %s", async (_field, extra) => {
    const { chairman } = await createChairmanFixture();
    await expect(createHouseholdResident(database, chairman, {
      ...createInput,
      newHouse: { number: `BAD-${randomUUID().slice(0, 8)}` },
      ...extra,
    } as never, businessDate)).rejects.toBeInstanceOf(InvalidHouseholdInputError);
  });

  it.each([
    ["impossible calendar date", { startsOn: "2026-02-30" }],
    ["short initial PIN", { initialPin: "12345" }],
    ["non-digit initial PIN", { initialPin: "12AB56" }],
    ["empty resident name", { fullName: "   " }],
  ])("rejects malformed create input: %s", async (_description, override) => {
    const { chairman } = await createChairmanFixture();
    await expect(createHouseholdResident(database, chairman, {
      ...createInput,
      newHouse: { number: `BAD-${randomUUID().slice(0, 8)}` },
      ...override,
    }, businessDate)).rejects.toBeInstanceOf(InvalidHouseholdInputError);
  });

  it.each([
    ["invalid end month", { effectiveMonth: "2026-13", reason: "Alasan yang valid" }],
    ["empty reason", { effectiveMonth: "2026-10", reason: "   " }],
    ["overlong reason", { effectiveMonth: "2026-10", reason: "x".repeat(501) }],
  ])("rejects malformed lifecycle input: %s", async (_description, override) => {
    const { chairman, resident } = await createChairmanFixture();
    await expect(deactivateHousehold(database, chairman, {
      householdId: resident.householdId,
      ...override,
    }, businessDate)).rejects.toBeInstanceOf(InvalidHouseholdInputError);
  });

  it("serializes concurrent replacement attempts for one house to one valid lifecycle", async () => {
    const { rtUnitId, resident, chairman } = await createChairmanFixture();
    const [house] = await testDatabase.db.select({ number: houses.number }).from(houses)
      .where(eq(houses.id, resident.houseId)).limit(1);
    const residentAuth = await createResidentAuthRecords(testDatabase.db as unknown as Pick<AppDatabase, "insert">, {
      rtUnitId,
      householdId: resident.householdId,
      personId: resident.personId,
      loginIdentifier: house!.number.toUpperCase(),
      fullName: "Penghuni Lama",
      pin: "123456",
    });
    const replace = (name: string) => replaceHouseholdResident(database, chairman, {
      householdId: resident.householdId,
      effectiveMonth: "2026-11",
      fullName: name,
      initialPin: validPin,
      reason: "Pergantian penghuni sesuai keputusan keluarga",
    }, businessDate);

    const outcomes = await Promise.allSettled([
      replace("Penghuni Pengganti A"),
      replace("Penghuni Pengganti B"),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(HouseholdConflictError);

    const allForHouse = await testDatabase.db.select({ id: households.id, status: households.status })
      .from(households).where(and(eq(households.rtUnitId, rtUnitId), eq(households.houseId, resident.houseId)));
    expect(allForHouse).toHaveLength(2);
    expect(allForHouse.filter((household) => household.status === "active")).toHaveLength(1);
    expect(allForHouse.filter((household) => household.status === "inactive")).toHaveLength(1);

    const accounts = await testDatabase.db.select({ id: appAccounts.id, status: appAccounts.status })
      .from(appAccounts).where(and(
        eq(appAccounts.rtUnitId, rtUnitId),
        eq(appAccounts.accountType, "resident"),
        eq(appAccounts.personId, resident.personId),
      ));
    expect(accounts).toEqual([{ id: residentAuth.appAccountId, status: "disabled" }]);
    const replacements = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "household.resident_replaced"),
      eq(auditEvents.entityId, resident.householdId),
    ));
    expect(replacements).toHaveLength(1);
  });
});
