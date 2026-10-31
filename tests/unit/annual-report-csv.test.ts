import { describe, expect, it } from "vitest";
import { createAnnualReportCsv } from "@/lib/reports/annual-report-csv";
import { aggregateRtFinancialReport, type ReportDueInput } from "@/lib/reports/aggregation";

function due(id: string, month: number, extra: Partial<ReportDueInput> = {}): ReportDueInput {
  return { monthlyDueId: id, household: { householdId: id, rtUnitId: "synthetic-rt", houseNumber: id,
    houseLabel: null, residentNames: [`Sintetis ${id}`], lifecycle: "active", startsOn: "2026-01-01", endsOn: null },
    year: 2026, month, dueDate: `2026-${String(month).padStart(2, "0")}-10`, status: "unpaid", originalAmount: 40000,
    adjustmentTotal: 0, activeReceived: 0, importedOpeningBalance: 0, transferReceived: 0, cashReceived: 0,
    waiverAmount: 0, hasPendingRequest: false, ...extra };
}
function fixture() {
  const old = due("old", 4); old.household.houseNumber = "S-01"; old.household.lifecycle = "historical"; old.household.endsOn = "2026-04-30";
  const current = due("current", 5, { hasPendingRequest: true }); current.household.houseNumber = "S-01"; current.household.startsOn = "2026-05-01";
  return aggregateRtFinancialReport([
    due("transfer", 1, { status: "paid", activeReceived: 40000, transferReceived: 40000 }),
    due("cash", 2, { status: "paid", activeReceived: 40000, cashReceived: 40000 }),
    due("opening", 3, { status: "paid", importedOpeningBalance: 40000 }),
    due("waived", 4, { status: "waived", waiverAmount: 40000 }), old, current, due("future", 6),
  ], { year: 2026, availableYears: [2026], businessDate: "2026-05-11" });
}
describe("annual report CSV", () => {
  it("exports all twelve billing months and reconciled annual balances without treating opening balances or waivers as new payments", () => {
    const result = createAnnualReportCsv(fixture(), "RT Sintetis");
    expect(result.filename).toBe("laporan-iuran-2026-tahunan.csv"); expect(result.content.startsWith("\uFEFF")).toBe(true); expect(result.content.endsWith("\r\n")).toBe(true);
    for (const [label, amount] of [["Target awal", 280000], ["Saldo awal impor", 40000], ["Total pembayaran terverifikasi", 80000], ["Pembayaran transfer terverifikasi", 40000], ["Pembayaran tunai", 40000], ["Pemutihan / dibebaskan", 40000], ["Sisa kewajiban", 120000]] as const) {
      expect(result.content).toContain(`"Ringkasan tahunan";"2026";"${label}";"";"";"";"";"";"";"";${amount}\r\n`);
    }
    expect((result.content.match(/"Ringkasan bulanan";/g) ?? []).length).toBe(96);
    for (let month = 1; month <= 12; month++) expect(result.content).toContain(`"Ringkasan bulanan";"2026-${String(month).padStart(2, "0")}"`);
    expect(result.content).toContain("bukan tanggal uang diterima"); expect(result.content).toContain("bukan pembayaran baru");
  });
  it("distinguishes historical/new households at the same house and exports only overdue periods with pending status", () => {
    const csv = createAnnualReportCsv(fixture(), "RT Sintetis").content;
    expect(csv).toContain('"S-01";"Sintetis old";"Riwayat rumah tangga";"2026-01-01";"2026-04-30";"2026-04-10";"Tidak";40000');
    expect(csv).toContain('"S-01";"Sintetis current";"Rumah tangga aktif";"2026-05-01";"";"2026-05-10";"Ya";40000');
    expect(csv).not.toContain('"Tunggakan";"2026-06"'); expect(csv).not.toContain("Sintetis future");
    expect(csv).toContain('"Total tunggakan";"2026";"Hanya kewajiban tahun terpilih yang sudah melewati jatuh tempo";"";"";"";"";"";"";"";80000');
    expect(csv).toContain('"Sisa kewajiban bulan mendatang (bukan tunggakan)";"";"";"";"";"";"";"";40000');
  });
  it("does not export a current-period due as arrears on its exact due date", () => {
    const report = aggregateRtFinancialReport([due("exact", 5)], { year: 2026, availableYears: [2026], businessDate: "2026-05-10" });
    expect(createAnnualReportCsv(report, "RT Sintetis").content).not.toContain('"Tunggakan";');
  });
  it.each(["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "  =1+1", "\t=1+1", "\n=1+1", "\u0000=1+1"])("neutralizes formulas in every exported user-controlled text field: %j", (value) => {
    const report = fixture(); const household = report.arrears.households[0];
    household.houseNumber = value; household.residentNames = [value]; household.startsOn = value; household.endsOn = value;
    const csv = createAnnualReportCsv(report, value).content;
    expect(csv.split(`"'${value}"`).length - 1).toBe(5);
  });
  it("quotes Unicode, delimiters, quotes and embedded line breaks", () => {
    const report = fixture(); report.arrears.households[0].residentNames = ['Désa; "Utara"\nBaris dua'];
    expect(createAnnualReportCsv(report, "RT Sintetis").content).toContain('"Désa; ""Utara""\nBaris dua"');
  });
  it("exports zero balances without fabricating household data", () => {
    const report = aggregateRtFinancialReport([], { year: 2026, availableYears: [], businessDate: "2026-05-11" });
    const csv = createAnnualReportCsv(report, "RT Sintetis").content;
    expect(csv).not.toContain('"Tunggakan";'); expect(csv).toContain('"Ringkasan tahunan";"2026";"Sisa kewajiban";"";"";"";"";"";"";"";0');
  });
  it("rejects missing/duplicate months, mismatched totals, future arrears and unsafe amounts", () => {
    const edits = [
      (r: ReturnType<typeof fixture>) => { r.monthly.pop(); },
      (r: ReturnType<typeof fixture>) => { r.monthly[1].month = 1; },
      (r: ReturnType<typeof fixture>) => { r.yearly.outstanding += 1; },
      (r: ReturnType<typeof fixture>) => { r.futureUnpaidOutstanding = Number.MAX_SAFE_INTEGER; },
      (r: ReturnType<typeof fixture>) => { r.monthly[0].received = Number.NaN; },
      (r: ReturnType<typeof fixture>) => { r.arrears.households[0].periods[0].dueDate = "2026-06-10"; },
      (r: ReturnType<typeof fixture>) => { r.arrears.totalOutstanding += 1; },
      (r: ReturnType<typeof fixture>) => { r.asOf.businessDate = "2026-02-30"; },
    ];
    for (const edit of edits) { const report = fixture(); edit(report); expect(() => createAnnualReportCsv(report, "RT Sintetis")).toThrow(); }
  });
});
