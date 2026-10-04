import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  auth: undefined as unknown,
  requestHeaders: new Headers(),
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/auth/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/server")>("@/lib/auth/server");
  return { ...actual, getAuth: () => mocks.auth };
});

import type { AppDatabase } from "@/db/client";
import { POST as recoverTwoFactor } from "@/app/api/system-admin/accounts/[accountId]/recover-two-factor/route";
import { GET as getResidentRequests, POST as createResidentRequest } from "@/app/api/resident/payment-requests/route";
import { POST as cancelResidentRequest } from "@/app/api/resident/payment-requests/[requestCode]/cancel/route";
import { GET as getResidentDues } from "@/app/api/resident/monthly-dues/route";
import { POST as resetResidentPin } from "@/app/api/residents/[accountId]/reset-pin/route";
import { POST as verifyTreasurerPayment } from "@/app/api/treasurer/payment-requests/[requestCode]/verify/route";
import { GET as getTreasurerQueue } from "@/app/api/treasurer/payment-requests/route";
import { GET as getTreasurerHistory } from "@/app/api/treasurer/payments/route";
import { POST as recordCashPayment } from "@/app/api/treasurer/cash-payments/route";
import { POST as reversePayment } from "@/app/api/treasurer/payments/[paymentId]/reverse/route";
import { GET as getChairmanReport } from "@/app/api/chairman/reports/route";
import { POST as createChairmanWaiver } from "@/app/api/chairman/waivers/route";
import { GET as getChairmanHouseholds, POST as createChairmanHousehold } from "@/app/api/chairman/households/route";
import { GET as getChairmanFeeRates, POST as createChairmanFeeRate } from "@/app/api/chairman/fee-rates/route";
import { POST as createChairmanAdjustment } from "@/app/api/chairman/adjustments/route";
import {
  appAccounts,
  auditEvents,
  authAccount,
  authSession,
  authTwoFactor,
  authUser,
  billingYears,
  monthlyDues,
  houses,
  households,
  feeRates,
  dueAdjustments,
  officialAssignments,
  paymentAllocations,
  paymentRequestItems,
  paymentRequestClaims,
  paymentRequests,
  payments,
  waiverActions,
  waiverItems,
} from "@/db/schema";
import { createAuth } from "@/lib/auth/server";
import { hashPassword } from "better-auth/crypto";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("System Admin recovery route cookie-session boundary", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let database: AppDatabase;
  let auth: ReturnType<typeof createAuth>;
  let ipCounter = 0;

  function nextTestIp() {
    ipCounter += 1;
    return `198.51.100.${ipCounter}`;
  }

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
    auth = createAuth(database, {
      secret: "test-only-secret-with-at-least-32-characters",
      baseURL: "http://localhost:3000",
    });
    mocks.database = database;
    mocks.auth = auth;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  beforeEach(() => {
    mocks.requestHeaders = new Headers();
  });

  async function verifiedAdminSession(label: string) {
    const testIp = nextTestIp();
    const user = await createAuthUser(testDatabase.db, label);
    const password = `Test-${randomUUID()}-Password`;
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(password),
    });
    const [account] = await testDatabase.db.insert(appAccounts).values({
      authUserId: user.id,
      accountType: "system_admin",
      loginIdentifier: `recovery-${randomUUID()}`,
    }).returning({ id: appAccounts.id });

    const signIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": testIp },
      body: JSON.stringify({ email: user.email, password, rememberMe: false }),
    }));
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(cookie).toContain("session_token");

    const enrollment = await auth.api.enableTwoFactor({
      body: { password, method: "totp", issuer: "KartuRT" },
      headers: new Headers({ cookie, "x-forwarded-for": testIp }),
    });
    if (enrollment.method !== "totp") throw new Error("TOTP enrollment did not return an authenticator secret.");
    const secret = new TextDecoder().decode((await import("@better-auth/utils/base32")).base32.decode(
      new URL(enrollment.totpURI).searchParams.get("secret")!,
    ));
    const code = await auth.api.generateTOTP({ body: { secret } });
    await auth.api.verifyTOTP({
      body: { code: code.code, trustDevice: false },
      headers: new Headers({ cookie, "x-forwarded-for": testIp }),
    });

    const challenge = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": testIp },
      body: JSON.stringify({ email: user.email, password, rememberMe: false }),
    }));
    expect(challenge.status).toBe(200);
    const challengeCookie = challenge.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const freshCode = await auth.api.generateTOTP({ body: { secret } });
    const verified = await auth.handler(new Request("http://localhost:3000/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: challengeCookie,
        "x-forwarded-for": testIp,
      },
      body: JSON.stringify({ code: freshCode.code, trustDevice: false }),
    }));
    expect(verified.status).toBe(200);
    const sessionCookie = verified.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(sessionCookie).toContain("session_token");
    mocks.requestHeaders = new Headers({ cookie: sessionCookie });
    expect(await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) })).toBeTruthy();
    return { accountId: account!.id, userId: user.id, cookie: sessionCookie };
  }

  async function regularSession(
    label: string,
    accountType: "resident" | "official" | "system_admin",
    options: { role?: "treasurer" | "rt_chairman"; disabled?: boolean; endedAssignment?: boolean; rtUnitId?: string } = {},
  ) {
    const testIp = nextTestIp();
    const user = await createAuthUser(testDatabase.db, label);
    const password = `Test-${randomUUID()}-Password`;
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(password),
    });
    const rtUnitId = accountType === "system_admin" ? null : options.rtUnitId ?? await createRt(testDatabase.db);
    const household = rtUnitId ? await createHousehold(testDatabase.db, rtUnitId) : null;
    const [account] = await testDatabase.db.insert(appAccounts).values({
      authUserId: user.id,
      accountType,
      loginIdentifier: `${label.replaceAll(" ", "-")}-${randomUUID()}`,
      ...(rtUnitId ? { rtUnitId } : {}),
      ...(household ? { personId: household.personId } : {}),
      ...(accountType === "resident" && household ? { householdId: household.householdId } : {}),
    }).returning({ id: appAccounts.id });
    if (accountType === "official") {
      await testDatabase.db.insert(officialAssignments).values({
        rtUnitId: rtUnitId!,
        appAccountId: account!.id,
        role: options.role ?? "treasurer",
        startsOn: "1990-01-01",
      });
    }
    const signIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": testIp },
      body: JSON.stringify({ email: user.email, password, rememberMe: false }),
    }));
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(cookie).toContain("session_token");
    if (options.disabled) {
      await testDatabase.db.update(appAccounts).set({ status: "disabled" }).where(eq(appAccounts.id, account!.id));
    }
    if (options.endedAssignment) {
      await testDatabase.db.update(officialAssignments).set({ endsOn: "2000-01-01" })
        .where(eq(officialAssignments.appAccountId, account!.id));
    }
    return {
      accountId: account!.id,
      userId: user.id,
      cookie,
      rtUnitId,
      householdId: household?.householdId ?? null,
      personId: household?.personId ?? null,
    };
  }

  async function assertTargetState(targetAccountId: string, targetUserId: string, before: {
    factors: unknown[];
    sessions: unknown[];
    account: unknown[];
    audits: unknown[];
  }) {
    expect(await testDatabase.db.select().from(authTwoFactor).where(eq(authTwoFactor.userId, targetUserId))).toEqual(before.factors);
    expect(await testDatabase.db.select().from(authSession).where(eq(authSession.userId, targetUserId))).toEqual(before.sessions);
    expect(await testDatabase.db.select({ enabled: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, targetUserId)))
      .toEqual(before.account);
    expect(await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.entityId, targetAccountId),
      eq(auditEvents.action, "system_admin.two_factor.emergency_recovery"),
    ))).toEqual(before.audits);
  }

  async function pendingRequestFor(input: {
    rtUnitId: string;
    householdId: string;
    residentAccountId: string;
    billingYearId: string;
    feeRateId: string;
    period: string;
  }) {
    const [yearText, monthText] = input.period.split("-");
    const month = Number(monthText);
    const [due] = await testDatabase.db.insert(monthlyDues).values({
      rtUnitId: input.rtUnitId,
      householdId: input.householdId,
      billingYearId: input.billingYearId,
      feeRateId: input.feeRateId,
      month,
      amount: 40000,
      dueDate: `${yearText}-${monthText}-10`,
      status: "unpaid",
    }).returning({ id: monthlyDues.id });
    const requestId = randomUUID();
    const requestCode = `KRT-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    await testDatabase.db.transaction(async (transaction) => {
      await transaction.insert(paymentRequests).values({
        id: requestId,
        requestCode,
        rtUnitId: input.rtUnitId,
        householdId: input.householdId,
        requestedByAccountId: input.residentAccountId,
        requestedByAccountType: "resident",
        status: "pending",
        idempotencyKey: randomUUID(),
        requestFingerprint: createHash("sha256").update(requestCode).digest("hex"),
        totalAmount: 40000,
        itemCount: 1,
      });
      await transaction.insert(paymentRequestItems).values({
        requestId,
        rtUnitId: input.rtUnitId,
        householdId: input.householdId,
        monthlyDueId: due!.id,
        period: input.period,
        amount: 40000,
      });
      await transaction.insert(paymentRequestClaims).values({ requestId, monthlyDueId: due!.id });
    });
    return { requestId, requestCode, dueId: due!.id };
  }

  it("scopes resident history to the signed-in owner and denies cross-user cancellation without changing request state", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const firstResident = await regularSession("Resident IDOR first", "resident", { rtUnitId });
    const secondResident = await regularSession("Resident IDOR second", "resident", { rtUnitId });
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
    const firstRequest = await pendingRequestFor({
      rtUnitId,
      householdId: firstResident.householdId!,
      residentAccountId: firstResident.accountId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      period: "2026-09",
    });
    const secondRequest = await pendingRequestFor({
      rtUnitId,
      householdId: secondResident.householdId!,
      residentAccountId: secondResident.accountId,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      period: "2026-08",
    });

    const beforeAnonymous = {
      requests: await testDatabase.db.select().from(paymentRequests),
      items: await testDatabase.db.select().from(paymentRequestItems),
      claims: await testDatabase.db.select().from(paymentRequestClaims),
      dues: await testDatabase.db.select().from(monthlyDues),
      audits: await testDatabase.db.select().from(auditEvents),
    };
    mocks.requestHeaders = new Headers();
    const anonymousGet = await getResidentRequests(new Request("http://localhost:3000/api/resident/payment-requests"));
    expect(anonymousGet.status).toBe(401);
    const anonymousCreate = await createResidentRequest(new Request("http://localhost:3000/api/resident/payment-requests", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({ period: "2026-07" }),
    }));
    expect(anonymousCreate.status).toBe(401);
    const anonymousCancel = await cancelResidentRequest(new Request(
      `http://localhost:3000/api/resident/payment-requests/${secondRequest.requestCode}/cancel`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: "{}",
      },
    ), { params: Promise.resolve({ requestCode: secondRequest.requestCode }) });
    expect(anonymousCancel.status).toBe(401);
    expect(await testDatabase.db.select().from(paymentRequests)).toEqual(beforeAnonymous.requests);
    expect(await testDatabase.db.select().from(paymentRequestItems)).toEqual(beforeAnonymous.items);
    expect(await testDatabase.db.select().from(paymentRequestClaims)).toEqual(beforeAnonymous.claims);
    expect(await testDatabase.db.select().from(monthlyDues)).toEqual(beforeAnonymous.dues);
    expect(await testDatabase.db.select().from(auditEvents)).toEqual(beforeAnonymous.audits);

    mocks.requestHeaders = new Headers({ cookie: firstResident.cookie });
    const firstHistory = await getResidentRequests(new Request("http://localhost:3000/api/resident/payment-requests", {
      headers: { cookie: firstResident.cookie },
    }));
    expect(firstHistory.status).toBe(200);
    expect(await firstHistory.json()).toMatchObject({ requests: [{ requestCode: firstRequest.requestCode }] });

    mocks.requestHeaders = new Headers({ cookie: secondResident.cookie });
    const secondHistory = await getResidentRequests(new Request("http://localhost:3000/api/resident/payment-requests", {
      headers: { cookie: secondResident.cookie },
    }));
    expect(secondHistory.status).toBe(200);
    expect(await secondHistory.json()).toMatchObject({ requests: [{ requestCode: secondRequest.requestCode }] });

    const before = {
      request: await testDatabase.db.select().from(paymentRequests).where(eq(paymentRequests.id, secondRequest.requestId)),
      item: await testDatabase.db.select().from(paymentRequestItems).where(eq(paymentRequestItems.requestId, secondRequest.requestId)),
      claim: await testDatabase.db.select().from(paymentRequestClaims).where(eq(paymentRequestClaims.requestId, secondRequest.requestId)),
      due: await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, secondRequest.dueId)),
      audit: await testDatabase.db.select().from(auditEvents).where(eq(auditEvents.entityId, secondRequest.requestId)),
    };
    mocks.requestHeaders = new Headers({ cookie: firstResident.cookie });
    const cancelResponse = await cancelResidentRequest(new Request(
      `http://localhost:3000/api/resident/payment-requests/${secondRequest.requestCode}/cancel`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie: firstResident.cookie,
        },
        body: "{}",
      },
    ), { params: Promise.resolve({ requestCode: secondRequest.requestCode }) });

    expect(cancelResponse.status).toBe(404);
    expect(await cancelResponse.text()).not.toContain(secondResident.userId);
    expect(await testDatabase.db.select().from(paymentRequests).where(eq(paymentRequests.id, secondRequest.requestId))).toEqual(before.request);
    expect(await testDatabase.db.select().from(paymentRequestItems).where(eq(paymentRequestItems.requestId, secondRequest.requestId))).toEqual(before.item);
    expect(await testDatabase.db.select().from(paymentRequestClaims).where(eq(paymentRequestClaims.requestId, secondRequest.requestId))).toEqual(before.claim);
    expect(await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, secondRequest.dueId))).toEqual(before.due);
    expect(await testDatabase.db.select().from(auditEvents).where(eq(auditEvents.entityId, secondRequest.requestId))).toEqual(before.audit);

    const treasurer = await regularSession("Resident request verification Treasurer", "official", {
      role: "treasurer",
      rtUnitId,
    });
    mocks.requestHeaders = new Headers({ cookie: treasurer.cookie });
    const verifiedResponse = await verifyTreasurerPayment(new Request(
      `http://localhost:3000/api/treasurer/payment-requests/${firstRequest.requestCode}/verify`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie: treasurer.cookie,
        },
        body: "{}",
      },
    ), { params: Promise.resolve({ requestCode: firstRequest.requestCode }) });
    expect(verifiedResponse.status).toBe(200);
    expect(await testDatabase.db.select({ status: paymentRequests.status }).from(paymentRequests)
      .where(eq(paymentRequests.id, firstRequest.requestId))).toMatchObject([{ status: "verified" }]);
    expect(await testDatabase.db.select().from(payments).where(eq(payments.paymentRequestId, firstRequest.requestId))).toHaveLength(1);
    expect(await testDatabase.db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId,
      (await testDatabase.db.select({ id: payments.id }).from(payments).where(eq(payments.paymentRequestId, firstRequest.requestId)))[0]!.id,
    ))).toHaveLength(1);
    expect(await testDatabase.db.select({ status: monthlyDues.status }).from(monthlyDues)
      .where(eq(monthlyDues.id, firstRequest.dueId))).toMatchObject([{ status: "paid" }]);
  });

  it("enforces live Chairman sessions, tenant scope, and state preservation on waiver/report routes", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const chairman = await regularSession("Chairman route actor", "official", { role: "rt_chairman", rtUnitId });
    const resident = await regularSession("Resident waiver target", "resident", { rtUnitId });
    const treasurer = await regularSession("Treasurer waiver attacker", "official", { role: "treasurer", rtUnitId });
    const otherRtUnitId = await createRt(testDatabase.db);
    const otherRtHousehold = await createHousehold(testDatabase.db, otherRtUnitId);
    const otherRtChairman = await regularSession("Other RT Chairman", "official", {
      role: "rt_chairman",
      rtUnitId: otherRtUnitId,
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
      monthlyAmount: 40000,
    });
    const [due] = await testDatabase.db.insert(monthlyDues).values({
      rtUnitId,
      householdId: resident.householdId!,
      billingYearId: billingYear!.id,
      feeRateId: feeRate!.id,
      month: 9,
      amount: 40000,
      dueDate: "2026-09-10",
      status: "unpaid",
    }).returning({ id: monthlyDues.id });
    async function waiverRequest(cookie: string | null, householdId: string, reason: string) {
      mocks.requestHeaders = new Headers(cookie ? { cookie } : {});
      return createChairmanWaiver(new Request("http://localhost:3000/api/chairman/waivers", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ householdId, periods: ["2026-09"], reason }),
      }));
    }

    const beforeDenied = {
      due: await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, due!.id)),
      actions: await testDatabase.db.select().from(waiverActions),
      items: await testDatabase.db.select().from(waiverItems),
      audits: await testDatabase.db.select().from(auditEvents),
    };
    for (const denied of [resident, treasurer, { cookie: null }]) {
      const response = await waiverRequest(denied.cookie, resident.householdId!, "Unauthorized waiver attempt.");
      expect(response.status).toBe(denied.cookie ? 403 : 401);
      expect(await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, due!.id))).toEqual(beforeDenied.due);
      expect(await testDatabase.db.select().from(waiverActions)).toEqual(beforeDenied.actions);
      expect(await testDatabase.db.select().from(waiverItems)).toEqual(beforeDenied.items);
      expect(await testDatabase.db.select().from(auditEvents)).toEqual(beforeDenied.audits);
    }

    const crossRtWaiver = await waiverRequest(chairman.cookie, otherRtHousehold.householdId, "Cross-RT waiver attempt.");
    expect(crossRtWaiver.status).toBe(404);
    expect(await testDatabase.db.select().from(monthlyDues).where(eq(monthlyDues.id, due!.id))).toEqual(beforeDenied.due);
    expect(await testDatabase.db.select().from(waiverActions)).toEqual(beforeDenied.actions);
    expect(await testDatabase.db.select().from(waiverItems)).toEqual(beforeDenied.items);
    expect(await testDatabase.db.select().from(auditEvents)).toEqual(beforeDenied.audits);

    const authorizedWaiver = await waiverRequest(chairman.cookie, resident.householdId!, "Approved same-RT waiver.");
    expect(authorizedWaiver.status).toBe(200);
    expect(await testDatabase.db.select({ status: monthlyDues.status }).from(monthlyDues).where(eq(monthlyDues.id, due!.id)))
      .toMatchObject([{ status: "waived" }]);

    for (const denied of [resident, treasurer, { cookie: null }]) {
      mocks.requestHeaders = new Headers(denied.cookie ? { cookie: denied.cookie } : {});
      const response = await getChairmanReport(new Request("http://localhost:3000/api/chairman/reports", {
        headers: denied.cookie ? { cookie: denied.cookie } : {},
      }));
      expect(response.status).toBe(denied.cookie ? 403 : 401);
    }

    mocks.requestHeaders = new Headers({ cookie: chairman.cookie });
    const chairmanReport = await getChairmanReport(new Request("http://localhost:3000/api/chairman/reports", {
      headers: { cookie: chairman.cookie },
    }));
    expect(chairmanReport.status).toBe(200);
    await expect(chairmanReport.json()).resolves.toMatchObject({ yearly: { target: 40000, waived: 40000 } });

    mocks.requestHeaders = new Headers({ cookie: otherRtChairman.cookie });
    const otherRtReport = await getChairmanReport(new Request("http://localhost:3000/api/chairman/reports", {
      headers: { cookie: otherRtChairman.cookie },
    }));
    expect(otherRtReport.status).toBe(200);
    await expect(otherRtReport.json()).resolves.toMatchObject({ yearly: { target: 0, waived: 0 } });

    mocks.requestHeaders = new Headers({ cookie: chairman.cookie });
    const spoofedReport = await getChairmanReport(new Request(
      `http://localhost:3000/api/chairman/reports?rtUnitId=${otherRtUnitId}`,
      { headers: { cookie: chairman.cookie } },
    ));
    expect(spoofedReport.status).toBe(400);
  });

  it("rejects a foreign Origin before an authenticated recovery can change factor, sessions, or audit state", async () => {
    const actor = await verifiedAdminSession("Verified recovery actor");
    const target = await verifiedAdminSession("Recovery target");
    const before = {
      factors: await testDatabase.db.select().from(authTwoFactor).where(eq(authTwoFactor.userId, target.userId)),
      sessions: await testDatabase.db.select().from(authSession).where(eq(authSession.userId, target.userId)),
      account: await testDatabase.db.select({ enabled: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, target.userId)),
      audits: await testDatabase.db.select().from(auditEvents).where(and(
        eq(auditEvents.entityId, target.accountId),
        eq(auditEvents.action, "system_admin.two_factor.emergency_recovery"),
      )),
    };
    mocks.requestHeaders = new Headers({ cookie: actor.cookie });

    for (const origin of ["https://attacker.invalid", "null", "bukan-url", undefined]) {
      const requestHeaders = new Headers({ "content-type": "application/json", cookie: actor.cookie });
      if (origin !== undefined) requestHeaders.set("origin", origin);
      mocks.requestHeaders = new Headers({ cookie: actor.cookie });
      const response = await recoverTwoFactor(new Request(
        `http://localhost:3000/api/system-admin/accounts/${target.accountId}/recover-two-factor`,
        {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({
            reason: "Attempted cross-origin recovery.",
            recoveryReference: "INC-2026-031",
          }),
        },
      ), { params: Promise.resolve({ accountId: target.accountId }) });

      expect(response.status, `Origin ${origin ?? "<missing>"}`).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await assertTargetState(target.accountId, target.userId, before);
    }
  });

  it("allows another verified System Admin through the direct API and revokes only the target state", async () => {
    const actor = await verifiedAdminSession("Authorized recovery actor");
    const target = await verifiedAdminSession("Authorized recovery target");
    const actorSessionsBefore = await testDatabase.db.select().from(authSession).where(eq(authSession.userId, actor.userId));
    mocks.requestHeaders = new Headers({ cookie: actor.cookie });
    const response = await recoverTwoFactor(new Request(
      `http://localhost:3000/api/system-admin/accounts/${target.accountId}/recover-two-factor`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie: actor.cookie,
        },
        body: JSON.stringify({
          reason: "Target lost the authenticator and backup codes.",
          recoveryReference: "INC-2026-033",
        }),
      },
    ), { params: Promise.resolve({ accountId: target.accountId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, targetAccountId: target.accountId, sessionsRevoked: 2 });
    expect(await testDatabase.db.select().from(authTwoFactor).where(eq(authTwoFactor.userId, target.userId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(authSession).where(eq(authSession.userId, target.userId))).toHaveLength(0);
    expect(await testDatabase.db.select().from(authSession).where(eq(authSession.userId, actor.userId))).toEqual(actorSessionsBefore);
    await expect(testDatabase.db.select({ enabled: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, target.userId)))
      .resolves.toMatchObject([{ enabled: false }]);
    expect(await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.entityId, target.accountId),
      eq(auditEvents.action, "system_admin.two_factor.emergency_recovery"),
    ))).toMatchObject([{
      actorAppAccountId: actor.accountId,
      reason: "Target lost the authenticator and backup codes.",
      context: { recoveryReference: "INC-2026-033", revokedSessionCount: 2 },
    }]);

    mocks.requestHeaders = new Headers({ cookie: target.cookie });
    const revokedCookieResponse = await getResidentRequests(new Request("http://localhost:3000/api/resident/payment-requests", {
      headers: { cookie: target.cookie },
    }));
    expect(revokedCookieResponse.status).toBe(401);
    expect(await testDatabase.db.select().from(authSession).where(eq(authSession.userId, target.userId))).toHaveLength(0);
  });

  it("denies self-recovery through the authenticated route without changing the actor's factor or sessions", async () => {
    const actor = await verifiedAdminSession("Self recovery actor");
    const before = {
      factors: await testDatabase.db.select().from(authTwoFactor).where(eq(authTwoFactor.userId, actor.userId)),
      sessions: await testDatabase.db.select().from(authSession).where(eq(authSession.userId, actor.userId)),
      account: await testDatabase.db.select({ enabled: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, actor.userId)),
      audits: await testDatabase.db.select().from(auditEvents).where(and(
        eq(auditEvents.entityId, actor.accountId),
        eq(auditEvents.action, "system_admin.two_factor.emergency_recovery"),
      )),
    };
    mocks.requestHeaders = new Headers({ cookie: actor.cookie });
    const response = await recoverTwoFactor(new Request(
      `http://localhost:3000/api/system-admin/accounts/${actor.accountId}/recover-two-factor`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie: actor.cookie,
        },
        body: JSON.stringify({ reason: "Self recovery attempt.", recoveryReference: "INC-2026-034" }),
      },
    ), { params: Promise.resolve({ accountId: actor.accountId }) });

    expect(response.status).toBe(403);
    await assertTargetState(actor.accountId, actor.userId, before);
  });

  it("denies authenticated wrong-role, inactive, ended-assignment, unverified, spoofed, and anonymous direct API calls without state changes", async () => {
    const target = await verifiedAdminSession("Recovery matrix target");
    const before = {
      factors: await testDatabase.db.select().from(authTwoFactor).where(eq(authTwoFactor.userId, target.userId)),
      sessions: await testDatabase.db.select().from(authSession).where(eq(authSession.userId, target.userId)),
      account: await testDatabase.db.select({ enabled: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, target.userId)),
      audits: await testDatabase.db.select().from(auditEvents).where(and(
        eq(auditEvents.entityId, target.accountId),
        eq(auditEvents.action, "system_admin.two_factor.emergency_recovery"),
      )),
    };
    const resident = await regularSession("Resident actor", "resident");
    const otherRtResident = await regularSession("Other RT resident", "resident");
    const treasurer = await regularSession("Treasurer actor", "official", { role: "treasurer" });
    const chairman = await regularSession("Chairman actor", "official", { role: "rt_chairman" });
    const inactiveAccount = await regularSession("Inactive official actor", "official", { role: "treasurer", disabled: true });
    const endedAssignment = await regularSession("Ended assignment actor", "official", { role: "treasurer", endedAssignment: true });
    const unverifiedAdmin = await regularSession("Unverified System Admin actor", "system_admin");
    const financialBefore = {
      requests: await testDatabase.db.select().from(paymentRequests),
      items: await testDatabase.db.select().from(paymentRequestItems),
      claims: await testDatabase.db.select().from(paymentRequestClaims),
      dues: await testDatabase.db.select().from(monthlyDues),
      payments: await testDatabase.db.select().from(payments),
      allocations: await testDatabase.db.select().from(paymentAllocations),
    };
    const cases = [
      { label: "Resident", cookie: resident.cookie, status: 403 },
      { label: "resident from a different RT", cookie: otherRtResident.cookie, status: 403 },
      { label: "Treasurer", cookie: treasurer.cookie, status: 403 },
      { label: "Chairman", cookie: chairman.cookie, status: 403 },
      { label: "inactive account", cookie: inactiveAccount.cookie, status: 401 },
      { label: "ended official assignment", cookie: endedAssignment.cookie, status: 401 },
      { label: "unverified System Admin", cookie: unverifiedAdmin.cookie, status: 401 },
      { label: "anonymous", cookie: null, status: 401 },
    ];

    for (const testCase of cases) {
      const headers = new Headers({
        origin: "http://localhost:3000",
        "content-type": "application/json",
        ...(testCase.cookie ? { cookie: testCase.cookie } : {}),
      });
      mocks.requestHeaders = new Headers(testCase.cookie ? { cookie: testCase.cookie } : {});
      const response = await recoverTwoFactor(new Request(
        `http://localhost:3000/api/system-admin/accounts/${target.accountId}/recover-two-factor`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            reason: `Denied ${testCase.label} attempt.`,
            recoveryReference: "INC-2026-032",
            role: "system_admin",
            rtUnitId: "00000000-0000-4000-8000-000000000099",
            actorAppAccountId: target.accountId,
            targetAccountId: target.accountId,
          }),
        },
      ), { params: Promise.resolve({ accountId: target.accountId }) });

      expect(response.status, testCase.label).toBe(testCase.status);
      await assertTargetState(target.accountId, target.userId, before);

      if (testCase.label !== "Treasurer") {
        mocks.requestHeaders = new Headers(testCase.cookie ? { cookie: testCase.cookie } : {});
        const verificationResponse = await verifyTreasurerPayment(new Request(
          "http://localhost:3000/api/treasurer/payment-requests/KRT-0000000000000000/verify",
          {
            method: "POST",
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              ...(testCase.cookie ? { cookie: testCase.cookie } : {}),
            },
            body: JSON.stringify({ role: "treasurer", rtUnitId: "00000000-0000-4000-8000-000000000099" }),
          },
        ), { params: Promise.resolve({ requestCode: "KRT-0000000000000000" }) });

        expect(verificationResponse.status, `Treasurer verification API: ${testCase.label}`).toBe(testCase.status);
        expect(await testDatabase.db.select().from(paymentRequests)).toEqual(financialBefore.requests);
        expect(await testDatabase.db.select().from(paymentRequestItems)).toEqual(financialBefore.items);
        expect(await testDatabase.db.select().from(paymentRequestClaims)).toEqual(financialBefore.claims);
        expect(await testDatabase.db.select().from(monthlyDues)).toEqual(financialBefore.dues);
        expect(await testDatabase.db.select().from(payments)).toEqual(financialBefore.payments);
        expect(await testDatabase.db.select().from(paymentAllocations)).toEqual(financialBefore.allocations);
      }
    }
  });

  it("covers authenticated route-family matrix cells for dues, PIN reset, Treasurer reads/writes, and Chairman management", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const resident = await regularSession("Matrix resident", "resident", { rtUnitId });
    const otherResident = await regularSession("Matrix other resident", "resident", { rtUnitId });
    const treasurer = await regularSession("Matrix Treasurer", "official", { role: "treasurer", rtUnitId });
    const chairman = await regularSession("Matrix Chairman", "official", { role: "rt_chairman", rtUnitId });
    const otherRtResident = await regularSession("Matrix other RT resident", "resident");
    const disabledResident = await regularSession("Matrix disabled Resident", "resident", { disabled: true });
    const endedChairman = await regularSession("Matrix ended Chairman", "official", { role: "rt_chairman", endedAssignment: true });
    const verifiedAdmin = await verifiedAdminSession("Matrix verified System Admin");
    const before = {
      accounts: await testDatabase.db.select().from(appAccounts),
      authAccounts: await testDatabase.db.select().from(authAccount),
      sessions: await testDatabase.db.select().from(authSession),
      dues: await testDatabase.db.select().from(monthlyDues),
      payments: await testDatabase.db.select().from(payments),
      allocations: await testDatabase.db.select().from(paymentAllocations),
      requests: await testDatabase.db.select().from(paymentRequests),
      requestItems: await testDatabase.db.select().from(paymentRequestItems),
      requestClaims: await testDatabase.db.select().from(paymentRequestClaims),
      houses: await testDatabase.db.select().from(houses),
      households: await testDatabase.db.select().from(households),
      feeRates: await testDatabase.db.select().from(feeRates),
      adjustments: await testDatabase.db.select().from(dueAdjustments),
      audits: await testDatabase.db.select().from(auditEvents),
    };

    const request = (path: string, cookie?: string | null, method = "GET", body?: unknown) => new Request(`http://localhost:3000${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(method !== "GET" ? { origin: "http://localhost:3000", "content-type": "application/json" } : {}),
        ...(method === "POST" && path === "/api/treasurer/cash-payments" ? { "idempotency-key": randomUUID() } : {}),
        ...(method === "POST" && path === "/api/chairman/fee-rates" ? { "idempotency-key": randomUUID() } : {}),
        ...(method === "POST" && path === "/api/chairman/adjustments" ? { "idempotency-key": randomUUID() } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const invokeWithCookie = async <T>(cookie: string | null, handler: () => Promise<T>) => {
      mocks.requestHeaders = new Headers(cookie ? { cookie } : {});
      return handler();
    };

    const residentDues = await invokeWithCookie(resident.cookie, () => getResidentDues());
    expect(residentDues.status).toBe(200);
    expect((await invokeWithCookie(null, () => getResidentDues())).status).toBe(401);
    expect((await invokeWithCookie(disabledResident.cookie, () => getResidentDues())).status).toBe(401);

    const pinBody = { pin: "123456", reason: "Authorized household recovery attempt", recoveryReference: "INC-2026-099" };
    const pinRequest = (cookie: string | null, accountId: string) => resetResidentPin(request(
      `/api/residents/${accountId}/reset-pin`, cookie ?? undefined, "POST", pinBody,
    ), { params: Promise.resolve({ accountId }) });
    expect((await invokeWithCookie(null, () => pinRequest(null, otherResident.accountId))).status).toBe(401);
    expect((await invokeWithCookie(resident.cookie, () => pinRequest(resident.cookie, otherResident.accountId))).status).toBe(403);
    expect((await invokeWithCookie(otherRtResident.cookie, () => pinRequest(otherRtResident.cookie, resident.accountId))).status).toBe(403);

    expect((await invokeWithCookie(treasurer.cookie, () => getTreasurerQueue())).status).toBe(200);
    expect((await invokeWithCookie(treasurer.cookie, () => getTreasurerHistory(request("/api/treasurer/payments", treasurer.cookie)))).status).toBe(200);
    expect((await invokeWithCookie(null, () => getTreasurerQueue())).status).toBe(401);
    expect((await invokeWithCookie(null, () => getTreasurerHistory(request("/api/treasurer/payments")))).status).toBe(401);

    const cashBody = { householdId: resident.householdId, period: "2026-09" };
    const cashResponse = await invokeWithCookie(treasurer.cookie, () => recordCashPayment(request(
      "/api/treasurer/cash-payments", treasurer.cookie, "POST", cashBody,
    )));
    expect(cashResponse.status).toBe(409);
    expect((await invokeWithCookie(null, () => recordCashPayment(request(
      "/api/treasurer/cash-payments", null, "POST", cashBody,
    )))).status).toBe(401);

    const paymentId = randomUUID();
    const reverseHandler = (cookie: string | null) => reversePayment(request(
      `/api/treasurer/payments/${paymentId}/reverse`, cookie ?? undefined, "POST", { reason: "Matrix denial attempt" },
    ), { params: Promise.resolve({ paymentId }) });
    expect((await invokeWithCookie(treasurer.cookie, () => reverseHandler(treasurer.cookie))).status).toBe(404);
    expect((await invokeWithCookie(null, () => reverseHandler(null))).status).toBe(401);

    const householdList = (cookie?: string) => getChairmanHouseholds(request("/api/chairman/households", cookie));
    expect((await invokeWithCookie(chairman.cookie, () => householdList(chairman.cookie))).status).toBe(200);
    expect((await invokeWithCookie(null, () => householdList())).status).toBe(401);
    expect((await invokeWithCookie(disabledResident.cookie, () => householdList(disabledResident.cookie))).status).toBe(401);
    expect((await invokeWithCookie(endedChairman.cookie, () => householdList(endedChairman.cookie))).status).toBe(401);

    const feeRatesResponse = await invokeWithCookie(chairman.cookie, () => getChairmanFeeRates(request("/api/chairman/fee-rates", chairman.cookie)));
    expect(feeRatesResponse.status).toBe(200);
    expect((await invokeWithCookie(null, () => getChairmanFeeRates(request("/api/chairman/fee-rates")))).status).toBe(401);

    const householdBody = { newHouse: { number: `matrix-${randomUUID().slice(0, 8)}` }, startsOn: "2026-10-04", fullName: "Matrix resident", initialPin: "123456" };
    expect((await invokeWithCookie(null, () => createChairmanHousehold(request("/api/chairman/households", null, "POST", householdBody)))).status).toBe(401);
    expect((await invokeWithCookie(treasurer.cookie, () => createChairmanHousehold(request("/api/chairman/households", treasurer.cookie, "POST", householdBody)))).status).toBe(403);

    const feeBody = { billingYearId: randomUUID(), effectiveMonth: 10, monthlyAmount: 50000 };
    expect((await invokeWithCookie(null, () => createChairmanFeeRate(request("/api/chairman/fee-rates", null, "POST", feeBody)))).status).toBe(401);
    expect((await invokeWithCookie(treasurer.cookie, () => createChairmanFeeRate(request("/api/chairman/fee-rates", treasurer.cookie, "POST", feeBody)))).status).toBe(403);
    const adjustmentBody = { monthlyDueId: randomUUID(), amountDelta: 1000, reason: "Unauthorized matrix attempt" };
    expect((await invokeWithCookie(null, () => createChairmanAdjustment(request("/api/chairman/adjustments", null, "POST", adjustmentBody)))).status).toBe(401);
    expect((await invokeWithCookie(treasurer.cookie, () => createChairmanAdjustment(request("/api/chairman/adjustments", treasurer.cookie, "POST", adjustmentBody)))).status).toBe(403);

    const adminVerify = await invokeWithCookie(verifiedAdmin.cookie, () => verifyTreasurerPayment(request(
      "/api/treasurer/payment-requests/KRT-0000000000000000/verify", verifiedAdmin.cookie, "POST", {},
    ), { params: Promise.resolve({ requestCode: "KRT-0000000000000000" }) }));
    expect(adminVerify.status).toBe(403);

    expect(await testDatabase.db.select().from(appAccounts)).toEqual(before.accounts);
    expect(await testDatabase.db.select().from(authAccount)).toEqual(before.authAccounts);
    expect(await testDatabase.db.select().from(authSession)).toEqual(before.sessions);
    expect(await testDatabase.db.select().from(monthlyDues)).toEqual(before.dues);
    expect(await testDatabase.db.select().from(payments)).toEqual(before.payments);
    expect(await testDatabase.db.select().from(paymentAllocations)).toEqual(before.allocations);
    expect(await testDatabase.db.select().from(paymentRequests)).toEqual(before.requests);
    expect(await testDatabase.db.select().from(paymentRequestItems)).toEqual(before.requestItems);
    expect(await testDatabase.db.select().from(paymentRequestClaims)).toEqual(before.requestClaims);
    expect(await testDatabase.db.select().from(houses)).toEqual(before.houses);
    expect(await testDatabase.db.select().from(households)).toEqual(before.households);
    expect(await testDatabase.db.select().from(feeRates)).toEqual(before.feeRates);
    expect(await testDatabase.db.select().from(dueAdjustments)).toEqual(before.adjustments);
    expect(await testDatabase.db.select().from(auditEvents)).toEqual(before.audits);
  });

  it("crosses signed-cookie principal categories against all available representative route families", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const sameRt = {
      resident: await regularSession("Cross matrix Resident", "resident", { rtUnitId }),
      treasurer: await regularSession("Cross matrix Treasurer", "official", { role: "treasurer", rtUnitId }),
      chairman: await regularSession("Cross matrix Chairman", "official", { role: "rt_chairman", rtUnitId }),
    };
    const otherRt = {
      resident: await regularSession("Cross matrix other-RT Resident", "resident"),
      treasurer: await regularSession("Cross matrix other-RT Treasurer", "official", { role: "treasurer" }),
      chairman: await regularSession("Cross matrix other-RT Chairman", "official", { role: "rt_chairman" }),
    };
    const verifiedAdmin = await verifiedAdminSession("Cross matrix verified System Admin");
    const unverifiedAdmin = await regularSession("Cross matrix unverified System Admin", "system_admin");
    const inactive = await regularSession("Cross matrix inactive session", "official", { role: "treasurer", disabled: true });
    const ended = await regularSession("Cross matrix ended assignment", "official", { role: "rt_chairman", endedAssignment: true });
    const target = await verifiedAdminSession("Cross matrix recovery target");

    const before = {
      requests: await testDatabase.db.select().from(paymentRequests),
      requestItems: await testDatabase.db.select().from(paymentRequestItems),
      requestClaims: await testDatabase.db.select().from(paymentRequestClaims),
      dues: await testDatabase.db.select().from(monthlyDues),
      payments: await testDatabase.db.select().from(payments),
      allocations: await testDatabase.db.select().from(paymentAllocations),
      accounts: await testDatabase.db.select().from(appAccounts),
      authAccounts: await testDatabase.db.select().from(authAccount),
      sessions: await testDatabase.db.select().from(authSession),
      factors: await testDatabase.db.select().from(authTwoFactor).where(eq(authTwoFactor.userId, target.userId)),
      targetUser: await testDatabase.db.select({ enabled: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, target.userId)),
      houses: await testDatabase.db.select().from(houses),
      households: await testDatabase.db.select().from(households),
      feeRates: await testDatabase.db.select().from(feeRates),
      adjustments: await testDatabase.db.select().from(dueAdjustments),
      audits: await testDatabase.db.select().from(auditEvents),
    };

    const cases = [
      { label: "Resident", resident: sameRt.resident.cookie, treasurer: sameRt.resident.cookie, chairman: sameRt.resident.cookie, recovery: sameRt.resident.cookie, expected: [200, 403, 403, 403] },
      { label: "Treasurer", resident: sameRt.treasurer.cookie, treasurer: sameRt.treasurer.cookie, chairman: sameRt.treasurer.cookie, recovery: sameRt.treasurer.cookie, expected: [403, 200, 403, 403] },
      { label: "Chairman", resident: sameRt.chairman.cookie, treasurer: sameRt.chairman.cookie, chairman: sameRt.chairman.cookie, recovery: sameRt.chairman.cookie, expected: [403, 403, 200, 403] },
      { label: "verified System Admin", resident: verifiedAdmin.cookie, treasurer: verifiedAdmin.cookie, chairman: verifiedAdmin.cookie, recovery: verifiedAdmin.cookie, expected: [403, 403, 403, 403] },
      { label: "unverified System Admin", resident: unverifiedAdmin.cookie, treasurer: unverifiedAdmin.cookie, chairman: unverifiedAdmin.cookie, recovery: unverifiedAdmin.cookie, expected: [401, 401, 401, 401] },
      { label: "inactive account session", resident: inactive.cookie, treasurer: inactive.cookie, chairman: inactive.cookie, recovery: inactive.cookie, expected: [401, 401, 401, 401] },
      { label: "ended assignment session", resident: ended.cookie, treasurer: ended.cookie, chairman: ended.cookie, recovery: ended.cookie, expected: [401, 401, 401, 401] },
      { label: "anonymous", resident: null, treasurer: null, chairman: null, recovery: null, expected: [401, 401, 401, 401] },
      { label: "other RT", resident: otherRt.resident.cookie, treasurer: otherRt.treasurer.cookie, chairman: otherRt.chairman.cookie, recovery: otherRt.treasurer.cookie, expected: [200, 200, 200, 403] },
    ];

    for (const testCase of cases) {
      const run = async <T>(cookie: string | null, handler: () => Promise<T>) => {
        mocks.requestHeaders = new Headers(cookie ? { cookie } : {});
        return handler();
      };
      const residentResponse = await run(testCase.resident, () => getResidentDues());
      expect(residentResponse.status, `Resident dues as ${testCase.label}`).toBe(testCase.expected[0]);
      const treasurerResponse = await run(testCase.treasurer, () => getTreasurerQueue());
      expect(treasurerResponse.status, `Treasurer queue as ${testCase.label}`).toBe(testCase.expected[1]);
      const chairmanResponse = await run(testCase.chairman, () => getChairmanHouseholds(new Request(
        "http://localhost:3000/api/chairman/households",
        testCase.chairman ? { headers: { cookie: testCase.chairman } } : {},
      )));
      expect(chairmanResponse.status, `Chairman households as ${testCase.label}`).toBe(testCase.expected[2]);

      const recoveryTargetId = testCase.label === "verified System Admin" ? verifiedAdmin.accountId : target.accountId;
      const recoveryResponse = await run(testCase.recovery, () => recoverTwoFactor(new Request(
        `http://localhost:3000/api/system-admin/accounts/${recoveryTargetId}/recover-two-factor`,
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
            ...(testCase.recovery ? { cookie: testCase.recovery } : {}),
          },
          body: JSON.stringify({ reason: `Cross matrix ${testCase.label}`, recoveryReference: "INC-2026-104" }),
        },
      ), { params: Promise.resolve({ accountId: recoveryTargetId }) }));
      expect(recoveryResponse.status, `System Admin recovery as ${testCase.label}`).toBe(testCase.expected[3]);
      await assertTargetState(target.accountId, target.userId, {
        factors: before.factors,
        sessions: before.sessions.filter((session) => session.userId === target.userId),
        account: before.targetUser,
        audits: before.audits.filter((audit) => audit.entityId === target.accountId && audit.action === "system_admin.two_factor.emergency_recovery"),
      });

      if (testCase.label === "other RT") {
        expect(await treasurerResponse.json()).toMatchObject({ pendingCount: 0, requests: [] });
        const chairmanBody = await chairmanResponse.text();
        expect(chairmanBody).not.toContain(sameRt.resident.householdId!);
        expect(chairmanBody).not.toContain(sameRt.resident.accountId);
      }
    }

    expect(await testDatabase.db.select().from(paymentRequests)).toEqual(before.requests);
    expect(await testDatabase.db.select().from(paymentRequestItems)).toEqual(before.requestItems);
    expect(await testDatabase.db.select().from(paymentRequestClaims)).toEqual(before.requestClaims);
    expect(await testDatabase.db.select().from(monthlyDues)).toEqual(before.dues);
    expect(await testDatabase.db.select().from(payments)).toEqual(before.payments);
    expect(await testDatabase.db.select().from(paymentAllocations)).toEqual(before.allocations);
    expect(await testDatabase.db.select().from(appAccounts)).toEqual(before.accounts);
    expect(await testDatabase.db.select().from(authAccount)).toEqual(before.authAccounts);
    expect(await testDatabase.db.select().from(authSession)).toEqual(before.sessions);
    expect(await testDatabase.db.select().from(authTwoFactor).where(eq(authTwoFactor.userId, target.userId))).toEqual(before.factors);
    expect(await testDatabase.db.select({ enabled: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, target.userId))).toEqual(before.targetUser);
    expect(await testDatabase.db.select().from(houses)).toEqual(before.houses);
    expect(await testDatabase.db.select().from(households)).toEqual(before.households);
    expect(await testDatabase.db.select().from(feeRates)).toEqual(before.feeRates);
    expect(await testDatabase.db.select().from(dueAdjustments)).toEqual(before.adjustments);
    expect(await testDatabase.db.select().from(auditEvents)).toEqual(before.audits);
  });
});
