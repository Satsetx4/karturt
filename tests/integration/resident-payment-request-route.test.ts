import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  createRequest: vi.fn(),
  profile: vi.fn(),
  history: vi.fn(),
  whatsapp: vi.fn(),
  database: {},
}));

vi.mock("@/lib/auth/principal", () => ({
  getCurrentPrincipal: mocks.principal,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  MfaEnrollmentRequiredError: class MfaEnrollmentRequiredError extends Error {},
}));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/billing/resident-payment-request", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/resident-payment-request")>("@/lib/billing/resident-payment-request");
  return {
    ...actual,
    createResidentPaymentRequest: mocks.createRequest,
  };
});
vi.mock("@/lib/billing/resident-profile", () => ({ getResidentProfile: mocks.profile }));
vi.mock("@/lib/billing/resident-payment-request-history", () => ({
  getResidentPaymentRequestHistory: mocks.history,
  InvalidResidentPaymentHistoryCursorError: class InvalidResidentPaymentHistoryCursorError extends Error {},
}));
vi.mock("@/lib/billing/resident-payment-whatsapp", () => ({
  createResidentPaymentWhatsAppLink: mocks.whatsapp,
}));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "http://localhost:3000" }));

import { GET, POST } from "../../src/app/api/resident/payment-requests/route";
import { UnauthenticatedError } from "../../src/lib/auth/principal";

const key = "b5d4b131-908a-45c2-9363-1ea1b84cd21e";
const resident = {
  authUserId: "auth-resident",
  appAccountId: "00000000-0000-4000-8000-000000000001",
  role: "resident",
  rtUnitId: "00000000-0000-4000-8000-000000000002",
  householdId: "00000000-0000-4000-8000-000000000003",
  personId: "00000000-0000-4000-8000-000000000004",
};

function post(body: unknown, options: { key?: string; origin?: string } = {}) {
  return new Request("http://localhost:3000/api/resident/payment-requests", {
    method: "POST",
    headers: {
      origin: options.origin ?? "http://localhost:3000",
      "content-type": "application/json",
      ...(options.key === undefined ? { "idempotency-key": key } : { "idempotency-key": options.key }),
    },
    body: JSON.stringify(body),
  });
}

