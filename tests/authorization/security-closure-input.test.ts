import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ database: undefined as unknown, auth: undefined as unknown, requestHeaders: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/auth/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/server")>("@/lib/auth/server");
  return { ...actual, getAuth: () => mocks.auth };
});

import type { AppDatabase } from "@/db/client";
import { POST as residentRequest } from "@/app/api/resident/payment-requests/route";
import { POST as treasurerCash } from "@/app/api/treasurer/cash-payments/route";
import { POST as treasurerVerify } from "@/app/api/treasurer/payment-requests/[requestCode]/verify/route";
import { POST as chairmanWaiver } from "@/app/api/chairman/waivers/route";
import { POST as chairmanResetPin } from "@/app/api/residents/[accountId]/reset-pin/route";
import { POST as adminRecovery } from "@/app/api/system-admin/accounts/[accountId]/recover-two-factor/route";
import { GET as chairmanHouseholds } from "@/app/api/chairman/households/route";
import { POST as applicationLogin } from "@/app/api/login/[type]/route";
import { appAccounts, auditEvents, authAccount, authSession, authTwoFactor, payments, paymentRequests, monthlyDues, waiverActions } from "@/db/schema";
import { createAuth } from "@/lib/auth/server";
import { hashPassword } from "better-auth/crypto";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

