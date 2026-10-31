import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import { appAccounts, auditEvents, billingYears, monthlyDues, officialAssignments, paymentRequests, payments } from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import { rejectTreasurerPaymentRequest } from "@/lib/billing/payment-request-resolution";
import { reverseTreasurerPayment } from "@/lib/billing/treasurer-payment-reversal";
import { getPaymentNotifications, PaymentNotificationsForbiddenError } from "@/lib/billing/payment-notifications";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("canonical in-app payment notifications", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let database: AppDatabase;
  beforeAll(async () => { testDatabase = await createTestDatabase(); database = testDatabase.db as unknown as AppDatabase; });
  afterAll(async () => { await testDatabase.close(); });
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


  it("isolates pending RT queues and own resident outcomes, without writing ledger or audit", async () => {
    const a = await createScenario(); const b = await createScenario();
    const auditBefore = await testDatabase.db.select().from(auditEvents);
    expect((await getPaymentNotifications(database, a.treasurerPrincipal)).items.map(x => x.requestCode)).toEqual([a.requestCode]);
    expect((await getPaymentNotifications(database, a.residentPrincipal)).items).toEqual([]);
    expect(await testDatabase.db.select().from(auditEvents)).toEqual(auditBefore);
    await verifyTreasurerPaymentRequest(database, a.treasurerPrincipal, a.requestCode);
    const outcome = await getPaymentNotifications(database, a.residentPrincipal);
    expect(outcome.items).toEqual([{ requestCode: a.requestCode, status: "verified", occurredAt: expect.any(String) }]);
    expect((await getPaymentNotifications(database, a.treasurerPrincipal)).items).toEqual([]);
    expect((await getPaymentNotifications(database, b.residentPrincipal)).items).toEqual([]);
    expect(Object.keys(outcome.items[0]).sort()).toEqual(["occurredAt", "requestCode", "status"]);
    const [payment] = await testDatabase.db.select().from(payments).where(eq(payments.paymentRequestId, a.requestId));
    await reverseTreasurerPayment(database, a.treasurerPrincipal, { paymentId: payment.id, reason: "Synthetic duplicate transfer correction" });
    expect((await getPaymentNotifications(database, a.residentPrincipal)).items[0].status).toBe("reversed");
  });
  it("reflects rejected requests without leaking the private reason", async () => {
    const a = await createScenario();
    await rejectTreasurerPaymentRequest(database, a.treasurerPrincipal, a.requestCode, "Synthetic unmatched reference");
    const outcome = await getPaymentNotifications(database, a.residentPrincipal);
    expect(outcome.items[0].status).toBe("rejected");
    expect(JSON.stringify(outcome)).not.toContain("Synthetic unmatched reference");
    expect((await getPaymentNotifications(database, a.treasurerPrincipal)).items).toEqual([]);
  });
  it("rejects forged scopes, unsupported roles and revoked membership or assignment", async () => {
    const a = await createScenario(); const b = await createScenario();
    for (const principal of [
      { ...a.residentPrincipal, rtUnitId: b.rtUnitId }, { ...a.residentPrincipal, householdId: b.householdId },
      { ...a.residentPrincipal, appAccountId: b.residentPrincipal.appAccountId },
      { ...a.residentPrincipal, role: "treasurer" as const },
      { ...a.treasurerPrincipal, role: "rt_chairman" as const }, { ...a.treasurerPrincipal, role: "system_admin" as const },
    ]) await expect(getPaymentNotifications(database, principal)).rejects.toBeInstanceOf(PaymentNotificationsForbiddenError);
    await testDatabase.db.update(officialAssignments).set({ endsOn: "2020-01-02" }).where(eq(officialAssignments.appAccountId, a.treasurerPrincipal.appAccountId));
    await expect(getPaymentNotifications(database, a.treasurerPrincipal)).rejects.toThrow();
    await testDatabase.db.update(appAccounts).set({ status: "disabled" }).where(eq(appAccounts.id, a.residentPrincipal.appAccountId));
    await expect(getPaymentNotifications(database, a.residentPrincipal)).rejects.toThrow();
  });
  it("caps resident outcomes at 20 and returns a stable newest-first order", async () => {
    const a = await createScenario();
    for (let i = 0; i < 22; i++) {
      const request = i === 0 ? { requestCode: a.requestCode } : await createResidentPaymentRequest(database, a.residentPrincipal, { period: "2026-03", idempotencyKey: randomUUID() });
      await rejectTreasurerPaymentRequest(database, a.treasurerPrincipal, request.requestCode, "Synthetic unmatched reference");
    }
    const first = await getPaymentNotifications(database, a.residentPrincipal);
    const second = await getPaymentNotifications(database, a.residentPrincipal);
    expect(first.items).toHaveLength(20); expect(first.hasMore).toBe(true); expect(first.items).toEqual(second.items);
    expect(first.items.map(x => x.occurredAt)).toEqual(first.items.map(x => x.occurredAt).sort().reverse());
  });
});
