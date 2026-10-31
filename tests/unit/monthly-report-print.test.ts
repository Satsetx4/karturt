import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthlyReportPrint } from "@/components/monthly-report-print";
import { aggregateRtFinancialReport, type ReportDueInput } from "@/lib/reports/aggregation";

function due(houseNumber: string, month: number, overrides: Partial<ReportDueInput> = {}): ReportDueInput {
  return {
    monthlyDueId: `${houseNumber}-${month}`,
    household: { householdId: houseNumber, rtUnitId: "synthetic-rt", houseNumber, houseLabel: null,
      residentNames: [], lifecycle: "active", startsOn: "2026-01-01", endsOn: null },
    year: 2026, month, dueDate: `2026-${String(month).padStart(2, "0")}-10`,
    status: "unpaid", originalAmount: 40000, adjustmentTotal: 0, activeReceived: 0,
    importedOpeningBalance: 0, transferReceived: 0, cashReceived: 0, waiverAmount: 0,
    hasPendingRequest: false, ...overrides,
  };
}

describe("monthly meeting print report", () => {
  const report = aggregateRtFinancialReport([
    due("SELECTED-UNPAID", 4), due("OTHER-MONTH", 3),
    due("TRANSFER", 4, { status: "paid", activeReceived: 40000, transferReceived: 40000 }),
    due("IMPORTED", 4, { status: "paid", importedOpeningBalance: 40000 }),
    due("WAIVED", 4, { status: "waived", waiverAmount: 40000 }),
  ], { year: 2026, availableYears: [2026], businessDate: "2026-05-20" });

  it("prints only the selected month's arrears and separates opening balances from payments and waivers", () => {
    const html = renderToStaticMarkup(createElement(MonthlyReportPrint, {
      report, rtIdentity: "RT Sintetis", month: 4, onMonthChange: () => {},
    }));
    expect(html).toContain("Periode tagihan: April 2026");
    expect(html).toContain("SELECTED-UNPAID");
    expect(html).not.toContain("OTHER-MONTH");
    expect(html).toContain("Saldo awal impor");
    expect(html).toContain("Pembayaran transfer terverifikasi");
    expect(html).toContain("Pemutihan / dibebaskan");
    expect(html).toContain("bukan tanggal uang diterima");
    expect(html).toContain("bukan buku kas");
    expect(html).toContain("RT Sintetis");
    expect(html).toContain("Unduh CSV bulanan");
    expect(html).toContain("Unduh CSV tahunan");
  });

  it("shows a truthful empty state instead of carrying arrears from another month", () => {
    const html = renderToStaticMarkup(createElement(MonthlyReportPrint, {
      report, rtIdentity: "RT Sintetis", month: 6, onMonthChange: () => {},
    }));
    expect(html).toContain("Tidak ada tunggakan yang sudah melewati jatuh tempo");
    expect(html).not.toContain("SELECTED-UNPAID");
  });
});
