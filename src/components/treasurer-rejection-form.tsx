"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

type RejectResponse = { code?: string; message?: string };

export function TreasurerRejectionForm({ requestCode }: { requestCode: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  async function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (inFlight.current || !trimmedReason || trimmedReason.length > 500) return;
    inFlight.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/treasurer/payment-requests/${encodeURIComponent(requestCode)}/reject`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: trimmedReason }),
      });
      const data = await response.json().catch(() => ({})) as RejectResponse;
      if (response.status === 401) {
        setSessionExpired(true);
        setMessage("Sesi berakhir. Silakan masuk kembali.");
        return;
      }
      if (response.status === 409 && data.code === "already_processed") {
        setComplete(true);
        setMessage("Permintaan ini sudah diproses. Rincian terbaru sedang dimuat.");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setMessage(data.message ?? "Permintaan belum dapat ditolak. Muat ulang rincian lalu coba lagi.");
        return;
      }
      setComplete(true);
      setMessage(data.message ?? "Permintaan ditolak. Warga dapat mengajukan ulang bulan tersebut.");
      router.refresh();
    } catch {
      setMessage("Sambungan terputus. Muat ulang rincian untuk memeriksa status terbaru.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="treasurer-reject-form" onSubmit={(event) => void reject(event)}>
      {message && (
        <div className={complete ? "treasurer-feedback treasurer-feedback--success" : "treasurer-feedback"} role={complete ? "status" : "alert"}>
          <p>{message}</p>
          {sessionExpired && <Link className="button button--primary" href="/login/pengurus">Masuk kembali</Link>}
          {complete && <Link className="button button--primary" href="/app">Kembali ke antrean</Link>}
        </div>
      )}
      {!complete && (
        <>
          <label htmlFor="payment-request-rejection-reason">Alasan penolakan</label>
          <textarea
            id="payment-request-rejection-reason"
            name="reason"
            value={reason}
            maxLength={500}
            required
            rows={3}
            aria-describedby="payment-request-rejection-help"
            onChange={(event) => setReason(event.target.value)}
          />
          <p id="payment-request-rejection-help">Contoh: Bukti transfer belum terbaca. Warga dapat mengajukan ulang setelah permintaan ini ditolak.</p>
          <button className="button button--secondary treasurer-reject-button" type="submit" disabled={submitting || !reason.trim()}>
            {submitting ? "Memproses…" : "Tolak permintaan"}
          </button>
        </>
      )}
    </form>
  );
}
