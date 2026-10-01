import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  feeRates,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequests,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { dueToken, duesSummary } from "@/lib/billing/resident-card";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { rejectTreasurerPaymentRequest } from "@/lib/billing/payment-request-resolution";
import {
  CashPaymentDueConflictError,
  CashPaymentHouseholdNotFoundError,
  CashPaymentIdempotencyConflictError,
  CashPaymentPendingRequestConflictError,
  getTreasurerCashPaymentHousehold,
  recordTreasurerCashPayment,
} from "@/lib/billing/treasurer-cash-payments";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

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

    const years = new Map<number, string>();
    for (const year of [...new Set(periods.map((period) => Number(period.slice(0, 4))))]) {
      const [billingYear] = await testDatabase.db.insert(billingYears).values({
        rtUnitId,
        year,
        status: years.size === 0 ? "open" : "closed",
      }).returning({ id: billingYears.id });
      const [feeRate] = await testDatabase.db.insert(feeRates).values({
        rtUnitId,
        billingYearId: billingYear!.id,
        effectiveMonth: 1,
        monthlyAmount: 40000,
      }).returning({ id: feeRates.id });
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
    });

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

    const residentDues = await getResidentMonthlyDues(database, scenario.residentPrincipal);
    expect(residentDues.every((due) => due.status === "paid" && dueToken(due) === "PAID")).toBe(true);
    expect(duesSummary(residentDues)).toEqual({ paid: 120000, pending: 0, unpaid: 0 });
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

  it("blocks pending claims without mutation, then records cash after rejection and preserves terminal history", async () => {
    const scenario = await createScenario(["2026-11", "2026-12"]);
    const request = await createResidentPaymentRequest(database, scenario.residentPrincipal, {
      period: "2026-12",
      idempotencyKey: randomUUID(),
    });
    const [requestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode));
    const claimsBefore = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, requestRow!.id));
    await expect(recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-12",
      idempotencyKey: randomUUID(),
    })).rejects.toBeInstanceOf(CashPaymentPendingRequestConflictError);
    expect(await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")))).toHaveLength(0);
    expect(await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, requestRow!.id))).toEqual(claimsBefore);
    expect((await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, requestRow!.id)))[0]!.status).toBe("pending");

    await rejectTreasurerPaymentRequest(database, scenario.treasurerPrincipal, request.requestCode, "Pembayaran diterima tunai", "2026-10-01");
    const cash = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-12",
      idempotencyKey: randomUUID(),
    }, "2026-10-01");
    expect(cash.periods).toEqual(["2026-11", "2026-12"]);
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
      }),
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
