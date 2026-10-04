import { describe, expect, it } from "vitest";
import {
  aggregateRtFinancialReport,
  sumActiveAllocationMethods,
  type ReportDueInput,
  type ReportHouseholdIdentity,
} from "@/lib/reports/aggregation";
import { ReportInvariantError } from "@/lib/reports/errors";

const BUSINESS_DATE = "2026-05-20";
const YEAR = 2026;

function household(input: Partial<ReportHouseholdIdentity> & Pick<ReportHouseholdIdentity, "householdId" | "houseNumber">): ReportHouseholdIdentity {
  const lifecycle = input.lifecycle ?? "active";
  return {
    householdId: input.householdId,
    rtUnitId: input.rtUnitId ?? "rt-1",
    houseNumber: input.houseNumber,
    houseLabel: input.houseLabel ?? null,
    residentNames: input.residentNames ?? [],
    lifecycle,
    startsOn: input.startsOn ?? "2024-01-01",
    endsOn: input.endsOn ?? (lifecycle === "active" ? null : "2026-02-28"),
  };
}

function due(
  identity: ReportHouseholdIdentity,
  month: number,
  input: Partial<ReportDueInput> = {},
): ReportDueInput {
  const status = input.status ?? "unpaid";
  const originalAmount = input.originalAmount ?? (status === "not_due" ? 0 : 40_000);
  return {
    monthlyDueId: `${identity.householdId}-${month}`,
    household: identity,
    year: YEAR,
    month,
    dueDate: `2026-${String(month).padStart(2, "0")}-10`,
    status,
    originalAmount,
    adjustmentTotal: 0,
    activeReceived: 0,
    transferReceived: 0,
    cashReceived: 0,
    waiverAmount: 0,
    hasPendingRequest: false,
    ...input,
  };
}

function createManualOracleDues(): ReportDueInput[] {
  const h1 = household({ householdId: "h1", houseNumber: "A-01", residentNames: ["H1 Resident"] });
  const h2 = household({ householdId: "h2", houseNumber: "A-02", startsOn: "2026-03-01", residentNames: ["H2 Resident"] });
  const h3Old = household({
    householdId: "h3-old",
    houseNumber: "A-03",
    lifecycle: "historical",
    startsOn: "2024-01-01",
    endsOn: "2026-02-28",
    residentNames: ["Previous Resident"],
  });
  const h3New = household({ householdId: "h3-new", houseNumber: "A-03", startsOn: "2026-03-01", residentNames: ["Current Resident"] });
  const dues: ReportDueInput[] = [];

  dues.push(
    due(h1, 1, { status: "paid", activeReceived: 40_000, transferReceived: 40_000 }),
    due(h2, 1, { status: "not_due" }),
    due(h3Old, 1, { status: "paid", activeReceived: 40_000, transferReceived: 40_000 }),
    due(h3New, 1, { status: "not_due" }),

    due(h1, 2, { status: "paid", adjustmentTotal: 10_000, activeReceived: 50_000, cashReceived: 50_000 }),
    due(h2, 2, { status: "not_due" }),
    due(h3Old, 2),
    due(h3New, 2, { status: "not_due" }),

    due(h1, 3, { adjustmentTotal: -5_000, hasPendingRequest: true }),
    due(h2, 3, { status: "paid", activeReceived: 40_000, transferReceived: 40_000 }),
    due(h3Old, 3, { status: "not_due" }),
    due(h3New, 3, { status: "paid", activeReceived: 40_000, cashReceived: 40_000 }),

    due(h1, 4, { status: "waived", waiverAmount: 40_000 }),
    due(h2, 4, { status: "paid", activeReceived: 40_000, cashReceived: 40_000 }),
    due(h3Old, 4, { status: "not_due" }),
    due(h3New, 4),

    due(h1, 5, { hasPendingRequest: true }),
    due(h2, 5, { status: "paid", activeReceived: 40_000, cashReceived: 40_000 }),
    due(h3Old, 5, { status: "not_due" }),
    due(h3New, 5),
  );

  for (let month = 6; month <= 12; month += 1) {
    dues.push(
      due(h1, month),
      due(h2, month),
      due(h3Old, month, { status: "not_due" }),
      due(h3New, month),
    );
  }
  return dues;
}

