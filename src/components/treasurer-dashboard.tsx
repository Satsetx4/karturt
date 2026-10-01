import Link from "next/link";
import { ArrowRight, Banknote, Clock3, Home, ReceiptText } from "lucide-react";
import type { TreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-requests";

const rupiah = (amount: number) => new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
}).format(amount);

const requestDate = (value: Date) => new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
}).format(value);

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function periodName(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

export function TreasurerDashboard({ requests }: { requests: TreasurerPaymentRequest[] }) {
  return (
    <section className="treasurer-area" aria-labelledby="treasurer-title">
      <div className="treasurer-heading">
        <p className="eyebrow">RUANG BENDAHARA</p>
        <h1 id="treasurer-title">Antrean pembayaran</h1>
        <p>Periksa permintaan warga dan konfirmasi setelah transfer diterima.</p>
      </div>

      <section className="cash-entry-card" aria-labelledby="cash-entry-title">
        <div className="cash-entry-icon"><Banknote size={22} aria-hidden="true" /></div>
        <div className="cash-entry-copy">
          <h2 id="cash-entry-title">Pembayaran langsung</h2>
          <p>Catat uang tunai yang diterima Bendahara untuk satu atau beberapa bulan.</p>
        </div>
        <Link className="cash-entry-link" href="/app/bendahara/tunai">
          Catat pembayaran tunai <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>

      <div className="treasurer-queue-heading">
        <h2>Menunggu konfirmasi</h2>
        <span className="treasurer-count" aria-label={`${requests.length} permintaan menunggu`}>
          {requests.length}
        </span>
      </div>

      {requests.length === 0 ? (
        <div className="treasurer-empty" role="status">
          <ReceiptText size={26} aria-hidden="true" />
          <p>Tidak ada permintaan pembayaran yang menunggu.</p>
        </div>
      ) : (
        <ol className="treasurer-queue">
          {requests.map((request) => (
            <li key={request.requestCode}>
              <Link className="treasurer-request-card" href={`/app/bendahara/${request.requestCode}`}>
                <div className="treasurer-request-topline">
                  <span className="treasurer-request-code">{request.requestCode}</span>
                  <span className="treasurer-pending-label"><Clock3 size={16} aria-hidden="true" /> Menunggu</span>
                </div>
                <h3>{request.residentName}</h3>
                <p className="treasurer-house"><Home size={17} aria-hidden="true" /> Rumah {request.houseNumber}</p>
                <div className="treasurer-request-meta">
                  <span>Diajukan</span>
                  <time dateTime={request.createdAt.toISOString()}>{requestDate(request.createdAt)}</time>
                </div>
                <div className="treasurer-request-periods">
                  <span>{request.items.length} bulan</span>
                  <strong>{request.items.map((item) => periodName(item.period)).join(", ")}</strong>
                </div>
                <div className="treasurer-request-total">
                  <span>Total</span>
                  <strong>{rupiah(request.totalAmount)}</strong>
                </div>
                <span className="treasurer-open-link">Lihat rincian <ArrowRight size={18} aria-hidden="true" /></span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
