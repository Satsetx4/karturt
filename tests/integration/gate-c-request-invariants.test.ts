import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  payments,
  waiverActions,
  waiverItems,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createChairmanAdjustment, ChairmanAdjustmentConflictError } from "@/lib/billing/chairman-adjustment";
import { createChairmanWaiver } from "@/lib/billing/chairman-waiver";
import { cancelResidentPaymentRequest, rejectTreasurerPaymentRequest } from "@/lib/billing/payment-request-resolution";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

type Fixture = {
  rtUnitId: string;
  householdId: string;
  dueId: string;
  residentPrincipal: Principal;
  chairmanPrincipal: Principal;
  treasurerPrincipal: Principal;
};

type DirectBalance = {
  original_amount: string;
  adjustment_total: string;
  active_received: string;
  stored_status: string;
};

const originalAmount = 40000;
const businessDate = "2026-10-03";
const adjustmentReason = "Penyesuaian yang disetujui sebelum permintaan pembayaran";
const waiverReason = "Pembebasan untuk verifikasi lifecycle Gate C";

describe("Gate C payment request invariants", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createFixture(): Promise<Fixture> {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId, { number: `G-${randomUUID().slice(0, 7)}` });

    const residentUser = await createAuthUser(testDatabase.db);
    const [residentAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `gate-c-resident-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id });

    const chairmanUser = await createAuthUser(testDatabase.db);
    const [chairmanAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: chairmanUser.id,
      accountType: "official",
      loginIdentifier: `gate-c-chairman-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: chairmanAccount!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });

    const treasurerUser = await createAuthUser(testDatabase.db);
    const [treasurerAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: treasurerUser.id,
      accountType: "official",
      loginIdentifier: `gate-c-treasurer-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: treasurerAccount!.id,
      role: "treasurer",
      startsOn: "2020-01-01",
    });

    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [feeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 1,
      monthlyAmount: originalAmount,
    });
    const [due] = await testDatabase.db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      month: 1,
      amount: originalAmount,
      dueDate: "2026-01-10",
      status: "unpaid",
    }).returning({ id: monthlyDues.id });

    return {
      rtUnitId,
      householdId: household.householdId,
      dueId: due!.id,
      residentPrincipal: {
        authUserId: residentUser.id,
        appAccountId: residentAccount!.id,
        role: "resident",
        rtUnitId,
        householdId: household.householdId,
        personId: household.personId,
      },
      chairmanPrincipal: {
        authUserId: chairmanUser.id,
        appAccountId: chairmanAccount!.id,
        role: "rt_chairman",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
      treasurerPrincipal: {
        authUserId: treasurerUser.id,
        appAccountId: treasurerAccount!.id,
        role: "treasurer",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
    };
  }

  async function directBalance(dueId: string): Promise<DirectBalance> {
    const [row] = (await testDatabase.client.query<DirectBalance>(`
      SELECT
        due.amount::text AS original_amount,
        COALESCE((
          SELECT SUM(adjustment.amount_delta)
          FROM due_adjustments AS adjustment
          WHERE adjustment.monthly_due_id = due.id
        ), 0)::text AS adjustment_total,
        COALESCE((
          SELECT SUM(allocation.amount)
          FROM payment_allocations AS allocation
          JOIN payments AS payment ON payment.id = allocation.payment_id
          WHERE allocation.monthly_due_id = due.id
            AND NOT EXISTS (
              SELECT 1
              FROM payment_reversals AS reversal
              WHERE reversal.payment_id = payment.id
            )
        ), 0)::text AS active_received,
        due.status::text AS stored_status
      FROM monthly_dues AS due
      WHERE due.id = $1::uuid
    `, [dueId])).rows;
    expect(row).toBeDefined();
    return row!;
  }

  async function hasValidPendingRequest(dueId: string) {
    const [row] = (await testDatabase.client.query<{ valid_pending: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM payment_requests AS request
        JOIN payment_request_items AS item ON item.request_id = request.id
        JOIN payment_request_claims AS claim
          ON claim.request_id = request.id
         AND claim.monthly_due_id = item.monthly_due_id
        WHERE request.status = 'pending'
          AND item.monthly_due_id = $1::uuid
          AND NOT EXISTS (
            SELECT 1
            FROM payment_request_items AS missing_item
            WHERE missing_item.request_id = request.id
              AND NOT EXISTS (
                SELECT 1
                FROM payment_request_claims AS missing_claim
                WHERE missing_claim.request_id = missing_item.request_id
                  AND missing_claim.monthly_due_id = missing_item.monthly_due_id
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM payment_request_claims AS extra_claim
            WHERE extra_claim.request_id = request.id
              AND NOT EXISTS (
                SELECT 1
                FROM payment_request_items AS matching_item
                WHERE matching_item.request_id = extra_claim.request_id
                  AND matching_item.monthly_due_id = extra_claim.monthly_due_id
              )
          )
      ) AS valid_pending
    `, [dueId])).rows;
    return row?.valid_pending === true;
  }

  async function requestFor(fixture: Fixture) {
    return createResidentPaymentRequest(database, fixture.residentPrincipal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });
  }

  async function savedRequest(requestCode: string) {
    const [request] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, requestCode));
    expect(request).toBeDefined();
    return request!;
  }

  async function expectTerminalHistory(
    fixture: Fixture,
    requestId: string,
    status: "cancelled" | "rejected",
    itemsBefore: Array<typeof paymentRequestItems.$inferSelect>,
  ) {
    const [request] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, requestId));
    const itemsAfter = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestId));
    const claims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, requestId));
    const requestPayments = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, requestId));
    const requestAllocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, requestId));
    const transitionAudits = await testDatabase.db.select().from(auditEvents)
      .where(eq(auditEvents.entityId, requestId));

    expect(request?.status).toBe(status);
    expect(itemsAfter).toEqual(itemsBefore);
    expect(claims).toHaveLength(0);
    expect(requestPayments).toHaveLength(0);
    expect(requestAllocations).toHaveLength(0);
    expect(transitionAudits.filter((event) => event.action === `payment_request.${status}`)).toHaveLength(1);
    expect(await hasValidPendingRequest(fixture.dueId)).toBe(false);
  }

  it("derives pending only from a complete active request and blocks adjustment without snapshot drift", async () => {
    const fixture = await createFixture();
    const [initialView] = await getResidentMonthlyDues(database, fixture.residentPrincipal);
    expect(await hasValidPendingRequest(fixture.dueId)).toBe(false);
    expect(initialView?.paymentRequestStatus).toBeNull();

    await createChairmanAdjustment(database, fixture.chairmanPrincipal, {
      monthlyDueId: fixture.dueId,
      amountDelta: 10000,
      reason: adjustmentReason,
      idempotencyKey: randomUUID(),
    }, businessDate);

    const created = await requestFor(fixture);
    const request = await savedRequest(created.requestCode);
    const items = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, request.id));
    const claims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, request.id));
    const before = await directBalance(fixture.dueId);
    const outstanding = Number(before.original_amount) + Number(before.adjustment_total) - Number(before.active_received);
    const [pendingView] = await getResidentMonthlyDues(database, fixture.residentPrincipal);
    const pendingFromReadModel = pendingView?.status === "unpaid" && pendingView.paymentRequestStatus === "pending";

    expect(before).toMatchObject({ original_amount: "40000", adjustment_total: "10000", active_received: "0", stored_status: "unpaid" });
    expect(outstanding).toBe(50000);
    expect(request).toMatchObject({ status: "pending", itemCount: 1, totalAmount: outstanding });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ monthlyDueId: fixture.dueId, period: "2026-01", amount: outstanding });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.monthlyDueId).toBe(fixture.dueId);
    expect(await hasValidPendingRequest(fixture.dueId)).toBe(true);
    expect(pendingFromReadModel).toBe(true);
    expect(pendingFromReadModel).toBe(await hasValidPendingRequest(fixture.dueId));

    await expect(createChairmanAdjustment(database, fixture.chairmanPrincipal, {
      monthlyDueId: fixture.dueId,
      amountDelta: 5000,
      reason: "Adjustment yang harus ditolak selama permintaan aktif",
      idempotencyKey: randomUUID(),
    }, businessDate)).rejects.toBeInstanceOf(ChairmanAdjustmentConflictError);

    const after = await directBalance(fixture.dueId);
    const requestAfterAttempt = await savedRequest(created.requestCode);
    const itemsAfterAttempt = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, request.id));
    const adjustmentRows = await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, fixture.dueId));
    expect(after).toEqual(before);
    expect(requestAfterAttempt).toEqual(request);
    expect(itemsAfterAttempt).toEqual(items);
    expect(adjustmentRows).toHaveLength(1);

    await cancelResidentPaymentRequest(database, fixture.residentPrincipal, created.requestCode);
    const cancelled = await savedRequest(created.requestCode);
    const [cancelledView] = await getResidentMonthlyDues(database, fixture.residentPrincipal);
    const pendingAfterCancel = cancelledView?.status === "unpaid" && cancelledView.paymentRequestStatus === "pending";
    expect(cancelled.status).toBe("cancelled");
    expect(await hasValidPendingRequest(fixture.dueId)).toBe(false);
    expect(pendingAfterCancel).toBe(false);
    expect(pendingAfterCancel).toBe(await hasValidPendingRequest(fixture.dueId));
    expect((await directBalance(fixture.dueId)).stored_status).toBe("unpaid");
    expect(await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, request.id))).toHaveLength(0);
  });

  it("verifies a pending request into exactly one payment with a complete matching allocation sum", async () => {
    const fixture = await createFixture();
    await createChairmanAdjustment(database, fixture.chairmanPrincipal, {
      monthlyDueId: fixture.dueId,
      amountDelta: 10000,
      reason: adjustmentReason,
      idempotencyKey: randomUUID(),
    }, businessDate);
    const created = await requestFor(fixture);
    const requestBefore = await savedRequest(created.requestCode);
    const itemsBefore = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, requestBefore.id));
    expect(itemsBefore).toHaveLength(1);
    expect(itemsBefore[0]?.amount).toBe(50000);

    await verifyTreasurerPaymentRequest(database, fixture.treasurerPrincipal, created.requestCode, businessDate);

    const requestAfter = await savedRequest(created.requestCode);
    const requestPayments = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, requestBefore.id));
    const requestAllocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, requestBefore.id));
    const remainingClaims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, requestBefore.id));
    const due = (await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, fixture.dueId)))[0];
    const balance = await directBalance(fixture.dueId);
    const [ledgerTotals] = (await testDatabase.client.query<{
      payment_count: string;
      payment_total: string;
      allocation_count: string;
      allocation_total: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM payments WHERE payment_request_id = $1::uuid) AS payment_count,
        (SELECT COALESCE(SUM(amount), 0)::text FROM payments WHERE payment_request_id = $1::uuid) AS payment_total,
        (SELECT COUNT(*)::text FROM payment_allocations WHERE payment_request_id = $1::uuid) AS allocation_count,
        (SELECT COALESCE(SUM(amount), 0)::text FROM payment_allocations WHERE payment_request_id = $1::uuid) AS allocation_total
    `, [requestBefore.id])).rows;

    expect(requestAfter?.status).toBe("verified");
    expect(requestPayments).toHaveLength(1);
    expect(requestPayments[0]?.amount).toBe(50000);
    expect(requestAllocations).toHaveLength(1);
    expect(requestAllocations[0]).toMatchObject({
      monthlyDueId: fixture.dueId,
      paymentId: requestPayments[0]!.id,
      amount: itemsBefore[0]!.amount,
    });
    expect(Number(ledgerTotals?.payment_count)).toBe(1);
    expect(Number(ledgerTotals?.allocation_count)).toBe(1);
    expect(ledgerTotals?.payment_total).toBe(ledgerTotals?.allocation_total);
    expect(Number(ledgerTotals?.payment_total)).toBe(requestAfter?.totalAmount);
    expect(remainingClaims).toHaveLength(0);
    expect(due?.status).toBe("paid");
    expect(Number(balance.original_amount) + Number(balance.adjustment_total) - Number(balance.active_received)).toBe(0);
    expect(balance.stored_status).toBe("paid");
    expect(await hasValidPendingRequest(fixture.dueId)).toBe(false);
    const [residentView] = await getResidentMonthlyDues(database, fixture.residentPrincipal);
    expect(residentView).toMatchObject({ status: "paid", paymentRequestStatus: null, outstanding: 0 });
  });

  it.each(["cancelled", "rejected"] as const)(
    "retains %s history without claims or owned ledger after the due is later paid or waived",
    async (terminalStatus) => {
      const paidFixture = await createFixture();
      const paidOriginal = await requestFor(paidFixture);
      const paidOriginalRow = await savedRequest(paidOriginal.requestCode);
      const paidItemsBefore = await testDatabase.db.select().from(paymentRequestItems)
        .where(eq(paymentRequestItems.requestId, paidOriginalRow.id));
      if (terminalStatus === "cancelled") {
        await cancelResidentPaymentRequest(database, paidFixture.residentPrincipal, paidOriginal.requestCode);
      } else {
        await rejectTreasurerPaymentRequest(database, paidFixture.treasurerPrincipal, paidOriginal.requestCode, "Bukti transfer perlu diperbaiki.", businessDate);
      }

      const replacement = await requestFor(paidFixture);
      await verifyTreasurerPaymentRequest(database, paidFixture.treasurerPrincipal, replacement.requestCode, businessDate);
      await expectTerminalHistory(paidFixture, paidOriginalRow.id, terminalStatus, paidItemsBefore);
      const paidDue = (await testDatabase.db.select().from(monthlyDues)
        .where(eq(monthlyDues.id, paidFixture.dueId)))[0];
      expect(paidDue?.status).toBe("paid");
      const replacementRow = await savedRequest(replacement.requestCode);
      const replacementPayments = await testDatabase.db.select().from(payments)
        .where(eq(payments.paymentRequestId, replacementRow.id));
      const replacementAllocations = await testDatabase.db.select().from(paymentAllocations)
        .where(eq(paymentAllocations.paymentRequestId, replacementRow.id));
      expect(replacementRow.status).toBe("verified");
      expect(replacementPayments).toHaveLength(1);
      expect(replacementAllocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(replacementPayments[0]?.amount);

      const waivedFixture = await createFixture();
      const waivedOriginal = await requestFor(waivedFixture);
      const waivedOriginalRow = await savedRequest(waivedOriginal.requestCode);
      const waivedItemsBefore = await testDatabase.db.select().from(paymentRequestItems)
        .where(eq(paymentRequestItems.requestId, waivedOriginalRow.id));
      if (terminalStatus === "cancelled") {
        await cancelResidentPaymentRequest(database, waivedFixture.residentPrincipal, waivedOriginal.requestCode);
      } else {
        await rejectTreasurerPaymentRequest(database, waivedFixture.treasurerPrincipal, waivedOriginal.requestCode, "Bukti transfer perlu diperbaiki.", businessDate);
      }

      await createChairmanWaiver(database, waivedFixture.chairmanPrincipal, {
        householdId: waivedFixture.householdId,
        periods: ["2026-01"],
        reason: waiverReason,
        idempotencyKey: randomUUID(),
      }, businessDate);
      await expectTerminalHistory(waivedFixture, waivedOriginalRow.id, terminalStatus, waivedItemsBefore);
      const [waivedDue] = await testDatabase.db.select().from(monthlyDues)
        .where(eq(monthlyDues.id, waivedFixture.dueId));
      const actions = await testDatabase.db.select().from(waiverActions)
        .where(eq(waiverActions.householdId, waivedFixture.householdId));
      const items = await testDatabase.db.select().from(waiverItems)
        .where(eq(waiverItems.monthlyDueId, waivedFixture.dueId));
      expect(waivedDue?.status).toBe("waived");
      expect(actions).toHaveLength(1);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ waiverActionId: actions[0]!.id, amount: originalAmount });
      expect(await testDatabase.db.select().from(payments)
        .where(eq(payments.householdId, waivedFixture.householdId))).toHaveLength(0);
      expect(await testDatabase.db.select().from(paymentAllocations)
        .where(eq(paymentAllocations.monthlyDueId, waivedFixture.dueId))).toHaveLength(0);
      const [waivedView] = await getResidentMonthlyDues(database, waivedFixture.residentPrincipal);
      expect(waivedView).toMatchObject({ status: "waived", paymentRequestStatus: null });
    },
  );
});
