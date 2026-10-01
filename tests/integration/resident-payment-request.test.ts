import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  billingYears,
  feeRates,
  monthlyDues,
  officialAssignments,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  paymentAllocations,
  payments,
  people,
} from "../../src/db/schema";
import { resolvePrincipalForUser } from "../../src/lib/auth/principal";
import { getResidentMonthlyDues } from "../../src/lib/billing/resident-dues";
import { createResidentPaymentWhatsAppLink } from "../../src/lib/billing/resident-payment-whatsapp";
import {
  createResidentPaymentRequest,
  PaymentRequestConflictError,
  PaymentRequestIdempotencyConflictError,
  PaymentRequestPeriodUnavailableError,
} from "../../src/lib/billing/resident-payment-request";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type DueInput = { period: string; status?: "unpaid" | "paid" | "waived" | "not_due"; amount?: number };

const key = () => randomUUID();

async function createVerifiedPaidHistory(
  database: TestDatabase["db"],
  input: { rtUnitId: string; householdId: string; residentAccountId: string; personId: string; dueId: string; period: string; amount: number },
) {
  const treasurerUser = await createAuthUser(database);
  const [treasurerAccount] = await database.insert(appAccounts).values({
    rtUnitId: input.rtUnitId,
    authUserId: treasurerUser.id,
    accountType: "official",
    loginIdentifier: `treasurer-${randomUUID().slice(0, 12)}`,
    personId: input.personId,
  }).returning({ id: appAccounts.id });
  await database.insert(officialAssignments).values({
    rtUnitId: input.rtUnitId,
    appAccountId: treasurerAccount!.id,
    role: "treasurer",
    startsOn: "2020-01-01",
  });

  const requestId = randomUUID();
  const requestCode = `KRT-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  await database.transaction(async (transaction) => {
    await transaction.insert(paymentRequests).values({
      id: requestId,
      requestCode,
      rtUnitId: input.rtUnitId,
      householdId: input.householdId,
      requestedByAccountId: input.residentAccountId,
      requestedByAccountType: "resident",
      status: "verified",
      idempotencyKey: randomUUID(),
      requestFingerprint: createHash("sha256").update(`fixture:${requestCode}`).digest("hex"),
      totalAmount: input.amount,
      itemCount: 1,
      verifiedByAccountId: treasurerAccount!.id,
      verifiedByAccountType: "official",
      verifiedAt: new Date(),
    });
    await transaction.insert(paymentRequestItems).values({
      requestId,
      rtUnitId: input.rtUnitId,
      householdId: input.householdId,
      monthlyDueId: input.dueId,
      period: input.period,
      amount: input.amount,
    });
    const [payment] = await transaction.insert(payments).values({
      rtUnitId: input.rtUnitId,
      householdId: input.householdId,
      paymentRequestId: requestId,
      amount: input.amount,
      method: "transfer",
      verifiedByAccountId: treasurerAccount!.id,
      verifiedByAccountType: "official",
    }).returning({ id: payments.id });
    const [allocation] = await transaction.insert(paymentAllocations).values({
      rtUnitId: input.rtUnitId,
      householdId: input.householdId,
      paymentRequestId: requestId,
      paymentId: payment!.id,
      monthlyDueId: input.dueId,
      amount: input.amount,
    }).returning({ id: paymentAllocations.id });
    await transaction.insert(activeDueSettlements).values({
      rtUnitId: input.rtUnitId,
      householdId: input.householdId,
      paymentId: payment!.id,
      allocationId: allocation!.id,
      monthlyDueId: input.dueId,
      amount: input.amount,
    });
    await transaction.insert(auditEvents).values({
      actorAppAccountId: treasurerAccount!.id,
      action: "payment_request.verified",
      entityType: "payment_request",
      entityId: requestId,
      context: { itemCount: 1, totalAmount: input.amount },
    });
    await transaction.update(monthlyDues)
      .set({ status: "paid" })
      .where(eq(monthlyDues.id, input.dueId));
  });
}

async function createResident(
  database: TestDatabase["db"],
  options: { rtUnitId?: string; number?: string; dues?: DueInput[]; latestBillingYearStatus?: "open" | "closed" } = {},
) {
  const rtUnitId = options.rtUnitId ?? await createRt(database);
  const household = await createHousehold(database, rtUnitId, { number: options.number });
  const user = await createAuthUser(database);
  const [account] = await database.insert(appAccounts).values({
    rtUnitId,
    authUserId: user.id,
    accountType: "resident",
    loginIdentifier: `resident-${randomUUID().slice(0, 12)}`,
    personId: household.personId,
    householdId: household.householdId,
  }).returning({ id: appAccounts.id });

  const periods = new Set((options.dues ?? []).map(({ period }) => Number(period.slice(0, 4))));
  const years = new Map<number, { id: string; feeRateId: string }>();
  for (const year of [...periods].sort((a, b) => a - b)) {
    const [billingYear] = await database.insert(billingYears).values({
      rtUnitId,
      year,
      status: year === Math.max(...periods) ? (options.latestBillingYearStatus ?? "open") : "closed",
    }).returning({ id: billingYears.id });
    const [feeRate] = await database.insert(feeRates).values({
      rtUnitId,
      billingYearId: billingYear.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    }).returning({ id: feeRates.id });
    years.set(year, { id: billingYear.id, feeRateId: feeRate.id });
  }

  for (const due of options.dues ?? []) {
    const [yearText, monthText] = due.period.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const status = due.status ?? "unpaid";
    const noObligation = status === "not_due";
    const [createdDue] = await database.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: years.get(year)!.id,
      feeRateId: noObligation ? null : years.get(year)!.feeRateId,
      month,
      amount: noObligation ? 0 : due.amount ?? 40000,
      dueDate: `${yearText}-${monthText}-10`,
      status: status === "paid" ? "unpaid" : status,
      waivedReason: status === "waived" ? "approved waiver" : null,
    }).returning({ id: monthlyDues.id });
    if (status === "paid") {
      await createVerifiedPaidHistory(database, {
        rtUnitId,
        householdId: household.householdId,
        residentAccountId: account!.id,
        personId: household.personId,
        dueId: createdDue!.id,
        period: due.period,
        amount: due.amount ?? 40000,
      });
    }
  }

  const principal = await resolvePrincipalForUser(database as never, user.id, "2026-06-18");
  return { rtUnitId, householdId: household.householdId, personId: household.personId, accountId: account.id, principal };
}

describe("resident payment request transactions", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  it("auto-selects older unpaid months across billing years and keeps due status unchanged", async () => {
    const { db } = testDatabase;
    const resident = await createResident(db, { dues: [
      { period: "2024-11", amount: 25000 },
      { period: "2025-12", amount: 30000 },
      { period: "2026-01", amount: 40000 },
      { period: "2026-02", amount: 40000 },
      { period: "2026-03", status: "paid" },
      { period: "2026-04", status: "waived" },
      { period: "2026-05", status: "not_due" },
    ] });
    const result = await createResidentPaymentRequest(db as never, resident.principal, {
      period: "2026-02",
      idempotencyKey: key(),
    });

    expect(result).toMatchObject({
      status: "pending",
      periods: ["2024-11", "2025-12", "2026-01", "2026-02"],
      totalAmount: 135000,
      idempotentReplay: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

    const request = await db.select().from(paymentRequests).where(eq(paymentRequests.requestCode, result.requestCode));
    expect(request).toHaveLength(1);
    const items = await db.select().from(paymentRequestItems).where(eq(paymentRequestItems.requestId, request[0].id));
    const claims = await db.select().from(paymentRequestClaims).where(eq(paymentRequestClaims.requestId, request[0].id));
    expect(items.map((item) => item.period).sort()).toEqual(result.periods);
    expect(items.reduce((sum, item) => sum + item.amount, 0)).toBe(result.totalAmount);
    expect(claims).toHaveLength(4);
    const event = await db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment_request.created"),
      eq(auditEvents.entityId, request[0].id),
    ));
    expect(event).toMatchObject([{
      actorAppAccountId: resident.accountId,
      context: { periods: "2024-11,2025-12,2026-01,2026-02", totalAmount: 135000, itemCount: 4 },
    }]);

    const readModel = await getResidentMonthlyDues(db as never, resident.principal);
    const pendingDue = readModel.find((due) => due.billingYear === 2024 && due.month === 11);
    expect(pendingDue).toMatchObject({ status: "unpaid", paymentRequestStatus: "pending" });
    const persistedDues = await db.select({ status: monthlyDues.status }).from(monthlyDues)
      .where(eq(monthlyDues.householdId, resident.householdId));
    expect(persistedDues.filter((due) => due.status === "unpaid")).toHaveLength(4);
  });

  it("replays the same request for the same key and rejects a changed payload", async () => {
    const { db } = testDatabase;
    const resident = await createResident(db, { dues: [
      { period: "2026-05" },
      { period: "2026-06" },
    ] });
    const idempotencyKey = key();
    const first = await createResidentPaymentRequest(db as never, resident.principal, {
      period: "2026-06",
      idempotencyKey,
    });
    const replay = await createResidentPaymentRequest(db as never, resident.principal, {
      period: "2026-06",
      idempotencyKey,
    });
    expect(replay).toMatchObject({
      requestCode: first.requestCode,
      periods: first.periods,
      totalAmount: first.totalAmount,
      idempotentReplay: true,
    });
    await expect(createResidentPaymentRequest(db as never, resident.principal, {
      period: "2026-05",
      idempotencyKey,
    })).rejects.toBeInstanceOf(PaymentRequestIdempotencyConflictError);
    await expect(db.select().from(paymentRequests).where(eq(paymentRequests.householdId, resident.householdId)))
      .resolves.toHaveLength(1);
    await expect(db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment_request.created"),
      eq(auditEvents.actorAppAccountId, resident.accountId),
    ))).resolves.toHaveLength(1);
  });

  it("does not claim an older period already in another active request", async () => {
    const { db } = testDatabase;
    const resident = await createResident(db, { dues: [
      { period: "2024-11" },
      { period: "2025-12" },
      { period: "2026-01" },
      { period: "2026-02" },
    ] });
    const older = await createResidentPaymentRequest(db as never, resident.principal, {
      period: "2025-12",
      idempotencyKey: key(),
    });
    const newer = await createResidentPaymentRequest(db as never, resident.principal, {
      period: "2026-02",
      idempotencyKey: key(),
    });
    expect(older.periods).toEqual(["2024-11", "2025-12"]);
    expect(newer.periods).toEqual(["2026-01", "2026-02"]);
    expect(newer.periods).not.toContain("2024-11");
    expect(newer.periods).not.toContain("2025-12");
  });

  it("allows only one concurrent active claim for the same periods", async () => {
    const { db } = testDatabase;
    const resident = await createResident(db, { dues: [
      { period: "2026-05" },
      { period: "2026-06" },
    ] });
    const outcomes = await Promise.allSettled([
      createResidentPaymentRequest(db as never, resident.principal, { period: "2026-06", idempotencyKey: key() }),
      createResidentPaymentRequest(db as never, resident.principal, { period: "2026-06", idempotencyKey: key() }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toBeInstanceOf(PaymentRequestConflictError);
    await expect(db.select().from(paymentRequests).where(eq(paymentRequests.householdId, resident.householdId)))
      .resolves.toHaveLength(1);
    await expect(db.select().from(paymentRequestClaims).innerJoin(
      paymentRequestItems,
      eq(paymentRequestItems.monthlyDueId, paymentRequestClaims.monthlyDueId),
    ).where(eq(paymentRequestItems.householdId, resident.householdId))).resolves.toHaveLength(2);
  });

  it("allows simultaneous retries with one key to return the same request", async () => {
    const { db } = testDatabase;
    const resident = await createResident(db, { dues: [{ period: "2026-06" }] });
    const idempotencyKey = key();
    const outcomes = await Promise.all([
      createResidentPaymentRequest(db as never, resident.principal, { period: "2026-06", idempotencyKey }),
      createResidentPaymentRequest(db as never, resident.principal, { period: "2026-06", idempotencyKey }),
    ]);
    expect(outcomes[0].requestCode).toBe(outcomes[1].requestCode);
    expect(outcomes.map((outcome) => outcome.idempotentReplay).sort()).toEqual([false, true]);
    await expect(db.select().from(paymentRequests).where(eq(paymentRequests.householdId, resident.householdId)))
      .resolves.toHaveLength(1);
    await expect(db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment_request.created"),
      eq(auditEvents.actorAppAccountId, resident.accountId),
    ))).resolves.toHaveLength(1);
  });

  it("rejects paid, waived, not-due, and malformed target periods without an audit event", async () => {
    const { db } = testDatabase;
    const resident = await createResident(db, { dues: [
      { period: "2026-03", status: "paid" },
      { period: "2026-04", status: "waived" },
      { period: "2026-05", status: "not_due" },
    ] });
    for (const period of ["2026-03", "2026-04", "2026-05"]) {
      await expect(createResidentPaymentRequest(db as never, resident.principal, {
        period,
        idempotencyKey: key(),
      })).rejects.toBeInstanceOf(PaymentRequestPeriodUnavailableError);
    }
    await expect(createResidentPaymentRequest(db as never, resident.principal, {
      period: "2026-13",
      idempotencyKey: key(),
    })).rejects.toThrow();
    await expect(db.select().from(paymentRequests).where(and(
      eq(paymentRequests.householdId, resident.householdId),
      eq(paymentRequests.status, "pending"),
    )))
      .resolves.toHaveLength(0);
    await expect(db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "payment_request.created"),
      eq(auditEvents.actorAppAccountId, resident.accountId),
    ))).resolves.toHaveLength(0);
  });

  it("cannot use another household's or RT's period through the resident principal", async () => {
    const { db } = testDatabase;
    const rtOne = await createRt(db);
    const owner = await createResident(db, {
      rtUnitId: rtOne,
      latestBillingYearStatus: "closed",
      dues: [{ period: "2025-05" }],
    });
    await createResident(db, { rtUnitId: rtOne, dues: [{ period: "2026-06" }] });
    await createResident(db, { dues: [{ period: "2026-07" }] });

    await expect(createResidentPaymentRequest(db as never, owner.principal, {
      period: "2026-06",
      idempotencyKey: key(),
    })).rejects.toBeInstanceOf(PaymentRequestPeriodUnavailableError);
    await expect(createResidentPaymentRequest(db as never, owner.principal, {
      period: "2026-07",
      idempotencyKey: key(),
    })).rejects.toBeInstanceOf(PaymentRequestPeriodUnavailableError);
    await expect(getResidentMonthlyDues(db as never, owner.principal)).resolves.toMatchObject([
      { billingYear: 2025, month: 5, status: "unpaid" },
    ]);
    await expect(db.select().from(paymentRequests).where(eq(paymentRequests.householdId, owner.householdId)))
      .resolves.toHaveLength(0);
  });

  it("builds a WhatsApp deep link for the active Treasurer in the same RT", async () => {
    const { db } = testDatabase;
    const resident = await createResident(db);
    const treasurerHousehold = await createHousehold(db, resident.rtUnitId, { number: "B-01" });
    const treasurerUser = await createAuthUser(db, "Bendahara Uji");
    await db.update(people).set({ phone: "08123456789" }).where(eq(people.id, treasurerHousehold.personId));
    const [treasurerAccount] = await db.insert(appAccounts).values({
      rtUnitId: resident.rtUnitId,
      authUserId: treasurerUser.id,
      accountType: "official",
      loginIdentifier: `treasurer-${treasurerUser.id.slice(0, 8)}`,
      personId: treasurerHousehold.personId,
    }).returning({ id: appAccounts.id });
    await db.insert(officialAssignments).values({
      rtUnitId: resident.rtUnitId,
      appAccountId: treasurerAccount.id,
      role: "treasurer",
      startsOn: "2020-01-01",
    });

    const request = {
      requestCode: "KRT-91A2B3C4D5E6",
      status: "pending" as const,
      periods: ["2024-11", "2026-02"],
      totalAmount: 135000,
      createdAt: new Date("2026-06-18T03:00:00.000Z"),
      idempotentReplay: false,
    };
    const link = await createResidentPaymentWhatsAppLink(db as never, {
      rtUnitId: resident.rtUnitId,
      houseNumber: "R-07",
      residentName: "Warga Uji",
      request,
    });

    expect(link).toMatch(/^https:\/\/wa\.me\/628123456789\?text=/);
    const message = new URL(link!).searchParams.get("text") ?? "";
    expect(message).toContain("Nama: Warga Uji");
    expect(message).toContain("Nomor rumah: R-07");
    expect(message).toContain("November 2024, Februari 2026");
    expect(message.replace(/\s/g, "")).toContain("Rp135.000");
    expect(message).toContain("Waktu pengajuan:");
    expect(message).toContain("Nomor pengajuan: KRT-91A2B3C4D5E6");

    const otherRt = await createRt(db);
    await expect(createResidentPaymentWhatsAppLink(db as never, {
      rtUnitId: otherRt,
      houseNumber: "R-07",
      residentName: "Warga Uji",
      request,
    })).resolves.toBeNull();
  });

  it("leaves no request, item, claim, or audit row when a domain constraint fails", async () => {
    const { client, db } = testDatabase;
    const resident = await createResident(db, { dues: [{ period: "2026-06" }] });
    await client.exec(`ALTER TABLE payment_request_items ADD CONSTRAINT phase5_test_domain_block CHECK (household_id <> '${resident.householdId}'::uuid)`);
    try {
      await expect(createResidentPaymentRequest(db as never, resident.principal, {
        period: "2026-06",
        idempotencyKey: key(),
      })).rejects.toThrow();
      await expect(db.select().from(paymentRequests).where(eq(paymentRequests.householdId, resident.householdId)))
        .resolves.toHaveLength(0);
      await expect(db.select().from(paymentRequestItems).where(eq(paymentRequestItems.householdId, resident.householdId)))
        .resolves.toHaveLength(0);
      await expect(db.select().from(paymentRequestClaims).innerJoin(
        paymentRequestItems,
        eq(paymentRequestItems.monthlyDueId, paymentRequestClaims.monthlyDueId),
      ).where(eq(paymentRequestItems.householdId, resident.householdId))).resolves.toHaveLength(0);
      await expect(db.select().from(auditEvents).where(and(
        eq(auditEvents.action, "payment_request.created"),
        eq(auditEvents.actorAppAccountId, resident.accountId),
      ))).resolves.toHaveLength(0);
    } finally {
      await client.exec("ALTER TABLE payment_request_items DROP CONSTRAINT phase5_test_domain_block");
    }
  });

  it("rolls back request, items, and claims when the audit insert fails", async () => {
    const { client, db } = testDatabase;
    const resident = await createResident(db, { dues: [{ period: "2026-06" }] });
    await client.exec(`ALTER TABLE audit_events ADD CONSTRAINT payment_request_test_audit_block CHECK (action <> 'payment_request.created' OR actor_app_account_id <> '${resident.accountId}'::uuid)`);
    try {
      await expect(createResidentPaymentRequest(db as never, resident.principal, {
        period: "2026-06",
        idempotencyKey: key(),
      })).rejects.toThrow();
      await expect(db.select().from(paymentRequests).where(eq(paymentRequests.householdId, resident.householdId)))
        .resolves.toHaveLength(0);
      await expect(db.select().from(paymentRequestItems).where(eq(paymentRequestItems.householdId, resident.householdId)))
        .resolves.toHaveLength(0);
      await expect(db.select().from(paymentRequestClaims).innerJoin(
        paymentRequestItems,
        eq(paymentRequestItems.monthlyDueId, paymentRequestClaims.monthlyDueId),
      ).where(eq(paymentRequestItems.householdId, resident.householdId))).resolves.toHaveLength(0);
      await expect(db.select().from(auditEvents).where(and(
        eq(auditEvents.action, "payment_request.created"),
        eq(auditEvents.actorAppAccountId, resident.accountId),
      ))).resolves.toHaveLength(0);
    } finally {
      await client.exec("ALTER TABLE audit_events DROP CONSTRAINT payment_request_test_audit_block");
    }
  });
});
