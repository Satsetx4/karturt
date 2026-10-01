"use client";

import { useEffect, useState } from "react";
import { Banknote, CircleCheck, Clock3, RotateCcw } from "lucide-react";

type ResidentPayment = {
  method: "transfer" | "cash";
  periods: string[];
  totalAmount: number;
  paidAt: string;
  requestCode: string | null;
  lifecycle: "active" | "reversed";
  reversedAt: string | null;
};

type HistoryPage = { payments: ResidentPayment[]; nextPage: number | null };

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

function paymentDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

export function ResidentPaymentHistory() {
  const [payments, setPayments] = useState<ResidentPayment[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  async function loadPage(page: number, append = false) {
    if (append) setLoadingMore(true);
    else setState("loading");
    setError("");
    try {
      const url = new URL("/api/resident/payment-history", window.location.origin);
      url.searchParams.set("page", String(page));
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("load");
      const result = await response.json() as HistoryPage;
      setPayments((current) => append ? [...current, ...result.payments] : result.payments);
      setNextPage(result.nextPage);
      setState("ready");
    } catch {
      setError("Riwayat pembayaran belum dapat dimuat.");
      setState((current) => append ? current : "error");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function loadInitialPage() {
      try {
        const response = await fetch("/api/resident/payment-history?page=1", { cache: "no-store" });
        if (!response.ok) throw new Error("load");
        const result = await response.json() as HistoryPage;
        if (!active) return;
        setPayments(result.payments);
        setNextPage(result.nextPage);
        setState("ready");
      } catch {
        if (!active) return;
        setError("Riwayat pembayaran belum dapat dimuat.");
        setState("error");
      }
    }
    void loadInitialPage();
    return () => { active = false; };
  }, []);

  return (
    <section className="resident-payment-history" aria-labelledby="resident-payment-history-title">
      <h3 id="resident-payment-history-title">Riwayat pembayaran</h3>
      {state === "loading" ? (
        <p role="status">Memuat riwayat pembayaran…</p>
      ) : state === "error" ? (
        <div role="alert">
          <p>{error}</p>
          <button className="button button--secondary" type="button" onClick={() => void loadPage(1)}>Coba lagi</button>
        </div>
      ) : payments.length === 0 ? (
        <p>Belum ada pembayaran yang tercatat.</p>
      ) : (
        <ol className="resident-payment-history-list">
          {payments.map((payment, index) => {
            const reversed = payment.lifecycle === "reversed";
            return (
              <li key={`${payment.paidAt}-${payment.requestCode ?? payment.method}-${index}`}>
                <div className="resident-payment-history-topline">
                  <strong className={reversed ? "resident-payment-reversed-label" : "resident-payment-active-label"}>
                    {reversed ? <RotateCcw size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}
                    {reversed ? "Pembayaran dibatalkan" : "Pembayaran tercatat"}
                  </strong>
                  <time dateTime={payment.paidAt}>{paymentDate(payment.paidAt)}</time>
                </div>
                <p>{payment.periods.map(periodName).join(", ")}</p>
                <div className="resident-payment-history-total">
                  <span>{payment.method === "cash" ? <><Banknote size={15} aria-hidden="true" /> Tunai</> : <><Clock3 size={15} aria-hidden="true" /> Transfer</>}</span>
                  <strong>{rupiah(payment.totalAmount)}</strong>
                </div>
                {payment.requestCode && <span className="resident-payment-request-code">Permintaan {payment.requestCode}</span>}
                {reversed && payment.reversedAt && (
                  <time className="resident-payment-reversed-time" dateTime={payment.reversedAt}>
                    Dibatalkan {paymentDate(payment.reversedAt)}
                  </time>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {error && state === "ready" && <p role="alert">{error}</p>}
      {nextPage && (
        <button className="button button--secondary resident-payment-history-more" type="button" disabled={loadingMore} onClick={() => void loadPage(nextPage, true)}>
          {loadingMore ? "Memuat…" : "Pembayaran sebelumnya"}
        </button>
      )}
    </section>
  );
}