describe("F2.1 S8 malformed inputs and S9 adversarial text boundaries", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let database: AppDatabase;
  let auth: ReturnType<typeof createAuth>;
  let rtUnitId: string;
  let householdId: string;
  let residentAccountId: string;
  let cookies: Record<string, string>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
    auth = createAuth(database, { secret: "test-only-security-closure-secret-32-characters", baseURL: "http://localhost:3000" });
    mocks.database = database;
    mocks.auth = auth;
    rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);
    householdId = household.householdId;
    const roles = ["resident", "treasurer", "rt_chairman", "system_admin"] as const;
    cookies = {};
    for (const role of roles) {
      const user = await createAuthUser(testDatabase.db, `S8 S9 ${role}`);
      const password = `Security-${randomUUID()}-Pass`;
      await testDatabase.db.insert(authAccount).values({
        id: randomUUID(), accountId: user.id, providerId: "credential", userId: user.id, password: await hashPassword(password),
      });
      const accountType = role === "resident" ? "resident" : role === "system_admin" ? "system_admin" : "official";
      const [account] = await testDatabase.db.insert(appAccounts).values({
        authUserId: user.id, accountType, loginIdentifier: `s8-${role}-${randomUUID()}`,
        ...(role === "system_admin" ? {} : { rtUnitId }),
        ...(role === "system_admin" ? {} : { personId: household.personId }),
        ...(role === "resident" ? { householdId } : {}),
      }).returning({ id: appAccounts.id });
      if (role === "resident") residentAccountId = account!.id;
      if (role === "treasurer" || role === "rt_chairman") {
        const { officialAssignments } = await import("@/db/schema");
        await testDatabase.db.insert(officialAssignments).values({
          rtUnitId, appAccountId: account!.id, role, startsOn: "1990-01-01",
        });
      }
      const signedIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: user.email, password, rememberMe: false }),
      }));
      expect(signedIn.status).toBe(200);
      cookies[role] = signedIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    }
  });

  afterAll(async () => { await testDatabase?.close(); });
  beforeEach(() => { mocks.requestHeaders = new Headers(); });

  function post(url: string, cookie: string, rawBody: string, extra: Record<string, string> = {}) {
    return new Request(url, { method: "POST", headers: {
      origin: "http://localhost:3000", cookie, "content-type": "application/json",
      "idempotency-key": randomUUID(), ...extra,
    }, body: rawBody });
  }

  async function call<T>(cookie: string, handler: (request: Request, context?: T) => Promise<Response>, request: Request, context?: T) {
    mocks.requestHeaders = new Headers({ cookie });
    return handler(request, context);
  }

  async function snapshot() {
    return {
      dues: await testDatabase.db.select().from(monthlyDues),
      requests: await testDatabase.db.select().from(paymentRequests),
      payments: await testDatabase.db.select().from(payments),
      waivers: await testDatabase.db.select().from(waiverActions),
      audits: await testDatabase.db.select().from(auditEvents),
      sessions: await testDatabase.db.select().from(authSession),
      factors: await testDatabase.db.select().from(authTwoFactor),
    };
  }

  async function expectBoundedDenial(response: Response, expected: number[] = [400]) {
    expect(expected).toContain(response.status);
    const text = await response.clone().text();
    expect(text.length).toBeLessThan(4000);
    expect(text).not.toMatch(/\b(?:stack|SQLSTATE|syntax error|select\s+.*from|password|secret|session_token)\b/i);
    expect(text).not.toContain("test-only-security-closure-secret");
  }

  async function callMalformedFamily() {
    const cases = ["{", "null", "[]", "{\"period\":[]}", "{\"period\":\"2026-13\"}",
      "{\"householdId\":{},\"period\":\"2026-01\"}", "{\"householdId\":\"not-a-uuid\",\"period\":\"2026-01\"}",
      JSON.stringify({ householdId, periods: ["2026-01"], reason: "x".repeat(1001) }),
      JSON.stringify({ householdId, periods: ["2026-01"], reason: "ok", unexpected: [1, 2] }),
      JSON.stringify({ pin: 123456, reason: "ok" }), JSON.stringify({ reason: "   ", recoveryReference: "" }),
      JSON.stringify({ householdId, period: "2026-01", reason: { nested: true } }),
    ];
    for (const body of cases) {
      const before = await snapshot();
      const response = await call(cookies.resident!, residentRequest, post("http://localhost:3000/api/resident/payment-requests", cookies.resident!, body));
      await expectBoundedDenial(response);
      expect(await snapshot()).toEqual(before);
    }
  }

  it("S8 rejects malformed bodies across Resident, Treasurer, Chairman, and System Admin route families without side effects", async () => {
    const cases: Array<{ name: string; cookie: string; run: (body: string) => Promise<Response> }> = [
      { name: "resident request", cookie: cookies.resident!, run: (body) => call(cookies.resident!, residentRequest, post("http://localhost:3000/api/resident/payment-requests", cookies.resident!, body)) },
      { name: "treasurer cash", cookie: cookies.treasurer!, run: (body) => call(cookies.treasurer!, treasurerCash, post("http://localhost:3000/api/treasurer/cash-payments", cookies.treasurer!, body)) },
      { name: "treasurer verification", cookie: cookies.treasurer!, run: (body) => call(cookies.treasurer!, (request) => treasurerVerify(request, { params: Promise.resolve({ requestCode: "KRT-AAAAAAAAAAAAAAAA" }) }), post("http://localhost:3000/api/treasurer/payment-requests/KRT-AAAAAAAAAAAAAAAA/verify", cookies.treasurer!, body)) },
      { name: "chairman waiver", cookie: cookies.rt_chairman!, run: (body) => call(cookies.rt_chairman!, chairmanWaiver, post("http://localhost:3000/api/chairman/waivers", cookies.rt_chairman!, body)) },
      { name: "chairman PIN reset", cookie: cookies.rt_chairman!, run: (body) => call(cookies.rt_chairman!, (request) => chairmanResetPin(request, { params: Promise.resolve({ accountId: residentAccountId }) }), post(`http://localhost:3000/api/residents/${residentAccountId}/reset-pin`, cookies.rt_chairman!, body)) },
      { name: "admin recovery", cookie: cookies.system_admin!, run: (body) => call(cookies.system_admin!, (request) => adminRecovery(request, { params: Promise.resolve({ accountId: residentAccountId }) }), post(`http://localhost:3000/api/system-admin/accounts/${residentAccountId}/recover-two-factor`, cookies.system_admin!, body)) },
    ];
    const malformed = ["{", "null", "[]", "{}", JSON.stringify({ period: [] }), JSON.stringify({ householdId: {}, period: "2026-01" }),
      JSON.stringify({ householdId, periods: ["2026-13"], reason: "x" }), JSON.stringify({ householdId, periods: ["2026-01"], reason: "x".repeat(1001) }),
      JSON.stringify({ pin: 123456, reason: "test" }), JSON.stringify({ pin: "12x456", reason: "test" }),
      JSON.stringify({ reason: "  ", recoveryReference: "" }), JSON.stringify({ reason: "x".repeat(501), recoveryReference: "R-1" }),
      JSON.stringify({ householdId, periods: ["2026-01"], reason: "valid shape", extra: { nested: true } }),
    ];
    for (const route of cases) {
      for (const body of malformed) {
        const before = await snapshot();
        const response = await route.run(body);
        await expectBoundedDenial(response, [400, 401, 403, 404, 409, 415]);
        expect(await snapshot()).toEqual(before);
      }
      // Invalid JSON and an invalid idempotency key are explicitly exercised independently.
      const invalidKeyRequest = post("http://localhost:3000/api/resident/payment-requests", route.cookie, "{\"period\":\"2026-01\"}", { "idempotency-key": "invalid" });
      const response = route.name === "resident request"
        ? await call(route.cookie, residentRequest, invalidKeyRequest)
        : await route.run("{");
      await expectBoundedDenial(response, [400, 404, 415]);
    }
    for (const [url, cookie, handler, raw, context] of [
      ["http://localhost:3000/api/resident/payment-requests", cookies.resident!, residentRequest, JSON.stringify({ period: "2026-01" }), undefined],
      ["http://localhost:3000/api/treasurer/cash-payments", cookies.treasurer!, treasurerCash, JSON.stringify({ householdId, period: "2026-01" }), undefined],
      ["http://localhost:3000/api/chairman/waivers", cookies.rt_chairman!, chairmanWaiver, JSON.stringify({ householdId, periods: ["2026-01"], reason: "Valid reason" }), undefined],
    ] as const) {
      const before = await snapshot();
      const response = await call(cookie, handler, post(url, cookie, raw, { "idempotency-key": "not-a-uuid" }), context);
      await expectBoundedDenial(response, [400]);
      expect(await snapshot()).toEqual(before);
    }
    await callMalformedFamily();
  });

  it("S9 treats hostile login identifiers, search values, route identifiers, and reason text as data", async () => {
    const hostile = ["' OR 1=1 --", "\\\\' OR 1=1 --", "%", "'/*comment*/", "\\\\", "-- /* */"];
    for (const identifier of hostile) {
      const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: identifier, password: "wrong", rememberMe: false }),
      }));
      expect([400, 401, 429]).toContain(response.status);
      expect(response.headers.getSetCookie().join(";")).not.toMatch(/session_token=[^;]+/);
      expect(await testDatabase.db.select().from(authSession).where(eq(authSession.token, "not-a-real-token"))).toHaveLength(0);
      await expectBoundedDenial(response, [400, 401, 429]);
    }

    for (const identifier of hostile) {
      const response = await call(cookies.resident!, (request) => applicationLogin(request, { params: Promise.resolve({ type: "official" }) }),
        new Request("http://localhost:3000/api/login/official", {
          method: "POST", headers: { cookie: cookies.resident!, "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ identifier, password: "6-digit-test" }),
        }));
      expect([400, 401, 429]).toContain(response.status);
      await expectBoundedDenial(response, [400, 401, 429]);
    }

    for (const search of hostile) {
      const response = await call(cookies.rt_chairman!, chairmanHouseholds,
        new Request(`http://localhost:3000/api/chairman/households?search=${encodeURIComponent(search)}`, { headers: { cookie: cookies.rt_chairman! } }));
      expect(response.status).toBe(200);
      const payload = await response.json() as { households?: unknown[] };
      expect(payload.households).toBeDefined();
      expect(payload.households).toHaveLength(0);
    }

    const before = await snapshot();
    for (const reason of hostile) {
      const response = await call(cookies.rt_chairman!, chairmanWaiver, post("http://localhost:3000/api/chairman/waivers", cookies.rt_chairman!,
        JSON.stringify({ householdId, periods: ["2026-01"], reason }), { "idempotency-key": randomUUID() }));
      expect([400, 409]).toContain(response.status);
      await expectBoundedDenial(response, [400, 409]);
      expect(await snapshot()).toEqual(before);
    }

    for (const routeId of hostile) {
      const response = await call(cookies.treasurer!, (request) => treasurerVerify(request, { params: Promise.resolve({ requestCode: routeId }) }),
        post(`http://localhost:3000/api/treasurer/payment-requests/${encodeURIComponent(routeId)}/verify`, cookies.treasurer!, "{}"),
      );
      expect([400, 404]).toContain(response.status);
      await expectBoundedDenial(response, [400, 404]);
    }
    expect(await snapshot()).toEqual(before);
  });
});
