import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  billingYears,
  feeRates,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentReversals,
  paymentRequests,
  payments,
} from "../../src/db/schema";
import { appendAuditEvent } from "../../src/lib/audit/writer";
import { createResidentPaymentRequest } from "../../src/lib/billing/resident-payment-request";
import { recordTreasurerCashPayment } from "../../src/lib/billing/treasurer-cash-payments";
import { reverseTreasurerPayment } from "../../src/lib/billing/treasurer-payment-reversal";
import type { Principal } from "../../src/lib/auth/permissions";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("cash payment ledger database constraints", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let scenario: {
    rtUnitId: string;
    householdId: string;
    otherHouseholdId: string;
    treasurerAccountId: string;
    treasurerPrincipal: Principal;
    residentPrincipal: Principal;
    dueIds: string[];
  };

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    const db = testDatabase.db;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const otherHousehold = await createHousehold(db, rtUnitId);
    const residentUser = await createAuthUser(db);
    const [residentAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id });
    const treasurerUser = await createAuthUser(db);
    const [treasurerAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: treasurerUser.id,
      accountType: "official",
      loginIdentifier: `treasurer-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: treasurerAccount!.id,
      role: "treasurer",
      startsOn: "2020-01-01",
    });
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" })
      .returning({ id: billingYears.id });
    const [rate] = await db.insert(feeRates).values({
      rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    }).returning({ id: feeRates.id });
    const dueRows = await db.insert(monthlyDues).values([1, 2, 3].map((month) => ({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year!.id,
      feeRateId: rate!.id,
      month,
      amount: 40000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    }))).returning({ id: monthlyDues.id });
    await db.insert(monthlyDues).values({
      rtUnitId,
      householdId: otherHousehold.householdId,
      billingYearId: year!.id,
      feeRateId: rate!.id,
      month: 1,
      amount: 40000,
      dueDate: "2026-01-10",
      status: "unpaid",
    });

    scenario = {
      rtUnitId,
      householdId: household.householdId,
      otherHouseholdId: otherHousehold.householdId,
      treasurerAccountId: treasurerAccount!.id,
      treasurerPrincipal: {
        authUserId: treasurerUser.id,
        appAccountId: treasurerAccount!.id,
        role: "treasurer",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
      residentPrincipal: {
        authUserId: residentUser.id,
        appAccountId: residentAccount!.id,
        role: "resident",
        rtUnitId,
        householdId: household.householdId,
        personId: household.personId,
      },
      dueIds: dueRows.map((row) => row.id),
    };
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  it("rejects source mixing, request-bound cash allocations, and cross-household allocation scope", async () => {
    const db = testDatabase.db;
    const cashResult = await recordTreasurerCashPayment(db as never, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, "2026-06-01");
    const [cashPayment] = await db.select().from(payments).where(eq(payments.method, "cash"));
    const [pendingRequest] = await db.select().from(paymentRequests)
      .where(eq(paymentRequests.householdId, scenario.householdId));
    expect(cashResult.periods).toEqual(["2026-01"]);
    expect(cashPayment).toBeDefined();
    expect(pendingRequest).toBeUndefined();

    const request = await createResidentPaymentRequest(db as never, scenario.residentPrincipal, {
      period: "2026-02",
      idempotencyKey: randomUUID(),
    });
    const [requestRow] = await db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode));

    await expect(db.insert(payments).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentRequestId: null,
      amount: 40000,
      method: "transfer",
      verifiedByAccountId: scenario.treasurerAccountId,
      verifiedByAccountType: "official",
    })).rejects.toThrow();

    await expect(db.insert(payments).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentRequestId: requestRow!.id,
      amount: 40000,
      method: "cash",
      verifiedByAccountId: scenario.treasurerAccountId,
      verifiedByAccountType: "official",
      cashIdempotencyKey: randomUUID(),
      cashIdempotencyFingerprint: "a".repeat(64),
    })).rejects.toThrow();

    const requestAllocation = await db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, requestRow!.id));
    expect(requestAllocation).toHaveLength(0);
    await expect(db.insert(paymentAllocations).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentRequestId: requestRow!.id,
      paymentId: cashPayment!.id,
      monthlyDueId: scenario.dueIds[1]!,
      amount: 40000,
    })).rejects.toThrow();

    const [otherDue] = await db.select().from(monthlyDues)
      .where(eq(monthlyDues.householdId, scenario.otherHouseholdId));
    await expect(db.insert(paymentAllocations).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.otherHouseholdId,
      paymentRequestId: null,
      paymentId: cashPayment!.id,
      monthlyDueId: otherDue!.id,
      amount: 40000,
    })).rejects.toThrow();
  });

  it("rejects paid dues without a valid allocation and rolls back mismatched cash totals or missing audit", async () => {
    const db = testDatabase.db;
    await expect(db.update(monthlyDues)
      .set({ status: "paid" })
      .where(eq(monthlyDues.id, scenario.dueIds[2]!))).rejects.toThrow();

    await expect(db.transaction(async (transaction) => {
      const [payment] = await transaction.insert(payments).values({
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        paymentRequestId: null,
        amount: 30000,
        method: "cash",
        verifiedByAccountId: scenario.treasurerAccountId,
        verifiedByAccountType: "official",
        cashIdempotencyKey: randomUUID(),
        cashIdempotencyFingerprint: "b".repeat(64),
      }).returning({ id: payments.id });
      await transaction.insert(paymentAllocations).values({
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        paymentRequestId: null,
        paymentId: payment!.id,
        monthlyDueId: scenario.dueIds[2]!,
        amount: 40000,
      });
      await transaction.update(monthlyDues).set({ status: "paid" })
        .where(eq(monthlyDues.id, scenario.dueIds[2]!));
      await appendAuditEvent(transaction as never, {
        actorAppAccountId: scenario.treasurerAccountId,
        action: "payment.cash_recorded",
        entityType: "payment",
        entityId: payment!.id,
        reason: null,
        context: { itemCount: 1, method: "cash", totalAmount: 30000 },
      });
    })).rejects.toThrow();

    expect(await db.select().from(payments).where(eq(payments.cashIdempotencyFingerprint, "b".repeat(64))))
      .toHaveLength(0);
    expect((await db.select().from(monthlyDues).where(eq(monthlyDues.id, scenario.dueIds[2]!)))[0]!.status)
      .toBe("unpaid");
    expect(await db.select().from(auditEvents)
      .where(eq(auditEvents.action, "payment.cash_recorded"))).toHaveLength(1);

    await expect(db.transaction(async (transaction) => {
      const [payment] = await transaction.insert(payments).values({
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        paymentRequestId: null,
        amount: 40000,
        method: "cash",
        verifiedByAccountId: scenario.treasurerAccountId,
        verifiedByAccountType: "official",
        cashIdempotencyKey: randomUUID(),
        cashIdempotencyFingerprint: "c".repeat(64),
      }).returning({ id: payments.id });
      await transaction.insert(paymentAllocations).values({
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        paymentRequestId: null,
        paymentId: payment!.id,
        monthlyDueId: scenario.dueIds[2]!,
        amount: 40000,
      });
      await transaction.update(monthlyDues).set({ status: "paid" })
        .where(eq(monthlyDues.id, scenario.dueIds[2]!));
    })).rejects.toThrow();
    expect(await db.select().from(payments).where(eq(payments.cashIdempotencyFingerprint, "c".repeat(64))))
      .toHaveLength(0);
    expect((await db.select().from(monthlyDues).where(eq(monthlyDues.id, scenario.dueIds[2]!)))[0]!.status)
      .toBe("unpaid");
  });

  it("protects active ownership, paid status, payment history, and reversal history at the database layer", async () => {
    const db = testDatabase.db;
    const [payment] = await db.select().from(payments).where(eq(payments.method, "cash"));
    expect(payment).toBeDefined();
    const [allocation] = await db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payment!.id));
    const [owner] = await db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, allocation!.monthlyDueId));
    expect(owner).toMatchObject({ paymentId: payment!.id, allocationId: allocation!.id, amount: allocation!.amount });

    await expect(db.update(monthlyDues).set({ status: "unpaid" })
      .where(eq(monthlyDues.id, allocation!.monthlyDueId))).rejects.toThrow();
    await expect(db.delete(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, allocation!.monthlyDueId))).rejects.toThrow();
    await expect(db.insert(activeDueSettlements).values({
      monthlyDueId: allocation!.monthlyDueId,
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentId: payment!.id,
      allocationId: allocation!.id,
      amount: allocation!.amount,
    })).rejects.toThrow();
    await expect(db.insert(activeDueSettlements).values({
      monthlyDueId: scenario.dueIds[1]!,
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentId: payment!.id,
      allocationId: allocation!.id,
      amount: allocation!.amount,
    })).rejects.toThrow();
    await expect(db.update(payments).set({ amount: payment!.amount + 1 })
      .where(eq(payments.id, payment!.id))).rejects.toThrow();
    await expect(db.update(paymentAllocations).set({ amount: allocation!.amount + 1 })
      .where(eq(paymentAllocations.id, allocation!.id))).rejects.toThrow();
    await expect(db.delete(payments).where(eq(payments.id, payment!.id))).rejects.toThrow();
    await expect(db.delete(paymentAllocations).where(eq(paymentAllocations.id, allocation!.id))).rejects.toThrow();

    await expect(db.insert(paymentReversals).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentId: payment!.id,
      reversedByAccountId: scenario.treasurerAccountId,
      reversedByAccountType: "official",
      reason: "",
    })).rejects.toThrow();
    await expect(testDatabase.client.exec(`
      INSERT INTO public.payment_reversals
        (rt_unit_id, household_id, payment_id, reversed_by_account_id, reversed_by_account_type)
      VALUES
        ('${scenario.rtUnitId}', '${scenario.householdId}', '${payment!.id}', '${scenario.treasurerAccountId}', 'official')
    `)).rejects.toThrow();
    await expect(db.insert(paymentReversals).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentId: payment!.id,
      reversedByAccountId: randomUUID(),
      reversedByAccountType: "official",
      reason: "Aktor di luar cakupan",
    })).rejects.toThrow();

    await reverseTreasurerPayment(db as never, scenario.treasurerPrincipal, {
      paymentId: payment!.id,
      reason: "Uji pembatasan histori reversal",
    }, "2026-06-01");
    const [reversal] = await db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, payment!.id));
    expect(reversal).toBeDefined();
    await expect(db.update(paymentReversals).set({ reason: "Alasan ditulis ulang" })
      .where(eq(paymentReversals.id, reversal!.id))).rejects.toThrow();
    await expect(db.delete(paymentReversals).where(eq(paymentReversals.id, reversal!.id))).rejects.toThrow();
    await expect(db.insert(paymentReversals).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentId: payment!.id,
      reversedByAccountId: scenario.treasurerAccountId,
      reversedByAccountType: "official",
      reason: "Percobaan reversal kedua",
    })).rejects.toThrow();
    expect(await db.select().from(paymentReversals).where(eq(paymentReversals.paymentId, payment!.id)))
      .toHaveLength(1);
    expect(await db.select().from(activeDueSettlements).where(eq(activeDueSettlements.paymentId, payment!.id)))
      .toHaveLength(0);
    await expect(db.insert(activeDueSettlements).values({
      monthlyDueId: allocation!.monthlyDueId,
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentId: payment!.id,
      allocationId: allocation!.id,
      amount: allocation!.amount,
    })).rejects.toThrow();
    await expect(testDatabase.client.exec("TRUNCATE TABLE public.payment_reversals")).rejects.toThrow();
  });
});
