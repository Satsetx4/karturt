import type { ReportAmounts, RtFinancialReportResponse } from "./aggregation";
import { serializeReportCsv } from "./csv";

const amounts: readonly [keyof ReportAmounts, string][] = [
  ["target", "Target awal"], ["effectiveTarget", "Target setelah penyesuaian"],
  ["openingBalanceReceived", "Saldo awal impor"], ["transferReceived", "Pembayaran transfer terverifikasi"],
  ["cashReceived", "Pembayaran tunai"], ["received", "Total pembayaran terverifikasi"],
  ["waived", "Pemutihan / dibebaskan"], ["outstanding", "Sisa kewajiban"],
];
const validAmount = (value: number) => Number.isSafeInteger(value) && value >= 0;
function validDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function createAnnualReportCsv(report: RtFinancialReportResponse, rtIdentity: string) {
  if (!Number.isInteger(report.year) || report.year < 2000 || report.year > 2200 || !validDate(report.asOf.businessDate) || report.monthly.length !== 12) throw new Error("Invalid annual report period.");
  const monthly = [...report.monthly].sort((left, right) => left.month - right.month);
  if (monthly.some((month, index) => month.month !== index + 1)) throw new Error("Invalid annual report months.");
  for (const [key] of amounts) {
    const total = monthly.reduce((sum, month) => {
      if (!validAmount(month[key]) || !Number.isSafeInteger(sum + month[key])) throw new Error("Invalid annual report amount.");
      return sum + month[key];
    }, 0);
    if (total !== report.yearly[key]) throw new Error("Annual report does not reconcile.");
  }
  if (!validAmount(report.dueNowOutstanding) || !validAmount(report.futureUnpaidOutstanding) ||
      !Number.isSafeInteger(report.dueNowOutstanding + report.futureUnpaidOutstanding) ||
      report.dueNowOutstanding + report.futureUnpaidOutstanding !== report.yearly.outstanding) throw new Error("Invalid outstanding split.");

  const rows: (string | number)[][] = [
    ["Bagian", "Periode tagihan", "Keterangan", "Rumah", "Warga", "Status rumah tangga", "Mulai menempati", "Akhir menempati", "Jatuh tempo", "Menunggu konfirmasi", "Nilai (rupiah)"],
  ];
  const summary = (section: string, period: string, label: string, amount: number | "" = "") => rows.push([section, period, label, "", "", "", "", "", "", "", amount]);
  summary("Identitas", String(report.year), rtIdentity);
  summary("Posisi data", report.asOf.businessDate, "Data saat laporan dimuat; muat ulang halaman untuk posisi terbaru.");
  summary("Catatan", String(report.year), "Pembayaran menurut bulan tagihan, bukan tanggal uang diterima. Bukan buku kas atau snapshot penutupan tahun.");
  for (const [key, label] of amounts) summary("Ringkasan tahunan", String(report.year), label, report.yearly[key]);
  summary("Posisi kewajiban", String(report.year), "Sisa kewajiban sampai bulan berjalan (bukan seluruhnya tunggakan)", report.dueNowOutstanding);
  summary("Posisi kewajiban", String(report.year), "Sisa kewajiban bulan mendatang (bukan tunggakan)", report.futureUnpaidOutstanding);
  for (const month of monthly) {
    for (const [key, label] of amounts) summary("Ringkasan bulanan", `${report.year}-${String(month.month).padStart(2, "0")}`, label, month[key]);
  }
  let arrears = 0;
  let count = 0;
  for (const household of report.arrears.households) {
    let householdTotal = 0;
    for (const period of household.periods) {
      if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12 || !validDate(period.dueDate) ||
          period.dueDate.slice(0, 7) !== `${report.year}-${String(period.month).padStart(2, "0")}` || period.dueDate >= report.asOf.businessDate ||
          !validAmount(period.outstanding) || period.outstanding === 0 || !Number.isSafeInteger(arrears + period.outstanding)) throw new Error("Invalid annual arrears.");
      arrears += period.outstanding; householdTotal += period.outstanding; count += 1;
      rows.push(["Tunggakan", `${report.year}-${String(period.month).padStart(2, "0")}`, "Sudah melewati jatuh tempo", household.houseNumber,
        household.residentNames.join(", "), household.lifecycle === "historical" ? "Riwayat rumah tangga" : "Rumah tangga aktif",
        household.startsOn, household.endsOn ?? "", period.dueDate, period.pending ? "Ya" : "Tidak", period.outstanding]);
    }
    if (householdTotal !== household.totalOutstanding) throw new Error("Household arrears do not reconcile.");
  }
  if (arrears !== report.arrears.totalOutstanding || count !== report.arrears.count || report.arrears.householdCount !== report.arrears.households.length) throw new Error("Annual arrears do not reconcile.");
  summary("Total tunggakan", String(report.year), "Hanya kewajiban tahun terpilih yang sudah melewati jatuh tempo", arrears);
  summary("Catatan", String(report.year), "Saldo awal impor dan pemutihan bukan pembayaran baru. Pembayaran yang dibatalkan tidak dihitung sebagai penerimaan.");
  return { filename: `laporan-iuran-${report.year}-tahunan.csv`, content: serializeReportCsv(rows) };
}
