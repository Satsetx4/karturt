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
    expect(canPerform(principal("treasurer"), "payment:verify", { rtUnitId: "rt-one" })).toBe(true);
    expect(canPerform(principal("treasurer"), "payment:verify")).toBe(false);
    expect(canPerform(principal("treasurer"), "payment:verify", { rtUnitId: "rt-two" })).toBe(false);
    expect(canPerform(principal("rt_chairman"), "payment:verify", { rtUnitId: "rt-one" })).toBe(false);
    expect(canPerform(principal("system_admin", { rtUnitId: null, householdId: null, personId: null }), "payment:verify", { rtUnitId: "rt-one" })).toBe(false);
    expect(canPerform(principal("resident"), "payment:verify", { rtUnitId: "rt-one" })).toBe(false);
  });

  it("allows payment requests only for a resident's own household", () => {
    expect(canPerform(principal("resident"), "payment:request:self", { rtUnitId: "rt-one", householdId: "household-one" })).toBe(true);
    expect(canPerform(principal("resident"), "payment:request:self", { rtUnitId: "rt-two", householdId: "household-one" })).toBe(false);
    expect(canPerform(principal("treasurer"), "payment:request:self", { rtUnitId: "rt-one", householdId: "household-one" })).toBe(false);
    expect(canPerform(principal("system_admin"), "payment:request:self", { rtUnitId: "rt-one", householdId: "household-one" })).toBe(false);
  });

  it("keeps fee, waiver, and assignment management with the RT Chairman", () => {
    const chairman = principal("rt_chairman");
    expect(canPerform(chairman, "fee_rate:manage", { rtUnitId: "rt-one" })).toBe(true);
    expect(canPerform(chairman, "waiver:manage", { rtUnitId: "rt-one" })).toBe(true);
    expect(canPerform(chairman, "official:manage", { rtUnitId: "rt-one" })).toBe(true);
    expect(canPerform(chairman, "resident:reset_credential", { rtUnitId: "rt-one" })).toBe(true);
    expect(canPerform(principal("treasurer"), "fee_rate:manage")).toBe(false);
    expect(canPerform(principal("treasurer"), "resident:reset_credential", { rtUnitId: "rt-one" })).toBe(false);
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
