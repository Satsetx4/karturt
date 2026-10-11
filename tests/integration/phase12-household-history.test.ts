import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  dueAdjustments,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  paymentReversals,
  payments,
  people,
  waiverActions,
  waiverItems,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createResidentAuthRecords } from "@/lib/accounts/resident-auth-records";
import { resolveResidentProvisioningTarget } from "@/lib/accounts/resident-provisioning";
import { createChairmanAdjustment } from "@/lib/billing/chairman-adjustment";
import { createChairmanWaiver } from "@/lib/billing/chairman-waiver";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { getResidentPaymentHistory } from "@/lib/billing/payment-history";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { reverseTreasurerPayment } from "@/lib/billing/treasurer-payment-reversal";
import { getTreasurerPaymentRequestQueue } from "@/lib/billing/treasurer-payment-requests";
import { verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import {
  HouseholdConflictError,
  deactivateHousehold,
  listHouseholdManagement,
  replaceHouseholdResident,
} from "@/lib/households/lifecycle";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
  ensureTestChairman,
} from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type Scenario = {
  rtUnitId: string;
  chairman: Principal;
  treasurer: Principal;
  household: { houseId: string; householdId: string; personId: string };
  billingYearId: string;
  januaryRateId: string;
  julyRateId: string;
  dueIds: Map<number, string>;
  residentRecords: { appAccountId: string; authUserId: string } | null;
  residentPrincipal: Principal | null;
};

const businessDate = "2026-10-03";
const initialPin = "804216";

