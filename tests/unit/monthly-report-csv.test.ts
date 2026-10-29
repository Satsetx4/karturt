import { describe, expect, it } from "vitest";
import { aggregateRtFinancialReport, type ReportDueInput } from "@/lib/reports/aggregation";
import { createMonthlyReportCsv } from "@/lib/reports/monthly-report-csv";

function reportFor(name = "Warga sintetis", houseNumber = "S-01") {
  const due: ReportDueInput = {
    monthlyDueId: "due-1", household: { householdId: "h-1", rtUnitId: "rt-1", houseNumber,
      houseLabel: null, residentNames: [name], lifecycle: "active", startsOn: "2026-01-01", endsOn: null },
    year: 2026, month: 4, dueDate: "2026-04-10", status: "unpaid", originalAmount: 40000,
    adjustmentTotal: 0, activeReceived: 0, importedOpeningBalance: 0, transferReceived: 0,
    cashReceived: 0, waiverAmount: 0, hasPendingRequest: true,
  };
  return aggregateRtFinancialReport([due, { ...due, monthlyDueId: "due-2", month: 3, dueDate: "2026-03-10" }],
    { year: 2026, availableYears: [2026], businessDate: "2026-05-20" });
}

describe("monthly report CSV", () => {
  it("exports the selected month with a BOM, CRLF, separate balance fields, numeric amounts and pending status", () => {
    const result = createMonthlyReportCsv(reportFor(), "RT Sintetis", 4);
    expect(result.filename).toBe("laporan-iuran-2026-04.csv");
    expect(result.content.startsWith("\uFEFF")).toBe(true);
    expect(result.content).toContain('"Saldo awal impor";"";"";"";"";0\r\n');
    expect(result.content).toContain('"Pembayaran transfer terverifikasi"');
    expect(result.content).toContain('"Pembayaran tunai"');
    expect(result.content).toContain('"Pemutihan / dibebaskan"');
    expect(result.content).toContain('"2026-04-10";"Ya";40000\r\n');
    expect(result.content).not.toContain("2026-03-10");
    expect(result.content).toContain('"Total tunggakan";"Hanya periode terpilih yang sudah melewati jatuh tempo";"";"";"";"";40000');
  });

  it.each(["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "  =1+1", "\t=1+1", "\n=1+1"])("neutralizes spreadsheet formula text %j in identity, house and resident fields", (value) => {
    const report = reportFor(value, value);
    report.arrears.households[0]!.residentNames = [value];
    const csv = createMonthlyReportCsv(report, value, 4).content;
    expect(csv.split(`"'${value}"`).length - 1).toBe(3);
  });

  it("quotes delimiters, quotes, line breaks and Unicode without creating extra cells", () => {
    const csv = createMonthlyReportCsv(reportFor('Désa; "Utara"\nBaris dua'), "RT Sintetis", 4).content;
    expect(csv).toContain('"Désa; ""Utara""\nBaris dua"');
  });

  it("keeps an empty month's arrears total zero and rejects invalid periods or unsafe numbers", () => {
    const report = reportFor();
    const csv = createMonthlyReportCsv(report, "RT Sintetis", 6).content;
    expect(csv).not.toContain('"Tunggakan";');
    expect(csv).toContain('"Total tunggakan";"Hanya periode terpilih yang sudah melewati jatuh tempo";"";"";"";"";0');
    expect(() => createMonthlyReportCsv(report, "RT Sintetis", 13)).toThrow();
    report.monthly[3]!.received = Number.NaN;
    expect(() => createMonthlyReportCsv(report, "RT Sintetis", 4)).toThrow();
  });
});
