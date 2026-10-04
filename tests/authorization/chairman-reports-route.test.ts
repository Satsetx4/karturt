import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  MfaEnrollmentRequiredError: class MfaEnrollmentRequiredError extends Error {},
  principal: vi.fn(),
  getDb: vi.fn(),
  database: {},
  getReport: vi.fn(),
}));

vi.mock("@/lib/auth/principal", () => ({
  getCurrentPrincipal: mocks.principal,
  UnauthenticatedError: mocks.UnauthenticatedError,
  MfaEnrollmentRequiredError: mocks.MfaEnrollmentRequiredError,
}));
vi.mock("@/db/client", () => ({ getDb: () => mocks.getDb() }));
vi.mock("@/lib/officials/lifecycle", () => ({ jakartaBusinessDate: () => "2026-10-04" }));
vi.mock("@/lib/reports/rt-financial-report", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reports/rt-financial-report")>("@/lib/reports/rt-financial-report");
  return { ...actual, getRtFinancialReport: mocks.getReport };
});

import * as reportRoute from "@/app/api/chairman/reports/route";
import { ReportForbiddenError, ReportInvariantError } from "@/lib/reports/rt-financial-report";

const chairman = {
  authUserId: "auth-chairman",
  appAccountId: "00000000-0000-4000-8000-000000000001",
  role: "rt_chairman",
  rtUnitId: "00000000-0000-4000-8000-000000000002",
  householdId: null,
  personId: null,
};

const payload = {
  year: 2026,
  availableYears: [2026],
  yearly: {},
  monthly: [],
  arrears: { totalOutstanding: 0, count: 0, householdCount: 0, households: [] },
};

describe("Chairman reports route boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.principal.mockResolvedValue(chairman);
    mocks.getDb.mockReturnValue(mocks.database);
    mocks.getReport.mockResolvedValue(payload);
  });

  it("loads the authenticated Chairman's report for the requested year without caching", async () => {
    const response = await reportRoute.GET(new Request("http://localhost:3000/api/chairman/reports?year=2026"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(payload);
    expect(mocks.getReport).toHaveBeenCalledWith(mocks.database, chairman, {
      year: 2026,
      businessDate: "2026-10-04",
    });
  });

  it("uses the service default when year is omitted", async () => {
    const response = await reportRoute.GET(new Request("http://localhost:3000/api/chairman/reports"));

    expect(response.status).toBe(200);
    expect(mocks.getReport).toHaveBeenCalledWith(mocks.database, chairman, {
      year: undefined,
      businessDate: "2026-10-04",
    });
  });

  it.each([
    ["malformed year", "year=20x6"],
    ["empty year", "year="],
    ["year below the supported range", "year=1999"],
    ["year above the supported range", "year=2201"],
    ["repeated year", "year=2026&year=2025"],
    ["spoofed tenant", "year=2026&rtUnitId=00000000-0000-4000-8000-000000000099"],
    ["spoofed role", "year=2026&role=rt_chairman"],
    ["unknown query key", "year=2026&debug=true"],
  ])("rejects %s before resolving the principal or reading reports", async (_name, query) => {
    const response = await reportRoute.GET(new Request(`http://localhost:3000/api/chairman/reports?${query}`));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.getReport).not.toHaveBeenCalled();
  });

  it("passes only the session-derived principal and denies a direct API request rejected by the report service", async () => {
    const treasurer = { ...chairman, role: "treasurer" };
    mocks.principal.mockResolvedValue(treasurer);
    mocks.getReport.mockRejectedValue(new ReportForbiddenError());

    const response = await reportRoute.GET(new Request("http://localhost:3000/api/chairman/reports?year=2026", {
      headers: {
        "x-role": "rt_chairman",
        "x-rt-unit-id": "00000000-0000-4000-8000-000000000099",
      },
    }));

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private account or assignment details");
    expect(mocks.getReport).toHaveBeenCalledWith(mocks.database, treasurer, {
      year: 2026,
      businessDate: "2026-10-04",
    });
  });

  it("returns a safe 401 response when authentication fails", async () => {
    mocks.principal.mockRejectedValue(new mocks.UnauthenticatedError("session details"));
    const response = await reportRoute.GET(new Request("http://localhost:3000/api/chairman/reports?year=2026"));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("session details");
    expect(mocks.getReport).not.toHaveBeenCalled();
  });

  it("hides report invariant details and exposes only a GET handler", async () => {
    mocks.getReport.mockRejectedValue(new ReportInvariantError("raw SQL and account identifiers"));

    const response = await reportRoute.GET(new Request("http://localhost:3000/api/chairman/reports?year=2026"));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("raw SQL and account identifiers");
    expect("POST" in reportRoute).toBe(false);
  });
});
