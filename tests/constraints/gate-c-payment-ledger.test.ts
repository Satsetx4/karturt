import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  billingYears,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentReversals,
  payments,
} from "../../src/db/schema";
import type { Principal } from "../../src/lib/auth/permissions";
import { createChairmanAdjustment } from "../../src/lib/billing/chairman-adjustment";
import { createResidentPaymentRequest } from "../../src/lib/billing/resident-payment-request";
import { recordTreasurerCashPayment } from "../../src/lib/billing/treasurer-cash-payments";
import { reverseTreasurerPayment } from "../../src/lib/billing/treasurer-payment-reversal";
import { verifyTreasurerPaymentRequest } from "../../src/lib/billing/treasurer-payment-verification";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
} from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type Scenario = {
  rtUnitId: string;
  householdId: string;
  otherHouseholdId: string;
  foreignRtUnitId: string;
  foreignHouseholdId: string;
  treasurerAccountId: string;
  treasurerPrincipal: Principal;
  chairmanPrincipal: Principal;
  residentPrincipal: Principal;
  dueIds: { adjusted: string; transfer: string; unpaid: string; otherHousehold: string; foreignRt: string };
};

const businessDate = "2026-10-02";
const originalAmount = 40000;

async function addOfficial(
  database: TestDatabase["db"],
  rtUnitId: string,
  personId: string,
  role: "treasurer" | "rt_chairman",
) {
  const user = await createAuthUser(database);
  const [account] = await database.insert(appAccounts).values({
    rtUnitId,
    authUserId: user.id,
    accountType: "official",
    loginIdentifier: `${role}-${randomUUID()}`,
    personId,
  }).returning({ id: appAccounts.id });
  await database.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: account!.id,
    role,
    startsOn: "2020-01-01",
  });
  return {
    userId: user.id,
    accountId: account!.id,
    principal: {
      authUserId: user.id,
      appAccountId: account!.id,
      role,
      rtUnitId,
      householdId: null,
      personId,
    } satisfies Principal,
  };
}

