import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import { appAccounts, billingYears, officialAssignments } from "@/db/schema";
import type { AppRole, Principal } from "@/lib/auth/permissions";
import {
  ChairmanFeeRateForbiddenError,
  ChairmanFeeRateNotFoundError,
  InvalidChairmanFeeRateInputError,
  createChairmanFeeRate,
} from "@/lib/billing/chairman-fee-rates";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type AccountStatus = "active" | "locked" | "disabled";
const businessDate = "2026-10-02";

describe("Chairman fee rate authorization and input guards", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createOfficial(options: {
    accountStatus?: AccountStatus;
    assignedRole?: "rt_chairman" | "treasurer";
    startsOn?: string;
    endsOn?: string | null;
  } = {}) {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db, "Fee rate authorization fixture");
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `official-${randomUUID()}`,
      personId: household.personId,
      status: options.accountStatus ?? "active",
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: options.assignedRole ?? "rt_chairman",
      startsOn: options.startsOn ?? "2020-01-01",
      endsOn: options.endsOn ?? null,
    });
    return {
      rtUnitId,
      principal: {
        authUserId: user.id,
        appAccountId: account!.id,
        role: "rt_chairman" as const,
        rtUnitId,
        householdId: null,
        personId: household.personId,
      } satisfies Principal,
    };
  }

  function input(overrides: Record<string, unknown> = {}): Parameters<typeof createChairmanFeeRate>[2] {
    return {
      billingYearId: randomUUID(),
      effectiveMonth: 11,
      monthlyAmount: 50000,
      idempotencyKey: randomUUID(),
      ...overrides,
    } as Parameters<typeof createChairmanFeeRate>[2];
  }

  it.each([
    ["Treasurer", "treasurer" as AppRole],
    ["Resident", "resident" as AppRole],
    ["System Admin", "system_admin" as AppRole],
  ])("denies %s even when the caller supplies a plausible RT scope", async (_label, role) => {
    const fixture = await createOfficial();
    const unauthorized: Principal = {
      ...fixture.principal,
      role,
      rtUnitId: role === "system_admin" ? null : fixture.rtUnitId,
      householdId: role === "resident" ? randomUUID() : null,
    };

    await expect(createChairmanFeeRate(database, unauthorized, input(), businessDate))
      .rejects.toBeInstanceOf(ChairmanFeeRateForbiddenError);
  });

  it.each([
    ["disabled account", { accountStatus: "disabled" as const }],
    ["locked account", { accountStatus: "locked" as const }],
    ["Treasurer assignment", { assignedRole: "treasurer" as const }],
    ["future assignment", { startsOn: "2026-10-03" }],
    ["ended assignment", { endsOn: "2026-10-01" }],
  ])("rechecks and denies a Chairman principal with a %s", async (_label, options) => {
    const fixture = await createOfficial(options);
    await expect(createChairmanFeeRate(database, fixture.principal, input(), businessDate))
      .rejects.toBeInstanceOf(ChairmanFeeRateForbiddenError);
  });

  it("hides a billing year that belongs to another RT", async () => {
    const fixture = await createOfficial();
    const otherRtUnitId = await createRt(testDatabase.db);
    const [foreignYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: otherRtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });

    await expect(createChairmanFeeRate(database, fixture.principal, input({ billingYearId: foreignYear!.id }), businessDate))
      .rejects.toBeInstanceOf(ChairmanFeeRateNotFoundError);
  });

  it.each([
    ["invalid month", { effectiveMonth: 13 }],
    ["zero amount", { monthlyAmount: 0 }],
    ["fractional amount", { monthlyAmount: 50000.5 }],
    ["amount beyond PostgreSQL integer", { monthlyAmount: 2_147_483_648 }],
    ["malformed idempotency key", { idempotencyKey: "not-a-uuid" }],
    ["unexpected service field", { extra: "not-allowed" }],
  ])("rejects %s before starting a transaction", async (_label, overrides) => {
    const fixture = await createOfficial();
    await expect(createChairmanFeeRate(
      database,
      fixture.principal,
      input(overrides),
      businessDate,
    )).rejects.toBeInstanceOf(InvalidChairmanFeeRateInputError);
  });
});
