import { describe, expect, it } from "vitest";
import type { Principal } from "../../src/lib/auth/permissions";
import { canPerform } from "../../src/lib/auth/permissions";

function principal(role: Principal["role"], overrides: Partial<Principal> = {}): Principal {
  return {
    authUserId: "auth-user",
    appAccountId: "app-account",
    role,
    rtUnitId: "rt-one",
    householdId: role === "resident" ? "household-one" : null,
    personId: "person-one",
    ...overrides,
  };
}

describe("role authorization", () => {
  it("limits residents to their own household and RT", () => {
    const resident = principal("resident");
    expect(canPerform(resident, "billing:read:self", { rtUnitId: "rt-one", householdId: "household-one" })).toBe(true);
    expect(canPerform(resident, "billing:read:self", { householdId: "household-two" })).toBe(false);
    expect(canPerform(resident, "billing:read:self", { rtUnitId: "rt-two" })).toBe(false);
    expect(canPerform(resident, "resident:manage")).toBe(false);
  });

  it("gives payment verification to the Treasurer only", () => {
    expect(canPerform(principal("treasurer"), "payment:verify")).toBe(true);
    expect(canPerform(principal("rt_chairman"), "payment:verify")).toBe(false);
    expect(canPerform(principal("system_admin", { rtUnitId: null, householdId: null, personId: null }), "payment:verify")).toBe(false);
    expect(canPerform(principal("resident"), "payment:verify")).toBe(false);
  });

  it("keeps fee, waiver, and assignment management with the RT Chairman", () => {
    const chairman = principal("rt_chairman");
    expect(canPerform(chairman, "fee_rate:manage", { rtUnitId: "rt-one" })).toBe(true);
    expect(canPerform(chairman, "waiver:manage", { rtUnitId: "rt-one" })).toBe(true);
    expect(canPerform(chairman, "official:manage", { rtUnitId: "rt-one" })).toBe(true);
    expect(canPerform(principal("treasurer"), "fee_rate:manage")).toBe(false);
  });

  it("limits System Admin to system recovery and auditing", () => {
    const administrator = principal("system_admin", { rtUnitId: null, householdId: null, personId: null });
    expect(canPerform(administrator, "system:recover")).toBe(true);
    expect(canPerform(administrator, "system:manage")).toBe(true);
    expect(canPerform(administrator, "audit:read")).toBe(true);
    expect(canPerform(administrator, "billing:read:rt")).toBe(false);
    expect(canPerform(administrator, "fee_rate:manage")).toBe(false);
    expect(canPerform(administrator, "waiver:manage")).toBe(false);
    expect(canPerform(administrator, "payment:record_cash")).toBe(false);
  });
});
