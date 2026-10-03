import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  dueAdjustments,
  feeRates,
  households,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequests,
  payments,
  people,
  waiverActions,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import {
  ChairmanAdjustmentForbiddenError,
  ChairmanAdjustmentNotFoundError,
  createChairmanAdjustment,
} from "@/lib/billing/chairman-adjustment";
import {
  ChairmanFeeRateForbiddenError,
  createChairmanFeeRate,
} from "@/lib/billing/chairman-fee-rates";
import {
  ChairmanWaiverForbiddenError,
  createChairmanWaiver,
} from "@/lib/billing/chairman-waiver";
import {
  cancelResidentPaymentRequest,
  rejectTreasurerPaymentRequest,
} from "@/lib/billing/payment-request-resolution";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { generateHouseholdDues } from "@/lib/billing/generator";
import {
  recordTreasurerCashPayment,
} from "@/lib/billing/treasurer-cash-payments";
import { reverseTreasurerPayment } from "@/lib/billing/treasurer-payment-reversal";
import {
  TreasurerPaymentRequestNotFoundError,
  verifyTreasurerPaymentRequest,
} from "@/lib/billing/treasurer-payment-verification";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
} from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type OfficialRole = "treasurer" | "rt_chairman";
type ActorFixture = { principal: Principal; accountId: string };
type Scenario = {
  rtUnitId: string;
  household: Awaited<ReturnType<typeof createHousehold>>;
  resident: ActorFixture;
  treasurer: ActorFixture;
  chairman: ActorFixture;
  billingYearId: string;
  feeRateId: string;
  dueIds: string[];
};

const businessDate = "2026-10-02";
const adjustmentReason = "Penyesuaian sesuai keputusan rapat RT";
const waiverReason = "Pemutihan sesuai keputusan rapat RT";

