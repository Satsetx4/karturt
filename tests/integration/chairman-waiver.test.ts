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
  paymentRequests,
  paymentReversals,
  payments,
  waiverActions,
  waiverItems,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import {
  ChairmanWaiverConflictError,
  ChairmanWaiverIdempotencyConflictError,
  createChairmanWaiver,
  getChairmanWaiverHousehold,
} from "@/lib/billing/chairman-waiver";
import {
  createResidentPaymentRequest,
  PaymentRequestPeriodUnavailableError,
} from "@/lib/billing/resident-payment-request";
import {
  CashPaymentDueConflictError,
  recordTreasurerCashPayment,
} from "@/lib/billing/treasurer-cash-payments";
import { cancelResidentPaymentRequest, rejectTreasurerPaymentRequest } from "@/lib/billing/payment-request-resolution";
import { reverseTreasurerPayment } from "@/lib/billing/treasurer-payment-reversal";
import { verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type Scenario = {
  rtUnitId: string;
  householdId: string;
  residentPrincipal: Principal;
  chairmanPrincipal: Principal;
  treasurerPrincipal: Principal;
  dueIds: Map<number, string>;
};

const businessDate = "2026-10-02";
const defaultReason = "Pemutihan sesuai keputusan rapat RT";

describe("Chairman waiver transaction and concurrency", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createScenario(options: {
    months?: number[];
    notDueMonths?: number[];
  } = {}) {
    const months = options.months ?? [1, 2, 3];
    const notDueMonths = new Set(options.notDueMonths ?? []);
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId, {
      number: `W-${randomUUID().slice(0, 6)}`,
    });

    const residentUser = await createAuthUser(testDatabase.db, "Resident Waiver Fixture");
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

    const chairmanUser = await createAuthUser(testDatabase.db, "Chairman Waiver Fixture");
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

    const treasurerUser = await createAuthUser(testDatabase.db, "Treasurer Waiver Fixture");
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
    const dueRows = await testDatabase.db.insert(monthlyDues).values(months.map((month) => {
      const notDue = notDueMonths.has(month);
      return {
        rtUnitId,
        householdId: household.householdId,
        billingYearId: billingYear!.id,
        feeRateId: notDue ? null : feeRate!.id,
        month,
        amount: notDue ? 0 : 40000,
        dueDate: `2026-${String(month).padStart(2, "0")}-10`,
        status: notDue ? "not_due" as const : "unpaid" as const,
      };
    })).returning({ id: monthlyDues.id, month: monthlyDues.month });

    return {
      rtUnitId,
      householdId: household.householdId,
      residentPrincipal,
      chairmanPrincipal,
      treasurerPrincipal,
      dueIds: new Map(dueRows.map((row) => [row.month, row.id])),
    };
  }

  function waiver(scenario: Scenario, periods: string[], idempotencyKey = randomUUID(), reason = defaultReason) {
    return createChairmanWaiver(database, scenario.chairmanPrincipal, {
      householdId: scenario.householdId,
      periods,
      reason,
      idempotencyKey,
    }, businessDate);
  }

  async function addAdjustment(scenario: Scenario, dueId: string, amountDelta: number, effectiveTargetAfter: number) {
    const id = randomUUID();
    const reason = "Penyesuaian sebelum pemutihan";
    await testDatabase.db.transaction(async (transaction) => {
      await transaction.insert(dueAdjustments).values({
        id,
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        monthlyDueId: dueId,
        amountDelta,
        effectiveTargetAfter,
        reason,
        adjustedByAccountId: scenario.chairmanPrincipal.appAccountId,
        adjustedByAccountType: "official",
        idempotencyKey: randomUUID(),
        requestFingerprint: createHash("sha256").update(`${id}:${amountDelta}`).digest("hex"),
      });
      await transaction.insert(auditEvents).values({
        actorAppAccountId: scenario.chairmanPrincipal.appAccountId,
        action: "billing.adjustment_created",
        entityType: "due_adjustment",
        entityId: id,
        reason,
        context: {
          amountDelta,
          effectiveTargetAfter,
          originalAmount: 40000,
        },
      });
    });
  }

  async function expectNoNewWaiver(scenario: Scenario) {
    expect(await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, scenario.householdId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.householdId, scenario.householdId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(auditEvents)
      .where(and(eq(auditEvents.action, "waiver.created"), eq(auditEvents.actorAppAccountId, scenario.chairmanPrincipal.appAccountId)))).toHaveLength(0);
  }

  it("records three selected months as one atomic action, item set, due change, and audit", async () => {
    const scenario = await createScenario();
    const result = await waiver(scenario, ["2026-03", "2026-01", "2026-02"]);
    const actions = await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, scenario.householdId));
    const items = await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.householdId, scenario.householdId));
    const dues = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, [...scenario.dueIds.values()]));
    const audits = await testDatabase.db.select().from(auditEvents)
      .where(and(eq(auditEvents.action, "waiver.created"), eq(auditEvents.actorAppAccountId, scenario.chairmanPrincipal.appAccountId)));

    expect(result).toMatchObject({ periods: ["2026-01", "2026-02", "2026-03"], totalAmount: 120000, reason: defaultReason, idempotentReplay: false });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ itemCount: 3, totalAmount: 120000, reason: defaultReason, waivedByAccountId: scenario.chairmanPrincipal.appAccountId });
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.period).sort()).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(items.every((item) => item.amount === 40000)).toBe(true);
    expect(dues.every((due) => due.status === "waived" && due.waivedReason === defaultReason)).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: "waiver_action",
      entityId: actions[0]!.id,
      reason: defaultReason,
      context: { itemCount: 3, periods: "2026-01,2026-02,2026-03", totalAmount: 120000 },
    });
    expect(await testDatabase.db.select().from(activeDueSettlements)
      .where(inArray(activeDueSettlements.monthlyDueId, [...scenario.dueIds.values()]))).toHaveLength(0);
    expect(await testDatabase.db.select().from(paymentRequestClaims)
      .where(inArray(paymentRequestClaims.monthlyDueId, [...scenario.dueIds.values()]))).toHaveLength(0);
  });

  it("shows and snapshots effective target when an adjusted unpaid due is waived", async () => {
    const scenario = await createScenario({ months: [1] });
    const dueId = scenario.dueIds.get(1)!;
    await addAdjustment(scenario, dueId, 15000, 55000);

    const detail = await getChairmanWaiverHousehold(
      database,
      scenario.chairmanPrincipal,
      scenario.householdId,
      businessDate,
    );
    expect(detail.dues).toMatchObject([
      { period: "2026-01", amount: 55000, statusLabel: "Belum bayar", selectable: true },
    ]);

    const result = await waiver(scenario, ["2026-01"]);
    const [item] = await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.monthlyDueId, dueId));
    const [action] = await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, scenario.householdId));
    expect(result.totalAmount).toBe(55000);
    expect(item?.amount).toBe(55000);
    expect(action?.totalAmount).toBe(55000);
  });

  it("rolls back the entire batch when any selected period is paid, pending, not due, or already waived", async () => {
    const paid = await createScenario({ months: [1, 2] });
    await recordTreasurerCashPayment(database, paid.treasurerPrincipal, {
      householdId: paid.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, businessDate);
    await expect(waiver(paid, ["2026-01", "2026-02"])).rejects.toBeInstanceOf(ChairmanWaiverConflictError);
    const paidDues = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, [...paid.dueIds.values()]));
    expect(paidDues.find((due) => due.month === 1)?.status).toBe("paid");
    expect(paidDues.find((due) => due.month === 2)?.status).toBe("unpaid");
    await expectNoNewWaiver(paid);

    const pending = await createScenario({ months: [1, 2] });
    const pendingRequest = await createResidentPaymentRequest(database, pending.residentPrincipal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    await expect(waiver(pending, ["2026-01", "2026-02"])).rejects.toBeInstanceOf(ChairmanWaiverConflictError);
    const pendingDues = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, [...pending.dueIds.values()]));
    expect(pendingDues.every((due) => due.status === "unpaid")).toBe(true);
    const [pendingRequestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, pendingRequest.requestCode));
    expect(pendingRequestRow?.status).toBe("pending");
    expect(await testDatabase.db.select().from(paymentRequestClaims)
      .where(inArray(paymentRequestClaims.monthlyDueId, [...pending.dueIds.values()]))).toHaveLength(1);
    await expectNoNewWaiver(pending);

    const notDue = await createScenario({ months: [1, 2], notDueMonths: [2] });
    await expect(waiver(notDue, ["2026-01", "2026-02"])).rejects.toBeInstanceOf(ChairmanWaiverConflictError);
    const notDueRows = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, [...notDue.dueIds.values()]));
    expect(notDueRows.find((due) => due.month === 1)?.status).toBe("unpaid");
    expect(notDueRows.find((due) => due.month === 2)?.status).toBe("not_due");
    await expectNoNewWaiver(notDue);

    const alreadyWaived = await createScenario({ months: [1, 2] });
    await waiver(alreadyWaived, ["2026-01"], randomUUID(), "Pemutihan awal bulan pertama");
    await expect(waiver(alreadyWaived, ["2026-01", "2026-02"])).rejects.toBeInstanceOf(ChairmanWaiverConflictError);
    const waivedRows = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, [...alreadyWaived.dueIds.values()]));
    expect(waivedRows.find((due) => due.month === 1)?.status).toBe("waived");
    expect(waivedRows.find((due) => due.month === 2)?.status).toBe("unpaid");
    expect(await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, alreadyWaived.householdId))).toHaveLength(1);
    expect(await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.householdId, alreadyWaived.householdId))).toHaveLength(1);
  });

  it("rolls back the ledger and due updates if the audit insert fails", async () => {
    const scenario = await createScenario({ months: [1, 2] });
    await testDatabase.client.exec(`
      CREATE FUNCTION fail_phase10_waiver_audit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'waiver.created' THEN
          RAISE EXCEPTION 'forced phase 10 audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_phase10_waiver_audit_v1_trigger
      BEFORE INSERT ON public.audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_phase10_waiver_audit_v1();
    `);

    try {
      await expect(waiver(scenario, ["2026-01", "2026-02"])).rejects.toThrow();
    } finally {
      await testDatabase.client.exec(`
        DROP TRIGGER fail_phase10_waiver_audit_v1_trigger ON public.audit_events;
        DROP FUNCTION fail_phase10_waiver_audit_v1();
      `);
    }

    const dues = await testDatabase.db.select().from(monthlyDues)
      .where(inArray(monthlyDues.id, [...scenario.dueIds.values()]));
    expect(dues.every((due) => due.status === "unpaid" && due.waivedReason === null)).toBe(true);
    await expectNoNewWaiver(scenario);
  });

  it("replays a matching idempotency key and rejects a changed fingerprint", async () => {
    const scenario = await createScenario({ months: [1, 2] });
    const key = randomUUID();
    const [first, second] = await Promise.all([
      waiver(scenario, ["2026-02", "2026-01"], key),
      waiver(scenario, ["2026-01", "2026-02"], key),
    ]);
    expect([first.idempotentReplay, second.idempotentReplay].sort()).toEqual([false, true]);
    expect(second).toMatchObject({ ...first, idempotentReplay: second.idempotentReplay });
    expect(await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, scenario.householdId))).toHaveLength(1);
    expect(await testDatabase.db.select().from(auditEvents)
      .where(and(eq(auditEvents.action, "waiver.created"), eq(auditEvents.actorAppAccountId, scenario.chairmanPrincipal.appAccountId)))).toHaveLength(1);

    await expect(waiver(scenario, ["2026-01", "2026-02"], key, "Alasan yang berbeda"))
      .rejects.toBeInstanceOf(ChairmanWaiverIdempotencyConflictError);
    await expect(waiver(scenario, ["2026-01"], key))
      .rejects.toBeInstanceOf(ChairmanWaiverIdempotencyConflictError);
    const otherHousehold = await createHousehold(testDatabase.db, scenario.rtUnitId, {
      number: `W-${randomUUID().slice(0, 6)}`,
    });
    await expect(createChairmanWaiver(database, scenario.chairmanPrincipal, {
      householdId: otherHousehold.householdId,
      periods: ["2026-01", "2026-02"],
      reason: defaultReason,
      idempotencyKey: key,
    }, businessDate)).rejects.toBeInstanceOf(ChairmanWaiverIdempotencyConflictError);
  });

  it("serializes concurrent Chairman attempts so a due has one waiver action", async () => {
    const scenario = await createScenario({ months: [1] });
    const attempts = await Promise.allSettled([
      waiver(scenario, ["2026-01"], randomUUID(), "Keputusan sesi A"),
      waiver(scenario, ["2026-01"], randomUUID(), "Keputusan sesi B"),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, scenario.householdId))).toHaveLength(1);
    expect(await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.householdId, scenario.householdId))).toHaveLength(1);
    const [due] = await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, scenario.dueIds.get(1)!));
    expect(due?.status).toBe("waived");
  });

  it("serializes resident request creation against a waiver without pending-plus-waived state", async () => {
    const scenario = await createScenario({ months: [1] });
    const [requestAttempt, waiverAttempt] = await Promise.allSettled([
      createResidentPaymentRequest(database, scenario.residentPrincipal, {
        period: "2026-01",
        idempotencyKey: randomUUID(),
      }),
      waiver(scenario, ["2026-01"]),
    ]);
    const [due] = await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, scenario.dueIds.get(1)!));
    const claims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.monthlyDueId, scenario.dueIds.get(1)!));
    const requests = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.householdId, scenario.householdId));

    expect(requestAttempt.status === "fulfilled" || requestAttempt.reason instanceof PaymentRequestPeriodUnavailableError).toBe(true);
    expect(waiverAttempt.status === "fulfilled" || waiverAttempt.reason instanceof ChairmanWaiverConflictError).toBe(true);
    expect(requestAttempt.status === "fulfilled" && waiverAttempt.status === "fulfilled").toBe(false);
    if (waiverAttempt.status === "fulfilled") {
      expect(due?.status).toBe("waived");
      expect(claims).toHaveLength(0);
      expect(requests).toHaveLength(0);
    } else {
      expect(due?.status).toBe("unpaid");
      expect(claims).toHaveLength(1);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.status).toBe("pending");
      await expectNoNewWaiver(scenario);
    }
  });

  it("serializes cash settlement against a waiver without paid-plus-waived ownership", async () => {
    const scenario = await createScenario({ months: [1] });
    const [cashAttempt, waiverAttempt] = await Promise.allSettled([
      recordTreasurerCashPayment(database, scenario.treasurerPrincipal, {
        householdId: scenario.householdId,
        period: "2026-01",
        idempotencyKey: randomUUID(),
      }, businessDate),
      waiver(scenario, ["2026-01"]),
    ]);
    const dueId = scenario.dueIds.get(1)!;
    const [due] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, dueId));
    const owners = await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, dueId));
    const items = await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.monthlyDueId, dueId));

    expect(cashAttempt.status === "fulfilled" || cashAttempt.reason instanceof CashPaymentDueConflictError).toBe(true);
    expect(waiverAttempt.status === "fulfilled" || waiverAttempt.reason instanceof ChairmanWaiverConflictError).toBe(true);
    expect(cashAttempt.status === "fulfilled" && waiverAttempt.status === "fulfilled").toBe(false);
    if (waiverAttempt.status === "fulfilled") {
      expect(due?.status).toBe("waived");
      expect(items).toHaveLength(1);
      expect(owners).toHaveLength(0);
    } else {
      expect(due?.status).toBe("paid");
      expect(items).toHaveLength(0);
      expect(owners).toHaveLength(1);
      await expectNoNewWaiver(scenario);
    }
  });

  it("blocks waiver while a transfer is pending, then preserves verified payment state", async () => {
    const scenario = await createScenario({ months: [1] });
    const request = await createResidentPaymentRequest(database, scenario.residentPrincipal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    const [verifyAttempt, waiverAttempt] = await Promise.allSettled([
      verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, request.requestCode),
      waiver(scenario, ["2026-01"]),
    ]);
    expect(verifyAttempt.status).toBe("fulfilled");
    expect(waiverAttempt.status).toBe("rejected");
    if (waiverAttempt.status === "rejected") expect(waiverAttempt.reason).toBeInstanceOf(ChairmanWaiverConflictError);

    const [requestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode));
    const dueId = scenario.dueIds.get(1)!;
    const [due] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, dueId));
    expect(requestRow?.status).toBe("verified");
    expect(due?.status).toBe("paid");
    expect(await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.monthlyDueId, dueId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, dueId))).toHaveLength(1);
    await expectNoNewWaiver(scenario);
  });

  it("allows waiver after transfer and cash reversals without deleting payment history", async () => {
    const transfer = await createScenario({ months: [1] });
    const request = await createResidentPaymentRequest(database, transfer.residentPrincipal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    await verifyTreasurerPaymentRequest(database, transfer.treasurerPrincipal, request.requestCode, businessDate);
    const [transferPayment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, transfer.rtUnitId), eq(payments.method, "transfer")));
    const transferAllocationsBefore = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, transferPayment!.id));
    await reverseTreasurerPayment(database, transfer.treasurerPrincipal, {
      paymentId: transferPayment!.id,
      reason: "Koreksi transfer sebelum pemutihan",
    }, businessDate);
    await waiver(transfer, ["2026-01"]);
    expect(await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, transferPayment!.id))).toHaveLength(1);
    expect(await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, transferPayment!.id))).toEqual(transferAllocationsBefore);
    expect(await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, transfer.dueIds.get(1)!))).toHaveLength(0);
    expect((await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, transfer.dueIds.get(1)!)))[0]?.status).toBe("waived");
    expect((await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode)))[0]?.status).toBe("verified");

    const cash = await createScenario({ months: [2] });
    await recordTreasurerCashPayment(database, cash.treasurerPrincipal, {
      householdId: cash.householdId,
      period: "2026-02",
      idempotencyKey: randomUUID(),
    }, businessDate);
    const [cashPayment] = await testDatabase.db.select().from(payments)
      .where(and(eq(payments.rtUnitId, cash.rtUnitId), eq(payments.method, "cash")));
    const cashAllocationsBefore = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, cashPayment!.id));
    await reverseTreasurerPayment(database, cash.treasurerPrincipal, {
      paymentId: cashPayment!.id,
      reason: "Koreksi tunai sebelum pemutihan",
    }, businessDate);
    await waiver(cash, ["2026-02"]);
    expect(await testDatabase.db.select().from(paymentReversals)
      .where(eq(paymentReversals.paymentId, cashPayment!.id))).toHaveLength(1);
    expect(await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, cashPayment!.id))).toEqual(cashAllocationsBefore);
    expect(await testDatabase.db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, cash.dueIds.get(2)!))).toHaveLength(0);
    expect((await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, cash.dueIds.get(2)!)))[0]?.status).toBe("waived");
  });

  it.each(["cancelled", "rejected"] as const)("allows waiver after a %s request while preserving terminal history", async (terminalStatus) => {
    const scenario = await createScenario({ months: [1] });
    const request = await createResidentPaymentRequest(database, scenario.residentPrincipal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
    if (terminalStatus === "cancelled") {
      await cancelResidentPaymentRequest(database, scenario.residentPrincipal, request.requestCode);
    } else {
      await rejectTreasurerPaymentRequest(database, scenario.treasurerPrincipal, request.requestCode, "Bukti transfer tidak sesuai.", businessDate);
    }
    await waiver(scenario, ["2026-01"]);
    const [requestRow] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, request.requestCode));
    const [due] = await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, scenario.dueIds.get(1)!));
    expect(requestRow?.status).toBe(terminalStatus);
    expect(due?.status).toBe("waived");
    expect(await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.monthlyDueId, scenario.dueIds.get(1)!))).toHaveLength(0);
    expect(await testDatabase.db.select().from(auditEvents)
      .where(and(eq(auditEvents.action, `payment_request.${terminalStatus}`), eq(auditEvents.entityId, requestRow!.id)))).toHaveLength(1);
    expect(await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, scenario.householdId))).toHaveLength(1);
  });
});
