import { describe, expect, it } from "vitest";
import { buildAnnualDues } from "../../src/lib/billing/generator";

const base = {
  rtUnitId: "rt-id",
  householdId: "household-id",
  billingYearId: "year-id",
  year: 2026,
  householdStartsOn: "2026-05-15",
  feeRates: [
    { id: "rate-one", effectiveMonth: 1, monthlyAmount: 40_000 },
    { id: "rate-two", effectiveMonth: 7, monthlyAmount: 50_000 },
  ],
};

describe("annual monthly-dues generation", () => {
  it("creates twelve months, waives months before activation, and snapshots effective rates", () => {
    const rows = buildAnnualDues(base);
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 4).every((row) => row.status === "waived" && row.amount === 0)).toBe(true);
    expect(rows[4]?.status).toBe("unpaid");
    expect(rows[4]?.amount).toBe(40_000);
    expect(rows[6]?.amount).toBe(50_000);
    expect(rows.every((row) => row.dueDate.endsWith("-10"))).toBe(true);
  });

  it("starts obligations in the joining month, even when the household joined after day one", () => {
    const rows = buildAnnualDues({ ...base, householdStartsOn: "2026-05-31" });
    expect(rows[3]?.status).toBe("waived");
    expect(rows[4]?.status).toBe("unpaid");
  });

  it("does not create a charge for months before the household start year", () => {
    const rows = buildAnnualDues({ ...base, householdStartsOn: "2027-03-15" });
    expect(rows.every((row) => row.status === "waived" && row.amount === 0)).toBe(true);
  });

  it("rejects a billable month without a rate", () => {
    expect(() => buildAnnualDues({ ...base, feeRates: [] })).toThrow("No fee rate is configured");
  });

  it("keeps the current due day fixed to the 10th", () => {
    expect(() => buildAnnualDues({ ...base, dueDay: 15 })).toThrow("due day is the 10th");
  });
});
