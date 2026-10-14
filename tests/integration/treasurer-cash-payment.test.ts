import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequests,
  paymentReversals,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createChairmanAdjustment } from "@/lib/billing/chairman-adjustment";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { dueToken, duesSummary } from "@/lib/billing/resident-card";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import {
  cancelResidentPaymentRequest,
  rejectTreasurerPaymentRequest,
} from "@/lib/billing/payment-request-resolution";
import {
  CashPaymentDueConflictError,
  CashPaymentHouseholdNotFoundError,
  CashPaymentIdempotencyConflictError,
  CashPaymentPendingRequestConflictError,
  getTreasurerCashPaymentHousehold,
  recordTreasurerCashPayment,
  searchTreasurerCashPaymentHouseholds,
} from "@/lib/billing/treasurer-cash-payments";
import { reverseTreasurerPayment } from "@/lib/billing/treasurer-payment-reversal";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

describe("Treasurer direct cash payment", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createScenario(periods = ["2026-11", "2026-12", "2027-02"]) {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId, { number: `R-${randomUUID().slice(0, 6)}` });
    const residentUser = await createAuthUser(testDatabase.db, "Resident Fixture");
    const [residentAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id });
    const residentPrincipal: Principal = {
      authUserId: residentUser.id,
      appAccountId: residentAccount!.id,
      role: "resident",
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
    };

    const treasurerUser = await createAuthUser(testDatabase.db, "Treasurer Fixture");
    const [treasurerAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: treasurerUser.id,
      accountType: "official",
      loginIdentifier: `treasurer-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: treasurerAccount!.id,
      role: "treasurer",
      startsOn: "2020-01-01",
    });
    const treasurerPrincipal: Principal = {
      authUserId: treasurerUser.id,
      appAccountId: treasurerAccount!.id,
      role: "treasurer",
      rtUnitId,
      householdId: null,
      personId: household.personId,
    };

    const chairmanUser = await createAuthUser(testDatabase.db, "Chairman Fixture");
    const [chairmanAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: chairmanUser.id,
      accountType: "official",
      loginIdentifier: `chairman-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: chairmanAccount!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });
    const chairmanPrincipal: Principal = {
      authUserId: chairmanUser.id,
      appAccountId: chairmanAccount!.id,
      role: "rt_chairman",
      rtUnitId,
      householdId: null,
      personId: household.personId,
    };

    const years = new Map<number, string>();
    for (const year of [...new Set(periods.map((period) => Number(period.slice(0, 4))))]) {
      const [billingYear] = await testDatabase.db.insert(billingYears).values({
        rtUnitId,
        year,
        status: years.size === 0 ? "open" : "closed",
      }).returning({ id: billingYears.id });
      const [feeRate] = await createFeeRateFixture(testDatabase.db, {
        rtUnitId,
        billingYearId: billingYear!.id,
        effectiveMonth: 1,
        monthlyAmount: 40000,
      });
      years.set(year, `${billingYear!.id}:${feeRate!.id}`);
    }
    const dueRows = await testDatabase.db.insert(monthlyDues).values(periods.map((period) => {
      const [year, month] = period.split("-").map(Number);
      const [billingYearId, feeRateId] = years.get(year!)!.split(":");
      return {
        rtUnitId,
        householdId: household.householdId,
        billingYearId: billingYearId!,
        feeRateId: feeRateId!,
        month: month!,
        amount: 40000,
        dueDate: `${period}-10`,
        status: "unpaid" as const,
      };
    })).returning({ id: monthlyDues.id });

    return {
      rtUnitId,
      householdId: household.householdId,
      residentPrincipal,
      treasurerPrincipal,
      chairmanPrincipal,
      treasurerAccountId: treasurerAccount!.id,
      dueIds: dueRows.map((row) => row.id),
    };
  }

  it("records one multi-year cash payment for every older unpaid period and refreshes the resident card", async () => {
    const scenario = await createScenario();
    const result = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2027-02",
      idempotencyKey: randomUUID(),
    }, "2026-10-12");

    expect(result).toEqual({
      status: "recorded",
      periods: ["2026-11", "2026-12", "2027-02"],
      itemCount: 3,
      totalAmount: 120000,
      replayed: false,
    });
    const paymentRows = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));
    const allocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentRows[0]!.id));
    const audit = await testDatabase.db.select().from(auditEvents)
      .where(and(eq(auditEvents.action, "payment.cash_recorded"), eq(auditEvents.entityId, paymentRows[0]!.id)));

    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]).toMatchObject({
      paymentRequestId: null,
      amount: 120000,
      method: "cash",
      verifiedByAccountId: scenario.treasurerAccountId,
      verifiedByAccountType: "official",
    });
    expect(allocations).toHaveLength(3);
    expect(allocations.every((allocation) => allocation.paymentRequestId === null && allocation.amount === 40000)).toBe(true);
    expect(allocations.reduce((total, allocation) => total + allocation.amount, 0)).toBe(120000);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorAppAccountId: scenario.treasurerAccountId,
      entityType: "payment",
      reason: null,
      context: { itemCount: 3, method: "cash", totalAmount: 120000 },
    });
    const persistedDues = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    expect(persistedDues.every((due) => due.status === "paid")).toBe(true);

    // All of these dues can be paid early by a Treasurer; per-month receipts
    // must not repeat the full transaction amount for each calendar card.
    const residentDues = await getResidentMonthlyDues(database, scenario.residentPrincipal, "2026-10-12");
    expect(residentDues.every((due) => due.status === "paid" && dueToken(due) === "PAID")).toBe(true);
    expect(residentDues.every((due) => due.periodTiming === "future")).toBe(true);
    expect(duesSummary(residentDues)).toEqual({ paid: 120000, pending: 0, unpaid: 0 });
    expect(residentDues.map((due) => due.receipts)).toHaveLength(3);
    for (const due of residentDues) {
      expect(due.receipts).toHaveLength(1);
      expect(due.receipts![0]).toMatchObject({
        allocationAmount: 40000,
        method: "cash",
      });
      expect(due.receipts![0]!.reference).toMatch(/^KRT-[A-F0-9]{12}$/);
      expect(new Date(due.receipts![0]!.verifiedAt).toString()).not.toBe("Invalid Date");
    }
  });

  it("shows two active same-month allocations as scoped receipts and excludes reversed history", async () => {
    const scenario = await createScenario(["2026-09", "2026-10"]);
    const septemberDueId = scenario.dueIds[0]!;
    const firstKey = randomUUID();
    await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-09",
      idempotencyKey: firstKey,
    }, "2026-10-12");

    await createChairmanAdjustment(database, scenario.chairmanPrincipal, {
      monthlyDueId: septemberDueId,
      amountDelta: 10000,
      reason: "Koreksi nominal September",
      idempotencyKey: randomUUID(),
    }, "2026-10-13");
    const secondKey = randomUUID();
    await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-09",
      idempotencyKey: secondKey,
    }, "2026-10-14");

    const reversedKey = randomUUID();
    await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-10",
      idempotencyKey: reversedKey,
    }, "2026-10-14");
    const [reversedPayment] = await testDatabase.db.select().from(payments)
      .where(eq(payments.cashIdempotencyKey, reversedKey));
    await reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: reversedPayment!.id,
      reason: "Koreksi transaksi Oktober",
    }, "2026-10-15");

    const [septemberDue] = await testDatabase.db.select({
      billingYearId: monthlyDues.billingYearId,
      feeRateId: monthlyDues.feeRateId,
    }).from(monthlyDues).where(eq(monthlyDues.id, septemberDueId));
    const otherHousehold = await createHousehold(testDatabase.db, scenario.rtUnitId);
    await testDatabase.db.insert(monthlyDues).values({
      rtUnitId: scenario.rtUnitId,
      householdId: otherHousehold.householdId,
      billingYearId: septemberDue!.billingYearId,
      feeRateId: septemberDue!.feeRateId,
      month: 11,
      amount: 40000,
      dueDate: "2026-11-10",
      status: "unpaid",
    });
    await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: otherHousehold.householdId,
      period: "2026-11",
      idempotencyKey: randomUUID(),
    }, "2026-10-15");

    const residentDues = await getResidentMonthlyDues(database, scenario.residentPrincipal, "2026-10-15");
    const september = residentDues.find((due) => due.billingYear === 2026 && due.month === 9)!;
    const october = residentDues.find((due) => due.billingYear === 2026 && due.month === 10)!;
    const [canonicalBalance] = await getDueFinancialBalances(database, [septemberDueId]);
    const activeSeptemberPayments = await testDatabase.db.select({ id: payments.id })
      .from(payments)
      .where(inArray(payments.cashIdempotencyKey, [firstKey, secondKey]));
    const reversedRows = await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, reversedPayment!.id));

    expect(residentDues.map((due) => due.month)).toEqual([9, 10]);
    expect(september).toMatchObject({
      status: "paid",
      effectiveTarget: 50000,
      activeReceived: 50000,
      outstanding: 0,
      periodTiming: "past",
    });
    expect(september.receipts).toHaveLength(2);
    expect(september.receipts!.map((receipt) => receipt.allocationAmount).sort((left, right) => left - right))
      .toEqual([10000, 40000]);
    expect(september.receipts!.reduce((total, receipt) => total + receipt.allocationAmount, 0))
      .toBe(canonicalBalance!.activeReceived);
    expect(september.receipts!.map((receipt) => receipt.reference).sort())
      .toEqual(activeSeptemberPayments.map(({ id }) => `KRT-${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`).sort());
    expect(october).toMatchObject({ status: "unpaid", activeReceived: 0, outstanding: 40000, receipts: [] });
    expect(reversedRows).toHaveLength(1);
  });

  it("replays the same key and rejects reuse for a different period or household", async () => {
    const scenario = await createScenario(["2026-11", "2026-12"]);
    const key = randomUUID();
    const input = { householdId: scenario.householdId, period: "2026-12", idempotencyKey: key };
    const first = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, input);
    const replay = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, input);
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    await expect(recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      ...input,
      period: "2026-11",
    })).rejects.toBeInstanceOf(CashPaymentIdempotencyConflictError);

    const otherHousehold = await createHousehold(testDatabase.db, scenario.rtUnitId);
    await expect(recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      ...input,
      householdId: otherHousehold.householdId,
    })).rejects.toBeInstanceOf(CashPaymentIdempotencyConflictError);
    expect(await testDatabase.db.select().from(payments)
      .where(eq(payments.cashIdempotencyKey, key))).toHaveLength(1);
  });

  it("serializes simultaneous retries of the same cash operation to one financial effect", async () => {
    const scenario = await createScenario(["2026-11", "2026-12"]);
    const idempotencyKey = randomUUID();
    const input = { householdId: scenario.householdId, period: "2026-12", idempotencyKey };

    const attempts = await Promise.all([
      recordTreasurerCashPayment(database, scenario.treasurerPrincipal, input),
      recordTreasurerCashPayment(database, scenario.treasurerPrincipal, input),
    ]);

    expect(attempts.map((result) => result.replayed).sort()).toEqual([false, true]);
    for (const attempt of attempts) {
      expect(attempt).toMatchObject({ status: "recorded", periods: ["2026-11", "2026-12"], itemCount: 2, totalAmount: 80000 });
    }

    const paymentRows = await testDatabase.db.select().from(payments)
      .where(eq(payments.cashIdempotencyKey, idempotencyKey));
    expect(paymentRows).toHaveLength(1);
    const allocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentRows[0]!.id));
    expect(allocations).toHaveLength(2);
    expect(allocations.reduce((total, allocation) => total + allocation.amount, 0)).toBe(80000);
    expect(await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment.cash_recorded"),
      eq(auditEvents.entityId, paymentRows[0]!.id),
    ))).toHaveLength(1);
    const persistedDues = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    expect(persistedDues).toHaveLength(2);
    expect(persistedDues.every((due) => due.status === "paid")).toBe(true);
  });

  it("treats injection-like household search text as data and keeps search within the Treasurer RT", async () => {
    const scenario = await createScenario(["2026-12"]);
    const otherRt = await createRt(testDatabase.db);
    const foreignHousehold = await createHousehold(testDatabase.db, otherRt, { number: "FOREIGN-OR-1=1" });

    const injectionLike = await searchTreasurerCashPaymentHouseholds(
      database,
      scenario.treasurerPrincipal,
      "' OR 1=1 --",
    );
    expect(injectionLike.households).toEqual([]);

    const foreignSearch = await searchTreasurerCashPaymentHouseholds(
      database,
      scenario.treasurerPrincipal,
      "FOREIGN-OR-1=1",
    );
    expect(foreignSearch.households.some((household) => household.householdId === foreignHousehold.householdId)).toBe(false);
  });

  it("blocks pending claims without mutation, then records cash after rejection and cancellation without rewriting history", async () => {
    const scenario = await createScenario(["2026-09", "2026-10", "2026-11", "2027-02"]);
    const request = await createResidentPaymentRequest(database, scenario.residentPrincipal, {
      period: "2026-09",
      idempotencyKey: randomUUID(),
    }, "2026-10-12");
    const [requestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode));
    const claimsBefore = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, requestRow!.id));
    await expect(recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-11",
      idempotencyKey: randomUUID(),
    }, "2026-10-12")).rejects.toBeInstanceOf(CashPaymentPendingRequestConflictError);
    expect(await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")))).toHaveLength(0);
    expect(await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, requestRow!.id))).toEqual(claimsBefore);
    expect((await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, requestRow!.id)))[0]!.status).toBe("pending");

    await rejectTreasurerPaymentRequest(database, scenario.treasurerPrincipal, request.requestCode, "Pembayaran diterima tunai", "2026-10-12");
    const cash = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-11",
      idempotencyKey: randomUUID(),
    }, "2026-10-12");
    expect(cash.periods).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect((await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, requestRow!.id)))[0]!.status).toBe("rejected");
    expect(await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, requestRow!.id))).toHaveLength(0);
    expect(await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, requestRow!.id))).toHaveLength(0);
    expect(await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment_request.rejected"),
      eq(auditEvents.entityId, requestRow!.id),
    ))).toHaveLength(1);

    const cancelledRequest = await createResidentPaymentRequest(database, scenario.residentPrincipal, {
      period: "2027-02",
      idempotencyKey: randomUUID(),
    }, "2027-02-01");
    const [cancelledRequestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, cancelledRequest.requestCode));
    await cancelResidentPaymentRequest(database, scenario.residentPrincipal, cancelledRequest.requestCode);
    const cancelledCash = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2027-02",
      idempotencyKey: randomUUID(),
    }, "2027-02-01");
    expect(cancelledCash.periods).toEqual(["2027-02"]);
    expect((await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, cancelledRequestRow!.id)))[0]!.status).toBe("cancelled");
    expect(await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, cancelledRequestRow!.id))).toHaveLength(0);
    expect(await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, cancelledRequestRow!.id))).toHaveLength(0);
    expect(await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, cancelledRequestRow!.id))).toHaveLength(0);
  });

  it("serializes distinct-key attempts against the same dues so only one can pay", async () => {
    const scenario = await createScenario(["2026-11", "2026-12"]);
    const attempts = await Promise.allSettled(["first", "second"].map(() =>
      recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
        householdId: scenario.householdId,
        period: "2026-12",
        idempotencyKey: randomUUID(),
      }),
    ));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(CashPaymentDueConflictError);
    expect(await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")))).toHaveLength(1);
    expect(await testDatabase.db.select().from(paymentAllocations)
      .where(inArray(paymentAllocations.monthlyDueId, scenario.dueIds))).toHaveLength(2);
  });

  it("serializes resident request creation against cash so a due has only one ownership path", async () => {
    const scenario = await createScenario(["2026-12"]);
    const [cashAttempt, requestAttempt] = await Promise.allSettled([
      recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
        householdId: scenario.householdId,
        period: "2026-12",
        idempotencyKey: randomUUID(),
      }),
      createResidentPaymentRequest(database, scenario.residentPrincipal, {
        period: "2026-12",
        idempotencyKey: randomUUID(),
      }, "2026-12-01"),
    ]);
    const [due] = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    const claims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(inArray(paymentRequestClaims.monthlyDueId, scenario.dueIds));
    const cashPayments = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));

    if (cashAttempt.status === "fulfilled") {
      expect(requestAttempt.status).toBe("rejected");
      expect(due!.status).toBe("paid");
      expect(claims).toHaveLength(0);
      expect(cashPayments).toHaveLength(1);
    } else {
      expect(requestAttempt.status).toBe("fulfilled");
      expect(due!.status).toBe("unpaid");
      expect(claims).toHaveLength(1);
      expect(cashPayments).toHaveLength(0);
    }
  });

  it("does not expose cross-RT household targets and enforces the active Treasurer service boundary", async () => {
    const scenario = await createScenario(["2026-12"]);
    const otherRt = await createRt(testDatabase.db);
    const foreignHousehold = await createHousehold(testDatabase.db, otherRt);
    await expect(getTreasurerCashPaymentHousehold(
      database,
      scenario.treasurerPrincipal,
      foreignHousehold.householdId,
    )).rejects.toBeInstanceOf(CashPaymentHouseholdNotFoundError);
    await expect(recordTreasurerCashPayment(database, scenario.residentPrincipal, {
      householdId: scenario.householdId,
      period: "2026-12",
      idempotencyKey: randomUUID(),
    })).rejects.toThrow(/Forbidden/);

    await testDatabase.db.update(officialAssignments)
      .set({ endsOn: "2026-09-30" })
      .where(eq(officialAssignments.appAccountId, scenario.treasurerPrincipal.appAccountId));
    await expect(recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-12",
      idempotencyKey: randomUUID(),
    }, "2026-10-01")).rejects.toThrow(/active|authorized|permission/i);
  });

  it("rolls back the payment, allocations, and due updates if audit insertion fails", async () => {
    const scenario = await createScenario(["2026-12"]);
    const trigger = `cash_audit_fail_${randomUUID().replaceAll("-", "")}`;
    await testDatabase.client.exec(`
      CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'payment.cash_recorded' THEN
          RAISE EXCEPTION 'forced cash audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${trigger}_trigger BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION ${trigger}();
    `);
    try {
      await expect(recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
        householdId: scenario.householdId,
        period: "2026-12",
        idempotencyKey: randomUUID(),
      })).rejects.toThrow();
    } finally {
      await testDatabase.client.exec(`DROP TRIGGER ${trigger}_trigger ON audit_events; DROP FUNCTION ${trigger}();`);
    }
    expect(await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")))).toHaveLength(0);
    expect(await testDatabase.db.select().from(paymentAllocations)
      .where(inArray(paymentAllocations.monthlyDueId, scenario.dueIds))).toHaveLength(0);
    const [due] = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    expect(due!.status).toBe("unpaid");
    expect(await testDatabase.db.select().from(auditEvents)
      .where(and(
        eq(auditEvents.action, "payment.cash_recorded"),
        eq(auditEvents.actorAppAccountId, scenario.treasurerPrincipal.appAccountId),
      )))
      .toHaveLength(0);
  });
});
