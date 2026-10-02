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
  paymentRequestItems,
  paymentRequests,
  payments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { getResidentPaymentRequestHistory } from "@/lib/billing/resident-payment-request-history";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import {
  cancelResidentPaymentRequest,
  InvalidPaymentRequestResolutionInputError,
  PaymentRequestAlreadyProcessedError,
  PaymentRequestResolutionNotFoundError,
  rejectTreasurerPaymentRequest,
} from "@/lib/billing/payment-request-resolution";
import { TreasurerPaymentRequestAlreadyProcessedError, verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import { getTreasurerPaymentRequestDetail } from "@/lib/billing/treasurer-payment-requests";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase, ensureTestChairman } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

function databaseErrorChain(error: unknown) {
  const messages: string[] = [];
  let current = error;
  const seen = new Set<object>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { message?: unknown; cause?: unknown; code?: unknown; constraint?: unknown };
    if (typeof candidate.message === "string") messages.push(candidate.message);
    if (typeof candidate.code === "string") messages.push(`code=${candidate.code}`);
    if (typeof candidate.constraint === "string") messages.push(`constraint=${candidate.constraint}`);
    current = candidate.cause;
  }
  return messages.join("\n");
}

async function expectDatabaseFailure(operation: Promise<unknown>, message: string) {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeDefined();
  expect(databaseErrorChain(failure)).toContain(message);
}

