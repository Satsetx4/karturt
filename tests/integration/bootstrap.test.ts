import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../src/db/client";
import {
  appAccounts,
  auditEvents,
  authAccount,
  authUser,
  billingYears,
  feeRates,
  houses,
  households,
  monthlyDues,
  officialAssignments,
  people,
  rtSettings,
  rtUnits,
} from "../../src/db/schema";
import {
  ChairmanFeeRateConflictError,
  ChairmanFeeRateForbiddenError,
  ChairmanFeeRateNotFoundError,
  createChairmanFeeRate,
  initializeFirstBillingYear,
  InvalidChairmanFeeRateInputError,
} from "../../src/lib/billing/chairman-fee-rates";
import { generateHouseholdDues } from "../../src/lib/billing/generator";
import { createHouseholdResident } from "../../src/lib/households/lifecycle";
import { hashApplicationPassword, type BetterAuthPasswordHash } from "../../src/lib/auth/password-hash";
import {
  bootstrapInitialChairman,
  bootstrapFirstOperationalRt,
  bootstrapRtUnit,
  InitialChairmanBootstrapConflictError,
  InvalidInitialChairmanBootstrapInputError,
  InitialRtBootstrapConflictError,
} from "../../src/lib/rt/bootstrap";
import { createTestDatabase } from "../helpers/database";
import { jakartaBusinessDate } from "../../src/lib/time/jakarta";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

