"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Printer } from "lucide-react";
import { createMonthlyReportCsv } from "@/lib/reports/monthly-report-csv";
import type { RtFinancialReportResponse } from "@/lib/reports/aggregation";

const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const rupiah = (amount: number) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
}).format(amount);

export function MonthlyReportPrint({ report, rtIdentity, month, onMonthChange }: {
  report: RtFinancialReportResponse;
  rtIdentity: string;
  month: number;
  onMonthChange: (month: number) => void;
}) {
  const printedAt = useRef<HTMLTimeElement>(null);
  const [downloadError, setDownloadError] = useState("");
  function downloadCsv() {
    let url: string | undefined;
    const link = document.createElement("a");
    try {
      setDownloadError("");
      const csv = createMonthlyReportCsv(report, rtIdentity, month);
      url = URL.createObjectURL(new Blob([csv.content], { type: "text/csv;charset=utf-8" }));
      link.href = url;
      link.download = csv.filename;
      document.body.appendChild(link);
      link.click();
    } catch {
      setDownloadError("CSV belum dapat diunduh. Silakan coba lagi.");
    } finally {
      link.remove();
      if (url) {
        const downloadUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
      }
    }
  }
  useEffect(() => {
    function stampPrintTime() {
      if (!printedAt.current) return;
      const now = new Date();
      printedAt.current.dateTime = now.toISOString();
      printedAt.current.textContent = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short",
      }).format(now) + " WIB";
    }
    window.addEventListener("beforeprint", stampPrintTime);
    return () => window.removeEventListener("beforeprint", stampPrintTime);
  }, []);

  const totals = report.monthly.find((item) => item.month === month);
  if (!totals) return null;
  const arrears = report.arrears.households.flatMap((household) => household.periods
    .filter((period) => period.month === month)
    .map((period) => ({ household, period })));

  return (
    <section className="monthly-report-print chairman-report-panel" aria-labelledby="monthly-print-title">
      <div className="monthly-report-controls">
        <label htmlFor="monthly-print-month">Bulan laporan
          <select id="monthly-print-month" value={month} onChange={(event) => onMonthChange(Number(event.target.value))}>
            {months.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}
          </select>
        </label>
        <button className="button button--secondary" type="button" onClick={() => window.print()}>
          <Printer size={18} aria-hidden="true" /> Cetak / Simpan PDF
        </button>
        <button className="button button--secondary" type="button" onClick={downloadCsv}>
          <Download size={18} aria-hidden="true" /> Unduh CSV
        </button>
        {downloadError && <p role="alert">{downloadError}</p>}
      </div>
      <h2 id="monthly-print-title">Laporan Iuran Bulanan</h2>
      <p><strong>{rtIdentity}</strong><br />Periode tagihan: {months[month - 1]} {report.year}</p>
      <p className="monthly-report-note">Posisi data per {report.asOf.businessDate}. Pembayaran dikelompokkan menurut bulan tagihan, bukan tanggal uang diterima. Laporan ini bukan buku kas atau posisi penutupan bulan historis.</p>
      <table className="monthly-report-table">
        <caption>Ringkasan {months[month - 1]} {report.year}</caption>
        <tbody>
          <tr><th scope="row">Target awal</th><td>{rupiah(totals.target)}</td></tr>
          <tr><th scope="row">Target setelah penyesuaian</th><td>{rupiah(totals.effectiveTarget)}</td></tr>
          <tr><th scope="row">Saldo awal impor</th><td>{rupiah(totals.openingBalanceReceived)}</td></tr>
          <tr><th scope="row">Pembayaran transfer terverifikasi</th><td>{rupiah(totals.transferReceived)}</td></tr>
          <tr><th scope="row">Pembayaran tunai</th><td>{rupiah(totals.cashReceived)}</td></tr>
          <tr><th scope="row">Total pembayaran terverifikasi</th><td>{rupiah(totals.received)}</td></tr>
          <tr><th scope="row">Pemutihan / dibebaskan</th><td>{rupiah(totals.waived)}</td></tr>
          <tr><th scope="row">Sisa kewajiban</th><td>{rupiah(totals.outstanding)}</td></tr>
        </tbody>
      </table>
      <p className="monthly-report-note">Saldo awal impor + pembayaran terverifikasi + pemutihan + sisa kewajiban = target setelah penyesuaian. Saldo awal dan pemutihan tidak dihitung sebagai pembayaran baru.</p>
      <h3>Tunggakan periode {months[month - 1]} {report.year}</h3>
      {arrears.length === 0 ? <p>Tidak ada tunggakan yang sudah melewati jatuh tempo untuk periode ini.</p> : (
        <table className="monthly-report-table">
          <thead><tr><th scope="col">Rumah / warga</th><th scope="col">Sisa tunggakan</th></tr></thead>
          <tbody>{arrears.map(({ household, period }, index) => (
            <tr key={`${household.houseNumber}-${household.startsOn}-${index}`}>
              <td>Rumah {household.houseNumber}{household.lifecycle === "historical" ? " (riwayat)" : ""}<br />{household.residentNames.join(", ") || "Nama warga tidak tercatat"}{period.pending ? <><br />Menunggu konfirmasi pembayaran</> : null}</td>
              <td>{rupiah(period.outstanding)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><th scope="row">Total tunggakan periode ini</th><td>{rupiah(arrears.reduce((sum, item) => sum + item.period.outstanding, 0))}</td></tr></tfoot>
        </table>
      )}
      <p className="monthly-report-note">Tagihan yang belum jatuh tempo tidak masuk daftar tunggakan. Pembayaran yang dibatalkan tidak dihitung sebagai penerimaan.</p>
      <p className="monthly-report-timestamp">Dicetak: <time ref={printedAt}>diisi saat mencetak</time></p>
    </section>
  );
}
