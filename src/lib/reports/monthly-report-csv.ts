import type { RtFinancialReportResponse } from "./aggregation";
import { serializeReportCsv } from "./csv";

export function createMonthlyReportCsv(report: RtFinancialReportResponse, rtIdentity: string, month: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(report.year) || report.year < 2000 || report.year > 2200) {
    throw new Error("Invalid report period.");
  }
  const totals = report.monthly.find((item) => item.month === month);
  if (!totals) throw new Error("Report month is unavailable.");
  const period = `${report.year}-${String(month).padStart(2, "0")}`;
  const rows: (string | number)[][] = [
    ["Bagian", "Keterangan", "Rumah", "Warga", "Jatuh tempo", "Menunggu konfirmasi", "Nilai (rupiah)"],
    ["Identitas", rtIdentity, "", "", "", "", ""],
    ["Periode tagihan", period, "", "", "", "", ""],
    ["Posisi data", report.asOf.businessDate, "", "", "", "", ""],
    ["Catatan", "Pembayaran menurut bulan tagihan, bukan tanggal uang diterima. Posisi data saat dibaca; bukan snapshot penutupan bulan atau buku kas.", "", "", "", "", ""],
  ];
  for (const [label, amount] of [
    ["Target awal", totals.target],
    ["Target setelah penyesuaian", totals.effectiveTarget],
    ["Saldo awal impor", totals.openingBalanceReceived],
    ["Pembayaran transfer terverifikasi", totals.transferReceived],
    ["Pembayaran tunai", totals.cashReceived],
    ["Total pembayaran terverifikasi", totals.received],
    ["Pemutihan / dibebaskan", totals.waived],
    ["Sisa kewajiban", totals.outstanding],
  ] as const) rows.push(["Ringkasan", label, "", "", "", "", amount]);

  let totalArrears = 0;
  for (const household of report.arrears.households) {
    for (const item of household.periods.filter((item) => item.month === month)) {
      totalArrears += item.outstanding;
      rows.push(["Tunggakan", household.lifecycle === "historical" ? "Riwayat rumah tangga" : "Rumah tangga aktif",
        household.houseNumber, household.residentNames.join(", "), item.dueDate, item.pending ? "Ya" : "Tidak", item.outstanding]);
    }
  }
  rows.push(["Total tunggakan", "Hanya periode terpilih yang sudah melewati jatuh tempo", "", "", "", "", totalArrears]);
  rows.push(["Catatan", "Saldo awal impor dan pemutihan bukan pembayaran baru. Pembayaran yang dibatalkan tidak dihitung sebagai penerimaan.", "", "", "", "", ""]);
  return {
    filename: `laporan-iuran-${period}.csv`,
    content: serializeReportCsv(rows),
  };
}
