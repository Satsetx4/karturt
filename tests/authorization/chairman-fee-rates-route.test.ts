import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  createFeeRate: vi.fn(),
  listFeeRates: vi.fn(),
  getDb: vi.fn(),
  database: {},
}));

vi.mock("@/lib/auth/principal", () => ({
  getCurrentPrincipal: mocks.principal,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  MfaEnrollmentRequiredError: class MfaEnrollmentRequiredError extends Error {},
}));
vi.mock("@/db/client", () => ({ getDb: () => mocks.getDb() }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/billing/chairman-fee-rates", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/chairman-fee-rates")>("@/lib/billing/chairman-fee-rates");
  return {
    ...actual,
    createChairmanFeeRate: mocks.createFeeRate,
    listChairmanFeeRates: mocks.listFeeRates,
  };
});

import { GET, POST } from "@/app/api/chairman/fee-rates/route";

const chairman = {
  authUserId: "auth-chairman",
  appAccountId: "00000000-0000-4000-8000-000000000001",
  role: "rt_chairman",
  rtUnitId: "00000000-0000-4000-8000-000000000002",
  householdId: null,
  personId: null,
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/chairman/fee-rates", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "Idempotency-Key": "00000000-0000-4000-8000-000000000003",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("Chairman fee rate route boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.principal.mockResolvedValue(chairman);
    mocks.getDb.mockReturnValue(mocks.database);
    mocks.listFeeRates.mockResolvedValue({ years: [], rates: [] });
    mocks.createFeeRate.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000004",
      billingYearId: "00000000-0000-4000-8000-000000000005",
      effectiveMonth: 11,
      monthlyAmount: 50000,
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
      idempotentReplay: false,
    });
  });

  it("returns the fee-rate list and passes the optional year filter", async () => {
    const response = await GET(new Request("http://localhost:3000/api/chairman/fee-rates?billingYearId=00000000-0000-4000-8000-000000000005"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ years: [], rates: [] });
    expect(mocks.listFeeRates).toHaveBeenCalledWith(
      mocks.database,
      chairman,
      "00000000-0000-4000-8000-000000000005",
    );
  });

  it("rejects unsupported GET parameters before reading account data", async () => {
    const response = await GET(new Request("http://localhost:3000/api/chairman/fee-rates?rtUnitId=secret"));

    expect(response.status).toBe(400);
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(mocks.listFeeRates).not.toHaveBeenCalled();
  });

  it("rejects a mutation without same-origin proof", async () => {
    const response = await POST(new Request("http://localhost:3000/api/chairman/fee-rates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        billingYearId: "00000000-0000-4000-8000-000000000005",
        effectiveMonth: 11,
        monthlyAmount: 50000,
      }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(mocks.createFeeRate).not.toHaveBeenCalled();
  });

  it("passes only the allowlisted tariff fields and idempotency key to the service", async () => {
    const response = await POST(post({
      billingYearId: "00000000-0000-4000-8000-000000000005",
      effectiveMonth: 11,
      monthlyAmount: 50000,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rate: { effectiveMonth: 11, monthlyAmount: 50000 },
      idempotentReplay: false,
      message: "Tarif berhasil ditambahkan.",
    });
    expect(mocks.createFeeRate).toHaveBeenCalledWith(
      mocks.database,
      chairman,
      {
        billingYearId: "00000000-0000-4000-8000-000000000005",
        effectiveMonth: 11,
        monthlyAmount: 50000,
        idempotencyKey: "00000000-0000-4000-8000-000000000003",
      },
    );
  });

  it("rejects mass-assignment fields before calling the fee-rate service", async () => {
    const response = await POST(post({
      billingYearId: "00000000-0000-4000-8000-000000000005",
      effectiveMonth: 11,
      monthlyAmount: 50000,
      rtUnitId: chairman.rtUnitId,
      actorId: chairman.appAccountId,
      status: "paid",
      feeRateId: "00000000-0000-4000-8000-000000000006",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: "Periksa kembali tahun, bulan efektif, dan nominal tarif.",
    });
    expect(mocks.createFeeRate).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before passing a write to the service", async () => {
    const response = await POST(post({
      billingYearId: "00000000-0000-4000-8000-000000000005",
      effectiveMonth: 11,
      monthlyAmount: 50000,
    }, { "Idempotency-Key": "bad-key" }));

    expect(response.status).toBe(400);
    expect(mocks.createFeeRate).not.toHaveBeenCalled();
  });
});
