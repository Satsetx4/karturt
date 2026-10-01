import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  history: vi.fn(),
  database: {},
}));

vi.mock("@/lib/auth/principal", () => ({
  getCurrentPrincipal: mocks.principal,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  MfaEnrollmentRequiredError: class MfaEnrollmentRequiredError extends Error {},
}));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/billing/resident-payment-request-history", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/resident-payment-request-history")>("@/lib/billing/resident-payment-request-history");
  return { ...actual, getResidentPaymentRequestHistory: mocks.history };
});

import { GET } from "../../src/app/api/resident/payment-requests/route";
import { UnauthenticatedError } from "../../src/lib/auth/principal";

const resident = {
  authUserId: "auth-resident",
  appAccountId: "00000000-0000-4000-8000-000000000001",
  role: "resident",
  rtUnitId: "00000000-0000-4000-8000-000000000002",
  householdId: "00000000-0000-4000-8000-000000000003",
  personId: "00000000-0000-4000-8000-000000000004",
};

describe("resident payment request history HTTP boundary", () => {
  it("requires an active resident session", async () => {
    mocks.principal.mockRejectedValueOnce(new UnauthenticatedError("expired"));
    expect((await GET(new Request("http://localhost:3000/api/resident/payment-requests"))).status).toBe(401);
    mocks.principal.mockResolvedValueOnce({ ...resident, role: "treasurer" });
    expect((await GET(new Request("http://localhost:3000/api/resident/payment-requests"))).status).toBe(403);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("uses the resident principal for a private, public-field-only response", async () => {
    mocks.principal.mockResolvedValue(resident);
    mocks.history.mockResolvedValue({
      requests: [{
        requestCode: "KRT-91A2B3C4D5E6ABCD",
        status: "rejected",
        createdAt: new Date("2026-06-18T03:00:00.000Z"),
        resolvedAt: new Date("2026-06-18T03:10:00.000Z"),
        items: [{ period: "2026-06", amount: 40000 }],
        totalAmount: 40000,
        resolutionReason: "Bukti belum terbaca.",
      }],
      nextCursor: null,
    });
    const response = await GET(new Request("http://localhost:3000/api/resident/payment-requests?cursor=KRT-91A2B3C4D5E6ABCD"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.history).toHaveBeenCalledWith(mocks.database, resident, "KRT-91A2B3C4D5E6ABCD");
    expect(body.requests[0]).toMatchObject({
      requestCode: "KRT-91A2B3C4D5E6ABCD",
      status: "rejected",
      items: [{ period: "2026-06", amount: 40000 }],
      resolutionReason: "Bukti belum terbaca.",
    });
    expect(body.requests[0]).not.toHaveProperty("id");
    expect(body.requests[0]).not.toHaveProperty("rtUnitId");
    expect(body.requests[0]).not.toHaveProperty("householdId");
    expect(body.requests[0]).not.toHaveProperty("resolvedByAccountId");
    expect(JSON.stringify(body)).not.toMatch(/00000000-0000-4000-8000-00000000000[1-4]/);
  });
});
