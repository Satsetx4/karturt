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
  paymentRequestItems,
  paymentRequests,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { getTreasurerPaymentRequestDetail, getTreasurerPaymentRequestQueue } from "@/lib/billing/treasurer-payment-requests";
import {
  TreasurerPaymentRequestAlreadyProcessedError,
  TreasurerPaymentRequestNotFoundError,
  verifyTreasurerPaymentRequest,
} from "@/lib/billing/treasurer-payment-verification";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { duesSummary } from "@/lib/billing/resident-card";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

describe("Treasurer payment verification", () => {
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
    const residentHousehold = await createHousehold(testDatabase.db, rtUnitId, { number: `R-${randomUUID().slice(0, 6)}` });
    const residentUser = await createAuthUser(testDatabase.db, "Warga Fixture");
    const [residentAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: residentHousehold.personId,
      householdId: residentHousehold.householdId,
    }).returning({ id: appAccounts.id });
    const residentPrincipal: Principal = {
      authUserId: residentUser.id,
      appAccountId: residentAccount!.id,
      role: "resident",
      rtUnitId,
      householdId: residentHousehold.householdId,
      personId: residentHousehold.personId,
    };

    const treasurerUser = await createAuthUser(testDatabase.db, "Treasurer Fixture");
    const [treasurerAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: treasurerUser.id,
      accountType: "official",
      loginIdentifier: `treasurer-${randomUUID()}`,
      personId: residentHousehold.personId,
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
      personId: residentHousehold.personId,
    };

    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [feeRate] = await testDatabase.db.insert(feeRates).values({
      rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    }).returning({ id: feeRates.id });
    const dueRows = await testDatabase.db.insert(monthlyDues).values(months.map((month) => ({
      rtUnitId,
      householdId: residentHousehold.householdId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      month,
      amount: 40000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    }))).returning({ id: monthlyDues.id, month: monthlyDues.month });

    const targetMonth = Math.max(...months);
    const request = await createResidentPaymentRequest(database, residentPrincipal, {
      period: `2026-${String(targetMonth).padStart(2, "0")}`,
      idempotencyKey: randomUUID(),
    });
    const [requestRow] = await testDatabase.db.select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode))
      .limit(1);
    return {
      rtUnitId,
      residentPrincipal,
      treasurerPrincipal,
      requestCode: request.requestCode,
      requestId: requestRow!.id,
      totalAmount: request.totalAmount,
      periods: request.periods,
      dueIds: dueRows.map((row) => row.id),
      treasurerAccountId: treasurerAccount!.id,
      householdId: residentHousehold.householdId,
    };
  }

  async function expectRequestUnchanged(scenario: Awaited<ReturnType<typeof createScenario>>) {
    const [request] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, scenario.requestId));
    const dues = await testDatabase.db.select({ id: monthlyDues.id, status: monthlyDues.status })
      .from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    const claims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, scenario.requestId));
    const paymentRows = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, scenario.requestId));
    const allocationRows = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, scenario.requestId));
    const verifyAudit = await testDatabase.db.select().from(auditEvents)
      .where(and(
        eq(auditEvents.action, "payment_request.verified"),
        eq(auditEvents.entityId, scenario.requestId),
      ));

    expect(request).toMatchObject({ status: "pending", verifiedByAccountId: null, verifiedAt: null });
    expect(dues).toHaveLength(scenario.dueIds.length);
    expect(dues.every((due) => due.status === "unpaid")).toBe(true);
    expect(claims).toHaveLength(scenario.dueIds.length);
    expect(paymentRows).toHaveLength(0);
    expect(allocationRows).toHaveLength(0);
    expect(verifyAudit).toHaveLength(0);
  }

  async function installFailureTrigger(name: string, table: string, event: string) {
    await testDatabase.client.exec(`
      CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced phase 6 write failure' USING ERRCODE = '23514';
      END;
      $$;
      CREATE TRIGGER ${name}_trigger ${event} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${name}();
    `);
  }

  async function removeFailureTrigger(name: string, table: string) {
    await testDatabase.client.exec(`DROP TRIGGER ${name}_trigger ON ${table}; DROP FUNCTION ${name}();`);
  }

  it("verifies a multi-month request as one payment and exact allocations, then refreshes the resident read model", async () => {
    const scenario = await createScenario();
    const itemsBefore = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, scenario.requestId));

    const result = await verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode);
    expect(result).toMatchObject({
      requestCode: scenario.requestCode,
      status: "verified",
      itemCount: 3,
      totalAmount: 120000,
    });
    expect(result.verifiedAt).toBeInstanceOf(Date);

    const [request] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, scenario.requestId));
    const paymentRows = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, scenario.requestId));
    const allocationRows = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, scenario.requestId));
    const claims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, scenario.requestId));
    const itemsAfter = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, scenario.requestId));
    const paidDues = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    const verifyAudit = await testDatabase.db.select().from(auditEvents)
      .where(and(
        eq(auditEvents.action, "payment_request.verified"),
        eq(auditEvents.entityId, scenario.requestId),
      ));

    expect(request).toMatchObject({
      status: "verified",
      totalAmount: 120000,
      itemCount: 3,
      verifiedByAccountId: scenario.treasurerAccountId,
    });
    expect(request!.verifiedAt).toBeInstanceOf(Date);
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]).toMatchObject({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      amount: 120000,
      method: "transfer",
      verifiedByAccountId: scenario.treasurerAccountId,
    });
    expect(allocationRows).toHaveLength(3);
    expect(allocationRows.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(120000);
    expect(allocationRows.map((allocation) => allocation.monthlyDueId).sort()).toEqual([...scenario.dueIds].sort());
    expect(claims).toHaveLength(0);
    expect(itemsAfter).toEqual(itemsBefore);
    expect(paidDues.every((due) => due.status === "paid")).toBe(true);
    expect(verifyAudit).toHaveLength(1);
    expect(verifyAudit[0]).toMatchObject({
      actorAppAccountId: scenario.treasurerAccountId,
      entityType: "payment_request",
      context: { itemCount: 3, totalAmount: 120000 },
    });

    const residentDues = await getResidentMonthlyDues(database, scenario.residentPrincipal);
    expect(residentDues.filter((due) => due.status === "paid")).toHaveLength(3);
    expect(residentDues.some((due) => due.paymentRequestStatus === "pending")).toBe(false);
    expect(duesSummary(residentDues)).toEqual({ paid: 120000, pending: 0, unpaid: 0 });
  });

  it("queues same-RT pending requests oldest-first and returns exact immutable detail without internal ids", async () => {
    const scenario = await createScenario([1, 2]);
    await new Promise((resolve) => setTimeout(resolve, 12));
    const secondHousehold = await createHousehold(testDatabase.db, scenario.rtUnitId, { number: `R-${randomUUID().slice(0, 6)}` });
    const secondUser = await createAuthUser(testDatabase.db, "Fixture Resident Two");
    const [secondAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId: scenario.rtUnitId,
      authUserId: secondUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: secondHousehold.personId,
      householdId: secondHousehold.householdId,
    }).returning({ id: appAccounts.id });
    const secondPrincipal: Principal = {
      authUserId: secondUser.id,
      appAccountId: secondAccount!.id,
      role: "resident",
      rtUnitId: scenario.rtUnitId,
      householdId: secondHousehold.householdId,
      personId: secondHousehold.personId,
    };
    const [billingYear] = await testDatabase.db.select({ id: billingYears.id })
      .from(billingYears)
      .where(eq(billingYears.rtUnitId, scenario.rtUnitId))
      .limit(1);
    const [feeRate] = await testDatabase.db.select({ id: feeRates.id })
      .from(feeRates)
      .where(eq(feeRates.billingYearId, billingYear!.id))
      .limit(1);
    await testDatabase.db.insert(monthlyDues).values([1, 2].map((month) => ({
      rtUnitId: scenario.rtUnitId,
      householdId: secondHousehold.householdId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      month,
      amount: 40000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    })));
    const laterRequest = await createResidentPaymentRequest(database, secondPrincipal, {
      period: "2026-02",
      idempotencyKey: randomUUID(),
    });
    const queue = await getTreasurerPaymentRequestQueue(database, scenario.treasurerPrincipal);
    expect(queue.map((request) => request.requestCode)).toEqual([scenario.requestCode, laterRequest.requestCode]);
    expect(queue[0]?.items).toEqual([
      { period: "2026-01", amount: 40000 },
      { period: "2026-02", amount: 40000 },
    ]);
    expect(queue[0]?.residentName.startsWith("Fixture ")).toBe(true);
    expect(queue[0]?.houseNumber.startsWith("R-")).toBe(true);
    expect("id" in queue[0]!).toBe(false);
    expect("rtUnitId" in queue[0]!).toBe(false);

    const detail = await getTreasurerPaymentRequestDetail(database, scenario.treasurerPrincipal, scenario.requestCode);
    expect(detail?.items).toEqual(queue[0]?.items);
    expect(detail?.totalAmount).toBe(80000);
  });

  it("forbids chairman, System Admin, resident, inactive Treasurer, and cross-RT access", async () => {
    const scenario = await createScenario();
    const chairman = { ...scenario.treasurerPrincipal, role: "rt_chairman" as const };
    const systemAdmin: Principal = {
      ...scenario.treasurerPrincipal,
      role: "system_admin",
      rtUnitId: null,
      householdId: null,
      personId: null,
    };
    await expect(verifyTreasurerPaymentRequest(database, chairman, scenario.requestCode)).rejects.toThrow("Forbidden:");
    await expect(verifyTreasurerPaymentRequest(database, systemAdmin, scenario.requestCode)).rejects.toThrow("Forbidden:");
    await expect(verifyTreasurerPaymentRequest(database, scenario.residentPrincipal, scenario.requestCode)).rejects.toThrow("Forbidden:");

    await testDatabase.db.update(officialAssignments)
      .set({ endsOn: "2020-01-02" })
      .where(eq(officialAssignments.appAccountId, scenario.treasurerPrincipal.appAccountId));
    await expect(verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode)).rejects.toThrow("Forbidden:");

    const otherRt = await createScenario();
    await expect(verifyTreasurerPaymentRequest(database, otherRt.treasurerPrincipal, scenario.requestCode))
      .rejects.toBeInstanceOf(TreasurerPaymentRequestNotFoundError);
    expect(await getTreasurerPaymentRequestDetail(database, otherRt.treasurerPrincipal, scenario.requestCode)).toBeNull();
  });

  it.each([
    ["allocation", "payment_allocations", "BEFORE INSERT"],
    ["due", "monthly_dues", "BEFORE UPDATE OF status"],
    ["request", "payment_requests", "BEFORE UPDATE OF status"],
  ])("rolls back payment, allocation, due, request, claims, and audit when the %s write fails", async (_stage, table, event) => {
    const scenario = await createScenario();
    const triggerName = `phase6_fail_${_stage}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    await installFailureTrigger(triggerName, table, event);
    try {
      await expect(verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode)).rejects.toThrow();
      await expectRequestUnchanged(scenario);
    } finally {
      await removeFailureTrigger(triggerName, table);
    }
  });

  it("rolls back every financial change when the verified audit insert fails", async () => {
    const scenario = await createScenario();
    const triggerName = `phase6_fail_audit_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    await testDatabase.client.exec(`
      CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'payment_request.verified' THEN
          RAISE EXCEPTION 'forced phase 6 audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${triggerName}_trigger BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION ${triggerName}();
    `);
    try {
      await expect(verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode)).rejects.toThrow();
      await expectRequestUnchanged(scenario);
    } finally {
      await testDatabase.client.exec(`DROP TRIGGER ${triggerName}_trigger ON audit_events; DROP FUNCTION ${triggerName}();`);
    }
  });

  it("enforces ledger totals, uniqueness, append-only rows, and allocation-backed paid dues at commit", async () => {
    const pending = await createScenario();
    const pendingItems = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, pending.requestId));
    await expect(testDatabase.db.transaction(async (transaction) => {
      await transaction.insert(payments).values({
        rtUnitId: pending.rtUnitId,
        householdId: pending.householdId,
        paymentRequestId: pending.requestId,
        amount: pending.totalAmount,
        method: "transfer",
        verifiedByAccountId: pending.treasurerAccountId,
        verifiedByAccountType: "official",
      });
    })).rejects.toThrow();
    await expect(testDatabase.db.update(monthlyDues)
      .set({ status: "paid" })
      .where(eq(monthlyDues.id, pendingItems[0]!.monthlyDueId)))
      .rejects.toThrow();
    await expectRequestUnchanged(pending);

    const verified = await createScenario();
    await verifyTreasurerPaymentRequest(database, verified.treasurerPrincipal, verified.requestCode);
    const [payment] = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, verified.requestId));
    const [allocation] = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, verified.requestId));

    await expect(testDatabase.db.insert(payments).values({
      rtUnitId: verified.rtUnitId,
      householdId: verified.householdId,
      paymentRequestId: verified.requestId,
      amount: 0,
      method: "transfer",
      verifiedByAccountId: verified.treasurerAccountId,
      verifiedByAccountType: "official",
    })).rejects.toThrow();
    await expect(testDatabase.db.insert(payments).values({
      rtUnitId: verified.rtUnitId,
      householdId: verified.householdId,
      paymentRequestId: verified.requestId,
      amount: verified.totalAmount,
      method: "transfer",
      verifiedByAccountId: verified.treasurerAccountId,
      verifiedByAccountType: "official",
    })).rejects.toThrow();
    await expect(testDatabase.db.insert(paymentAllocations).values({
      rtUnitId: allocation!.rtUnitId,
      householdId: allocation!.householdId,
      paymentRequestId: allocation!.paymentRequestId,
      paymentId: payment!.id,
      monthlyDueId: allocation!.monthlyDueId,
      amount: allocation!.amount,
    })).rejects.toThrow();
    await expect(testDatabase.db.update(payments)
      .set({ amount: verified.totalAmount + 1 })
      .where(eq(payments.id, payment!.id)))
      .rejects.toThrow();
    await expect(testDatabase.db.delete(payments).where(eq(payments.id, payment!.id))).rejects.toThrow();
    await expect(testDatabase.db.delete(paymentAllocations)
      .where(eq(paymentAllocations.id, allocation!.id)))
      .rejects.toThrow();
  });

  it("serializes duplicate verify attempts and returns a safe already-processed result", async () => {
    const scenario = await createScenario();
    const attempts = await Promise.allSettled([
      verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode),
      verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const failures = attempts.filter((attempt) => attempt.status === "rejected");
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason).toBeInstanceOf(TreasurerPaymentRequestAlreadyProcessedError);
    expect(await testDatabase.db.select().from(payments).where(eq(payments.paymentRequestId, scenario.requestId))).toHaveLength(1);
    expect(await testDatabase.db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentRequestId, scenario.requestId))).toHaveLength(3);
    expect(await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment_request.verified"),
      eq(auditEvents.entityId, scenario.requestId),
    ))).toHaveLength(1);
    await expect(verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode))
      .rejects.toBeInstanceOf(TreasurerPaymentRequestAlreadyProcessedError);
  });
});
