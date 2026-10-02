import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appAccounts,
  auditEvents,
  billingYears,
  monthlyDues,
  officialAssignments,
  paymentRequests,
  waiverActions,
  waiverItems,
} from "../../src/db/schema";
import { createResidentPaymentRequest } from "../../src/lib/billing/resident-payment-request";
import { recordTreasurerCashPayment } from "../../src/lib/billing/treasurer-cash-payments";
import type { Principal } from "../../src/lib/auth/permissions";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("waiver ledger database constraints", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => { testDatabase = await createTestDatabase(); });
  afterAll(async () => { if (testDatabase) await testDatabase.close(); });

  async function createScenario(months: number[]) {
    const db = testDatabase.db;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const actorUser = await createAuthUser(db);
    const [actor] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: actorUser.id,
      accountType: "official",
      loginIdentifier: `chair-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" })
      .returning({ id: billingYears.id });
    const [rate] = await createFeeRateFixture(db, {
      rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    const dues = await db.insert(monthlyDues).values(months.map((month) => ({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year!.id,
      feeRateId: rate!.id,
      month,
      amount: 40000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    }))).returning({ id: monthlyDues.id, month: monthlyDues.month, amount: monthlyDues.amount });

    return {
      rtUnitId,
      householdId: household.householdId,
      personId: household.personId,
      actorAuthUserId: actorUser.id,
      actorAccountId: actor!.id,
      billingYearId: year!.id,
      feeRateId: rate!.id,
      dues,
    };
  }

  async function createWaiver(
    scenario: Awaited<ReturnType<typeof createScenario>>,
    dueRows = scenario.dues,
    options: {
      reason?: string;
      dueReason?: string;
      itemAmounts?: number[];
      itemCount?: number;
      totalAmount?: number;
      audit?: boolean;
      auditReason?: string;
      auditPeriods?: string;
    } = {},
  ) {
    const reason = options.reason ?? "Kesepakatan warga untuk periode terpilih";
    const itemAmounts = options.itemAmounts ?? dueRows.map((due) => due.amount);
    const totalAmount = options.totalAmount ?? itemAmounts.reduce((sum, amount) => sum + amount, 0);
    const periods = dueRows.map((due) => `2026-${String(due.month).padStart(2, "0")}`).sort();
    const actionId = randomUUID();

    await testDatabase.db.transaction(async (transaction) => {
      await transaction.insert(waiverActions).values({
        id: actionId,
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        waivedByAccountId: scenario.actorAccountId,
        waivedByAccountType: "official",
        reason,
        itemCount: options.itemCount ?? dueRows.length,
        totalAmount,
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
      });
      await transaction.insert(waiverItems).values(dueRows.map((due, index) => ({
        waiverActionId: actionId,
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        monthlyDueId: due.id,
        period: `2026-${String(due.month).padStart(2, "0")}`,
        amount: itemAmounts[index]!,
      })));
      await transaction.update(monthlyDues).set({ status: "waived", waivedReason: options.dueReason ?? reason })
        .where(inArray(monthlyDues.id, dueRows.map((due) => due.id)));
      if (options.audit !== false) {
        await transaction.insert(auditEvents).values({
          actorAppAccountId: scenario.actorAccountId,
          action: "waiver.created",
          entityType: "waiver_action",
          entityId: actionId,
          reason: options.auditReason ?? reason,
          context: {
            itemCount: options.itemCount ?? dueRows.length,
            periods: options.auditPeriods ?? periods.join(","),
            totalAmount,
          },
        });
      }
    });
    return actionId;
  }

  it("accepts one atomic action, complete item set, waived dues, and one matching audit", async () => {
    const scenario = await createScenario([1, 2, 3]);
    const chosen = scenario.dues.slice(0, 2);
    const actionId = await createWaiver(scenario, chosen);
    const db = testDatabase.db;

    expect(await db.select().from(waiverActions).where(eq(waiverActions.id, actionId))).toHaveLength(1);
    expect(await db.select().from(waiverItems).where(eq(waiverItems.waiverActionId, actionId))).toMatchObject([
      { monthlyDueId: chosen[0]!.id, period: "2026-01", amount: 40000 },
      { monthlyDueId: chosen[1]!.id, period: "2026-02", amount: 40000 },
    ]);
    expect((await db.select().from(monthlyDues).where(inArray(monthlyDues.id, chosen.map((due) => due.id))))
      .map((due) => due.status)).toEqual(["waived", "waived"]);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.entityId, actionId))).toMatchObject([
      { action: "waiver.created", entityType: "waiver_action", reason: "Kesepakatan warga untuk periode terpilih" },
    ]);

    await expect(db.update(monthlyDues).set({ status: "unpaid", waivedReason: null })
      .where(eq(monthlyDues.id, chosen[0]!.id))).rejects.toThrow();
  });

  it("enforces actor-scoped idempotency and one structured waiver per due", async () => {
    const scenario = await createScenario([1, 2]);
    const due = scenario.dues[0]!;
    const actionId = await createWaiver(scenario, [due]);
    const [existing] = await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.id, actionId));

    await expect(testDatabase.db.insert(waiverActions).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      waivedByAccountId: scenario.actorAccountId,
      waivedByAccountType: "official",
      reason: "Percobaan retry key untuk payload lain",
      itemCount: 1,
      totalAmount: 40000,
      idempotencyKey: existing!.idempotencyKey,
      requestFingerprint: "b".repeat(64),
    })).rejects.toThrow();

    await expect(testDatabase.db.transaction(async (transaction) => {
      const [secondAction] = await transaction.insert(waiverActions).values({
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        waivedByAccountId: scenario.actorAccountId,
        waivedByAccountType: "official",
        reason: "Percobaan waiver kedua untuk due yang sama",
        itemCount: 1,
        totalAmount: 40000,
        idempotencyKey: randomUUID(),
        requestFingerprint: "c".repeat(64),
      }).returning({ id: waiverActions.id });
      await transaction.insert(waiverItems).values({
        waiverActionId: secondAction!.id,
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        monthlyDueId: due.id,
        period: "2026-01",
        amount: due.amount,
      });
    })).rejects.toThrow();
    expect(await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, scenario.householdId))).toHaveLength(1);
  });

  it("rolls back WAIVED status when its structured ledger and audit are absent", async () => {
    const scenario = await createScenario([3]);
    const due = scenario.dues[0]!;
    await expect(testDatabase.db.update(monthlyDues)
      .set({ status: "waived", waivedReason: "Tidak ada action" })
      .where(eq(monthlyDues.id, due.id))).rejects.toThrow();
    const [after] = await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, due.id));
    expect(after).toMatchObject({ status: "unpaid", waivedReason: null });
  });

  it("requires due snapshots, reason, item count, total, and audit to match exactly", async () => {
    const mismatchedSnapshot = await createScenario([4]);
    await expect(createWaiver(mismatchedSnapshot, mismatchedSnapshot.dues, {
      itemAmounts: [30000],
      totalAmount: 30000,
    })).rejects.toThrow();

    const mismatchedReason = await createScenario([5]);
    await expect(createWaiver(mismatchedReason, mismatchedReason.dues, {
      dueReason: "Reason differs from the action",
    })).rejects.toThrow();

    const incomplete = await createScenario([6]);
    await expect(createWaiver(incomplete, incomplete.dues, { audit: false })).rejects.toThrow();

    const badCount = await createScenario([7]);
    await expect(createWaiver(badCount, badCount.dues, { itemCount: 2 })).rejects.toThrow();

    for (const scenario of [mismatchedSnapshot, mismatchedReason, incomplete, badCount]) {
      const [due] = await testDatabase.db.select().from(monthlyDues)
        .where(eq(monthlyDues.id, scenario.dues[0]!.id));
      expect(due).toMatchObject({ status: "unpaid", waivedReason: null });
      expect(await testDatabase.db.select().from(waiverActions)
        .where(eq(waiverActions.householdId, scenario.householdId))).toHaveLength(0);
    }
  });

  it("blocks an active pending payment request claim from coexisting with a waiver", async () => {
    const scenario = await createScenario([8]);
    const db = testDatabase.db;
    const residentUser = await createAuthUser(db);
    const [resident] = await db.insert(appAccounts).values({
      rtUnitId: scenario.rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: scenario.personId,
      householdId: scenario.householdId,
    }).returning({ id: appAccounts.id });
    const principal: Principal = {
      authUserId: residentUser.id,
      appAccountId: resident!.id,
      role: "resident",
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      personId: scenario.personId,
    };
    const request = await createResidentPaymentRequest(db as never, principal, {
      period: "2026-08",
      idempotencyKey: randomUUID(),
    });
    expect(await db.select().from(paymentRequests)
      .where(eq(paymentRequests.householdId, scenario.householdId))).toHaveLength(1);

    await expect(createWaiver(scenario)).rejects.toThrow();
    const [due] = await db.select().from(monthlyDues).where(eq(monthlyDues.id, scenario.dues[0]!.id));
    expect(due).toMatchObject({ status: "unpaid", waivedReason: null });
    expect(request.status).toBe("pending");
    expect(await db.select().from(waiverActions)
      .where(eq(waiverActions.householdId, scenario.householdId))).toHaveLength(0);
  });

  it("rejects direct WAIVED creation and transitions from NOT_DUE or PAID", async () => {
    const scenario = await createScenario([9]);
    await expect(testDatabase.db.insert(monthlyDues).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      billingYearId: scenario.billingYearId,
      feeRateId: scenario.feeRateId,
      month: 10,
      amount: 40000,
      dueDate: "2026-10-10",
      status: "waived",
      waivedReason: "Tidak boleh dibuat langsung",
    })).rejects.toThrow();

    const notDueScenario = await createScenario([10]);
    const [notDueRow] = await testDatabase.db.insert(monthlyDues).values({
      rtUnitId: notDueScenario.rtUnitId,
      householdId: notDueScenario.householdId,
      billingYearId: notDueScenario.billingYearId,
      feeRateId: null,
      month: 11,
      amount: 0,
      dueDate: "2026-11-10",
      status: "not_due",
    }).returning({ id: monthlyDues.id });
    await expect(testDatabase.db.update(monthlyDues)
      .set({ status: "waived", waivedReason: "Bukan kewajiban" })
      .where(eq(monthlyDues.id, notDueRow!.id))).rejects.toThrow();

    const paidScenario = await createScenario([9]);
    const db = testDatabase.db;
    await db.insert(officialAssignments).values({
      rtUnitId: paidScenario.rtUnitId,
      appAccountId: paidScenario.actorAccountId,
      role: "treasurer",
      startsOn: "2020-01-01",
    });
    const treasurerPrincipal: Principal = {
      authUserId: paidScenario.actorAuthUserId,
      appAccountId: paidScenario.actorAccountId,
      role: "treasurer",
      rtUnitId: paidScenario.rtUnitId,
      householdId: null,
      personId: paidScenario.personId,
    };
    await recordTreasurerCashPayment(db as never, treasurerPrincipal, {
      householdId: paidScenario.householdId,
      period: "2026-09",
      idempotencyKey: randomUUID(),
    }, "2026-10-02");
    await expect(db.update(monthlyDues).set({ status: "waived", waivedReason: "Sudah dibayar" })
      .where(eq(monthlyDues.id, paidScenario.dues[0]!.id))).rejects.toThrow();
  });

  it("forbids rewriting or truncating either append-only waiver ledger table", async () => {
    const scenario = await createScenario([11]);
    const actionId = await createWaiver(scenario);
    const [action] = await testDatabase.db.select().from(waiverActions)
      .where(eq(waiverActions.id, actionId));
    const [item] = await testDatabase.db.select().from(waiverItems)
      .where(eq(waiverItems.waiverActionId, actionId));

    await expect(testDatabase.db.update(waiverActions).set({ reason: "Rewritten" })
      .where(eq(waiverActions.id, action!.id))).rejects.toThrow();
    await expect(testDatabase.db.delete(waiverActions).where(eq(waiverActions.id, action!.id))).rejects.toThrow();
    await expect(testDatabase.db.update(waiverItems).set({ amount: 1 })
      .where(eq(waiverItems.waiverActionId, item!.waiverActionId))).rejects.toThrow();
    await expect(testDatabase.db.delete(waiverItems)
      .where(eq(waiverItems.waiverActionId, item!.waiverActionId))).rejects.toThrow();
    await expect(testDatabase.client.exec("TRUNCATE TABLE public.waiver_actions")).rejects.toThrow();
    await expect(testDatabase.client.exec("TRUNCATE TABLE public.waiver_items")).rejects.toThrow();
  });
});
