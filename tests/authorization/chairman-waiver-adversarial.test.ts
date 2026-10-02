import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  monthlyDues,
  officialAssignments,
  waiverActions,
  waiverItems,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import {
  ChairmanWaiverForbiddenError,
  ChairmanWaiverHouseholdNotFoundError,
  ChairmanWaiverIdempotencyConflictError,
  InvalidChairmanWaiverInputError,
  createChairmanWaiver,
  searchChairmanWaiverHouseholds,
} from "@/lib/billing/chairman-waiver";
import { isSameOriginMutation } from "@/app/api/chairman/waivers/response";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
} from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type ChairmanFixture = {
  rtUnitId: string;
  householdId: string;
  principal: Principal;
};

const businessDate = "2026-10-02";
const validReason = "Pemutihan sesuai keputusan rapat RT";

describe("waiver security and adversarial inputs", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createChairmanFixture(options: {
    accountStatus?: "active" | "locked" | "disabled";
    assignmentRole?: "rt_chairman" | "treasurer";
    startsOn?: string;
    endsOn?: string | null;
  } = {}): Promise<ChairmanFixture> {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db, "Chairman security fixture");
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `chairman-${randomUUID()}`,
      personId: household.personId,
      status: options.accountStatus ?? "active",
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: options.assignmentRole ?? "rt_chairman",
      startsOn: options.startsOn ?? "2020-01-01",
      endsOn: options.endsOn ?? null,
    });
    return {
      rtUnitId,
      householdId: household.householdId,
      principal: {
        authUserId: user.id,
        appAccountId: account!.id,
        role: "rt_chairman",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
    };
  }

  function waiverInput(householdId: string, overrides: Record<string, unknown> = {}) {
    return {
      householdId,
      periods: ["2026-01"],
      reason: validReason,
      idempotencyKey: randomUUID(),
      ...overrides,
    } as Parameters<typeof createChairmanWaiver>[2];
  }

  it.each([
    ["disabled Chairman account", { accountStatus: "disabled" as const }],
    ["locked Chairman account", { accountStatus: "locked" as const }],
    ["ended Chairman assignment", { endsOn: "2026-10-01" }],
    ["future Chairman assignment", { startsOn: "2026-10-03" }],
    ["assignment with Treasurer role", { assignmentRole: "treasurer" as const }],
  ])("rejects a %s", async (_description, options) => {
    const fixture = await createChairmanFixture(options);
    await expect(createChairmanWaiver(
      database,
      fixture.principal,
      waiverInput(fixture.householdId),
      businessDate,
    )).rejects.toBeInstanceOf(ChairmanWaiverForbiddenError);
  });

  it("does not disclose whether a household exists in another RT", async () => {
    const fixture = await createChairmanFixture();
    const otherRt = await createRt(testDatabase.db);
    const foreignHousehold = await createHousehold(testDatabase.db, otherRt);
    const missingHouseholdId = randomUUID();

    const [foreignError, missingError] = await Promise.all([
      createChairmanWaiver(
        database,
        fixture.principal,
        waiverInput(foreignHousehold.householdId),
        businessDate,
      ).catch((error: unknown) => error),
      createChairmanWaiver(
        database,
        fixture.principal,
        waiverInput(missingHouseholdId),
        businessDate,
      ).catch((error: unknown) => error),
    ]);

    expect(foreignError).toBeInstanceOf(ChairmanWaiverHouseholdNotFoundError);
    expect(missingError).toBeInstanceOf(ChairmanWaiverHouseholdNotFoundError);
    expect((foreignError as Error).message).toBe("Rumah tidak ditemukan.");
    expect((missingError as Error).message).toBe("Rumah tidak ditemukan.");
    expect((foreignError as Error).message).not.toContain(foreignHousehold.householdId);
  });

  it.each([
    ["malformed household UUID", { householdId: "not-a-uuid" }],
    ["malformed idempotency UUID", { idempotencyKey: "not-a-uuid" }],
    ["noncanonical month", { periods: ["2026-1"] }],
    ["out-of-range month", { periods: ["2026-13"] }],
    ["year outside supported range", { periods: ["1999-12"] }],
    ["duplicate selected months", { periods: ["2026-01", "2026-01"] }],
    ["blank reason", { reason: "   " }],
    ["reason containing an email address", { reason: "Keputusan rapat, hubungi warga@example.test" }],
    ["reason containing a labeled PIN", { reason: "Kesepakatan rapat, PIN 123456" }],
  ])("rejects %s before database mutation", async (_description, overrides) => {
    const fixture = await createChairmanFixture();
    await expect(createChairmanWaiver(
      database,
      fixture.principal,
      waiverInput(fixture.householdId, overrides),
      businessDate,
    )).rejects.toBeInstanceOf(InvalidChairmanWaiverInputError);
  });

  it("requires a same-origin Origin header for mutation requests", () => {
    const publicUrl = "https://karturt.example/app";
    expect(isSameOriginMutation(new Request("https://karturt.example/api/chairman/waivers", {
      method: "POST",
      headers: { origin: "https://karturt.example" },
    }), publicUrl)).toBe(true);
    expect(isSameOriginMutation(new Request("https://karturt.example/api/chairman/waivers", {
      method: "POST",
    }), publicUrl)).toBe(false);
    expect(isSameOriginMutation(new Request("https://karturt.example/api/chairman/waivers", {
      method: "POST",
      headers: { origin: "https://karturt.example.attacker.test" },
    }), publicUrl)).toBe(false);
    expect(isSameOriginMutation(new Request("https://karturt.example/api/chairman/waivers", {
      method: "POST",
      headers: { origin: "not a valid origin" },
    }), publicUrl)).toBe(false);
  });

  it("treats SQL LIKE wildcard characters as literal search text", async () => {
    const fixture = await createChairmanFixture();
    const literalHousehold = await createHousehold(testDatabase.db, fixture.rtUnitId, {
      number: `W%_\\${randomUUID().slice(0, 6)}`,
    });
    await createHousehold(testDatabase.db, fixture.rtUnitId, {
      number: `WAX${randomUUID().slice(0, 6)}`,
    });

    for (const query of ["%", "_", "\\"]) {
      const results = await searchChairmanWaiverHouseholds(database, fixture.principal, query, businessDate);
      expect(results.map((household) => household.id)).toEqual([literalHousehold.householdId]);
    }
  });

  it("rejects key reuse for different periods or a different household without a second ledger entry", async () => {
    const fixture = await createChairmanFixture();
    const otherHousehold = await createHousehold(testDatabase.db, fixture.rtUnitId, {
      number: `W-OTHER-${randomUUID().slice(0, 6)}`,
    });
    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: fixture.rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [feeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId: fixture.rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    await testDatabase.db.insert(monthlyDues).values({
      rtUnitId: fixture.rtUnitId,
      householdId: fixture.householdId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      month: 1,
      amount: 40000,
      dueDate: "2026-01-10",
      status: "unpaid",
    });
    const key = randomUUID();

    await expect(createChairmanWaiver(
      database,
      fixture.principal,
      waiverInput(fixture.householdId, { idempotencyKey: key }),
      businessDate,
    )).resolves.toMatchObject({ periods: ["2026-01"], idempotentReplay: false });

    await expect(createChairmanWaiver(
      database,
      fixture.principal,
      waiverInput(fixture.householdId, { idempotencyKey: key, periods: ["2026-01", "2026-02"] }),
      businessDate,
    )).rejects.toBeInstanceOf(ChairmanWaiverIdempotencyConflictError);
    await expect(createChairmanWaiver(
      database,
      fixture.principal,
      waiverInput(otherHousehold.householdId, { idempotencyKey: key }),
      businessDate,
    )).rejects.toBeInstanceOf(ChairmanWaiverIdempotencyConflictError);

    expect(await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.waivedByAccountId, fixture.principal.appAccountId))).toHaveLength(1);
    expect(await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.householdId, fixture.householdId))).toHaveLength(1);
    expect(await testDatabase.db.select().from(auditEvents)
      .where(and(
        eq(auditEvents.actorAppAccountId, fixture.principal.appAccountId),
        eq(auditEvents.action, "waiver.created"),
      ))).toHaveLength(1);
    const dues = await testDatabase.db.select({ householdId: monthlyDues.householdId, month: monthlyDues.month, status: monthlyDues.status })
      .from(monthlyDues)
      .where(eq(monthlyDues.rtUnitId, fixture.rtUnitId));
    expect(dues.filter((due) => due.householdId === fixture.householdId && due.month === 1).map((due) => due.status)).toEqual(["waived"]);
    expect(dues.filter((due) => due.householdId === otherHousehold.householdId)).toEqual([]);
  });
});
