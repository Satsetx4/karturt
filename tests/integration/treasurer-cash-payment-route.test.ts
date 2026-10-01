import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  searchHouseholds: vi.fn(),
  getHousehold: vi.fn(),
  recordCash: vi.fn(),
  database: {},
}));

vi.mock("@/lib/auth/principal", () => ({
  getCurrentPrincipal: mocks.principal,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  MfaEnrollmentRequiredError: class MfaEnrollmentRequiredError extends Error {},
}));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/billing/treasurer-cash-payments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/treasurer-cash-payments")>("@/lib/billing/treasurer-cash-payments");
  return {
    ...actual,
    searchTreasurerCashPaymentHouseholds: mocks.searchHouseholds,
    getTreasurerCashPaymentHousehold: mocks.getHousehold,
    recordTreasurerCashPayment: mocks.recordCash,
  };
});

import { GET as searchGet } from "../../src/app/api/treasurer/cash-payments/households/route";
import { GET as householdGet } from "../../src/app/api/treasurer/cash-payments/households/[householdId]/route";
import { POST as cashPost } from "../../src/app/api/treasurer/cash-payments/route";

const rtUnitId = "00000000-0000-4000-8000-000000000001";
const householdId = "00000000-0000-4000-8000-000000000002";
const idempotencyKey = "00000000-0000-4000-8000-000000000003";
const treasurer = {
  authUserId: "auth-treasurer",
  appAccountId: "00000000-0000-4000-8000-000000000004",
  role: "treasurer",
  rtUnitId,
  householdId: null,
  personId: null,
};
const resident = { ...treasurer, role: "resident", householdId };

function get(path: string) {
  return new Request(`http://localhost:3000${path}`);
}

function post(body: string, options: { origin?: string; key?: string } = {}) {
  return new Request("http://localhost:3000/api/treasurer/cash-payments", {
    method: "POST",
    headers: {
      origin: options.origin ?? "http://localhost:3000",
      "content-type": "application/json",
      ...(options.key === undefined ? { "Idempotency-Key": idempotencyKey } : { "Idempotency-Key": options.key }),
    },
    body,
  });
}

describe("Treasurer cash-payment HTTP boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("limits household search and detail to an authenticated Treasurer", async () => {
    mocks.principal.mockResolvedValueOnce(resident);
    expect((await searchGet(get("/api/treasurer/cash-payments/households?search=R-01"))).status).toBe(403);
    mocks.principal.mockResolvedValueOnce(resident);
    expect((await householdGet(get("/api/treasurer/cash-payments/households/" + householdId), {
      params: Promise.resolve({ householdId }),
    })).status).toBe(403);
    expect(mocks.searchHouseholds).not.toHaveBeenCalled();
    expect(mocks.getHousehold).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, malformed-key, and mass-assignment cash mutations", async () => {
    mocks.principal.mockResolvedValue(treasurer);
    expect((await cashPost(post(JSON.stringify({ householdId, period: "2026-03" }), { origin: "https://elsewhere.invalid" }))).status).toBe(403);
    expect((await cashPost(post(JSON.stringify({ householdId, period: "2026-03" }), { key: "not-a-uuid" }))).status).toBe(400);
    for (const body of [
      "{",
      JSON.stringify({ householdId, period: "2026-13" }),
      JSON.stringify({ householdId, period: "2026-03", amount: 1 }),
      JSON.stringify({ householdId, period: "2026-03", method: "cash" }),
      JSON.stringify({ householdId, period: "2026-03", actorId: treasurer.appAccountId }),
      JSON.stringify({ householdId, period: "2026-03", rtUnitId }),
      JSON.stringify({ householdId, period: "2026-03", dueIds: [householdId] }),
      JSON.stringify({ householdId, period: "2026-03", paymentRequestId: householdId }),
    ]) {
      expect((await cashPost(post(body))).status).toBe(400);
    }
    expect(mocks.recordCash).not.toHaveBeenCalled();
  });

  it("passes only server-derived actor plus household, period, and idempotency key", async () => {
    mocks.principal.mockResolvedValue(treasurer);
    mocks.recordCash.mockResolvedValue({
      status: "recorded",
      periods: ["2026-01", "2026-02", "2026-03"],
      itemCount: 3,
      totalAmount: 120000,
      replayed: false,
    });
    const response = await cashPost(post(JSON.stringify({ householdId, period: "2026-03" })));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.recordCash).toHaveBeenCalledWith(mocks.database, treasurer, {
      householdId,
      period: "2026-03",
      idempotencyKey,
    });
    expect(body).toMatchObject({ itemCount: 3, totalAmount: 120000, status: "recorded" });
    expect(body).not.toHaveProperty("paymentId");
    expect(body).not.toHaveProperty("actorAppAccountId");
    expect(body).not.toHaveProperty("rtUnitId");
  });

  it("returns the safe pending-request conflict message", async () => {
    const { CashPaymentPendingRequestConflictError } = await import("../../src/lib/billing/treasurer-cash-payments");
    mocks.principal.mockResolvedValue(treasurer);
    mocks.recordCash.mockRejectedValue(new CashPaymentPendingRequestConflictError(
      "Ada permintaan pembayaran yang masih menunggu untuk bulan ini. Selesaikan atau tolak/batalkan permintaan tersebut lebih dulu.",
    ));
    const response = await cashPost(post(JSON.stringify({ householdId, period: "2026-03" })));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "pending_request_conflict" });
  });
});
