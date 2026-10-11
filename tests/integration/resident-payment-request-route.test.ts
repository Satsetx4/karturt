import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  createRequest: vi.fn(),
  profile: vi.fn(),
  whatsapp: vi.fn(),
  treasurerNumber: vi.fn(),
  whatsappUrl: vi.fn(),
  history: vi.fn(),
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
vi.mock("@/lib/billing/resident-payment-whatsapp", () => ({
  createResidentPaymentWhatsAppLink: mocks.whatsapp,
  createResidentPaymentWhatsAppUrl: mocks.whatsappUrl,
  getResidentTreasurerWhatsAppNumber: mocks.treasurerNumber,
}));
vi.mock("@/lib/billing/resident-payment-request-history", () => ({
  getResidentPaymentRequestHistory: mocks.history,
  InvalidResidentPaymentHistoryCursorError: class InvalidResidentPaymentHistoryCursorError extends Error {},
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
    mocks.whatsapp.mockResolvedValue("https://wa.me/628123456789?text=hello");
    mocks.createRequest.mockResolvedValue({
      requestCode: "KRT-91A2B3C4D5E6",
      status: "pending",
      periods: ["2026-05", "2026-06"],
      totalAmount: 80000,
      createdAt: new Date("2026-06-18T03:00:00.000Z"),
      idempotentReplay: false,
    });

    const response = await POST(post({ period: "2026-06" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createRequest).toHaveBeenCalledWith(mocks.database, resident, {
      period: "2026-06",
      idempotencyKey: key,
    });
    expect(body).toMatchObject({
      requestCode: "KRT-91A2B3C4D5E6",
      status: "pending",
      periods: ["2026-05", "2026-06"],
      totalAmount: 80000,
      whatsappUrl: "https://wa.me/628123456789?text=hello",
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
    mocks.whatsapp.mockResolvedValue(null);
    mocks.createRequest.mockResolvedValue({
      requestCode: "KRT-91A2B3C4D5E6",
      status: "pending",
      periods: ["2026-06"],
      totalAmount: 40000,
      createdAt: new Date("2026-06-18T03:00:00.000Z"),
      idempotentReplay: false,
    });
    const body = await (await POST(post({ period: "2026-06" }))).json();
    expect(body.whatsappUrl).toBeNull();
    expect(body.contactMessage).toBe("Nomor WhatsApp Bendahara belum tersedia. Permintaan Anda tetap tercatat.");
    expect(body.message).toContain("Menunggu konfirmasi");
  });
});


describe("resident persisted pending WhatsApp CTA", () => {
  const pending = {
    requestCode: "KRT-91A2B3C4D5E6",
    status: "pending",
    createdAt: new Date("2026-10-05T10:00:00.000Z"),
    resolvedAt: null,
    items: [{ period: "2026-09", amount: 40000 }],
    totalAmount: 40000,
    resolutionReason: null,
  };

  it("links only pending persisted snapshots for the same authenticated Resident and RT", async () => {
    mocks.principal.mockResolvedValue(resident);
    mocks.history.mockResolvedValue({
      requests: [pending, { ...pending, requestCode: "KRT-0000000000000002", status: "verified" }],
      nextCursor: null,
    });
    mocks.profile.mockResolvedValue({ name: "Warga Uji", houseNumber: "UJI-5", rtName: "RT Uji", startsOn: "2020-01-01" });
    mocks.treasurerNumber.mockResolvedValue("628123456789");
    mocks.whatsappUrl.mockReturnValue("https://wa.me/628123456789?text=pending");

    const response = await GET(new Request("http://localhost:3000/api/resident/payment-requests"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.history).toHaveBeenLastCalledWith(mocks.database, resident, undefined);
    expect(mocks.treasurerNumber).toHaveBeenLastCalledWith(mocks.database, resident.rtUnitId);
    expect(mocks.whatsappUrl).toHaveBeenLastCalledWith({
      destinationNumber: "628123456789",
      houseNumber: "UJI-5",
      residentName: "Warga Uji",
      request: {
        requestCode: pending.requestCode,
        status: "pending",
        periods: ["2026-09"],
        totalAmount: 40000,
        createdAt: pending.createdAt,
      },
    });
    expect(body.requests[0].whatsappUrl).toBe("https://wa.me/628123456789?text=pending");
    expect(body.requests[1].whatsappUrl).toBeNull();
    expect(body.requests[1].contactMessage).toBeNull();
    expect(body.requests[0]).not.toHaveProperty("rtUnitId");
  });

  it("keeps pending history readable without a Treasurer number", async () => {
    mocks.principal.mockResolvedValue(resident);
    mocks.history.mockResolvedValue({ requests: [pending], nextCursor: null });
    mocks.profile.mockResolvedValue({ name: "Warga Uji", houseNumber: "UJI-5" });
    mocks.treasurerNumber.mockResolvedValue(null);
    mocks.whatsappUrl.mockClear();
    const response = await GET(new Request("http://localhost:3000/api/resident/payment-requests"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.requests[0].whatsappUrl).toBeNull();
    expect(body.requests[0].contactMessage).toContain("tidak tersedia");
    expect(mocks.whatsappUrl).not.toHaveBeenCalled();
  });

  it("does not consult Treasurer contact for nonpending or empty history", async () => {
    mocks.principal.mockResolvedValue(resident);
    mocks.history.mockResolvedValue({ requests: [{ ...pending, status: "cancelled" }], nextCursor: null });
    mocks.treasurerNumber.mockClear();
    const response = await GET(new Request("http://localhost:3000/api/resident/payment-requests"));
    expect(response.status).toBe(200);
    expect(mocks.treasurerNumber).not.toHaveBeenCalled();
    expect((await response.json()).requests[0]).not.toHaveProperty("whatsappUrl");
  });
});
