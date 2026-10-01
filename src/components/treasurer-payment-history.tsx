"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Banknote, CircleCheck, Home, ReceiptText, RotateCcw } from "lucide-react";

type PaymentHistoryItem = {
  paymentId: string;
  residentName: string | null;
  houseNumber: string;
  method: "transfer" | "cash";
  periods: string[];
  totalAmount: number;
  paidAt: string | Date;
  requestCode: string | null;
  lifecycle: "active" | "reversed";
  reversedAt: string | Date | null;
  reversalReason: string | null;
};

type PaymentHistoryPage = { transactions: PaymentHistoryItem[]; nextCursor: string | null };

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const rupiah = (amount: number) => new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
}).format(amount);

function periodName(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

function dateLabel(value: string | Date) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function PaymentHistoryCard({
  payment,
  onReversed,
}: {
  payment: PaymentHistoryItem;
  onReversed: (paymentId: string, reversedAt: string, reason: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const reversed = payment.lifecycle === "reversed";

  async function reversePayment() {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setMessage("Tuliskan alasan pembatalan terlebih dahulu.");
      return;
    }
    if (normalizedReason.length > 500) {
      setMessage("Alasan pembatalan maksimal 500 karakter.");
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/treasurer/payments/${encodeURIComponent(payment.paymentId)}/reverse`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: normalizedReason }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; reversedAt?: string };
      if (!response.ok) {
        setMessage(result.message ?? "Pembayaran belum dapat dibatalkan. Silakan coba lagi.");
        return;
      }
      onReversed(payment.paymentId, result.reversedAt ?? new Date().toISOString(), normalizedReason);
      setEditing(false);
      setReason("");
      setMessage("Pencatatan dibatalkan. Histori pembayaran tetap tersimpan.");
    } catch {
      setMessage("Sambungan terputus. Muat ulang riwayat sebelum mencoba lagi.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <li className={`payment-history-card${reversed ? " payment-history-card--reversed" : ""}`}>
      <div className="payment-history-card__topline">
        <span className={`payment-history-status${reversed ? " payment-history-status--reversed" : ""}`}>
          {reversed ? <RotateCcw size={16} aria-hidden="true" /> : <CircleCheck size={16} aria-hidden="true" />}
          {reversed ? "Dibatalkan" : "Aktif"}
        </span>
        <time dateTime={new Date(payment.paidAt).toISOString()}>{dateLabel(payment.paidAt)}</time>
      </div>
      <div className="payment-history-identity">
        <h3>{payment.residentName ?? "Nama warga tidak tersedia"}</h3>
        <p><Home size={16} aria-hidden="true" /> Rumah {payment.houseNumber}</p>
      </div>
      <div className="payment-history-details">
        <p><span>Metode</span><strong>{payment.method === "cash" ? "Tunai" : "Transfer"}</strong></p>
        <p><span>Bulan</span><strong>{payment.periods.map(periodName).join(", ")}</strong></p>
        <p><span>Total</span><strong>{rupiah(payment.totalAmount)}</strong></p>
      </div>
      {payment.requestCode && <p className="payment-history-request-code">Permintaan {payment.requestCode}</p>}

      {reversed ? (
        <div className="payment-history-reversal">
          <time dateTime={payment.reversedAt ? new Date(payment.reversedAt).toISOString() : undefined}>
            Dibatalkan {payment.reversedAt ? dateLabel(payment.reversedAt) : ""}
          </time>
          {payment.reversalReason && <p><strong>Alasan:</strong> {payment.reversalReason}</p>}
        </div>
      ) : (
        <div className="payment-history-actions">
          {!editing ? (
            <button className="button button--danger" type="button" onClick={() => { setMessage(""); setEditing(true); }}>
              Batalkan pencatatan pembayaran
            </button>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); void reversePayment(); }}>
              <p className="payment-history-confirmation">
                Histori pembayaran tetap tersimpan. {payment.periods.length === 1 ? "Bulan ini kembali" : "Bulan-bulan ini kembali"} menjadi <strong>Belum bayar</strong> sampai dibayar lagi.
              </p>
              <label htmlFor={`reversal-reason-${payment.paymentId}`}>Alasan pembatalan</label>
              <textarea
                id={`reversal-reason-${payment.paymentId}`}
                value={reason}
                maxLength={500}
                required
                rows={3}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Contoh: pencatatan pembayaran ganda"
                disabled={submitting}
              />
              <div className="payment-history-form-actions">
                <button className="button button--danger" type="submit" disabled={submitting || !reason.trim()}>
                  {submitting ? "Membatalkan…" : "Konfirmasi pembatalan"}
                </button>
                <button className="text-button" type="button" disabled={submitting} onClick={() => setEditing(false)}>
                  Kembali
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {message && <p className="payment-history-feedback" role="status">{message}</p>}
    </li>
  );
}

export function TreasurerPaymentHistory({ initialPage }: { initialPage: PaymentHistoryPage }) {
  const [transactions, setTransactions] = useState(initialPage.transactions);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError("");
    try {
      const url = new URL("/api/treasurer/payments", window.location.origin);
      url.searchParams.set("cursor", nextCursor);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("load");
      const page = await response.json() as PaymentHistoryPage;
      setTransactions((current) => [...current, ...page.transactions]);
      setNextCursor(page.nextCursor);
    } catch {
      setLoadError("Riwayat berikutnya belum dapat dimuat.");
    } finally {
      setLoadingMore(false);
    }
  }

  function markReversed(paymentId: string, reversedAt: string, reason: string) {
    setTransactions((current) => current.map((payment) => payment.paymentId === paymentId
      ? { ...payment, lifecycle: "reversed", reversedAt, reversalReason: reason }
      : payment));
  }

  return (
    <section className="treasurer-area payment-history-page" aria-labelledby="payment-history-title">
      <Link className="payment-history-back" href="/app"><ArrowLeft size={18} aria-hidden="true" /> Kembali ke Bendahara</Link>
      <div className="treasurer-heading">
        <p className="eyebrow">RUANG BENDAHARA</p>
        <h1 id="payment-history-title">Riwayat transaksi</h1>
        <p>Setiap pembayaran tetap tersimpan di riwayat, termasuk pencatatan yang dibatalkan.</p>
      </div>
      {transactions.length === 0 ? (
        <div className="treasurer-empty" role="status">
          <ReceiptText size={26} aria-hidden="true" />
          <p>Belum ada pembayaran yang tercatat.</p>
          <Link className="button button--secondary" href="/app/bendahara/tunai"><Banknote size={18} aria-hidden="true" /> Catat pembayaran tunai</Link>
        </div>
      ) : (
        <ol className="payment-history-list">
          {transactions.map((payment) => <PaymentHistoryCard key={payment.paymentId} payment={payment} onReversed={markReversed} />)}
        </ol>
      )}
      {loadError && <p className="payment-history-feedback" role="alert">{loadError}</p>}
      {nextCursor && (
        <button className="button button--secondary payment-history-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? "Memuat…" : "Transaksi sebelumnya"} <ArrowRight size={18} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