describe("Phase 12 household financial history safeguards", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createOfficialPrincipal(rtUnitId: string, role: "rt_chairman" | "treasurer"): Promise<Principal> {
    if (role === "rt_chairman") {
      const accountId = await ensureTestChairman(testDatabase.db, rtUnitId);
      const [account] = await testDatabase.db.select({
        authUserId: appAccounts.authUserId,
        personId: appAccounts.personId,
      }).from(appAccounts).where(eq(appAccounts.id, accountId));
      return {
        authUserId: account!.authUserId,
        appAccountId: accountId,
        role,
        rtUnitId,
        householdId: null,
        personId: account!.personId,
      };
    }

    const officialHousehold = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db, "Treasurer history fixture");
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `history-treasurer-${randomUUID()}`,
      personId: officialHousehold.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role,
      startsOn: "2020-01-01",
    });
    return {
      authUserId: user.id,
      appAccountId: account!.id,
      role,
      rtUnitId,
      householdId: null,
      personId: officialHousehold.personId,
    };
  }

  async function addResident(household: { householdId: string; personId: string }, rtUnitId: string, fullName = "Original Resident") {
    const target = await resolveResidentProvisioningTarget(testDatabase.db as never, {
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
    });
    return database.transaction((transaction) => createResidentAuthRecords(transaction as never, {
      ...target,
      fullName,
      pin: initialPin,
    }));
  }

  async function createScenario(options: { resident?: boolean } = {}) {
    const rtUnitId = await createRt(testDatabase.db);
    const chairman = await createOfficialPrincipal(rtUnitId, "rt_chairman");
    const treasurer = await createOfficialPrincipal(rtUnitId, "treasurer");
    const household = await createHousehold(testDatabase.db, rtUnitId, {
      number: `H-${randomUUID().slice(0, 8).toUpperCase()}`,
      startsOn: "2020-01-01",
    });
    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [januaryRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 40_000,
    });
    const [julyRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 7,
      monthlyAmount: 50_000,
    });
    const insertedDues = await testDatabase.db.insert(monthlyDues).values(
      Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        return {
          rtUnitId,
          householdId: household.householdId,
          billingYearId: billingYear!.id,
          feeRateId: month < 7 ? januaryRate!.id : julyRate!.id,
          month,
          amount: month < 7 ? 40_000 : 50_000,
          dueDate: `2026-${String(month).padStart(2, "0")}-10`,
          status: "unpaid" as const,
        };
      }),
    ).returning({ id: monthlyDues.id, month: monthlyDues.month });
    const dueIds = new Map(insertedDues.map((due) => [due.month, due.id]));
    const residentRecords = options.resident ? await addResident(household, rtUnitId) : null;
    const residentPrincipal: Principal | null = residentRecords
      ? {
        authUserId: residentRecords.authUserId,
        appAccountId: residentRecords.appAccountId,
        role: "resident",
        rtUnitId,
        householdId: household.householdId,
        personId: household.personId,
      }
      : null;

    return {
      rtUnitId,
      chairman,
      treasurer,
      household,
      billingYearId: billingYear!.id,
      januaryRateId: januaryRate!.id,
      julyRateId: julyRate!.id,
      dueIds,
      residentRecords,
      residentPrincipal,
    };
  }

  async function dueRows(scenario: Scenario) {
    return testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.householdId, scenario.household.householdId))
      .orderBy(monthlyDues.month);
  }

  it("moves only untouched future unpaid dues to NOT_DUE and leaves arrears unwaived", async () => {
    const scenario = await createScenario();
    const before = await dueRows(scenario);

    const result = await deactivateHousehold(database, scenario.chairman, {
      householdId: scenario.household.householdId,
      effectiveMonth: "2026-10",
      reason: "Household ended after the October billing period.",
    }, businessDate);

    const after = await dueRows(scenario);
    expect(result).toMatchObject({ effectiveDate: "2026-10-31", transitionedDueCount: 2 });
    expect(after.slice(0, 10)).toEqual(before.slice(0, 10));
    expect(after.slice(10).map(({ status, amount, feeRateId, waivedReason }) => ({ status, amount, feeRateId, waivedReason })))
      .toEqual([
        { status: "not_due", amount: 0, feeRateId: null, waivedReason: null },
        { status: "not_due", amount: 0, feeRateId: null, waivedReason: null },
      ]);
    expect(after.slice(0, 10).every((due) => due.status === "unpaid" && due.amount > 0)).toBe(true);
    await expect(testDatabase.db.select().from(waiverItems)
      .where(inArray(waiverItems.monthlyDueId, after.map((due) => due.id))))
      .resolves.toHaveLength(0);
  });

  it("blocks end-date reconciliation when a post-end payment request item and claim exist", async () => {
    const scenario = await createScenario({ resident: true });
    const request = await createResidentPaymentRequest(database, scenario.residentPrincipal!, {
      period: "2026-11",
      idempotencyKey: randomUUID(),
    }, "2026-11-01");
    const dueBefore = await dueRows(scenario);

    await expect(deactivateHousehold(database, scenario.chairman, {
      householdId: scenario.household.householdId,
      effectiveMonth: "2026-10",
      reason: "Close after October despite a November request.",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdConflictError);

    const novemberDueId = scenario.dueIds.get(11)!;
    const [requestRow] = await testDatabase.db.select({ id: paymentRequests.id })
      .from(paymentRequests).where(eq(paymentRequests.requestCode, request.requestCode));
    expect(requestRow).toBeDefined();
    await expect(testDatabase.db.select().from(paymentRequestItems).where(and(
      eq(paymentRequestItems.requestId, requestRow!.id),
      eq(paymentRequestItems.monthlyDueId, novemberDueId),
    ))).resolves.toHaveLength(1);
    await expect(testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.monthlyDueId, novemberDueId))).resolves.toHaveLength(1);
    const dueAfter = await dueRows(scenario);
    expect(dueAfter).toEqual(dueBefore);
  });

  it("blocks a post-end due with an active allocation and preserves its paid status", async () => {
    const scenario = await createScenario({ resident: true });
    const request = await createResidentPaymentRequest(database, scenario.residentPrincipal!, {
      period: "2026-11",
      idempotencyKey: randomUUID(),
    }, "2026-11-01");
    await verifyTreasurerPaymentRequest(database, scenario.treasurer, request.requestCode, "2026-11-01");
    const novemberDueId = scenario.dueIds.get(11)!;
    const [payment] = await testDatabase.db.select({ id: payments.id })
      .from(payments).innerJoin(paymentRequests, eq(paymentRequests.id, payments.paymentRequestId))
      .where(eq(paymentRequests.requestCode, request.requestCode));

    await expect(deactivateHousehold(database, scenario.chairman, {
      householdId: scenario.household.householdId,
      effectiveMonth: "2026-10",
      reason: "Close after October while November has a payment.",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdConflictError);

    const [due] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, novemberDueId));
    expect(due).toMatchObject({ status: "paid", amount: 50_000, feeRateId: scenario.julyRateId });
    await expect(testDatabase.db.select().from(paymentAllocations).where(and(
      eq(paymentAllocations.monthlyDueId, novemberDueId),
      eq(paymentAllocations.paymentId, payment!.id),
    ))).resolves.toHaveLength(1);
  });

  it("blocks a post-end due with a reversed allocation and retains allocation and reversal history", async () => {
    const scenario = await createScenario({ resident: true });
    const request = await createResidentPaymentRequest(database, scenario.residentPrincipal!, {
      period: "2026-11",
      idempotencyKey: randomUUID(),
    }, "2026-11-01");
    await verifyTreasurerPaymentRequest(database, scenario.treasurer, request.requestCode, "2026-11-01");
    const [payment] = await testDatabase.db.select({ id: payments.id })
      .from(payments).innerJoin(paymentRequests, eq(paymentRequests.id, payments.paymentRequestId))
      .where(eq(paymentRequests.requestCode, request.requestCode));
    await reverseTreasurerPayment(database, scenario.treasurer, {
      paymentId: payment!.id,
      reason: "Reverse the test payment while retaining ledger history.",
    }, "2026-11-01");
    const novemberDueId = scenario.dueIds.get(11)!;

    await expect(deactivateHousehold(database, scenario.chairman, {
      householdId: scenario.household.householdId,
      effectiveMonth: "2026-10",
      reason: "Close after October with reversed November allocation history.",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdConflictError);

    const [due] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, novemberDueId));
    expect(due).toMatchObject({ status: "unpaid", amount: 50_000, feeRateId: scenario.julyRateId });
    await expect(testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.monthlyDueId, novemberDueId))).resolves.toHaveLength(1);
    await expect(testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, payment!.id))).resolves.toHaveLength(1);
  });

  it("blocks reconciliation when a post-end due has waiver history", async () => {
    const scenario = await createScenario();
    await createChairmanWaiver(database, scenario.chairman, {
      householdId: scenario.household.householdId,
      periods: ["2026-11"],
      reason: "Approved waiver fixture for lifecycle protection.",
      idempotencyKey: randomUUID(),
    }, businessDate);
    const novemberDueId = scenario.dueIds.get(11)!;
    const [waiverBefore] = await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.monthlyDueId, novemberDueId));

    await expect(deactivateHousehold(database, scenario.chairman, {
      householdId: scenario.household.householdId,
      effectiveMonth: "2026-10",
      reason: "Close after October with November waiver history.",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdConflictError);

    const [due] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, novemberDueId));
    const [waiverAfter] = await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.monthlyDueId, novemberDueId));
    expect(due).toMatchObject({ status: "waived", amount: 50_000, feeRateId: scenario.julyRateId });
    expect(waiverAfter).toEqual(waiverBefore);
    expect(waiverBefore!.waiverActionId).toBeTruthy();
  });

  it("blocks reconciliation when a post-end due has adjustment history", async () => {
    const scenario = await createScenario();
    const novemberDueId = scenario.dueIds.get(11)!;
    const adjustment = await createChairmanAdjustment(database, scenario.chairman, {
      monthlyDueId: novemberDueId,
      amountDelta: 1_000,
      reason: "Approved test adjustment before household closure.",
      idempotencyKey: randomUUID(),
    }, businessDate);
    const [dueBefore] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, novemberDueId));
    const [adjustmentBefore] = await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.id, adjustment.id));

    await expect(deactivateHousehold(database, scenario.chairman, {
      householdId: scenario.household.householdId,
      effectiveMonth: "2026-10",
      reason: "Close after October with November adjustment history.",
    }, businessDate)).rejects.toBeInstanceOf(HouseholdConflictError);

    const [dueAfter] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, novemberDueId));
    const [adjustmentAfter] = await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.id, adjustment.id));
    expect(dueAfter).toEqual(dueBefore);
    expect(adjustmentAfter).toEqual(adjustmentBefore);
    expect(dueAfter).toMatchObject({ status: "unpaid", amount: 50_000, feeRateId: scenario.julyRateId });
  });

  it("replaces the resident without moving arrears or ledger history and scopes new reads to the new household", async () => {
    const scenario = await createScenario({ resident: true });
    const originalResident = scenario.residentRecords!;
    const oldPrincipal = scenario.residentPrincipal!;

    const januaryRequest = await createResidentPaymentRequest(database, oldPrincipal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    await verifyTreasurerPaymentRequest(database, scenario.treasurer, januaryRequest.requestCode, businessDate);
    const [januaryPayment] = await testDatabase.db.select({ id: payments.id })
      .from(payments).innerJoin(paymentRequests, eq(paymentRequests.id, payments.paymentRequestId))
      .where(eq(paymentRequests.requestCode, januaryRequest.requestCode));
    await reverseTreasurerPayment(database, scenario.treasurer, {
      paymentId: januaryPayment!.id,
      reason: "Reverse the original resident payment to retain unpaid arrears.",
    }, businessDate);

    const januaryAdjustment = await createChairmanAdjustment(database, scenario.chairman, {
      monthlyDueId: scenario.dueIds.get(1)!,
      amountDelta: 1_000,
      reason: "Approved original-household arrears adjustment.",
      idempotencyKey: randomUUID(),
    }, businessDate);
    const waiverKey = randomUUID();
    await createChairmanWaiver(database, scenario.chairman, {
      householdId: scenario.household.householdId,
      periods: ["2026-02"],
      reason: "Approved original-household waiver history.",
      idempotencyKey: waiverKey,
    }, businessDate);
    const [oldWaiverAction] = await testDatabase.db.select({ id: waiverActions.id })
      .from(waiverActions).where(eq(waiverActions.idempotencyKey, waiverKey));

    const oldPendingRequest = await createResidentPaymentRequest(database, oldPrincipal, {
      period: "2026-10",
      idempotencyKey: randomUUID(),
    });
    const oldRequestRow = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, oldPendingRequest.requestCode));
    const januaryRequestRow = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, januaryRequest.requestCode));
    const oldRequestIds = [...januaryRequestRow, ...oldRequestRow].map(({ id }) => id);
    const oldDueIds = [...scenario.dueIds.values()];
    const historyEntityIds = [...oldRequestIds, januaryPayment!.id, januaryAdjustment.id, oldWaiverAction!.id];
    const beforeHistory = await historySnapshot(scenario, oldRequestIds, [januaryPayment!.id], oldDueIds, historyEntityIds);
    const beforeOldDues = await dueRows(scenario);

    const result = await replaceHouseholdResident(database, scenario.chairman, {
      householdId: scenario.household.householdId,
      effectiveMonth: "2026-11",
      fullName: "Replacement Resident",
      initialPin: "624810",
      reason: "Household turnover effective at the November billing boundary.",
    }, businessDate);

    const afterHistory = await historySnapshot(scenario, oldRequestIds, [januaryPayment!.id], oldDueIds, historyEntityIds);
    expect(afterHistory).toEqual(beforeHistory);
    expect(result).toMatchObject({
      effectiveDate: "2026-11-01",
      transitionedDueCount: 2,
      generatedDueCount: 12,
      disabledAccountCount: 1,
    });

    const oldDuesAfter = await dueRows(scenario);
    expect(oldDuesAfter.slice(0, 10)).toEqual(beforeOldDues.slice(0, 10));
    expect(oldDuesAfter[0]).toMatchObject({ status: "unpaid", amount: 40_000, feeRateId: scenario.januaryRateId });
    expect(oldDuesAfter[10]).toMatchObject({ status: "not_due", amount: 0, feeRateId: null, waivedReason: null });
    expect(oldDuesAfter[11]).toMatchObject({ status: "not_due", amount: 0, feeRateId: null, waivedReason: null });

    const [oldPerson] = await testDatabase.db.select({ isActive: people.isActive })
      .from(people).where(eq(people.id, scenario.household.personId));
    const [oldAccount] = await testDatabase.db.select({ status: appAccounts.status })
      .from(appAccounts).where(eq(appAccounts.id, originalResident.appAccountId));
    expect(oldPerson?.isActive).toBe(false);
    expect(oldAccount?.status).toBe("disabled");

    const newResidentPrincipal: Principal = {
      authUserId: (await testDatabase.db.select({ authUserId: appAccounts.authUserId })
        .from(appAccounts).where(eq(appAccounts.id, result.newResidentAccountId)))[0]!.authUserId,
      appAccountId: result.newResidentAccountId,
      role: "resident",
      rtUnitId: scenario.rtUnitId,
      householdId: result.newHouseholdId,
      personId: result.newPersonId,
    };
    const newResidentDues = await getResidentMonthlyDues(database, newResidentPrincipal, businessDate);
    expect(newResidentDues).toHaveLength(10);
    expect(newResidentDues.every((due) => due.status === "not_due" && due.amount === 0 && due.outstanding === 0)).toBe(true);
    const storedNewResidentDues = await testDatabase.db.select({ month: monthlyDues.month, status: monthlyDues.status })
      .from(monthlyDues).where(eq(monthlyDues.householdId, result.newHouseholdId));
    expect(storedNewResidentDues).toHaveLength(12);
    expect(storedNewResidentDues.filter((due) => due.month > 10).sort((a, b) => a.month - b.month))
      .toEqual([{ month: 11, status: "unpaid" }, { month: 12, status: "unpaid" }]);
    expect(await getResidentPaymentHistory(database, newResidentPrincipal)).toEqual({ payments: [], nextPage: null });

    const management = await listHouseholdManagement(database, scenario.chairman, "", businessDate);
    const oldSummary = management.households.find((item) => item.householdId === scenario.household.householdId);
    const newSummary = management.households.find((item) => item.householdId === result.newHouseholdId);
    expect(oldSummary?.financialHistory.arrearsAmount).toBeGreaterThan(0);
    expect(newSummary?.financialHistory).toMatchObject({ unpaidCount: 2, notDueCount: 10, arrearsAmount: 0 });

    const newRequest = await createResidentPaymentRequest(database, newResidentPrincipal, {
      period: "2026-11",
      idempotencyKey: randomUUID(),
    }, "2026-11-01");
    const queue = await getTreasurerPaymentRequestQueue(database, scenario.treasurer, "2026-11-01");
    const oldQueueRequest = queue.find((item) => item.requestCode === oldPendingRequest.requestCode);
    const newQueueRequest = queue.find((item) => item.requestCode === newRequest.requestCode);
    expect(oldQueueRequest?.items.map((item) => item.period)).toEqual(
      ["2026-01", ...Array.from({ length: 8 }, (_, index) => `2026-${String(index + 3).padStart(2, "0")}`)],
    );
    expect(newQueueRequest?.items.map((item) => item.period)).toEqual(["2026-11"]);
    expect(oldQueueRequest?.houseNumber).toBe(newQueueRequest?.houseNumber);
  });

  async function historySnapshot(
    scenario: Scenario,
    requestIds: string[],
    paymentIds: string[],
    dueIds: string[],
    historyEntityIds: string[],
  ) {
    const requests = requestIds.length === 0 ? [] : await testDatabase.db.select().from(paymentRequests)
      .where(inArray(paymentRequests.id, requestIds));
    const requestItems = requestIds.length === 0 ? [] : await testDatabase.db.select().from(paymentRequestItems)
      .where(inArray(paymentRequestItems.requestId, requestIds));
    const claims = dueIds.length === 0 ? [] : await testDatabase.db.select().from(paymentRequestClaims)
      .where(inArray(paymentRequestClaims.monthlyDueId, dueIds));
    const paymentsForHousehold = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.householdId, scenario.household.householdId)));
    const allocations = dueIds.length === 0 ? [] : await testDatabase.db.select().from(paymentAllocations)
      .where(inArray(paymentAllocations.monthlyDueId, dueIds));
    const reversals = paymentIds.length === 0 ? [] : await testDatabase.db.select().from(paymentReversals)
      .where(inArray(paymentReversals.paymentId, paymentIds));
    const adjustments = await testDatabase.db.select().from(dueAdjustments)
      .where(and(eq(dueAdjustments.rtUnitId, scenario.rtUnitId), eq(dueAdjustments.householdId, scenario.household.householdId)));
    const waivers = await testDatabase.db.select().from(waiverItems)
      .where(and(eq(waiverItems.rtUnitId, scenario.rtUnitId), eq(waiverItems.householdId, scenario.household.householdId)));
    const waiverActionsForHousehold = await testDatabase.db.select().from(waiverActions)
      .where(and(eq(waiverActions.rtUnitId, scenario.rtUnitId), eq(waiverActions.householdId, scenario.household.householdId)));
    const financialAudits = historyEntityIds.length === 0 ? [] : await testDatabase.db.select().from(auditEvents)
      .where(inArray(auditEvents.entityId, historyEntityIds));
    return {
      requests,
      requestItems,
      claims,
      paymentsForHousehold,
      allocations,
      reversals,
      adjustments,
      waiverActionsForHousehold,
      waivers,
      financialAudits,
    };
  }
});