function failOnInsert(database: AppDatabase, tableToFail: unknown): AppDatabase {
  return {
    transaction: (callback: (transaction: unknown) => Promise<unknown>) => database.transaction(async (transaction) => {
      const guarded = new Proxy(transaction, {
        get(target, property) {
          if (property === "insert") {
            return (table: unknown) => {
              if (table === tableToFail) throw new Error("injected write failure");
              return target.insert(table as never);
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return callback(guarded);
    }) as unknown as AppDatabase["transaction"],
  } as unknown as AppDatabase;
}

describe("protected empty RT bootstrap", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;
  let passwordHash: BetterAuthPasswordHash;
  let alternatePasswordHash: BetterAuthPasswordHash;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
    passwordHash = await hashApplicationPassword("synthetic-wave-six-chairman-password");
    alternatePasswordHash = await hashApplicationPassword("synthetic-wave-six-retry-password");
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createEmptyRt(code: string) {
    return bootstrapRtUnit(database, {
      code,
      rwCode: "RW-04",
      name: `RT ${code}`,
      village: "Jrebeng Wetan",
    });
  }

  async function createChairman(rtUnitId: string, loginIdentifier: string, targetDatabase = database) {
    return bootstrapInitialChairman(targetDatabase, {
      rtUnitId,
      loginIdentifier,
      displayName: `Chairman ${loginIdentifier}`,
      passwordHash,
      startsOn: "2026-01-01",
    });
  }

  it("creates one settings row and keeps RT creation repeat-safe", async () => {
    const values = { code: `RT-${randomUUID().slice(0, 8)}`, rwCode: "RW-04", name: "RT 05", village: "Jrebeng Wetan" };
    const first = await bootstrapRtUnit(database, values);
    const retry = await bootstrapRtUnit(database, values);
    const units = await testDatabase.db.select().from(rtUnits).where(eq(rtUnits.code, values.code));
    const settings = await testDatabase.db.select().from(rtSettings).where(eq(rtSettings.rtUnitId, first.id));

    expect(retry).toEqual({ id: first.id, created: false });
    expect(units).toHaveLength(1);
    expect(settings).toHaveLength(1);
    await expect(bootstrapRtUnit(database, { ...values, name: "Conflicting RT identity" }))
      .rejects.toBeInstanceOf(InitialRtBootstrapConflictError);
    expect(await testDatabase.db.select().from(rtSettings).where(eq(rtSettings.rtUnitId, first.id)))
      .toHaveLength(1);
  });

  it("serializes first-RT creation and rejects a concurrent second operational RT", async () => {
    const isolated = await createTestDatabase();
    const isolatedDatabase = isolated.db as unknown as AppDatabase;
    try {
      const suffix = randomUUID().slice(0, 8);
      const attempts = await Promise.allSettled([
        bootstrapFirstOperationalRt(isolatedDatabase, {
          code: `RT-${suffix}-A`, rwCode: "RW-04", name: "Synthetic first RT A", village: "Synthetic village",
        }),
        bootstrapFirstOperationalRt(isolatedDatabase, {
          code: `RT-${suffix}-B`, rwCode: "RW-04", name: "Synthetic first RT B", village: "Synthetic village",
        }),
      ]);
      const created = attempts.filter((attempt) => attempt.status === "fulfilled");
      const rejected = attempts.filter((attempt) => attempt.status === "rejected");
      expect(created).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ reason: expect.any(InitialRtBootstrapConflictError) });
      const units = await isolated.db.select().from(rtUnits);
      const settings = await isolated.db.select().from(rtSettings);
      expect(units).toHaveLength(1);
      expect(settings).toHaveLength(1);
      const winningValues = attempts.find((attempt) => attempt.status === "fulfilled")!;
      const winnerCode = winningValues.status === "fulfilled" ? winningValues.value.id : "";
      const sameWinner = await isolated.db.select().from(rtUnits).where(eq(rtUnits.id, winnerCode));
      const retry = await bootstrapFirstOperationalRt(isolatedDatabase, {
        code: sameWinner[0]!.code,
        rwCode: sameWinner[0]!.rwCode,
        name: sameWinner[0]!.name,
        village: sameWinner[0]!.village,
        district: sameWinner[0]!.district,
        city: sameWinner[0]!.city,
        province: sameWinner[0]!.province,
      });
      expect(retry).toEqual({ id: winnerCode, created: false });
    } finally {
      await isolated.close();
    }
  });

  it("creates the first standalone Chairman identity atomically and replays without resetting credentials", async () => {
    const { id: rtUnitId } = await createEmptyRt(`RT-${randomUUID().slice(0, 8)}`);
    const input = {
      rtUnitId,
      loginIdentifier: `chair-${randomUUID()}`,
      displayName: "Ketua RT Synthetic",
      passwordHash,
      startsOn: "2026-01-01",
    };
    const concurrent = await Promise.all([
      bootstrapInitialChairman(database, input),
      bootstrapInitialChairman(database, input),
    ]);
    const created = concurrent.find((result) => result.created)!;
    const concurrentRetry = concurrent.find((result) => !result.created)!;
    const originalCredential = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, created.authUserId));
    const replay = await bootstrapInitialChairman(database, { ...input, passwordHash: alternatePasswordHash });
    const accounts = await testDatabase.db.select().from(appAccounts).where(eq(appAccounts.rtUnitId, rtUnitId));
    const assigned = await testDatabase.db.select().from(officialAssignments)
      .where(eq(officialAssignments.appAccountId, created.appAccountId));
    const persons = await testDatabase.db.select().from(people).where(eq(people.rtUnitId, rtUnitId));
    const credentials = await testDatabase.db.select({ password: authAccount.password })
      .from(authAccount).where(eq(authAccount.userId, created.authUserId));
    const audits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "rt.initial_chairman_provisioned"),
      eq(auditEvents.entityId, created.assignmentId),
    ));

    expect(created).toMatchObject({ created: true, rtUnitId, principal: { role: "rt_chairman", householdId: null } });
    expect(replay).toMatchObject({ created: false, authUserId: created.authUserId, appAccountId: created.appAccountId });
    expect(concurrentRetry).toMatchObject({ created: false, authUserId: created.authUserId, appAccountId: created.appAccountId });
    expect(accounts).toHaveLength(1);
    expect(assigned).toHaveLength(1);
    expect(persons).toHaveLength(1);
    expect(persons[0]).toMatchObject({ householdId: null, isActive: true });
    expect(credentials).toEqual(originalCredential);
    expect(audits).toHaveLength(1);

    await expect(bootstrapInitialChairman(database, { ...input, loginIdentifier: `other-${randomUUID()}` }))
      .rejects.toBeInstanceOf(InitialChairmanBootstrapConflictError);
  });

  it("rejects an arbitrary passwordHash before any account rows are written", async () => {
    const { id: rtUnitId } = await createEmptyRt(`RT-${randomUUID().slice(0, 8)}`);
    const input = {
      rtUnitId,
      loginIdentifier: `chair-${randomUUID()}`,
      displayName: "Invalid Hash Synthetic",
      passwordHash: "$argon2id$synthetic-test-hash-only" as unknown as BetterAuthPasswordHash,
      startsOn: "2026-01-01",
    };

    await expect(bootstrapInitialChairman(database, input))
      .rejects.toBeInstanceOf(InvalidInitialChairmanBootstrapInputError);
    expect(await testDatabase.db.select().from(appAccounts).where(eq(appAccounts.rtUnitId, rtUnitId)))
      .toHaveLength(0);
  });

  it("rolls back the person and auth user when credential creation fails", async () => {
    const { id: rtUnitId } = await createEmptyRt(`RT-${randomUUID().slice(0, 8)}`);
    const beforeUsers = await testDatabase.db.select({ id: authUser.id }).from(authUser);
    const input = {
      rtUnitId,
      loginIdentifier: `chair-${randomUUID()}`,
      displayName: "Rollback Synthetic",
      passwordHash,
      startsOn: "2026-01-01",
    };

    await expect(bootstrapInitialChairman(failOnInsert(database, authAccount), input))
      .rejects.toThrow("injected write failure");

    expect(await testDatabase.db.select().from(people).where(eq(people.rtUnitId, rtUnitId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(appAccounts).where(eq(appAccounts.rtUnitId, rtUnitId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(officialAssignments).where(eq(officialAssignments.rtUnitId, rtUnitId))).toHaveLength(0);
    expect(await testDatabase.db.select({ id: authUser.id }).from(authUser)).toHaveLength(beforeUsers.length);
  });

  it("refuses a first Chairman when an RT already has housing records", async () => {
    const { id: rtUnitId } = await createEmptyRt(`RT-${randomUUID().slice(0, 8)}`);
    const [house] = await testDatabase.db.insert(houses).values({
      rtUnitId, number: `PREEXISTING-${randomUUID().slice(0, 6)}`,
    }).returning({ id: houses.id });
    await testDatabase.db.insert(households).values({ rtUnitId, houseId: house!.id, startsOn: "2026-01-01" });

    await expect(createChairman(rtUnitId, `chair-${randomUUID()}`))
      .rejects.toBeInstanceOf(InitialChairmanBootstrapConflictError);
    expect(await testDatabase.db.select().from(appAccounts).where(eq(appAccounts.rtUnitId, rtUnitId))).toHaveLength(0);
  });

  it("opens the first future billing year and January tariff atomically with auth, tenant, replay and conflict guards", async () => {
    const { id: rtUnitId } = await createEmptyRt(`RT-${randomUUID().slice(0, 8)}`);
    const chairman = await createChairman(rtUnitId, `chair-${randomUUID()}`);
    const today = jakartaBusinessDate();
    const year = Number(today.slice(0, 4)) + 1;
    const input = { year, monthlyAmount: 40_000, idempotencyKey: randomUUID() };

    await expect(initializeFirstBillingYear(database, {
      ...chairman.principal,
      role: "resident",
      householdId: randomUUID(),
    }, input, today)).rejects.toBeInstanceOf(ChairmanFeeRateForbiddenError);

    await expect(initializeFirstBillingYear(database, chairman.principal, {
      ...input,
      rtUnitId: randomUUID(),
    } as typeof input, today)).rejects.toBeInstanceOf(InvalidChairmanFeeRateInputError);
    await expect(initializeFirstBillingYear(database, chairman.principal, input, "2026-02-30"))
      .rejects.toBeInstanceOf(InvalidChairmanFeeRateInputError);

    const concurrent = await Promise.all([
      initializeFirstBillingYear(database, chairman.principal, input, today),
      initializeFirstBillingYear(database, chairman.principal, input, today),
    ]);
    const initialized = concurrent[0]!;
    expect(concurrent.filter((result) => result.idempotentReplay)).toHaveLength(1);
    const replay = await initializeFirstBillingYear(database, chairman.principal, input, today);
    expect(replay).toMatchObject({ ...initialized, idempotentReplay: true });

    await expect(initializeFirstBillingYear(database, chairman.principal, {
      ...input,
      idempotencyKey: randomUUID(),
    }, today)).rejects.toBeInstanceOf(ChairmanFeeRateConflictError);
    await expect(initializeFirstBillingYear(database, chairman.principal, {
      ...input,
      monthlyAmount: 50_000,
    }, today)).rejects.toThrow(/kunci permintaan/i);

    const otherRt = await createEmptyRt(`RT-${randomUUID().slice(0, 8)}`);
    const otherChairman = await createChairman(otherRt.id, `chair-${randomUUID()}`);
    await expect(createChairmanFeeRate(database, otherChairman.principal, {
      billingYearId: initialized.billingYearId,
      effectiveMonth: 2,
      monthlyAmount: 40_000,
      idempotencyKey: randomUUID(),
    }, today)).rejects.toBeInstanceOf(ChairmanFeeRateNotFoundError);

    const years = await testDatabase.db.select().from(billingYears).where(eq(billingYears.rtUnitId, rtUnitId));
    const rates = await testDatabase.db.select().from(feeRates).where(eq(feeRates.rtUnitId, rtUnitId));
    const rateAudits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "fee_rate.created"), eq(auditEvents.entityId, initialized.feeRateId),
    ));
    const yearAudits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "billing_year.initialized"), eq(auditEvents.entityId, initialized.billingYearId),
    ));
    expect(years).toMatchObject([{ year, status: "open" }]);
    expect(rates).toMatchObject([{ billingYearId: initialized.billingYearId, effectiveMonth: 1, monthlyAmount: 40_000 }]);
    expect(rateAudits).toHaveLength(1);
    expect(yearAudits).toHaveLength(1);
  });

  it("rolls back the first billing year if January tariff insertion fails", async () => {
    const { id: rtUnitId } = await createEmptyRt(`RT-${randomUUID().slice(0, 8)}`);
    const chairman = await createChairman(rtUnitId, `chair-${randomUUID()}`);
    const year = Number(jakartaBusinessDate().slice(0, 4)) + 1;
    const beforeYearAudits = await testDatabase.db.select({ id: auditEvents.id }).from(auditEvents)
      .where(eq(auditEvents.action, "billing_year.initialized"));

    await expect(initializeFirstBillingYear(failOnInsert(database, feeRates), chairman.principal, {
      year,
      monthlyAmount: 40_000,
      idempotencyKey: randomUUID(),
    })).rejects.toThrow("injected write failure");

    expect(await testDatabase.db.select().from(billingYears).where(eq(billingYears.rtUnitId, rtUnitId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(feeRates).where(eq(feeRates.rtUnitId, rtUnitId))).toHaveLength(0);
    expect(await testDatabase.db.select({ id: auditEvents.id }).from(auditEvents)
      .where(eq(auditEvents.action, "billing_year.initialized"))).toHaveLength(beforeYearAudits.length);
  });

  it("boots an empty RT through its first household and all 12 future unpaid dues without target-state seeding", async () => {
    const isolated = await createTestDatabase();
    const isolatedDatabase = isolated.db as unknown as AppDatabase;
    try {
      const today = jakartaBusinessDate();
      const year = Number(today.slice(0, 4)) + 1;
      const rt = await bootstrapFirstOperationalRt(isolatedDatabase, {
        code: `RT-${randomUUID().slice(0, 8)}`,
        rwCode: "RW-04",
        name: "Synthetic first RT",
        village: "Synthetic village",
      });
      const chairman = await createChairman(rt.id, `chair-${randomUUID()}`, isolatedDatabase);
      const billing = await initializeFirstBillingYear(isolatedDatabase, chairman.principal, {
        year,
        monthlyAmount: 40_000,
        idempotencyKey: randomUUID(),
      }, today);
      const household = await createHouseholdResident(isolatedDatabase, chairman.principal, {
        newHouse: { number: `A-${randomUUID().slice(0, 6)}` },
        startsOn: today,
        fullName: "Household Bootstrap Synthetic",
        initialPin: "482913",
      }, today);
      const dues = await isolated.db.select().from(monthlyDues)
        .where(and(eq(monthlyDues.rtUnitId, rt.id), eq(monthlyDues.householdId, household.householdId)))
        .orderBy(monthlyDues.month);
      const repeatedGeneration = await generateHouseholdDues(isolatedDatabase, chairman.principal, {
        householdId: household.householdId,
        billingYearId: billing.billingYearId,
      });
      const targetHouse = await isolated.db.select().from(houses).where(eq(houses.id, household.houseId));
      const targetHousehold = await isolated.db.select().from(households).where(eq(households.id, household.householdId));
      const rtPeople = await isolated.db.select().from(people).where(eq(people.rtUnitId, rt.id));

      expect(household.generatedDueCount).toBe(12);
      expect(targetHouse).toHaveLength(1);
      expect(targetHousehold).toHaveLength(1);
      expect(rtPeople).toHaveLength(2);
      expect(dues).toHaveLength(12);
      expect(dues.map((due) => due.month)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
      expect(dues.every((due) => due.status === "unpaid" && due.amount === 40_000 && due.feeRateId === billing.feeRateId)).toBe(true);
      expect(dues.every((due) => due.dueDate === `${year}-${String(due.month).padStart(2, "0")}-10` && due.dueDate > today)).toBe(true);
      expect(repeatedGeneration.insertedCount).toBe(0);
    } finally {
      await isolated.close();
    }
  });
});
