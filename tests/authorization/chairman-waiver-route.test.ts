import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  createWaiver: vi.fn(),
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
vi.mock("@/lib/billing/chairman-waiver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/chairman-waiver")>("@/lib/billing/chairman-waiver");
  return { ...actual, createChairmanWaiver: mocks.createWaiver };
});

import { POST } from "@/app/api/chairman/waivers/route";

const chairman = {
  authUserId: "auth-chairman",
  appAccountId: "00000000-0000-4000-8000-000000000001",
  role: "rt_chairman",
  rtUnitId: "00000000-0000-4000-8000-000000000002",
  householdId: null,
  personId: null,
};

function post(body: unknown) {
  return new Request("http://localhost:3000/api/chairman/waivers", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "Idempotency-Key": "00000000-0000-4000-8000-000000000003",
    },
    body: JSON.stringify(body),
  });
}

describe("Chairman waiver mutation route boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.principal.mockResolvedValue(chairman);
    mocks.getDb.mockReturnValue(mocks.database);
  });

  it("rejects valid waiver fields mixed with mass-assignment fields before calling the service", async () => {
    const response = await POST(post({
      householdId: "00000000-0000-4000-8000-000000000004",
      periods: ["2026-01"],
      reason: "Pemutihan sesuai keputusan rapat RT",
      rtUnitId: chairman.rtUnitId,
      actorId: chairman.appAccountId,
      amount: 1,
      status: "paid",
      dueIds: ["00000000-0000-4000-8000-000000000005"],
      audit: { action: "payment.verified" },
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      message: "Periksa kembali rumah, periode, dan alasan pemutihan.",
    });
    expect(mocks.principal).toHaveBeenCalledOnce();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.createWaiver).not.toHaveBeenCalled();
  });
});
