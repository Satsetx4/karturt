import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  getDb: vi.fn(),
  database: {},
  create: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  deactivate: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/auth/principal", () => ({
  getCurrentPrincipal: mocks.principal,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  MfaEnrollmentRequiredError: class MfaEnrollmentRequiredError extends Error {},
}));
vi.mock("@/db/client", () => ({ getDb: () => mocks.getDb() }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/households/lifecycle", () => ({
  HouseholdConflictError: class HouseholdConflictError extends Error {},
  HouseholdForbiddenError: class HouseholdForbiddenError extends Error {},
  HouseholdNotFoundError: class HouseholdNotFoundError extends Error {},
  InvalidHouseholdInputError: class InvalidHouseholdInputError extends Error {},
  createHouseholdResident: mocks.create,
  listHouseholdManagement: mocks.list,
  updateHouseholdResident: mocks.update,
  deactivateHousehold: mocks.deactivate,
  replaceHouseholdResident: mocks.replace,
}));

import { POST as createHousehold } from "@/app/api/chairman/households/route";
import { PATCH as updateHousehold } from "@/app/api/chairman/households/[householdId]/route";
import { POST as deactivateHousehold } from "@/app/api/chairman/households/[householdId]/deactivate/route";
import { POST as replaceHouseholdResident } from "@/app/api/chairman/households/[householdId]/replace/route";

const householdId = "00000000-0000-4000-8000-000000000001";
const personId = "00000000-0000-4000-8000-000000000002";

function jsonRequest(url: string, method: "POST" | "PATCH", body: unknown) {
  return new Request(url, {
    method,
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("F12 Chairman household API strict security boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(mocks.database);
  });

  it.each([
    ["create", () => createHousehold(jsonRequest("http://localhost:3000/api/chairman/households", "POST", {
      newHouse: { number: "A-01", label: "Blok A" },
      startsOn: "2026-10-03",
      fullName: "Warga Baru",
      initialPin: "482913",
      rtUnitId: householdId,
      status: "active",
      accountType: "official",
      authUserId: "attacker-user",
      amount: 99,
      feeRateId: personId,
    })), "create"],
    ["edit", () => updateHousehold(jsonRequest(`http://localhost:3000/api/chairman/households/${householdId}?personId=${personId}`, "PATCH", {
      fullName: "Nama Baru",
      rtUnitId: householdId,
      status: "inactive",
      householdId: personId,
    }), { params: Promise.resolve({ householdId }) }), "update"],
    ["deactivate", () => deactivateHousehold(jsonRequest(`http://localhost:3000/api/chairman/households/${householdId}/deactivate`, "POST", {
      activeThroughMonth: "2026-10",
      reason: "Warga berpindah",
      amount: 0,
      waivedReason: "reset tunggakan",
    }), { params: Promise.resolve({ householdId }) }), "deactivate"],
    ["replace", () => replaceHouseholdResident(jsonRequest(`http://localhost:3000/api/chairman/households/${householdId}/replace`, "POST", {
      effectiveMonth: "2026-11",
      fullName: "Warga Pengganti",
      initialPin: "482913",
      reason: "Pergantian penghuni",
      feeRateId: personId,
      oldDebt: 0,
      authUserId: "attacker-user",
    }), { params: Promise.resolve({ householdId }) }), "replace"],
  ])("rejects mass-assignment fields on %s before authentication or service access", async (_operation, run, serviceName) => {
    const response = await (run as () => Promise<Response>)();

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks[serviceName as "create" | "update" | "deactivate" | "replace"]).not.toHaveBeenCalled();
  });

  it.each([
    ["impossible create date", () => createHousehold(jsonRequest("http://localhost:3000/api/chairman/households", "POST", {
      newHouse: { number: "A-02" }, startsOn: "2026-02-30", fullName: "Warga", initialPin: "482913",
    }))],
    ["short initial PIN", () => createHousehold(jsonRequest("http://localhost:3000/api/chairman/households", "POST", {
      newHouse: { number: "A-03" }, startsOn: "2026-10-03", fullName: "Warga", initialPin: "12345",
    }))],
    ["malformed replacement PIN", () => replaceHouseholdResident(jsonRequest(`http://localhost:3000/api/chairman/households/${householdId}/replace`, "POST", {
      effectiveMonth: "2026-11", fullName: "Warga Pengganti", initialPin: "not-a-pin", reason: "Pergantian penghuni",
    }), { params: Promise.resolve({ householdId }) })],
  ])("rejects %s without leaking the submitted value", async (_description, run) => {
    const response = await (run as () => Promise<Response>)();
    const payload = await response.text();

    expect(response.status).toBe(400);
    expect(payload).not.toContain("not-a-pin");
    expect(payload).not.toContain("12345");
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("rejects cross-origin mutation before parsing or revealing household data", async () => {
    const response = await createHousehold(new Request("http://localhost:3000/api/chairman/households", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://attacker.invalid" },
      body: JSON.stringify({ newHouse: { number: "A-01" } }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