describe("resident payment request HTTP boundary", () => {
  it("requires an active session and a resident role", async () => {
    mocks.principal.mockRejectedValueOnce(new UnauthenticatedError("expired"));
    expect((await POST(post({ period: "2026-06" }))).status).toBe(401);

    mocks.principal.mockResolvedValueOnce({ ...resident, role: "treasurer" });
    expect((await POST(post({ period: "2026-06" }))).status).toBe(403);
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it("rejects malformed periods, missing idempotency keys, cross-origin calls, and mass assignment", async () => {
    mocks.principal.mockResolvedValue(resident);
    expect((await POST(post({ period: "2026-13" }))).status).toBe(400);
    expect((await POST(post({ period: "2026-06" }, { key: "" }))).status).toBe(400);
    expect((await POST(post({ period: "2026-06" }, { origin: "https://elsewhere.invalid" }))).status).toBe(403);
    expect((await POST(post({ period: "2026-06" }, { origin: "bukan-url" }))).status).toBe(403);
    expect((await POST(post({ period: "2026-06", householdId: "other-household", monthlyDueId: "internal" }))).status).toBe(400);
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it("uses the session principal and returns only public request details", async () => {
    mocks.principal.mockResolvedValue(resident);
    mocks.profile.mockResolvedValue({ name: "Warga Uji", houseNumber: "UJI-5", rtName: "RT Uji", startsOn: "2020-01-01" });
    mocks.whatsapp.mockReturnValue("https://wa.me/6289234234737?text=hello");
    mocks.createRequest.mockResolvedValue({
      requestCode: "KRT-91A2B3C4D5E6",
      status: "pending",
      periods: ["2026-05", "2026-06"],
      totalAmount: 80000,
      createdAt: new Date("2026-06-18T03:00:00.000Z"),
      idempotentReplay: false,
    });
    mocks.history.mockResolvedValue({
      requests: [{
        requestCode: "KRT-91A2B3C4D5E6",
        status: "pending",
        items: [{ period: "2026-05", amount: 40000 }, { period: "2026-06", amount: 40000 }],
        totalAmount: 80000,
      }],
      nextCursor: null,
    });

    const response = await POST(post({ period: "2026-06" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createRequest).toHaveBeenCalledWith(mocks.database, resident, {
      period: "2026-06",
      idempotencyKey: key,
    });
    expect(mocks.whatsapp).toHaveBeenCalledWith({
      destinationNumber: process.env.KARTURT_DEMO_TREASURER_WHATSAPP_NUMBER,
      rtName: "RT Uji",
      houseNumber: "UJI-5",
      request: {
        requestCode: "KRT-91A2B3C4D5E6",
        status: "pending",
        periods: ["2026-05", "2026-06"],
        totalAmount: 80000,
      },
    });
    expect(body).toMatchObject({
      requestCode: "KRT-91A2B3C4D5E6",
      status: "pending",
      periods: ["2026-05", "2026-06"],
      totalAmount: 80000,
      whatsappUrl: "https://wa.me/6289234234737?text=hello",
    });
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("rtUnitId");
    expect(body).not.toHaveProperty("householdId");
    expect(body).not.toHaveProperty("monthlyDueId");
    expect(body).not.toHaveProperty("idempotencyKey");
    expect(JSON.stringify(body)).not.toMatch(/00000000-0000-4000-8000-00000000000[1-4]/);
  });

  it("keeps the request successful when a Treasurer contact is unavailable", async () => {
    mocks.principal.mockResolvedValue(resident);
    mocks.profile.mockResolvedValue({ name: "Warga Uji", houseNumber: "UJI-5", rtName: "RT Uji", startsOn: "2020-01-01" });
    mocks.whatsapp.mockReturnValue(null);
    mocks.createRequest.mockResolvedValue({
      requestCode: "KRT-91A2B3C4D5E6",
      status: "pending",
      periods: ["2026-06"],
      totalAmount: 40000,
      createdAt: new Date("2026-06-18T03:00:00.000Z"),
      idempotentReplay: false,
    });
    mocks.history.mockResolvedValue({
      requests: [{
        requestCode: "KRT-91A2B3C4D5E6",
        status: "pending",
        items: [{ period: "2026-06", amount: 40000 }],
        totalAmount: 40000,
      }],
      nextCursor: null,
    });
    const body = await (await POST(post({ period: "2026-06" }))).json();
    expect(body.whatsappUrl).toBeNull();
    expect(body.contactMessage).toBe("Tautan WhatsApp demo belum tersedia. Permintaan Anda tetap tercatat.");
    expect(body.message).toContain("Menunggu konfirmasi");
  });

  it("returns a demo WhatsApp link for existing pending requests from persisted history data", async () => {
    mocks.principal.mockResolvedValue(resident);
    mocks.profile.mockResolvedValue({ name: "Warga Uji", houseNumber: "D-07", rtName: "RT.05", startsOn: "2026-01-01" });
    mocks.history.mockResolvedValue({
      requests: [{
        requestCode: "KRT-91A2B3C4D5E6",
        status: "pending",
        createdAt: new Date("2026-10-06T03:00:00.000Z"),
        resolvedAt: null,
        items: [{ period: "2026-07", amount: 40000 }, { period: "2026-08", amount: 40000 }, { period: "2026-09", amount: 40000 }],
        totalAmount: 123000,
        resolutionReason: null,
      }],
      nextCursor: null,
    });
    mocks.whatsapp.mockReturnValue("https://wa.me/6289234234737?text=hello");

    const response = await GET(new Request("http://localhost:3000/api/resident/payment-requests"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.requests[0].whatsappUrl).toBe("https://wa.me/6289234234737?text=hello");
    expect(mocks.whatsapp).toHaveBeenCalledWith({
      destinationNumber: process.env.KARTURT_DEMO_TREASURER_WHATSAPP_NUMBER,
      rtName: "RT.05",
      houseNumber: "D-07",
      request: {
        requestCode: "KRT-91A2B3C4D5E6",
        status: "pending",
        periods: ["2026-07", "2026-08", "2026-09"],
        totalAmount: 123000,
      },
    });
  });
});