describe("Gate C payment ledger invariants", () => {
  let testDatabase: TestDatabase;
  let scenario: Scenario;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    const db = testDatabase.db;

    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const otherHousehold = await createHousehold(db, rtUnitId);
    const treasurer = await addOfficial(db, rtUnitId, household.personId, "treasurer");
    const chairman = await addOfficial(db, rtUnitId, household.personId, "rt_chairman");
    const residentUser = await createAuthUser(db);
    const [residentAccount] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id });

    const [billingYear] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" })
      .returning({ id: billingYears.id });
    const [feeRate] = await createFeeRateFixture(db, {
      rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 1,
      monthlyAmount: originalAmount,
    });

    const dueRows = await db.insert(monthlyDues).values([
      { householdId: household.householdId, month: 1 },
      { householdId: household.householdId, month: 2 },
      { householdId: household.householdId, month: 3 },
      { householdId: otherHousehold.householdId, month: 1 },
    ].map(({ householdId, month }) => ({
      rtUnitId,
      householdId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      month,
      amount: originalAmount,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    }))).returning({ id: monthlyDues.id, householdId: monthlyDues.householdId, month: monthlyDues.month });

    const foreignRtUnitId = await createRt(db);
    const foreignHousehold = await createHousehold(db, foreignRtUnitId);
    const [foreignYear] = await db.insert(billingYears).values({ rtUnitId: foreignRtUnitId, year: 2026, status: "open" })
      .returning({ id: billingYears.id });
    const [foreignRate] = await createFeeRateFixture(db, {
      rtUnitId: foreignRtUnitId,
      billingYearId: foreignYear!.id,
      effectiveMonth: 1,
      monthlyAmount: originalAmount,
    });
    const [foreignDue] = await db.insert(monthlyDues).values({
      rtUnitId: foreignRtUnitId,
      householdId: foreignHousehold.householdId,
      billingYearId: foreignYear!.id,
      feeRateId: foreignRate!.id,
      month: 1,
      amount: originalAmount,
      dueDate: "2026-01-10",
      status: "unpaid",
    }).returning({ id: monthlyDues.id });

    const ownDues = dueRows.filter((row) => row.householdId === household.householdId);
    const otherDue = dueRows.find((row) => row.householdId === otherHousehold.householdId)!;
    scenario = {
      rtUnitId,
      householdId: household.householdId,
      otherHouseholdId: otherHousehold.householdId,
      foreignRtUnitId,
      foreignHouseholdId: foreignHousehold.householdId,
      treasurerAccountId: treasurer.accountId,
      treasurerPrincipal: treasurer.principal,
      chairmanPrincipal: chairman.principal,
      residentPrincipal: {
        authUserId: residentUser.id,
        appAccountId: residentAccount!.id,
        role: "resident",
        rtUnitId,
        householdId: household.householdId,
        personId: household.personId,
      },
      dueIds: {
        adjusted: ownDues.find((row) => row.month === 1)!.id,
        transfer: ownDues.find((row) => row.month === 2)!.id,
        unpaid: ownDues.find((row) => row.month === 3)!.id,
        otherHousehold: otherDue.id,
        foreignRt: foreignDue!.id,
      },
    };
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function readDueBalances(dueIds: string[]) {
    const result = await testDatabase.client.query<{
      due_id: string;
      status: string;
      effective_target: string;
      active_received: string;
      outstanding: string;
    }>(`
      SELECT due.id::text AS due_id,
             due.status::text AS status,
             (due.amount::numeric + coalesce(sum(adjustment.amount_delta), 0))::text AS effective_target,
             coalesce((
               SELECT sum(allocation.amount)::numeric
               FROM public.payment_allocations allocation
               JOIN public.payments payment
                 ON payment.id = allocation.payment_id
                AND payment.rt_unit_id = allocation.rt_unit_id
                AND payment.household_id = allocation.household_id
               WHERE allocation.monthly_due_id = due.id
                 AND NOT EXISTS (
                   SELECT 1 FROM public.payment_reversals reversal
                   WHERE reversal.payment_id = payment.id
                 )
             ), 0)::text AS active_received,
             (due.amount::numeric + coalesce(sum(adjustment.amount_delta), 0)
               - coalesce((
                 SELECT sum(allocation.amount)::numeric
                 FROM public.payment_allocations allocation
                 JOIN public.payments payment
                   ON payment.id = allocation.payment_id
                  AND payment.rt_unit_id = allocation.rt_unit_id
                  AND payment.household_id = allocation.household_id
                 WHERE allocation.monthly_due_id = due.id
                   AND NOT EXISTS (
                     SELECT 1 FROM public.payment_reversals reversal
                     WHERE reversal.payment_id = payment.id
                   )
               ), 0))::text AS outstanding
      FROM public.monthly_dues due
      LEFT JOIN public.due_adjustments adjustment
        ON adjustment.monthly_due_id = due.id
       AND adjustment.rt_unit_id = due.rt_unit_id
       AND adjustment.household_id = due.household_id
      WHERE due.id = ANY($1::uuid[])
      GROUP BY due.id
      ORDER BY due.id
    `, [dueIds]);
    return new Map(result.rows.map((row) => [row.due_id, {
      status: row.status,
      effectiveTarget: Number(row.effective_target),
      activeReceived: Number(row.active_received),
      outstanding: Number(row.outstanding),
    }]));
  }

  async function expectOwnershipMatchesActiveAllocations() {
    const result = await testDatabase.client.query<{ allocation_id: string; discrepancy: string }>(`
      SELECT allocation.id::text AS allocation_id, 'missing_or_mismatched_owner' AS discrepancy
      FROM public.payment_allocations allocation
      JOIN public.payments payment ON payment.id = allocation.payment_id
      LEFT JOIN public.payment_reversals reversal ON reversal.payment_id = payment.id
      LEFT JOIN public.active_due_settlements owner
        ON owner.allocation_id = allocation.id
       AND owner.payment_id = allocation.payment_id
       AND owner.rt_unit_id = allocation.rt_unit_id
       AND owner.household_id = allocation.household_id
       AND owner.monthly_due_id = allocation.monthly_due_id
       AND owner.amount = allocation.amount
      WHERE reversal.id IS NULL AND owner.allocation_id IS NULL
      UNION ALL
      SELECT owner.allocation_id::text AS allocation_id, 'orphan_or_reversed_owner' AS discrepancy
      FROM public.active_due_settlements owner
      LEFT JOIN public.payment_allocations allocation
        ON allocation.id = owner.allocation_id
       AND allocation.payment_id = owner.payment_id
       AND allocation.rt_unit_id = owner.rt_unit_id
       AND allocation.household_id = owner.household_id
       AND allocation.monthly_due_id = owner.monthly_due_id
       AND allocation.amount = owner.amount
      LEFT JOIN public.payment_reversals reversal ON reversal.payment_id = owner.payment_id
      WHERE allocation.id IS NULL OR reversal.id IS NOT NULL
    `);
    expect(result.rows).toEqual([]);
  }

  it("reconciles transfer, cash, adjustment, active ownership, and reversal from SQL ledger rows", async () => {
    const db = testDatabase.db;
    const firstCash = await recordTreasurerCashPayment(db as never, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, businessDate);
    expect(firstCash).toMatchObject({ status: "recorded", totalAmount: originalAmount, itemCount: 1 });

    await createChairmanAdjustment(db as never, scenario.chairmanPrincipal, {
      monthlyDueId: scenario.dueIds.adjusted,
      amountDelta: 10000,
      reason: "Koreksi nominal kewajiban pada dataset Gate C",
      idempotencyKey: randomUUID(),
    }, businessDate);
    const secondCash = await recordTreasurerCashPayment(db as never, scenario.treasurerPrincipal, {
      householdId: scenario.householdId,
      period: "2026-01",
      idempotencyKey: randomUUID(),
    }, businessDate);
    expect(secondCash).toMatchObject({ status: "recorded", totalAmount: 10000, itemCount: 1 });

    const request = await createResidentPaymentRequest(db as never, scenario.residentPrincipal, {
      period: "2026-02",
      idempotencyKey: randomUUID(),
    });
    await verifyTreasurerPaymentRequest(db as never, scenario.treasurerPrincipal, request.requestCode, businessDate);

    const [requestPayment] = await db.select().from(payments)
      .where(eq(payments.method, "transfer"));
    const cashRowsBeforeReversal = await db.select().from(payments)
      .where(eq(payments.method, "cash"));
    expect(requestPayment?.paymentRequestId).toBeTruthy();
    expect(cashRowsBeforeReversal).toHaveLength(2);

    const dueBalancesBeforeReversal = await readDueBalances([
      scenario.dueIds.adjusted,
      scenario.dueIds.transfer,
      scenario.dueIds.unpaid,
    ]);
    expect(dueBalancesBeforeReversal.get(scenario.dueIds.adjusted)).toEqual({
      status: "paid",
      effectiveTarget: 50000,
      activeReceived: 50000,
      outstanding: 0,
    });
    expect(dueBalancesBeforeReversal.get(scenario.dueIds.transfer)).toEqual({
      status: "paid",
      effectiveTarget: 40000,
      activeReceived: 40000,
      outstanding: 0,
    });
    expect(dueBalancesBeforeReversal.get(scenario.dueIds.unpaid)).toEqual({
      status: "unpaid",
      effectiveTarget: 40000,
      activeReceived: 0,
      outstanding: 40000,
    });
    for (const balance of dueBalancesBeforeReversal.values()) {
      expect(balance.activeReceived).toBeGreaterThanOrEqual(0);
      expect(balance.activeReceived).toBeLessThanOrEqual(balance.effectiveTarget);
      expect(balance.status === "paid").toBe(balance.outstanding === 0);
      if (balance.status === "unpaid") expect(balance.outstanding).toBeGreaterThan(0);
    }

    const adjustedOwnersBeforeReversal = await db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, scenario.dueIds.adjusted));
    expect(adjustedOwnersBeforeReversal).toHaveLength(2);
    expect(adjustedOwnersBeforeReversal.map((owner) => owner.amount).sort((a, b) => a - b))
      .toEqual([10000, 40000]);
    expect(adjustedOwnersBeforeReversal.reduce((sum, owner) => sum + owner.amount, 0)).toBe(50000);

    const paymentRollup = await testDatabase.client.query<{
      method: string;
      payment_id: string;
      payment_request_id: string | null;
      amount: string;
      allocation_count: string;
      allocation_total: string;
      duplicate_due_count: string;
      cash_key: string | null;
      cash_fingerprint: string | null;
      request_status: string | null;
    }>(`
      SELECT payment.id::text AS payment_id,
             payment.method,
             payment.payment_request_id::text AS payment_request_id,
             payment.amount::text AS amount,
             count(allocation.id)::text AS allocation_count,
             coalesce(sum(allocation.amount), 0)::text AS allocation_total,
             count(DISTINCT allocation.monthly_due_id)::text AS duplicate_due_count,
             payment.cash_idempotency_key::text AS cash_key,
             payment.cash_idempotency_fingerprint AS cash_fingerprint,
             request.status::text AS request_status
      FROM public.payments payment
      LEFT JOIN public.payment_allocations allocation ON allocation.payment_id = payment.id
      LEFT JOIN public.payment_requests request ON request.id = payment.payment_request_id
      GROUP BY payment.id, request.status
      ORDER BY payment.id
    `);
    expect(paymentRollup.rows).toHaveLength(3);
    for (const payment of paymentRollup.rows) {
      expect(Number(payment.allocation_count)).toBeGreaterThan(0);
      expect(Number(payment.allocation_total)).toBe(Number(payment.amount));
      expect(Number(payment.duplicate_due_count)).toBe(Number(payment.allocation_count));
      if (payment.method === "cash") {
        expect(payment.payment_request_id).toBeNull();
        expect(payment.cash_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(payment.cash_fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(payment.request_status).toBeNull();
      } else {
        expect(payment.method).toBe("transfer");
        expect(payment.payment_request_id).toBeTruthy();
        expect(payment.cash_key).toBeNull();
        expect(payment.cash_fingerprint).toBeNull();
        expect(payment.request_status).toBe("verified");
      }
    }

    const allocationScopes = await testDatabase.client.query<{
      payment_id: string;
      method: string;
      payment_rt: string;
      payment_household: string;
      allocation_rt: string;
      allocation_household: string;
      due_rt: string;
      due_household: string;
      payment_request_id: string | null;
      allocation_request_id: string | null;
      request_status: string | null;
      item_matches: boolean;
    }>(`
      SELECT payment.id::text AS payment_id,
             payment.method,
             payment.rt_unit_id::text AS payment_rt,
             payment.household_id::text AS payment_household,
             allocation.rt_unit_id::text AS allocation_rt,
             allocation.household_id::text AS allocation_household,
             due.rt_unit_id::text AS due_rt,
             due.household_id::text AS due_household,
             payment.payment_request_id::text AS payment_request_id,
             allocation.payment_request_id::text AS allocation_request_id,
             request.status::text AS request_status,
             CASE WHEN payment.method = 'cash' THEN allocation.payment_request_id IS NULL
                  ELSE request.id = payment.payment_request_id
                    AND allocation.payment_request_id = payment.payment_request_id
                    AND request.status = 'verified'
                    AND EXISTS (
                      SELECT 1 FROM public.payment_request_items item
                      WHERE item.request_id = request.id
                        AND item.rt_unit_id = allocation.rt_unit_id
                        AND item.household_id = allocation.household_id
                        AND item.monthly_due_id = allocation.monthly_due_id
                        AND item.amount = allocation.amount
                    )
             END AS item_matches
      FROM public.payment_allocations allocation
      JOIN public.payments payment ON payment.id = allocation.payment_id
      JOIN public.monthly_dues due ON due.id = allocation.monthly_due_id
      LEFT JOIN public.payment_requests request ON request.id = allocation.payment_request_id
    `);
    expect(allocationScopes.rows).toHaveLength(3);
    for (const allocation of allocationScopes.rows) {
      expect(allocation.payment_rt).toBe(allocation.allocation_rt);
      expect(allocation.payment_rt).toBe(allocation.due_rt);
      expect(allocation.payment_household).toBe(allocation.allocation_household);
      expect(allocation.payment_household).toBe(allocation.due_household);
      expect(allocation.item_matches).toBe(true);
      if (allocation.method === "cash") {
        expect(allocation.payment_request_id).toBeNull();
        expect(allocation.allocation_request_id).toBeNull();
      } else {
        expect(allocation.payment_request_id).toBe(allocation.allocation_request_id);
        expect(allocation.request_status).toBe("verified");
      }
    }

    await expectOwnershipMatchesActiveAllocations();
    const settlementSums = await testDatabase.client.query<{
      due_id: string;
      owner_total: string;
      active_received: string;
    }>(`
      SELECT due.id::text AS due_id,
             coalesce(sum(owner.amount), 0)::text AS owner_total,
             coalesce((
               SELECT sum(allocation.amount)::numeric
               FROM public.payment_allocations allocation
               JOIN public.payments payment ON payment.id = allocation.payment_id
               WHERE allocation.monthly_due_id = due.id
                 AND NOT EXISTS (SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id)
             ), 0)::text AS active_received
      FROM public.monthly_dues due
      LEFT JOIN public.active_due_settlements owner ON owner.monthly_due_id = due.id
      WHERE due.id = ANY($1::uuid[])
      GROUP BY due.id
    `, [[scenario.dueIds.adjusted, scenario.dueIds.transfer, scenario.dueIds.unpaid]]);
    expect(settlementSums.rows.every((row) => Number(row.owner_total) === Number(row.active_received))).toBe(true);

    const paymentToReverse = cashRowsBeforeReversal.find((payment) => payment.amount === 10000)!;
    const survivingCashPayment = cashRowsBeforeReversal.find((payment) => payment.amount === originalAmount);
    expect(survivingCashPayment).toBeTruthy();
    const allocationsBeforeReversal = await db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentToReverse.id));
    const allHistoricalPaymentsBeforeReversal = await db.select().from(payments);
    await reverseTreasurerPayment(db as never, scenario.treasurerPrincipal, {
      paymentId: paymentToReverse.id,
      reason: "Pembatalan terkontrol untuk verifikasi ownership Gate C",
    }, businessDate);

    expect(await db.select().from(payments)).toEqual(allHistoricalPaymentsBeforeReversal);
    expect(await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentToReverse.id)))
      .toEqual(allocationsBeforeReversal);
    expect(await db.select().from(paymentReversals).where(eq(paymentReversals.paymentId, paymentToReverse.id)))
      .toHaveLength(1);
    expect(await db.select().from(activeDueSettlements).where(eq(activeDueSettlements.paymentId, paymentToReverse.id)))
      .toHaveLength(0);
    const adjustedOwnersAfterReversal = await db.select().from(activeDueSettlements)
      .where(eq(activeDueSettlements.monthlyDueId, scenario.dueIds.adjusted));
    expect(adjustedOwnersAfterReversal).toHaveLength(1);
    expect(adjustedOwnersAfterReversal[0]).toMatchObject({ amount: originalAmount });
    expect(await db.select().from(activeDueSettlements).where(eq(activeDueSettlements.paymentId, survivingCashPayment!.id)))
      .toHaveLength(1);

    await expectOwnershipMatchesActiveAllocations();
    const dueBalancesAfterReversal = await readDueBalances([
      scenario.dueIds.adjusted,
      scenario.dueIds.transfer,
      scenario.dueIds.unpaid,
    ]);
    expect(dueBalancesAfterReversal.get(scenario.dueIds.adjusted)).toEqual({
      status: "unpaid",
      effectiveTarget: 50000,
      activeReceived: 40000,
      outstanding: 10000,
    });
    expect(dueBalancesAfterReversal.get(scenario.dueIds.transfer)).toEqual({
      status: "paid",
      effectiveTarget: 40000,
      activeReceived: 40000,
      outstanding: 0,
    });
    expect(dueBalancesAfterReversal.get(scenario.dueIds.unpaid)).toEqual({
      status: "unpaid",
      effectiveTarget: 40000,
      activeReceived: 0,
      outstanding: 40000,
    });
  });

  it("rejects over-allocation, missing or mismatched ownership, duplicate allocations, and invalid due states atomically", async () => {
    const db = testDatabase.db;
    const paymentBefore = await db.select().from(payments);
    const allocationBefore = await db.select().from(paymentAllocations);
    const ownerBefore = await db.select().from(activeDueSettlements);
    const [transferAllocation] = await db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.monthlyDueId, scenario.dueIds.transfer));

    await expect(db.transaction(async (transaction) => {
      await transaction.insert(paymentAllocations).values({
        rtUnitId: transferAllocation!.rtUnitId,
        householdId: transferAllocation!.householdId,
        paymentRequestId: transferAllocation!.paymentRequestId,
        paymentId: transferAllocation!.paymentId,
        monthlyDueId: transferAllocation!.monthlyDueId,
        amount: transferAllocation!.amount,
      });
    })).rejects.toThrow();
    expect(await db.select().from(paymentAllocations)).toEqual(allocationBefore);

    const overpaymentId = randomUUID();
    await expect(db.transaction(async (transaction) => {
      await transaction.insert(payments).values({
        id: overpaymentId,
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        paymentRequestId: null,
        amount: originalAmount + 1,
        method: "cash",
        verifiedByAccountId: scenario.treasurerAccountId,
        verifiedByAccountType: "official",
        cashIdempotencyKey: randomUUID(),
        cashIdempotencyFingerprint: "f".repeat(64),
      });
      const [allocation] = await transaction.insert(paymentAllocations).values({
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        paymentRequestId: null,
        paymentId: overpaymentId,
        monthlyDueId: scenario.dueIds.unpaid,
        amount: originalAmount + 1,
      }).returning({ id: paymentAllocations.id });
      await transaction.insert(activeDueSettlements).values({
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        paymentId: overpaymentId,
        allocationId: allocation!.id,
        monthlyDueId: scenario.dueIds.unpaid,
        amount: originalAmount + 1,
      });
      await transaction.update(monthlyDues).set({ status: "paid" })
        .where(eq(monthlyDues.id, scenario.dueIds.unpaid));
      await transaction.insert(auditEvents).values({
        actorAppAccountId: scenario.treasurerAccountId,
        action: "payment.cash_recorded",
        entityType: "payment",
        entityId: overpaymentId,
        context: { itemCount: 1, method: "cash", totalAmount: originalAmount + 1 },
      });
    })).rejects.toThrow();
    expect(await db.select().from(payments)).toEqual(paymentBefore);
    expect(await db.select().from(paymentAllocations)).toEqual(allocationBefore);
    expect(await db.select().from(activeDueSettlements)).toEqual(ownerBefore);

    const missingOwnerPaymentId = randomUUID();
    await expect(db.transaction(async (transaction) => {
      await transaction.insert(payments).values({
        id: missingOwnerPaymentId,
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        paymentRequestId: null,
        amount: originalAmount,
        method: "cash",
        verifiedByAccountId: scenario.treasurerAccountId,
        verifiedByAccountType: "official",
        cashIdempotencyKey: randomUUID(),
        cashIdempotencyFingerprint: "e".repeat(64),
      });
      await transaction.insert(paymentAllocations).values({
        rtUnitId: scenario.rtUnitId,
        householdId: scenario.householdId,
        paymentRequestId: null,
        paymentId: missingOwnerPaymentId,
        monthlyDueId: scenario.dueIds.unpaid,
        amount: originalAmount,
      });
      await transaction.insert(auditEvents).values({
        actorAppAccountId: scenario.treasurerAccountId,
        action: "payment.cash_recorded",
        entityType: "payment",
        entityId: missingOwnerPaymentId,
        context: { itemCount: 1, method: "cash", totalAmount: originalAmount },
      });
    })).rejects.toThrow();
    expect(await db.select().from(payments)).toEqual(paymentBefore);
    expect(await db.select().from(paymentAllocations)).toEqual(allocationBefore);

    await expect(db.insert(activeDueSettlements).values({
      rtUnitId: scenario.rtUnitId,
      householdId: scenario.householdId,
      paymentId: transferAllocation!.paymentId,
      allocationId: transferAllocation!.id,
      monthlyDueId: scenario.dueIds.adjusted,
      amount: transferAllocation!.amount,
    })).rejects.toThrow();
    expect(await db.select().from(activeDueSettlements)).toEqual(ownerBefore);

    await expect(db.update(monthlyDues).set({ status: "paid" })
      .where(eq(monthlyDues.id, scenario.dueIds.unpaid))).rejects.toThrow();
    await expect(db.update(monthlyDues).set({ status: "unpaid" })
      .where(eq(monthlyDues.id, scenario.dueIds.transfer))).rejects.toThrow();
    expect((await db.select().from(monthlyDues).where(and(
      eq(monthlyDues.id, scenario.dueIds.unpaid),
      eq(monthlyDues.status, "unpaid"),
    )))).toHaveLength(1);
    expect((await db.select().from(monthlyDues).where(and(
      eq(monthlyDues.id, scenario.dueIds.transfer),
      eq(monthlyDues.status, "paid"),
    )))).toHaveLength(1);
  });

  it("rejects allocations that substitute a different household or RT", async () => {
    const db = testDatabase.db;
    const attempts = [
      { dueId: scenario.dueIds.otherHousehold, label: "same-RT other household" },
      { dueId: scenario.dueIds.foreignRt, label: "foreign RT" },
    ];
    for (const attempt of attempts) {
      const paymentId = randomUUID();
      const paymentsBefore = await db.select().from(payments);
      const allocationsBefore = await db.select().from(paymentAllocations);
      await expect(db.transaction(async (transaction) => {
        await transaction.insert(payments).values({
          id: paymentId,
          rtUnitId: scenario.rtUnitId,
          householdId: scenario.householdId,
          paymentRequestId: null,
          amount: originalAmount,
          method: "cash",
          verifiedByAccountId: scenario.treasurerAccountId,
          verifiedByAccountType: "official",
          cashIdempotencyKey: randomUUID(),
          cashIdempotencyFingerprint: "a".repeat(64),
        });
        await transaction.insert(paymentAllocations).values({
          rtUnitId: scenario.rtUnitId,
          householdId: attempt.dueId === scenario.dueIds.otherHousehold
            ? scenario.otherHouseholdId
            : scenario.householdId,
          paymentRequestId: null,
          paymentId,
          monthlyDueId: attempt.dueId,
          amount: originalAmount,
        });
      })).rejects.toThrow();
      expect(await db.select().from(payments)).toEqual(paymentsBefore);
      expect(await db.select().from(paymentAllocations)).toEqual(allocationsBefore);
    }
  });
});