describe("payment request reject and cancel", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createScenario(months = [1, 2]) {
    const rtUnitId = await createRt(testDatabase.db);
    const residentHousehold = await createHousehold(testDatabase.db, rtUnitId, { number: `R-${randomUUID().slice(0, 7)}` });
    const residentUser = await createAuthUser(testDatabase.db);
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

    const treasurerUser = await createAuthUser(testDatabase.db);
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
    const [feeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    const dueRows = await testDatabase.db.insert(monthlyDues).values(months.map((month) => ({
      rtUnitId,
      householdId: residentHousehold.householdId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      month,
      amount: 40000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    }))).returning({ id: monthlyDues.id });

    const request = await createResidentPaymentRequest(database, residentPrincipal, {
      period: `2026-${String(Math.max(...months)).padStart(2, "0")}`,
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
      residentAccountId: residentAccount!.id,
      treasurerAccountId: treasurerAccount!.id,
      householdId: residentHousehold.householdId,
      requestCode: request.requestCode,
      requestId: requestRow!.id,
      itemCount: request.periods.length,
      totalAmount: request.totalAmount,
      dueIds: dueRows.map((row) => row.id),
    };
  }

  async function assertUnpaidAndReleased(scenario: Awaited<ReturnType<typeof createScenario>>) {
    const [request] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, scenario.requestId));
    const items = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, scenario.requestId));
    const dues = await testDatabase.db.select({ id: monthlyDues.id, status: monthlyDues.status })
      .from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    const claims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, scenario.requestId));
    const requestPayments = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, scenario.requestId));
    const allocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, scenario.requestId));
    const transitionAudits = await testDatabase.db.select().from(auditEvents)
      .where(and(
        inArray(auditEvents.action, ["payment_request.verified", "payment_request.rejected", "payment_request.cancelled"]),
        eq(auditEvents.entityType, "payment_request"),
        eq(auditEvents.entityId, scenario.requestId),
      ));

    expect(items).toHaveLength(scenario.itemCount);
    expect(dues).toHaveLength(scenario.dueIds.length);
    expect(dues.every((due) => due.status === "unpaid")).toBe(true);
    expect(claims).toHaveLength(0);
    expect(requestPayments).toHaveLength(0);
    expect(allocations).toHaveLength(0);
    expect(transitionAudits).toHaveLength(1);
    expect(request).toBeDefined();
    return { request: request!, items, transitionAudits };
  }

  async function expectStillPending(scenario: Awaited<ReturnType<typeof createScenario>>) {
    const [request] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, scenario.requestId));
    const items = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, scenario.requestId));
    const dues = await testDatabase.db.select({ status: monthlyDues.status })
      .from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    const claims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, scenario.requestId));
    const requestPayments = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, scenario.requestId));
    const allocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, scenario.requestId));
    const transitionAudits = await testDatabase.db.select().from(auditEvents)
      .where(and(
        inArray(auditEvents.action, ["payment_request.verified", "payment_request.rejected", "payment_request.cancelled"]),
        eq(auditEvents.entityId, scenario.requestId),
      ));

    expect(request).toMatchObject({
      status: "pending",
      verifiedByAccountId: null,
      verifiedAt: null,
      resolvedAt: null,
      resolvedByAccountId: null,
      resolvedByAccountType: null,
      resolutionReason: null,
    });
    expect(items).toHaveLength(scenario.itemCount);
    expect(dues.every((due) => due.status === "unpaid")).toBe(true);
    expect(claims).toHaveLength(scenario.itemCount);
    expect(requestPayments).toHaveLength(0);
    expect(allocations).toHaveLength(0);
    expect(transitionAudits).toHaveLength(0);
  }

  async function verifyReplacementAndAssertHistory(
    scenario: Awaited<ReturnType<typeof createScenario>>,
    itemsBefore: Array<typeof paymentRequestItems.$inferSelect>,
    oldStatus: "rejected" | "cancelled",
    oldActorId: string,
    oldReason: string | null,
  ) {
    const replacement = await createResidentPaymentRequest(database, scenario.residentPrincipal, {
      period: "2026-02",
      idempotencyKey: randomUUID(),
    });
    expect(replacement.requestCode).not.toBe(scenario.requestCode);
    expect(replacement.periods).toEqual(["2026-01", "2026-02"]);

    const verification = await verifyTreasurerPaymentRequest(database, scenario.treasurerPrincipal, replacement.requestCode);
    expect(verification.status).toBe("verified");

    const [oldRequest] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, scenario.requestId));
    const oldItems = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, scenario.requestId));
    const oldClaims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, scenario.requestId));
    const oldPayments = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, scenario.requestId));
    const oldAllocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, scenario.requestId));
    const oldAudits = await testDatabase.db.select().from(auditEvents)
      .where(and(
        inArray(auditEvents.action, ["payment_request.verified", "payment_request.rejected", "payment_request.cancelled"]),
        eq(auditEvents.entityType, "payment_request"),
        eq(auditEvents.entityId, scenario.requestId),
      ));

    expect(oldRequest).toMatchObject({ status: oldStatus, resolvedByAccountId: oldActorId, resolutionReason: oldReason });
    expect(oldItems).toEqual(itemsBefore);
    expect(oldClaims).toHaveLength(0);
    expect(oldPayments).toHaveLength(0);
    expect(oldAllocations).toHaveLength(0);
    expect(oldAudits).toHaveLength(1);
    expect(oldAudits[0]).toMatchObject({
      action: `payment_request.${oldStatus}`,
      actorAppAccountId: oldActorId,
      reason: oldReason,
      context: { itemCount: scenario.itemCount, totalAmount: scenario.totalAmount },
    });

    const [replacementRequest] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.requestCode, replacement.requestCode));
    const replacementItems = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, replacementRequest!.id));
    const replacementPayments = await testDatabase.db.select().from(payments)
      .where(eq(payments.paymentRequestId, replacementRequest!.id));
    const replacementAllocations = await testDatabase.db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentRequestId, replacementRequest!.id));
    const replacementClaims = await testDatabase.db.select().from(paymentRequestClaims)
      .where(eq(paymentRequestClaims.requestId, replacementRequest!.id));
    const paidDues = await testDatabase.db.select({ status: monthlyDues.status })
      .from(monthlyDues)
      .where(inArray(monthlyDues.id, scenario.dueIds));
    expect(replacementRequest?.status).toBe("verified");
    expect(replacementItems).toHaveLength(scenario.itemCount);
    expect(replacementPayments).toHaveLength(1);
    expect(replacementPayments[0]?.amount).toBe(scenario.totalAmount);
    expect(replacementAllocations).toHaveLength(scenario.itemCount);
    expect(replacementAllocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(scenario.totalAmount);
    expect(replacementClaims).toHaveLength(0);
    expect(paidDues.every((due) => due.status === "paid")).toBe(true);

    await expect(testDatabase.db.update(paymentRequests)
      .set({ status: "pending", resolvedAt: null, resolvedByAccountId: null, resolvedByAccountType: null, resolutionReason: null })
      .where(eq(paymentRequests.id, scenario.requestId))).rejects.toThrow();
    await expect(testDatabase.db.update(paymentRequests)
      .set({ resolutionReason: oldReason ? `${oldReason} diubah` : "Riwayat diubah" })
      .where(eq(paymentRequests.id, scenario.requestId))).rejects.toThrow();

    const [stillHistorical] = await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.id, scenario.requestId));
    const stillOneAudit = await testDatabase.db.select().from(auditEvents)
      .where(and(
        inArray(auditEvents.action, ["payment_request.verified", "payment_request.rejected", "payment_request.cancelled"]),
        eq(auditEvents.entityType, "payment_request"),
        eq(auditEvents.entityId, scenario.requestId),
      ));
    expect(stillHistorical).toMatchObject({ status: oldStatus, resolvedByAccountId: oldActorId, resolutionReason: oldReason });
    expect(stillOneAudit).toHaveLength(1);

    return replacement;
  }

  it("cancels only the requester's pending request and retains a fresh re-request path", async () => {
    const scenario = await createScenario();
    const itemsBefore = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, scenario.requestId));

    const result = await cancelResidentPaymentRequest(database, scenario.residentPrincipal, scenario.requestCode);
    expect(result).toMatchObject({ status: "cancelled", itemCount: 2, totalAmount: 80000 });
    expect(result.resolvedAt).toBeInstanceOf(Date);
    const resolved = await assertUnpaidAndReleased(scenario);
    expect(resolved.request).toMatchObject({
      status: "cancelled",
      resolvedByAccountId: scenario.residentAccountId,
      resolvedByAccountType: "resident",
      resolutionReason: null,
    });
    expect(resolved.request.resolvedAt).toBeInstanceOf(Date);
    expect(resolved.items).toEqual(itemsBefore);
    expect(resolved.transitionAudits[0]).toMatchObject({
      action: "payment_request.cancelled",
      actorAppAccountId: scenario.residentAccountId,
      reason: null,
      context: { itemCount: 2, totalAmount: 80000 },
    });

    const dueRefresh = await getResidentMonthlyDues(database, scenario.residentPrincipal);
    expect(dueRefresh.every((due) => due.status === "unpaid" && due.paymentRequestStatus === null)).toBe(true);
    const reRequest = await verifyReplacementAndAssertHistory(
      scenario,
      itemsBefore,
      "cancelled",
      scenario.residentAccountId,
      null,
    );
    expect(await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.householdId, scenario.householdId))).toHaveLength(2);

    const history = await getResidentPaymentRequestHistory(database, scenario.residentPrincipal);
    expect(history.requests.find((request) => request.requestCode === reRequest.requestCode)).toMatchObject({ status: "verified" });
    expect(history.requests.find((request) => request.requestCode === scenario.requestCode)).toMatchObject({ status: "cancelled", resolutionReason: null });
    expect(JSON.stringify(history)).not.toMatch(/rtUnitId|householdId|actorAppAccountId|requestId/);
  });

  it("rejects with a required reason, retains snapshots, and preserves history for a new request", async () => {
    const scenario = await createScenario();
    const itemsBefore = await testDatabase.db.select().from(paymentRequestItems)
      .where(eq(paymentRequestItems.requestId, scenario.requestId));
    const reason = "Bukti transfer belum terbaca.";

    const result = await rejectTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode, `  ${reason}  `);
    expect(result).toMatchObject({ status: "rejected", itemCount: 2, totalAmount: 80000 });
    expect(result.resolvedAt).toBeInstanceOf(Date);
    const resolved = await assertUnpaidAndReleased(scenario);
    expect(resolved.request).toMatchObject({
      status: "rejected",
      resolvedByAccountId: scenario.treasurerAccountId,
      resolvedByAccountType: "official",
      resolutionReason: reason,
      verifiedByAccountId: null,
      verifiedAt: null,
    });
    expect(resolved.items).toEqual(itemsBefore);
    expect(resolved.transitionAudits[0]).toMatchObject({
      action: "payment_request.rejected",
      actorAppAccountId: scenario.treasurerAccountId,
      reason,
      context: { itemCount: 2, totalAmount: 80000 },
    });

    const detail = await getTreasurerPaymentRequestDetail(database, scenario.treasurerPrincipal, scenario.requestCode);
    expect(detail).toMatchObject({ status: "rejected", resolvedAt: result.resolvedAt, resolutionReason: reason });
    const history = await getResidentPaymentRequestHistory(database, scenario.residentPrincipal);
    expect(history.requests[0]).toMatchObject({ requestCode: scenario.requestCode, status: "rejected", resolutionReason: reason });
    const dueRefresh = await getResidentMonthlyDues(database, scenario.residentPrincipal);
    expect(dueRefresh.every((due) => due.status === "unpaid" && due.paymentRequestStatus === null)).toBe(true);

    const reRequest = await verifyReplacementAndAssertHistory(
      scenario,
      itemsBefore,
      "rejected",
      scenario.treasurerAccountId,
      reason,
    );
    expect(reRequest.requestCode).not.toBe(scenario.requestCode);
    expect(await testDatabase.db.select().from(paymentRequests)
      .where(eq(paymentRequests.householdId, scenario.householdId))).toHaveLength(2);
    const finalHistory = await getResidentPaymentRequestHistory(database, scenario.residentPrincipal);
    expect(finalHistory.requests.find((request) => request.requestCode === scenario.requestCode))
      .toMatchObject({ status: "rejected", resolutionReason: reason });
    expect(finalHistory.requests.find((request) => request.requestCode === reRequest.requestCode))
      .toMatchObject({ status: "verified" });
  });

  it("validates rejection reasons before opening a resolution transaction", async () => {
    const scenario = await createScenario();
    for (const reason of [undefined, null, "", "   ", "x".repeat(501), "Hubungi 08123456789"]) {
      await expect(rejectTreasurerPaymentRequest(
        database,
        scenario.treasurerPrincipal,
        scenario.requestCode,
        reason,
      )).rejects.toBeInstanceOf(InvalidPaymentRequestResolutionInputError);
    }
    await expectStillPending(scenario);
  });

  it("rejects direct cancellation and rejection unless the transition owns unpaid dues and complete claims", async () => {
    for (const action of ["cancelled", "rejected"] as const) {
      const paidDueScenario = await createScenario();
      await expectDatabaseFailure(testDatabase.db.transaction(async (transaction) => {
        await transaction.update(monthlyDues)
          .set({ status: "paid" })
          .where(eq(monthlyDues.id, paidDueScenario.dueIds[0]!));
        await transaction.update(paymentRequests)
          .set(action === "cancelled" ? {
            status: "cancelled",
            resolvedAt: new Date(),
            resolvedByAccountId: paidDueScenario.residentAccountId,
            resolvedByAccountType: "resident",
            resolutionReason: null,
          } : {
            status: "rejected",
            resolvedAt: new Date(),
            resolvedByAccountId: paidDueScenario.treasurerAccountId,
            resolvedByAccountType: "official",
            resolutionReason: "Bukti belum terbaca.",
          })
          .where(eq(paymentRequests.id, paidDueScenario.requestId));
      }), "Requested dues must remain unpaid and match their immutable outstanding snapshot");
      await expectStillPending(paidDueScenario);

      const incompleteClaimsScenario = await createScenario();
      await expectDatabaseFailure(testDatabase.db.transaction(async (transaction) => {
        await transaction.delete(paymentRequestClaims)
          .where(and(
            eq(paymentRequestClaims.requestId, incompleteClaimsScenario.requestId),
            eq(paymentRequestClaims.monthlyDueId, incompleteClaimsScenario.dueIds[0]!),
          ));
        await transaction.update(paymentRequests)
          .set(action === "cancelled" ? {
            status: "cancelled",
            resolvedAt: new Date(),
            resolvedByAccountId: incompleteClaimsScenario.residentAccountId,
            resolvedByAccountType: "resident",
            resolutionReason: null,
          } : {
            status: "rejected",
            resolvedAt: new Date(),
            resolvedByAccountId: incompleteClaimsScenario.treasurerAccountId,
            resolvedByAccountType: "official",
            resolutionReason: "Bukti belum terbaca.",
          })
          .where(eq(paymentRequests.id, incompleteClaimsScenario.requestId));
      }), "complete claims owned by the request");
      await expectStillPending(incompleteClaimsScenario);
    }
  });

  it("rejects direct cancellation and rejection when a payment ledger already exists", async () => {
    for (const action of ["cancelled", "rejected"] as const) {
      const scenario = await createScenario();
      await expectDatabaseFailure(testDatabase.db.transaction(async (transaction) => {
        const [payment] = await transaction.insert(payments).values({
          rtUnitId: scenario.rtUnitId,
          householdId: scenario.householdId,
          paymentRequestId: scenario.requestId,
          amount: scenario.totalAmount,
          verifiedByAccountId: scenario.treasurerAccountId,
        }).returning({ id: payments.id });
        await transaction.insert(paymentAllocations).values({
          rtUnitId: scenario.rtUnitId,
          householdId: scenario.householdId,
          paymentRequestId: scenario.requestId,
          paymentId: payment!.id,
          monthlyDueId: scenario.dueIds[0]!,
          amount: 40000,
        });
        await transaction.update(paymentRequests)
          .set(action === "cancelled" ? {
            status: "cancelled",
            resolvedAt: new Date(),
            resolvedByAccountId: scenario.residentAccountId,
            resolvedByAccountType: "resident",
            resolutionReason: null,
          } : {
            status: "rejected",
            resolvedAt: new Date(),
            resolvedByAccountId: scenario.treasurerAccountId,
            resolvedByAccountType: "official",
            resolutionReason: "Bukti belum terbaca.",
          })
          .where(eq(paymentRequests.id, scenario.requestId));
      }), "already has a payment ledger");
      await expectStillPending(scenario);
    }
  });

  it("rejects invalid resolution metadata at the transition", async () => {
    const scenario = await createScenario();
    await expectDatabaseFailure(testDatabase.db.update(paymentRequests)
      .set({
        status: "rejected",
        resolvedAt: new Date(),
        resolvedByAccountId: scenario.treasurerAccountId,
        resolvedByAccountType: "official",
        resolutionReason: "   ",
      })
      .where(eq(paymentRequests.id, scenario.requestId)), "valid Treasurer resolution metadata");
    await expectStillPending(scenario);
  });

  it("hides another resident's request and another RT's request from mutation services", async () => {
    const scenario = await createScenario();
    const otherHousehold = await createHousehold(testDatabase.db, scenario.rtUnitId);
    const otherUser = await createAuthUser(testDatabase.db);
    const [otherAccount] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId: scenario.rtUnitId,
      authUserId: otherUser.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      householdId: otherHousehold.householdId,
      personId: otherHousehold.personId,
    }).returning({ id: appAccounts.id });
    const otherResident: Principal = {
      authUserId: otherUser.id,
      appAccountId: otherAccount!.id,
      role: "resident",
      rtUnitId: scenario.rtUnitId,
      householdId: otherHousehold.householdId,
      personId: otherHousehold.personId,
    };

    await expect(cancelResidentPaymentRequest(database, otherResident, scenario.requestCode))
      .rejects.toBeInstanceOf(PaymentRequestResolutionNotFoundError);

    const otherRt = await createRt(testDatabase.db);
    const otherOfficialHousehold = await createHousehold(testDatabase.db, otherRt);
    const otherOfficialUser = await createAuthUser(testDatabase.db);
    const [otherOfficial] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId: otherRt,
      authUserId: otherOfficialUser.id,
      accountType: "official",
      loginIdentifier: `treasurer-${randomUUID()}`,
      personId: otherOfficialHousehold.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId: otherRt,
      appAccountId: otherOfficial!.id,
      role: "treasurer",
      startsOn: "2020-01-01",
    });
    const otherTreasurer: Principal = {
      authUserId: otherOfficialUser.id,
      appAccountId: otherOfficial!.id,
      role: "treasurer",
      rtUnitId: otherRt,
      householdId: null,
      personId: otherOfficialHousehold.personId,
    };
    await expect(rejectTreasurerPaymentRequest(database, otherTreasurer, scenario.requestCode, "Alasan sah."))
      .rejects.toBeInstanceOf(PaymentRequestResolutionNotFoundError);
    await expectStillPending(scenario);
  });

  it("denies an inactive Treasurer and non-Treasurer roles", async () => {
    const scenario = await createScenario();
    const chairmanAccountId = await ensureTestChairman(testDatabase.db, scenario.rtUnitId);
    const [chairmanAccount] = await testDatabase.db.select({ authUserId: appAccounts.authUserId })
      .from(appAccounts)
      .where(eq(appAccounts.id, chairmanAccountId));
    const chairman: Principal = {
      authUserId: chairmanAccount!.authUserId,
      appAccountId: chairmanAccountId,
      role: "rt_chairman",
      rtUnitId: scenario.rtUnitId,
      householdId: null,
      personId: scenario.residentPrincipal.personId,
    };
    const residentResult = rejectTreasurerPaymentRequest(database, scenario.residentPrincipal, scenario.requestCode, "Alasan sah.");
    const chairmanResult = rejectTreasurerPaymentRequest(database, chairman, scenario.requestCode, "Alasan sah.");
    await expect(residentResult).rejects.toThrow("Forbidden:");
    await expect(chairmanResult).rejects.toThrow("Forbidden:");

    await testDatabase.db.update(appAccounts)
      .set({ status: "disabled" })
      .where(eq(appAccounts.id, scenario.treasurerAccountId));
    await expect(rejectTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode, "Alasan sah."))
      .rejects.toThrow("Forbidden:");
    await expectStillPending(scenario);
  });

  it("allows only one terminal winner for each pairwise race", async () => {
    const cases = [
      { name: "cancel versus verify", first: (s: Awaited<ReturnType<typeof createScenario>>) => cancelResidentPaymentRequest(database, s.residentPrincipal, s.requestCode), second: (s: Awaited<ReturnType<typeof createScenario>>) => verifyTreasurerPaymentRequest(database, s.treasurerPrincipal, s.requestCode) },
      { name: "reject versus verify", first: (s: Awaited<ReturnType<typeof createScenario>>) => rejectTreasurerPaymentRequest(database, s.treasurerPrincipal, s.requestCode, "Bukti belum terbaca."), second: (s: Awaited<ReturnType<typeof createScenario>>) => verifyTreasurerPaymentRequest(database, s.treasurerPrincipal, s.requestCode) },
      { name: "cancel versus reject", first: (s: Awaited<ReturnType<typeof createScenario>>) => cancelResidentPaymentRequest(database, s.residentPrincipal, s.requestCode), second: (s: Awaited<ReturnType<typeof createScenario>>) => rejectTreasurerPaymentRequest(database, s.treasurerPrincipal, s.requestCode, "Bukti belum terbaca.") },
    ];
    for (const testCase of cases) {
      const scenario = await createScenario();
      const attempts = await Promise.allSettled([testCase.first(scenario), testCase.second(scenario)]);
      expect(attempts.filter((attempt) => attempt.status === "fulfilled"), testCase.name).toHaveLength(1);
      const failure = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
      expect(
        failure.reason instanceof PaymentRequestAlreadyProcessedError ||
        failure.reason instanceof TreasurerPaymentRequestAlreadyProcessedError,
        testCase.name,
      ).toBe(true);

      const [request] = await testDatabase.db.select().from(paymentRequests)
        .where(eq(paymentRequests.id, scenario.requestId));
      expect(["verified", "rejected", "cancelled"]).toContain(request!.status);
      const transitionAudits = await testDatabase.db.select().from(auditEvents)
        .where(and(
          inArray(auditEvents.action, ["payment_request.verified", "payment_request.rejected", "payment_request.cancelled"]),
          eq(auditEvents.entityId, scenario.requestId),
        ));
      expect(transitionAudits).toHaveLength(1);
      const claims = await testDatabase.db.select().from(paymentRequestClaims)
        .where(eq(paymentRequestClaims.requestId, scenario.requestId));
      expect(claims).toHaveLength(0);
      const requestPayments = await testDatabase.db.select().from(payments)
        .where(eq(payments.paymentRequestId, scenario.requestId));
      const allocations = await testDatabase.db.select().from(paymentAllocations)
        .where(eq(paymentAllocations.paymentRequestId, scenario.requestId));
      const dueRows = await testDatabase.db.select({ id: monthlyDues.id, status: monthlyDues.status })
        .from(monthlyDues)
        .where(inArray(monthlyDues.id, scenario.dueIds));
      const items = await testDatabase.db.select().from(paymentRequestItems)
        .where(eq(paymentRequestItems.requestId, scenario.requestId));
      expect(items).toHaveLength(scenario.itemCount);

      if (request!.status === "verified") {
        expect(requestPayments).toHaveLength(1);
        expect(allocations).toHaveLength(scenario.itemCount);
        expect(allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(scenario.totalAmount);
        expect(dueRows.every((due) => due.status === "paid")).toBe(true);
        expect(transitionAudits[0]).toMatchObject({ action: "payment_request.verified", actorAppAccountId: scenario.treasurerAccountId });
      } else {
        expect(requestPayments).toHaveLength(0);
        expect(allocations).toHaveLength(0);
        expect(dueRows.every((due) => due.status === "unpaid")).toBe(true);
        expect(transitionAudits[0]?.action).toBe(`payment_request.${request!.status}`);
        if (request!.status === "cancelled") {
          expect(transitionAudits[0]).toMatchObject({ actorAppAccountId: scenario.residentAccountId, reason: null });
        } else {
          expect(transitionAudits[0]).toMatchObject({ actorAppAccountId: scenario.treasurerAccountId, reason: "Bukti belum terbaca." });
        }
      }
    }
  });

  it.each([
    ["request update", "request"],
    ["claim removal", "claim"],
    ["audit insert", "audit"],
  ] as const)("rolls back cancel and reject when %s fails", async (_label, failurePoint) => {
    for (const action of ["cancelled", "rejected"] as const) {
      const scenario = await createScenario();
      const functionName = `phase7_fail_${failurePoint}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
      const createFailureTrigger = async () => {
        if (failurePoint === "request") {
          await testDatabase.client.exec(`
            CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.status = '${action}' THEN RAISE EXCEPTION 'forced request update failure' USING ERRCODE = '23514'; END IF;
              RETURN NEW;
            END;
            $$;
            CREATE TRIGGER ${functionName}_trigger BEFORE UPDATE ON payment_requests
            FOR EACH ROW EXECUTE FUNCTION ${functionName}();
          `);
        } else if (failurePoint === "claim") {
          await testDatabase.client.exec(`
            CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'forced claim removal failure' USING ERRCODE = '23514'; END;
            $$;
            CREATE TRIGGER ${functionName}_trigger BEFORE DELETE ON payment_request_claims
            FOR EACH ROW EXECUTE FUNCTION ${functionName}();
          `);
        } else {
          await testDatabase.client.exec(`
            CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.action = 'payment_request.${action}' THEN RAISE EXCEPTION 'forced audit insert failure' USING ERRCODE = '23514'; END IF;
              RETURN NEW;
            END;
            $$;
            CREATE TRIGGER ${functionName}_trigger BEFORE INSERT ON audit_events
            FOR EACH ROW EXECUTE FUNCTION ${functionName}();
          `);
        }
      };
      const dropFailureTrigger = async () => {
        const table = failurePoint === "request" ? "payment_requests" : failurePoint === "claim" ? "payment_request_claims" : "audit_events";
        await testDatabase.client.exec(`DROP TRIGGER ${functionName}_trigger ON ${table}; DROP FUNCTION ${functionName}();`);
      };

      await createFailureTrigger();
      try {
        const transition = action === "cancelled"
          ? cancelResidentPaymentRequest(database, scenario.residentPrincipal, scenario.requestCode)
          : rejectTreasurerPaymentRequest(database, scenario.treasurerPrincipal, scenario.requestCode, "Bukti belum terbaca.");
        await expect(transition).rejects.toThrow();
        await expectStillPending(scenario);
      } finally {
        await dropFailureTrigger();
      }
    }
  });

  it("enforces missing audits, terminal immutability, and exact transition-audit cardinality at commit", async () => {
    const missingAudit = await createScenario();
    await expect(testDatabase.db.transaction(async (transaction) => {
      await transaction.update(paymentRequests)
        .set({
          status: "cancelled",
          resolvedAt: new Date(),
          resolvedByAccountId: missingAudit.residentAccountId,
          resolvedByAccountType: "resident",
        })
        .where(eq(paymentRequests.id, missingAudit.requestId));
      await transaction.delete(paymentRequestClaims)
        .where(eq(paymentRequestClaims.requestId, missingAudit.requestId));
    })).rejects.toThrow();
    await expectStillPending(missingAudit);

    const terminal = await createScenario();
    await cancelResidentPaymentRequest(database, terminal.residentPrincipal, terminal.requestCode);
    await expect(testDatabase.db.update(paymentRequests)
      .set({ status: "pending", resolvedAt: null, resolvedByAccountId: null, resolvedByAccountType: null })
      .where(eq(paymentRequests.id, terminal.requestId))).rejects.toThrow();
    const [stillTerminal] = await testDatabase.db.select({ status: paymentRequests.status })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, terminal.requestId));
    expect(stillTerminal?.status).toBe("cancelled");
    await expect(testDatabase.db.insert(auditEvents).values({
      actorAppAccountId: terminal.residentAccountId,
      action: "payment_request.cancelled",
      entityType: "payment_request",
      entityId: terminal.requestId,
      context: { itemCount: terminal.itemCount, totalAmount: terminal.totalAmount },
    })).rejects.toThrow();
  });
});
