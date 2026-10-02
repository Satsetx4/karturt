import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  billingYears,
  dueAdjustments,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentReversals,
  paymentRequests,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { getResidentPaymentHistory, getTreasurerPaymentHistory } from "@/lib/billing/payment-history";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { cancelResidentPaymentRequest } from "@/lib/billing/payment-request-resolution";
import {
  createResidentPaymentRequest,
  PaymentRequestPeriodUnavailableError,
} from "@/lib/billing/resident-payment-request";
import {
  CashPaymentDueConflictError,
  recordTreasurerCashPayment,
} from "@/lib/billing/treasurer-cash-payments";
import { verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import {
  reverseTreasurerPayment,
  TreasurerPaymentAlreadyReversedError,
  TreasurerPaymentNotFoundError,
  TreasurerPaymentReversalConflictError,
} from "@/lib/billing/treasurer-payment-reversal";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase, ensureTestChairman } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

describe("Treasurer payment reversal", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createScenario(months = [1, 2, 3]) {
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
    const dueRows = await testDatabase.db.insert(monthlyDues).values(months.map((month) => ({
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
      householdId: household.householdId,
      residentPrincipal,
      treasurerPrincipal,
      dueIds: dueRows.map((row) => row.id),
    };
  }

  async function createTransferPayment(scenario: Awaited<ReturnType<typeof createScenario>>) {
    const request = await createResidentPaymentRequest(database, scenario.residentPrincipal, {
      period: "2026-03",
      idempotencyKey: randomUUID(),
    });
    const [requestRow] = await testDatabase.db.select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode));
    const result = await verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, request.requestCode);
    const [payment] = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, requestRow!.id));
    return { request, requestId: requestRow!.id, payment: payment!, result };
  }

  it("reverses a whole transfer payment, preserves verified history, and permits a new request and settlement", async () => {
    const scenario = await createScenario();
    const original = await createTransferPayment(scenario);
    const allocationsBefore = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, original.payment.id));

    const reversed = await reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: original.payment.id,
      reason: "Pencatatan transfer keliru",
    }, "2026-10-02");

    expect(reversed).toMatchObject({ status: "reversed", method: "transfer", itemCount: 3, totalAmount: 120000 });
    const [requestAfterReverse] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, original.requestId));
    const [paymentAfterReverse] = await testDatabase.db.select().from(payments)
      .where(eq(payments.id, original.payment.id));
    const allocationsAfter = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, original.payment.id));
    const reversals = await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, original.payment.id));
    const reversalAudits = await testDatabase.db.select().from(auditEvents)
      .where(and(eq(auditEvents.action, "payment.reversed"), eq(auditEvents.entityId, original.payment.id)));
    const duesAfterReverse = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    const ownershipAfterReverse = await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.paymentId, original.payment.id));

    expect(requestAfterReverse?.status).toBe("verified");
    expect(paymentAfterReverse).toEqual(original.payment);
    expect(allocationsAfter).toEqual(allocationsBefore);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ reason: "Pencatatan transfer keliru", reversedByAccountType: "official" });
    expect(reversalAudits).toHaveLength(1);
    expect(reversalAudits[0]).toMatchObject({
      entityType: "payment",
      reason: "Pencatatan transfer keliru",
      context: { itemCount: 3, method: "transfer", totalAmount: 120000 },
    });
    expect(duesAfterReverse.every((due) => due.status === "unpaid")).toBe(true);
    expect(ownershipAfterReverse).toHaveLength(0);
    expect((await getResidentPaymentHistory(database, scenario.residentPrincipal)).payments[0])
      .toMatchObject({ lifecycle: "reversed", method: "transfer", periods: ["2026-01", "2026-02", "2026-03"] });
    expect((await getTreasurerPaymentHistory(database, scenario.treasurerPrincipal)).transactions[0])
      .toMatchObject({ lifecycle: "reversed", reversalReason: "Pencatatan transfer keliru" });

    const replacement = await createTransferPayment(scenario);
    const activeOwners = await testDatabase.db.select().from(activeDueSettlements)
      .where(inArray(activeDueSettlements.monthlyDueId, scenario.dueIds));
    expect(replacement.payment.id).not.toBe(original.payment.id);
    expect(activeOwners).toHaveLength(3);
    expect(activeOwners.every((owner) => owner.paymentId === replacement.payment.id)).toBe(true);
    expect((await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, original.payment.id))).length).toBe(1);
    expect((await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, original.requestId)))[0]!.status).toBe("verified");
  });

  it("reverses a multi-month cash payment and permits a new payment with a different idempotency key", async () => {
    const scenario = await createScenario();
    const first = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-03",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const [originalPayment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));
    const originalAllocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, originalPayment!.id));

    await reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: originalPayment!.id,
      reason: "Salah input transaksi tunai",
    }, "2026-10-02");
    const [newPayment] = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    expect(newPayment?.status).toBe("unpaid");
    expect((await getResidentPaymentHistory(database, scenario.residentPrincipal)).payments[0]?.lifecycle).toBe("reversed");

    const second = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-03",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const [replacementPayment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")))
      .orderBy(payments.createdAt);
    const history = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));
    const replacement = history.find((payment) => payment.id !== originalPayment!.id)!;
    const oldAllocationsAfter = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, originalPayment!.id));
    const activeOwners = await testDatabase.db.select().from(activeDueSettlements)
      .where(inArray(activeDueSettlements.monthlyDueId, scenario.dueIds));

    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ status: "recorded", periods: ["2026-01", "2026-02", "2026-03"], replayed: false });
    expect(replacementPayment?.id).toBe(originalPayment!.id);
    expect(replacement.id).not.toBe(originalPayment!.id);
    expect(oldAllocationsAfter).toEqual(originalAllocations);
    expect((await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, originalPayment!.id))).length).toBe(1);
    expect(activeOwners).toHaveLength(3);
    expect(activeOwners.every((owner) => owner.paymentId === replacement.id)).toBe(true);
  });

  it("releases only the reversed allocation after a paid due is adjusted and settled twice", async () => {
    const scenario = await createScenario([1]);
    const firstPaymentResult = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const [firstPayment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));

    const chairmanAccountId = await ensureTestChairman(testDatabase.db, scenario.rtUnitId);
    const dueId = scenario.dueIds[0]!;
    const adjustmentId = randomUUID();
    const adjustmentReason = "Penyesuaian setelah pembayaran pertama";
    await testDatabase.db.transaction(async (transaction) => {
      await transaction.insert(dueAdjustments).values({
        id: adjustmentId,
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        monthlyDueId: dueId,
        amountDelta: 10000,
        effectiveTargetAfter: 50000,
        reason: adjustmentReason,
        adjustedByAccountId: chairmanAccountId,
        adjustedByAccountType: "official",
        idempotencyKey: randomUUID(),
        requestFingerprint: createHash("sha256").update(adjustmentId).digest("hex"),
      });
      await transaction.update(monthlyDues).set({ status: "unpaid" })
        .where(eq(monthlyDues.id, dueId));
      await transaction.insert(auditEvents).values({
        actorAppAccountId: chairmanAccountId,
        action: "billing.adjustment_created",
        entityType: "due_adjustment",
        entityId: adjustmentId,
        reason: adjustmentReason,
        context: { amountDelta: 10000, effectiveTargetAfter: 50000, originalAmount: 40000 },
      });
    });

    const pendingRequest = await createResidentPaymentRequest(database, scenario.residentPrincipal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: firstPayment!.id,
      reason: "Uji blokir reversal saat klaim aktif",
    }, "2026-10-02")).rejects.toBeInstanceOf(TreasurerPaymentReversalConflictError);
    expect(await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, firstPayment!.id))).toHaveLength(0);
    await cancelResidentPaymentRequest(database, scenario.residentPrincipal, pendingRequest.requestCode);

    const secondPaymentResult = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const cashPayments = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));
    const currentSecondPayment = cashPayments.find((payment) => payment.id !== firstPayment!.id);
    const firstAllocation = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, firstPayment!.id));
    const secondAllocation = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, currentSecondPayment!.id));

    await reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: firstPayment!.id,
      reason: "Membalik penerimaan pertama untuk pemeriksaan saldo",
    }, "2026-10-02");

    const remainingOwners = await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, dueId));
    const [balance] = await getDueFinancialBalances(database, [dueId]);
    const [due] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, dueId));

    expect(firstPaymentResult.totalAmount).toBe(40000);
    expect(secondPaymentResult.totalAmount).toBe(10000);
    expect(cashPayments).toHaveLength(2);
    expect(firstAllocation).toMatchObject([{ amount: 40000 }]);
    expect(secondAllocation).toMatchObject([{ amount: 10000 }]);
    expect(remainingOwners).toMatchObject([{
      allocationId: secondAllocation[0]!.id,
      paymentId: currentSecondPayment!.id,
      amount: 10000,
    }]);
    expect(balance).toMatchObject({ originalAmount: 40000, adjustmentTotal: 10000, effectiveTarget: 50000, activeReceived: 10000, outstanding: 40000 });
    expect(due?.status).toBe("unpaid");
  });

  it("serializes concurrent reversals to one record and one audit, then rejects replay", async () => {
    const scenario = await createScenario([1]);
    const original = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const [payment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));
    const attempts = await Promise.allSettled([
      reverseTreasurerPayment(database, scenario.treasurerPrincipal, { paymentId: payment!.id, reason: "Koreksi A" }, "2026-10-02"),
      reverseTreasurerPayment(database, scenario.treasurerPrincipal, { paymentId: payment!.id, reason: "Koreksi B" }, "2026-10-02"),
    ]);

    expect(original.status).toBe("recorded");
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(TreasurerPaymentAlreadyReversedError);
    expect(await testDatabase.db.select().from(paymentReversals).where(eq(paymentReversals.paymentId, payment!.id))).toHaveLength(1);
    expect(await testDatabase.db.select().from(auditEvents)
      .where(and(eq(auditEvents.action, "payment.reversed"), eq(auditEvents.entityId, payment!.id)))).toHaveLength(1);
    await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: payment!.id,
      reason: "Jangan ubah alasan yang sudah tercatat",
    }, "2026-10-02")).rejects.toBeInstanceOf(TreasurerPaymentAlreadyReversedError);
  });

  it("rolls back the reversal and all due changes when the audit insert fails", async () => {
    const scenario = await createScenario([1, 2]);
    await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-02",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const [payment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));
    await testDatabase.client.exec(`
      CREATE FUNCTION fail_phase9_reversal_audit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'payment.reversed' THEN
          RAISE EXCEPTION 'forced phase 9 audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_phase9_reversal_audit_v1_trigger
      BEFORE INSERT ON public.audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_phase9_reversal_audit_v1();
    `);

    try {
      await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
        paymentId: payment!.id,
        reason: "Rollback wajib utuh",
      }, "2026-10-02")).rejects.toThrow();
    } finally {
      await testDatabase.client.exec(`
        DROP TRIGGER fail_phase9_reversal_audit_v1_trigger ON public.audit_events;
        DROP FUNCTION fail_phase9_reversal_audit_v1();
      `);
    }

    expect(await testDatabase.db.select().from(paymentReversals).where(eq(paymentReversals.paymentId, payment!.id))).toHaveLength(0);
    expect(await testDatabase.db.select().from(activeDueSettlements).where(eq(activeDueSettlements.paymentId, payment!.id))).toHaveLength(2);
    expect(await testDatabase.db.select().from(auditEvents)
      .where(and(eq(auditEvents.action, "payment.reversed"), eq(auditEvents.entityId, payment!.id)))).toHaveLength(0);
    const dues = await testDatabase.db.select().from(monthlyDues).where(inArray(monthlyDues.id, scenario.dueIds));
    expect(dues.every((due) => due.status === "paid")).toBe(true);
  });

  it("serializes resident request creation against reversal of the same paid due", async () => {
    const scenario = await createScenario([1]);
    await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const [payment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));

    const [reversalAttempt, requestAttempt] = await Promise.allSettled([
      reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
        paymentId: payment!.id,
        reason: "Uji urutan reversal dan pengajuan",
      }, "2026-10-02"),
      createResidentPaymentRequest(database, scenario.residentPrincipal, {
        period: "2026-01",
        idempotencyKey: randomUUID(),
      }),
    ]);

    expect(reversalAttempt.status).toBe("fulfilled");
    expect(await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, payment!.id))).toHaveLength(1);
    const dueRows = await testDatabase.db.select().from(monthlyDues).where(inArray(monthlyDues.id, scenario.dueIds));
    expect(dueRows.every((due) => due.status === "unpaid")).toBe(true);
    expect(await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, scenario.dueIds[0]!))).toHaveLength(0);

    if (requestAttempt.status === "fulfilled") {
      const [request] = await testDatabase.db.select().from(paymentRequests)
        .where(eq(paymentRequests.requestCode, requestAttempt.value.requestCode));
      expect(request?.status).toBe("pending");
      expect(await testDatabase.db.select().from(paymentRequestClaims)
        .where(eq(paymentRequestClaims.monthlyDueId, scenario.dueIds[0]!))).toHaveLength(1);
    } else {
      expect(requestAttempt.reason).toBeInstanceOf(PaymentRequestPeriodUnavailableError);
      const retryAfterCommit = await createResidentPaymentRequest(database, scenario.residentPrincipal, {
        period: "2026-01",
        idempotencyKey: randomUUID(),
      });
      expect(retryAfterCommit.status).toBe("pending");
      expect(await testDatabase.db.select().from(paymentRequestClaims)
        .where(eq(paymentRequestClaims.monthlyDueId, scenario.dueIds[0]!))).toHaveLength(1);
    }
  });

  it("serializes reversal against concurrent cash re-payment without duplicate active ownership", async () => {
    const scenario = await createScenario([1, 2]);
    await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-02",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const [originalPayment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));
    const replacementKey = randomUUID();

    const [reversalAttempt, cashAttempt] = await Promise.allSettled([
      reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
        paymentId: originalPayment!.id,
        reason: "Uji urutan reversal dan pembayaran tunai baru",
      }, "2026-10-02"),
      recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
        householdId: scenario.householdId,
        period: "2026-02",
        idempotencyKey: replacementKey,
      }, "2026-10-02"),
    ]);

    expect(reversalAttempt.status).toBe("fulfilled");
    expect(cashAttempt.status === "fulfilled" || cashAttempt.reason instanceof CashPaymentDueConflictError).toBe(true);
    let replacementId: string | undefined;
    if (cashAttempt.status === "fulfilled") {
      expect(cashAttempt.value.replayed).toBe(false);
      const [replacement] = await testDatabase.db.select().from(payments)
        .where(eq(payments.cashIdempotencyKey, replacementKey));
      replacementId = replacement?.id;
    } else {
      const retryKey = randomUUID();
      const retried = await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
        householdId: scenario.householdId,
        period: "2026-02",
        idempotencyKey: retryKey,
      }, "2026-10-02");
      expect(retried.replayed).toBe(false);
      const [replacement] = await testDatabase.db.select().from(payments)
        .where(eq(payments.cashIdempotencyKey, retryKey));
      replacementId = replacement?.id;
    }

    expect(replacementId).toBeDefined();
    expect(replacementId).not.toBe(originalPayment!.id);
    expect(await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, originalPayment!.id))).toHaveLength(1);
    const owners = await testDatabase.db.select().from(activeDueSettlements)
      .where(inArray(activeDueSettlements.monthlyDueId, scenario.dueIds));
    expect(owners).toHaveLength(2);
    expect(owners.every((owner) => owner.paymentId === replacementId)).toBe(true);
    const dues = await testDatabase.db.select().from(monthlyDues).where(inArray(monthlyDues.id, scenario.dueIds));
    expect(dues.every((due) => due.status === "paid")).toBe(true);
  });

  it("rejects other roles, cross-RT payment lookup, invalid reasons, and tampered ownership", async () => {
    const scenario = await createScenario([1]);
    await recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const [payment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, scenario.rtUnitId), eq(payments.method, "cash")));

    await expect(reverseTreasurerPayment(database, scenario.residentPrincipal, {
      paymentId: payment!.id,
      reason: "Tidak berhak",
    }, "2026-10-02")).rejects.toThrow(/Forbidden/);
    await expect(reverseTreasurerPayment(database, {
      ...scenario.treasurerPrincipal,
      role: "rt_chairman",
    }, { paymentId: payment!.id, reason: "Ketua RT" }, "2026-10-02")).rejects.toThrow(/Forbidden/);
    await expect(reverseTreasurerPayment(database, {
      ...scenario.treasurerPrincipal,
      role: "system_admin",
      rtUnitId: null,
      householdId: null,
      personId: null,
    }, { paymentId: payment!.id, reason: "System Admin" }, "2026-10-02")).rejects.toThrow(/Forbidden/);
    await expect(reverseTreasurerPayment(database, {
      ...scenario.treasurerPrincipal,
      rtUnitId: randomUUID(),
    }, { paymentId: payment!.id, reason: "Salah RT" }, "2026-10-02")).rejects.toThrow(/Forbidden/);

    await testDatabase.db.update(appAccounts).set({ status: "disabled" })
      .where(eq(appAccounts.id, scenario.treasurerPrincipal.appAccountId));
    await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: payment!.id,
      reason: "Bendahara nonaktif",
    }, "2026-10-02")).rejects.toThrow(/Forbidden/);
    await testDatabase.db.update(appAccounts).set({ status: "active" })
      .where(eq(appAccounts.id, scenario.treasurerPrincipal.appAccountId));

    await testDatabase.db.update(officialAssignments).set({ endsOn: "2026-10-01" })
      .where(eq(officialAssignments.appAccountId, scenario.treasurerPrincipal.appAccountId));
    await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: payment!.id,
      reason: "Bendahara sudah berakhir masa tugasnya",
    }, "2026-10-02")).rejects.toThrow(/Forbidden/);
    await testDatabase.db.update(officialAssignments).set({ endsOn: null })
      .where(eq(officialAssignments.appAccountId, scenario.treasurerPrincipal.appAccountId));

    const foreignScenario = await createScenario([1]);
    await recordTreasurerCashPayment(database, foreignScenario.treasurerPrincipal, {
      householdId: foreignScenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    const [foreignPayment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, foreignScenario.rtUnitId), eq(payments.method, "cash")));
    await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: foreignPayment!.id,
      reason: "Pembayaran lintas RT",
    }, "2026-10-02")).rejects.toBeInstanceOf(TreasurerPaymentNotFoundError);
    await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: payment!.id,
      reason: "   ",
    }, "2026-10-02")).rejects.toThrow(/Alasan/);
    await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: payment!.id,
      reason: "x".repeat(501),
    }, "2026-10-02")).rejects.toThrow(/Alasan/);
    await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
      paymentId: payment!.id,
      reason: "Hubungi warga di 081234567890",
    }, "2026-10-02")).rejects.toThrow(/Alasan/);

    await testDatabase.client.exec(`
      CREATE FUNCTION fail_phase9_settlement_delete_v1() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced phase 9 owner corruption' USING ERRCODE = '23514';
      END;
      $$;
      CREATE TRIGGER fail_phase9_settlement_delete_v1_trigger
      BEFORE DELETE ON public.active_due_settlements
      FOR EACH ROW EXECUTE FUNCTION fail_phase9_settlement_delete_v1();
    `);
    try {
      await expect(reverseTreasurerPayment(database, scenario.treasurerPrincipal, {
        paymentId: payment!.id,
        reason: "Uji kepemilikan aktif",
      }, "2026-10-02")).rejects.toThrow();
    } finally {
      await testDatabase.client.exec(`
        DROP TRIGGER fail_phase9_settlement_delete_v1_trigger ON public.active_due_settlements;
        DROP FUNCTION fail_phase9_settlement_delete_v1();
      `);
    }
    expect(await testDatabase.db.select().from(paymentReversals).where(eq(paymentReversals.paymentId, payment!.id))).toHaveLength(0);
    expect(await testDatabase.db.select().from(activeDueSettlements).where(eq(activeDueSettlements.paymentId, payment!.id))).toHaveLength(1);
  });
});