describe("Gate C financial actor, audit, and tenant invariants", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createResident(rtUnitId: string, household: Awaited<ReturnType<typeof createHousehold>>) {
    const user = await createAuthUser(testDatabase.db);
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id });
    return {
      accountId: account!.id,
      principal: {
        authUserId: user.id,
        appAccountId: account!.id,
        role: "resident",
        rtUnitId,
        householdId: household.householdId,
        personId: household.personId,
      } satisfies Principal,
    };
  }

  async function createOfficial(
    rtUnitId: string,
    household: Awaited<ReturnType<typeof createHousehold>>,
    role: OfficialRole,
  ): Promise<ActorFixture> {
    const user = await createAuthUser(testDatabase.db);
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `${role}-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role,
      startsOn: "2020-01-01",
    });
    return {
      accountId: account!.id,
      principal: {
        authUserId: user.id,
        appAccountId: account!.id,
        role,
        rtUnitId,
        householdId: null,
        personId: household.personId,
      } satisfies Principal,
    };
  }

  async function createScenario(months = [1, 2, 3, 4, 5, 6]): Promise<Scenario> {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);
    const resident = await createResident(rtUnitId, household);
    const chairman = await createOfficial(rtUnitId, household, "rt_chairman");
    const treasurer = await createOfficial(rtUnitId, household, "treasurer");
    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [feeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    const dues = await testDatabase.db.insert(monthlyDues).values(months.map((month) => ({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      month,
      amount: 40000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    }))).returning({ id: monthlyDues.id });
    return {
      rtUnitId,
      household,
      resident,
      treasurer,
      chairman,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      dueIds: dues.map(({ id }) => id),
    };
  }

  it("reads back one actor, entity, reason, context, and audit per exercised financial action", async () => {
    const scenario = await createScenario();

    const januaryRequest = await createResidentPaymentRequest(database, scenario.resident.principal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    await verifyTreasurerPaymentRequest(database, scenario.treasurer.principal, januaryRequest.requestCode, businessDate);

    const februaryRequest = await createResidentPaymentRequest(database, scenario.resident.principal, {
      period: "2026-02",
      idempotencyKey: randomUUID(),
    });
    const rejectionReason = "Bukti transfer belum terbaca.";
    await rejectTreasurerPaymentRequest(database, scenario.treasurer.principal, februaryRequest.requestCode, rejectionReason, businessDate);

    const marchRequest = await createResidentPaymentRequest(database, scenario.resident.principal, {
      period: "2026-03",
      idempotencyKey: randomUUID(),
    });
    await cancelResidentPaymentRequest(database, scenario.resident.principal, marchRequest.requestCode);

    const cashKey = randomUUID();
    await recordTreasurerCashPayment(database, scenario.treasurer.principal, {
      householdId: scenario.household.householdId,
      period: "2026-04",
      idempotencyKey: cashKey,
    }, businessDate);
    const [cashPayment] = await testDatabase.db.select({ id: payments.id })
      .from(payments).where(eq(payments.cashIdempotencyKey, cashKey));
    expect(cashPayment).toBeDefined();
    const reversalReason = "Pembayaran tunai dibalik setelah pemeriksaan bukti.";
    await reverseTreasurerPayment(database, scenario.treasurer.principal, {
      paymentId: cashPayment!.id,
      reason: reversalReason,
    }, businessDate);

    await testDatabase.db.update(billingYears).set({ status: "closed" })
      .where(eq(billingYears.id, scenario.billingYearId));
    const [futureYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId: scenario.rtUnitId,
      year: 2027,
      status: "open",
    }).returning({ id: billingYears.id });
    const tariff = await createChairmanFeeRate(database, scenario.chairman.principal, {
      billingYearId: futureYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 50000,
      idempotencyKey: randomUUID(),
    }, businessDate);

    const adjustment = await createChairmanAdjustment(database, scenario.chairman.principal, {
      monthlyDueId: scenario.dueIds[4]!,
      amountDelta: 10000,
      reason: adjustmentReason,
      idempotencyKey: randomUUID(),
    }, businessDate);
    const waiverKey = randomUUID();
    await createChairmanWaiver(database, scenario.chairman.principal, {
      householdId: scenario.household.householdId,
      periods: ["2026-06"],
      reason: waiverReason,
      idempotencyKey: waiverKey,
    }, businessDate);

    const requestRows = await testDatabase.db.select({ id: paymentRequests.id, requestCode: paymentRequests.requestCode })
      .from(paymentRequests)
      .where(inArray(paymentRequests.requestCode, [
        januaryRequest.requestCode,
        februaryRequest.requestCode,
        marchRequest.requestCode,
      ]));
    const requestId = (code: string) => requestRows.find((row) => row.requestCode === code)!.id;
    const [waiver] = await testDatabase.db.select({ id: waiverActions.id })
      .from(waiverActions).where(eq(waiverActions.idempotencyKey, waiverKey));

    const expectedAudits = [
      {
        action: "payment_request.created",
        entityType: "payment_request",
        entityId: requestId(januaryRequest.requestCode),
        actorAppAccountId: scenario.resident.accountId,
        reason: null,
        context: { periods: "2026-01", totalAmount: 40000, itemCount: 1 },
      },
      {
        action: "payment_request.verified",
        entityType: "payment_request",
        entityId: requestId(januaryRequest.requestCode),
        actorAppAccountId: scenario.treasurer.accountId,
        reason: null,
        context: { itemCount: 1, totalAmount: 40000 },
      },
      {
        action: "payment_request.created",
        entityType: "payment_request",
        entityId: requestId(februaryRequest.requestCode),
        actorAppAccountId: scenario.resident.accountId,
        reason: null,
        context: { periods: "2026-02", totalAmount: 40000, itemCount: 1 },
      },
      {
        action: "payment_request.rejected",
        entityType: "payment_request",
        entityId: requestId(februaryRequest.requestCode),
        actorAppAccountId: scenario.treasurer.accountId,
        reason: rejectionReason,
        context: { itemCount: 1, totalAmount: 40000 },
      },
      {
        action: "payment_request.created",
        entityType: "payment_request",
        entityId: requestId(marchRequest.requestCode),
        actorAppAccountId: scenario.resident.accountId,
        reason: null,
        context: { periods: "2026-02,2026-03", totalAmount: 80000, itemCount: 2 },
      },
      {
        action: "payment_request.cancelled",
        entityType: "payment_request",
        entityId: requestId(marchRequest.requestCode),
        actorAppAccountId: scenario.resident.accountId,
        reason: null,
        context: { itemCount: 2, totalAmount: 80000 },
      },
      {
        action: "payment.cash_recorded",
        entityType: "payment",
        entityId: cashPayment!.id,
        actorAppAccountId: scenario.treasurer.accountId,
        reason: null,
        context: { itemCount: 3, method: "cash", totalAmount: 120000 },
      },
      {
        action: "payment.reversed",
        entityType: "payment",
        entityId: cashPayment!.id,
        actorAppAccountId: scenario.treasurer.accountId,
        reason: reversalReason,
        context: { itemCount: 3, method: "cash", totalAmount: 120000 },
      },
      {
        action: "fee_rate.created",
        entityType: "fee_rate",
        entityId: tariff.id,
        actorAppAccountId: scenario.chairman.accountId,
        reason: null,
        context: { period: "2027-01", monthlyAmount: 50000 },
      },
      {
        action: "billing.adjustment_created",
        entityType: "due_adjustment",
        entityId: adjustment.id,
        actorAppAccountId: scenario.chairman.accountId,
        reason: adjustmentReason,
        context: { amountDelta: 10000, effectiveTargetAfter: 50000, originalAmount: 40000 },
      },
      {
        action: "waiver.created",
        entityType: "waiver_action",
        entityId: waiver!.id,
        actorAppAccountId: scenario.chairman.accountId,
        reason: waiverReason,
        context: { itemCount: 1, periods: "2026-06", totalAmount: 40000 },
      },
    ];
    const actualAudits = await testDatabase.db.select().from(auditEvents)
      .where(inArray(auditEvents.entityId, [...new Set(expectedAudits.map((event) => event.entityId))]));

    expect(actualAudits).toHaveLength(expectedAudits.length);
    for (const expected of expectedAudits) {
      const matching = actualAudits.filter((audit) => audit.action === expected.action && audit.entityId === expected.entityId);
      expect(matching, `${expected.action} for ${expected.entityType} ${expected.entityId}`).toHaveLength(1);
      expect(matching[0]).toMatchObject(expected);
    }
  });

  it("rejects role and actor-account scope substitution without creating financial rows or System Admin audits", async () => {
    const target = await createScenario([1, 2]);
    const foreign = await createScenario([1, 2]);
    const cashHousehold = await createHousehold(testDatabase.db, target.rtUnitId);
    const cashResident = await createResident(target.rtUnitId, cashHousehold);
    await testDatabase.db.insert(monthlyDues).values([1, 2].map((month) => ({
      rtUnitId: target.rtUnitId,
      householdId: cashHousehold.householdId,
      billingYearId: target.billingYearId,
      feeRateId: target.feeRateId,
      month,
      amount: 40000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    })));

    const request = await createResidentPaymentRequest(database, target.resident.principal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    const cashKey = randomUUID();
    await recordTreasurerCashPayment(database, target.treasurer.principal, {
      householdId: cashHousehold.householdId,
      period: "2026-01",
      idempotencyKey: cashKey,
    }, businessDate);
    const [cashPayment] = await testDatabase.db.select({ id: payments.id })
      .from(payments).where(eq(payments.cashIdempotencyKey, cashKey));
    const targetFebruaryDueId = target.dueIds[1]!;

    const systemAdminUser = await createAuthUser(testDatabase.db);
    const [systemAdminAccount] = await testDatabase.db.insert(appAccounts).values({
      authUserId: systemAdminUser.id,
      accountType: "system_admin",
      loginIdentifier: `system-admin-${randomUUID()}`,
    }).returning({ id: appAccounts.id });
    const systemAdmin: Principal = {
      authUserId: systemAdminUser.id,
      appAccountId: systemAdminAccount!.id,
      role: "system_admin",
      rtUnitId: null,
      householdId: null,
      personId: null,
    };

    await testDatabase.db.update(billingYears).set({ status: "closed" })
      .where(eq(billingYears.id, target.billingYearId));
    const futureYearId = (await testDatabase.db.insert(billingYears).values({
      rtUnitId: target.rtUnitId,
      year: 2027,
      status: "open",
    }).returning({ id: billingYears.id }))[0]!.id;
    const feeInput = {
      billingYearId: futureYearId,
      effectiveMonth: 1,
      monthlyAmount: 50000,
      idempotencyKey: randomUUID(),
    };
    const adjustmentInput = {
      monthlyDueId: targetFebruaryDueId,
      amountDelta: 10000,
      reason: adjustmentReason,
      idempotencyKey: randomUUID(),
    };
    const waiverInput = {
      householdId: target.household.householdId,
      periods: ["2026-02"],
      reason: waiverReason,
      idempotencyKey: randomUUID(),
    };

    await expect(verifyTreasurerPaymentRequest(database, target.chairman.principal, request.requestCode, businessDate))
      .rejects.toThrow(/Forbidden/);
    await expect(recordTreasurerCashPayment(database, target.chairman.principal, {
      householdId: cashHousehold.householdId,
      period: "2026-02",
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toThrow(/Forbidden/);
    await expect(reverseTreasurerPayment(database, target.chairman.principal, {
      paymentId: cashPayment!.id,
      reason: "Ketua RT tidak boleh membalik pembayaran",
    }, businessDate)).rejects.toThrow(/Forbidden/);

    await expect(createChairmanWaiver(database, target.treasurer.principal, waiverInput, businessDate))
      .rejects.toBeInstanceOf(ChairmanWaiverForbiddenError);
    await expect(createChairmanFeeRate(database, target.treasurer.principal, feeInput, businessDate))
      .rejects.toBeInstanceOf(ChairmanFeeRateForbiddenError);
    await expect(createChairmanAdjustment(database, target.treasurer.principal, adjustmentInput, businessDate))
      .rejects.toBeInstanceOf(ChairmanAdjustmentForbiddenError);

    const wrongTreasurerAccount: Principal = {
      ...target.treasurer.principal,
      appAccountId: foreign.treasurer.accountId,
    };
    const wrongChairmanAccount: Principal = {
      ...target.chairman.principal,
      appAccountId: foreign.chairman.accountId,
    };
    await expect(verifyTreasurerPaymentRequest(database, wrongTreasurerAccount, request.requestCode, businessDate))
      .rejects.toThrow(/Forbidden/);
    await expect(createChairmanAdjustment(database, wrongChairmanAccount, adjustmentInput, businessDate))
      .rejects.toBeInstanceOf(ChairmanAdjustmentForbiddenError);

    await expect(verifyTreasurerPaymentRequest(database, foreign.treasurer.principal, request.requestCode, businessDate))
      .rejects.toBeInstanceOf(TreasurerPaymentRequestNotFoundError);
    await expect(createChairmanAdjustment(database, foreign.chairman.principal, adjustmentInput, businessDate))
      .rejects.toBeInstanceOf(ChairmanAdjustmentNotFoundError);

    const substitutedResident: Principal = {
      ...target.resident.principal,
      householdId: cashHousehold.householdId,
      personId: cashResident.principal.personId,
    };
    await expect(createResidentPaymentRequest(database, substitutedResident, {
      period: "2026-02",
      idempotencyKey: randomUUID(),
    })).rejects.toThrow();

    await expect(verifyTreasurerPaymentRequest(database, systemAdmin, request.requestCode, businessDate))
      .rejects.toThrow(/Forbidden/);
    await expect(rejectTreasurerPaymentRequest(database, systemAdmin, request.requestCode, "Tidak berwenang", businessDate))
      .rejects.toThrow(/Forbidden/);
    await expect(cancelResidentPaymentRequest(database, systemAdmin, request.requestCode))
      .rejects.toThrow(/Forbidden/);
    await expect(createResidentPaymentRequest(database, systemAdmin, {
      period: "2026-02",
      idempotencyKey: randomUUID(),
    })).rejects.toThrow(/Forbidden/);
    await expect(recordTreasurerCashPayment(database, systemAdmin, {
      householdId: cashHousehold.householdId,
      period: "2026-02",
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toThrow(/Forbidden/);
    await expect(reverseTreasurerPayment(database, systemAdmin, {
      paymentId: cashPayment!.id,
      reason: "System Admin tidak menjadi aktor keuangan",
    }, businessDate)).rejects.toThrow(/Forbidden/);
    await expect(createChairmanWaiver(database, systemAdmin, waiverInput, businessDate))
      .rejects.toBeInstanceOf(ChairmanWaiverForbiddenError);
    await expect(createChairmanFeeRate(database, systemAdmin, feeInput, businessDate))
      .rejects.toBeInstanceOf(ChairmanFeeRateForbiddenError);
    await expect(createChairmanAdjustment(database, systemAdmin, adjustmentInput, businessDate))
      .rejects.toBeInstanceOf(ChairmanAdjustmentForbiddenError);

    const targetRequests = await testDatabase.db.select({ id: paymentRequests.id })
      .from(paymentRequests).where(eq(paymentRequests.householdId, target.household.householdId));
    const targetFebruaryAdjustments = await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, targetFebruaryDueId));
    const targetPayments = await testDatabase.db.select().from(payments)
      .where(eq(payments.householdId, target.household.householdId));
    const systemAdminAudits = await testDatabase.db.select().from(auditEvents)
      .where(eq(auditEvents.actorAppAccountId, systemAdminAccount!.id));
    const februaryDue = (await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, targetFebruaryDueId)))[0];

    expect(targetRequests).toHaveLength(1);
    expect(targetPayments).toHaveLength(0);
    expect(targetFebruaryAdjustments).toHaveLength(0);
    expect(februaryDue?.status).toBe("unpaid");
    expect(systemAdminAudits).toHaveLength(0);
    expect(await testDatabase.db.select().from(feeRates)
      .where(and(eq(feeRates.rtUnitId, target.rtUnitId), eq(feeRates.billingYearId, futureYearId)))).toHaveLength(0);
    expect(await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.idempotencyKey, waiverInput.idempotencyKey))).toHaveLength(0);
    expect(await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, cashPayment!.id))).toHaveLength(1);
  });

  it("keeps an ended household's arrears and receipt allocation with that household after turnover", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const officialHousehold = await createHousehold(testDatabase.db, rtUnitId);
    const chairman = await createOfficial(rtUnitId, officialHousehold, "rt_chairman");
    const treasurer = await createOfficial(rtUnitId, officialHousehold, "treasurer");
    const oldHousehold = await createHousehold(testDatabase.db, rtUnitId, { number: `TURN-${randomUUID().slice(0, 7)}` });
    const [oldResidentAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: (await createAuthUser(testDatabase.db)).id,
      accountType: "resident",
      loginIdentifier: `old-resident-${randomUUID()}`,
      personId: oldHousehold.personId,
      householdId: oldHousehold.householdId,
    }).returning({ id: appAccounts.id });

    const [oldYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2025,
      status: "open",
    }).returning({ id: billingYears.id });
    const [oldRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: oldYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    const oldDues = await testDatabase.db.insert(monthlyDues).values([11, 12].map((month) => ({
      rtUnitId,
      householdId: oldHousehold.householdId,
      billingYearId: oldYear!.id,
      feeRateId: oldRate!.id,
      month,
      amount: 40000,
      dueDate: `2025-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    }))).returning({ id: monthlyDues.id, month: monthlyDues.month });

    const novemberPaymentKey = randomUUID();
    await recordTreasurerCashPayment(database, treasurer.principal, {
      householdId: oldHousehold.householdId,
      period: "2025-11",
      idempotencyKey: novemberPaymentKey,
    }, "2025-11-30");
    const [oldPayment] = await testDatabase.db.select().from(payments)
      .where(eq(payments.cashIdempotencyKey, novemberPaymentKey));
    expect(oldPayment).toBeDefined();

    await testDatabase.db.update(households).set({ status: "inactive", endsOn: "2025-12-31" })
      .where(eq(households.id, oldHousehold.householdId));
    await testDatabase.db.update(people).set({ isActive: false }).where(eq(people.id, oldHousehold.personId));
    await testDatabase.db.update(appAccounts).set({ status: "disabled" })
      .where(eq(appAccounts.id, oldResidentAccount!.id));
    const [successorHousehold] = await testDatabase.db.insert(households).values({
      rtUnitId,
      houseId: oldHousehold.houseId,
      startsOn: "2026-01-01",
      status: "active",
    }).returning({ id: households.id });
    const [successorPerson] = await testDatabase.db.insert(people).values({
      rtUnitId,
      householdId: successorHousehold!.id,
      fullName: `Successor ${randomUUID().slice(0, 7)}`,
    }).returning({ id: people.id });
    await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: (await createAuthUser(testDatabase.db)).id,
      accountType: "resident",
      loginIdentifier: `successor-${randomUUID()}`,
      personId: successorPerson!.id,
      householdId: successorHousehold!.id,
    });

    await testDatabase.db.update(billingYears).set({ status: "closed" }).where(eq(billingYears.id, oldYear!.id));
    const [successorYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: successorYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 45000,
    });
    await generateHouseholdDues(database, chairman.principal, {
      householdId: successorHousehold!.id,
      billingYearId: successorYear!.id,
    });

    const oldDueIds = oldDues.map(({ id }) => id);
    const oldRowsAfter = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, oldDueIds));
    const oldAllocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, oldPayment!.id));
    const successorDues = await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.householdId, successorHousehold!.id));
    const oldDecember = oldRowsAfter.find((due) => due.month === 12);
    const successorJanuary = successorDues.find((due) => due.month === 1);

    expect(oldRowsAfter).toHaveLength(2);
    expect(oldRowsAfter.every((due) => due.householdId === oldHousehold.householdId)).toBe(true);
    expect(oldDecember).toMatchObject({ householdId: oldHousehold.householdId, amount: 40000, status: "unpaid" });
    expect(oldPayment).toMatchObject({ householdId: oldHousehold.householdId, amount: 40000 });
    expect(oldAllocations).toHaveLength(1);
    expect(oldAllocations[0]).toMatchObject({ householdId: oldHousehold.householdId, monthlyDueId: oldDues[0]!.id, amount: 40000 });
    expect(successorDues).toHaveLength(12);
    expect(successorDues.every((due) => due.householdId === successorHousehold!.id)).toBe(true);
    expect(successorJanuary).toMatchObject({ householdId: successorHousehold!.id, amount: 45000, status: "unpaid" });
    expect(successorDues.some((due) => due.billingYearId === oldYear!.id)).toBe(false);
  });
});