describe("F13 report aggregation", () => {
  it("matches the manually calculated monthly, yearly, and arrears oracle", () => {
    const result = aggregateRtFinancialReport(createManualOracleDues(), {
      year: YEAR,
      availableYears: [2026, 2025],
      businessDate: BUSINESS_DATE,
    });

    expect(result.monthly).toHaveLength(12);
    expect(result.monthly.slice(0, 5)).toEqual([
      expect.objectContaining({ month: 1, target: 80_000, effectiveTarget: 80_000, received: 80_000, transferReceived: 80_000, cashReceived: 0, waived: 0, outstanding: 0, notDueCount: 2 }),
      expect.objectContaining({ month: 2, target: 80_000, effectiveTarget: 90_000, received: 50_000, transferReceived: 0, cashReceived: 50_000, waived: 0, outstanding: 40_000, notDueCount: 2 }),
      expect.objectContaining({ month: 3, target: 120_000, effectiveTarget: 115_000, received: 80_000, transferReceived: 40_000, cashReceived: 40_000, waived: 0, outstanding: 35_000, notDueCount: 1 }),
      expect.objectContaining({ month: 4, target: 120_000, effectiveTarget: 120_000, received: 40_000, transferReceived: 0, cashReceived: 40_000, waived: 40_000, outstanding: 40_000, notDueCount: 1 }),
      expect.objectContaining({ month: 5, target: 120_000, effectiveTarget: 120_000, received: 40_000, transferReceived: 0, cashReceived: 40_000, waived: 0, outstanding: 80_000, notDueCount: 1 }),
    ]);
    expect(result.yearly).toEqual({
      target: 1_360_000,
      effectiveTarget: 1_365_000,
      received: 290_000,
      transferReceived: 120_000,
      cashReceived: 170_000,
      waived: 40_000,
      outstanding: 1_035_000,
      obligationCount: 34,
      waivedCount: 1,
      notDueCount: 14,
      overdueCount: 5,
    });
    expect(result.yearly.effectiveTarget).toBe(result.yearly.received + result.yearly.waived + result.yearly.outstanding);
    expect(result.arrears).toMatchObject({ totalOutstanding: 195_000, count: 5, householdCount: 3 });
    expect(result.arrears.households).toEqual(expect.arrayContaining([
      expect.objectContaining({ houseNumber: "A-03", lifecycle: "historical", totalOutstanding: 40_000, periods: [expect.objectContaining({ month: 2, outstanding: 40_000 })] }),
      expect.objectContaining({ houseNumber: "A-03", lifecycle: "active", totalOutstanding: 80_000, periods: [expect.objectContaining({ month: 4 }), expect.objectContaining({ month: 5 })] }),
      expect.objectContaining({ houseNumber: "A-01", totalOutstanding: 75_000, periods: [expect.objectContaining({ month: 3, pending: true }), expect.objectContaining({ month: 5, pending: true })] }),
    ]));
    const beforeMayDueDate = aggregateRtFinancialReport(createManualOracleDues(), {
      year: YEAR,
      availableYears: [2026, 2025],
      businessDate: "2026-05-05",
    });
    expect(beforeMayDueDate.arrears).toMatchObject({ totalOutstanding: 115_000, count: 3, householdCount: 3 });
    expect(result.arrears.households.every((row) => !("householdId" in row) && !("rtUnitId" in row))).toBe(true);
    expect(result.monthly.slice(5).every((month) => month.outstanding === 120_000 && month.notDueCount === 1)).toBe(true);
  });

  it("uses a strict due-date cutoff and keeps a pending request out of received", () => {
    const identity = household({ householdId: "pending", houseNumber: "A-04" });
    const pendingDue = due(identity, 5, { hasPendingRequest: true });
    const beforeDueDate = aggregateRtFinancialReport([pendingDue], { year: YEAR, availableYears: [YEAR], businessDate: "2026-05-10" });
    const afterDueDate = aggregateRtFinancialReport([pendingDue], { year: YEAR, availableYears: [YEAR], businessDate: "2026-05-11" });

    expect(beforeDueDate.monthly[4]).toMatchObject({ received: 0, outstanding: 40_000, overdueCount: 0 });
    expect(beforeDueDate.arrears).toMatchObject({ count: 0, totalOutstanding: 0 });
    expect(afterDueDate.monthly[4]).toMatchObject({ received: 0, outstanding: 40_000, overdueCount: 1 });
    expect(afterDueDate.arrears.households[0]).toMatchObject({ pending: true, periods: [{ pending: true }] });
  });

  it("sums multiple active allocation methods and excludes reversed allocations", () => {
    const identity = household({ householdId: "mixed", houseNumber: "A-05" });
    const methodTotals = sumActiveAllocationMethods([
      { monthlyDueId: "mixed-1", householdId: "mixed", rtUnitId: "rt-1", method: "transfer", amount: "15000", paymentReversed: false },
      { monthlyDueId: "mixed-1", householdId: "mixed", rtUnitId: "rt-1", method: "transfer", amount: "25000", paymentReversed: false },
      { monthlyDueId: "mixed-1", householdId: "mixed", rtUnitId: "rt-1", method: "cash", amount: "10000", paymentReversed: false },
      { monthlyDueId: "mixed-1", householdId: "mixed", rtUnitId: "rt-1", method: "cash", amount: "40000", paymentReversed: true },
    ], [{ monthlyDueId: "mixed-1", household: identity }]);

    expect(methodTotals.get("mixed-1")).toEqual({ transferReceived: 40_000, cashReceived: 10_000 });
    const report = aggregateRtFinancialReport([
      due(identity, 1, { originalAmount: 100_000, activeReceived: 50_000, transferReceived: 40_000, cashReceived: 10_000 }),
    ], { year: YEAR, availableYears: [YEAR], businessDate: BUSINESS_DATE });
    expect(report.monthly[0]).toMatchObject({ received: 50_000, transferReceived: 40_000, cashReceived: 10_000, outstanding: 50_000 });
  });

  it("fails closed on unsafe totals, method mismatches, invalid NOT_DUE activity, and inconsistent waiver amounts", () => {
    const identity = household({ householdId: "invalid", houseNumber: "A-06" });
    expect(() => aggregateRtFinancialReport([
      due(identity, 1, { originalAmount: Number.MAX_SAFE_INTEGER, adjustmentTotal: 1 }),
    ], { year: YEAR, availableYears: [YEAR], businessDate: BUSINESS_DATE })).toThrow(ReportInvariantError);
    expect(() => aggregateRtFinancialReport([
      due(identity, 1, { activeReceived: 40_000, transferReceived: 39_999 }),
    ], { year: YEAR, availableYears: [YEAR], businessDate: BUSINESS_DATE })).toThrow(ReportInvariantError);
    expect(() => aggregateRtFinancialReport([
      due(identity, 1, { status: "not_due", activeReceived: 1 }),
    ], { year: YEAR, availableYears: [YEAR], businessDate: BUSINESS_DATE })).toThrow(ReportInvariantError);
    expect(() => aggregateRtFinancialReport([
      due(identity, 1, { status: "waived" }),
    ], { year: YEAR, availableYears: [YEAR], businessDate: BUSINESS_DATE })).toThrow(ReportInvariantError);
    expect(() => aggregateRtFinancialReport([
      due(identity, 1, { status: "waived", waiverAmount: 39_999 }),
    ], { year: YEAR, availableYears: [YEAR], businessDate: BUSINESS_DATE })).toThrow(ReportInvariantError);
    expect(() => aggregateRtFinancialReport([
      due(identity, 1, { status: "waived", activeReceived: 1, transferReceived: 1, waiverAmount: 39_999 }),
    ], { year: YEAR, availableYears: [YEAR], businessDate: BUSINESS_DATE })).toThrow(ReportInvariantError);
  });

  it("fails closed when allocation scope or amounts are invalid", () => {
    const identity = household({ householdId: "alloc", houseNumber: "A-07" });
    expect(() => sumActiveAllocationMethods([
      { monthlyDueId: "alloc-1", householdId: "other", rtUnitId: "rt-1", method: "cash", amount: 10, paymentReversed: false },
    ], [{ monthlyDueId: "alloc-1", household: identity }])).toThrow(ReportInvariantError);
    expect(() => sumActiveAllocationMethods([
      { monthlyDueId: "alloc-1", householdId: "alloc", rtUnitId: "rt-1", method: "cash", amount: Number.MAX_SAFE_INTEGER + 1, paymentReversed: false },
    ], [{ monthlyDueId: "alloc-1", household: identity }])).toThrow(ReportInvariantError);
  });
});
