import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChairmanAnnualSummary } from "../../src/components/chairman-reports";
import type { RtFinancialReportResponse } from "../../src/lib/reports/rt-financial-report";

const report = {
  year: 2026,
  availableYears: [2026],
  asOf: { businessDate: "2026-10-12", period: "2026-10" },
  dueNowOutstanding: 40_000,
  futureUnpaidOutstanding: 80_000,
  yearly: {
    target: 480_000,
    effectiveTarget: 480_000,
    received: 360_000,
    transferReceived: 360_000,
    cashReceived: 0,
    waived: 0,
    outstanding: 120_000,
    obligationCount: 12,
    waivedCount: 0,
    notDueCount: 0,
    overdueCount: 0,
  },
  yearlyOutstandingTiming: {
    dueNowOutstanding: 40_000,
    futureUnpaidOutstanding: 80_000,
  },
  monthly: [],
  arrears: {
    totalOutstanding: 0,
    count: 0,
    householdCount: 0,
    households: [],
  },
} satisfies RtFinancialReportResponse;

describe("chairman annual report summary", () => {
  it("labels annual, due-now, and future unpaid amounts separately", () => {
    const markup = renderToStaticMarkup(
      createElement(ChairmanAnnualSummary, { data: report }),
    );
    const text = markup
      .replace(/<[^>]*>/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ");

    expect(text).toContain("Sisa kewajiban tahunan Rp 120.000");
    expect(text).toContain("Jatuh tempo saat ini Rp 40.000");
    expect(text).toContain("Belum jatuh tempo Rp 80.000");
    expect(text).toContain("Tunggakan di bawah hanya menghitung periode sebelum bulan berjalan.");
    expect(text).not.toContain("Belum diterima");
  });
});
