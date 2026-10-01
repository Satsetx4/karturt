import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  cancel: vi.fn(),
  reject: vi.fn(),
  database: {},
}));

vi.mock("@/lib/auth/principal", () => ({
  getCurrentPrincipal: mocks.principal,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  MfaEnrollmentRequiredError: class MfaEnrollmentRequiredError extends Error {},
}));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/billing/payment-request-resolution", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/payment-request-resolution")>("@/lib/billing/payment-request-resolution");
  return {
    ...actual,
    cancelResidentPaymentRequest: mocks.cancel,
    rejectTreasurerPaymentRequest: mocks.reject,
  };
});

import { POST as cancelPost } from "../../src/app/api/resident/payment-requests/[requestCode]/cancel/route";
import { POST as rejectPost } from "../../src/app/api/treasurer/payment-requests/[requestCode]/reject/route";
import { UnauthenticatedError } from "../../src/lib/auth/principal";

const requestCode = "KRT-91A2B3C4D5E6ABCD";
const resident = {
  authUserId: "auth-resident",
  appAccountId: "00000000-0000-4000-8000-000000000001",
  role: "resident",
  rtUnitId: "00000000-0000-4000-8000-000000000002",
  householdId: "00000000-0000-4000-8000-000000000003",
  personId: "00000000-0000-4000-8000-000000000004",
};
const treasurer = { ...resident, appAccountId: "00000000-0000-4000-8000-000000000005", role: "treasurer", householdId: null };
const routeContext = { params: Promise.resolve({ requestCode }) };

function post(body: unknown, options: { origin?: string; code?: string } = {}) {
  return new Request("http://localhost:3000/api/payment-request", {
    method: "POST",
    headers: {
      origin: options.origin ?? "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("payment request resolution HTTP boundaries", () => {
  it("limits cancel to same-origin residents and strict empty bodies", async () => {
    mocks.principal.mockRejectedValueOnce(new UnauthenticatedError("expired"));
    expect((await cancelPost(post({}), routeContext)).status).toBe(401);

    mocks.principal.mockResolvedValueOnce(treasurer);
    expect((await cancelPost(post({}), routeContext)).status).toBe(403);
    mocks.principal.mockResolvedValue(resident);
    expect((await cancelPost(post({}, { origin: "https://elsewhere.invalid" }), routeContext)).status).toBe(403);
    expect((await cancelPost(post({ requestCode, householdId: "another" }), routeContext)).status).toBe(400);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("cancels using the session principal and returns no internal identifiers", async () => {
    mocks.principal.mockResolvedValue(resident);
    mocks.cancel.mockResolvedValue({
      requestCode,
      status: "cancelled",
      itemCount: 1,
      totalAmount: 40000,
      resolvedAt: new Date("2026-06-18T03:10:00.000Z"),
    });
    const response = await cancelPost(post({}), routeContext);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.cancel).toHaveBeenCalledWith(mocks.database, resident, requestCode);
    expect(body).toMatchObject({ requestCode, status: "cancelled" });
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("rtUnitId");
    expect(body).not.toHaveProperty("householdId");
  });

  it("requires a same-origin active Treasurer, a reason, and no extra client fields", async () => {
    mocks.principal.mockResolvedValueOnce(resident);
    expect((await rejectPost(post({ reason: "Bukti belum terbaca." }), routeContext)).status).toBe(403);
    mocks.principal.mockResolvedValue(treasurer);
    expect((await rejectPost(post({ reason: "Bukti belum terbaca." }, { origin: "https://elsewhere.invalid" }), routeContext)).status).toBe(403);
    for (const body of [{}, { reason: "   " }, { reason: "x".repeat(501) }, { reason: "Alasan", amount: 1 }, { reason: "Alasan", rtUnitId: "internal" }]) {
      expect((await rejectPost(post(body), routeContext)).status).toBe(400);
    }
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it("sends only the public code, session principal, and trimmed reason to the service", async () => {
    mocks.principal.mockResolvedValue(treasurer);
    mocks.reject.mockResolvedValue({
      requestCode,
      status: "rejected",
      itemCount: 1,
      totalAmount: 40000,
      resolvedAt: new Date("2026-06-18T03:10:00.000Z"),
    });
    const response = await rejectPost(post({ reason: "  Bukti belum terbaca.  " }), routeContext);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.reject).toHaveBeenCalledWith(mocks.database, treasurer, requestCode, "Bukti belum terbaca.");
    expect(body).toMatchObject({ requestCode, status: "rejected" });
    expect(body).not.toHaveProperty("actorAppAccountId");
    expect(body).not.toHaveProperty("rtUnitId");
  });
});
