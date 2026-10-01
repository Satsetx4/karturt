"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useTreasurerResolutionCoordinator } from "@/components/treasurer-resolution-coordinator";

type VerifyResponse = {
  code?: string;
  message?: string;
};

export function TreasurerVerificationButton({ requestCode }: { requestCode: string }) {
  const coordinator = useTreasurerResolutionCoordinator();
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  async function verify() {
    if (inFlight.current || complete || coordinator.completedBy !== null || !coordinator.begin("verify")) return;
    inFlight.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/treasurer/payment-requests/${encodeURIComponent(requestCode)}/verify`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({})) as VerifyResponse;
      if (response.status === 401) {
        setSessionExpired(true);
        setMessage("Sesi berakhir. Silakan masuk kembali.");
        return;
      }
      if (response.status === 409 && data.code === "already_processed") {
        setComplete(true);
        coordinator.markComplete("verify");
        setMessage("Permintaan ini sudah diproses. Antrean akan menampilkan status terbaru.");
        return;
      }
      if (!response.ok) {
        setMessage(data.message ?? "Pembayaran belum dapat dikonfirmasi. Periksa antrean lalu coba lagi.");
        return;
      }
      setComplete(true);
      coordinator.markComplete("verify");
      setMessage("Pembayaran berhasil dikonfirmasi. Status iuran warga sudah diperbarui.");
    } catch {
      setMessage("Sambungan terputus. Muat ulang rincian untuk memeriksa status terbaru.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
      coordinator.end("verify");
    }
  }

  if (coordinator.completedBy === "reject") return null;

  return (
    <div className="treasurer-verify-actions">
      {message && (
        <div className={complete ? "treasurer-feedback treasurer-feedback--success" : "treasurer-feedback"} role={complete ? "status" : "alert"}>
          <p>{message}</p>
          {sessionExpired && <Link className="button button--primary" href="/login/pengurus">Masuk kembali</Link>}
          {complete && <Link className="button button--primary" href="/app">Kembali ke antrean</Link>}
        </div>
      )}
      {!complete && coordinator.completedBy === null && (
        <button className="button button--primary treasurer-confirm-button" type="button" disabled={submitting || coordinator.activeAction !== null} onClick={() => void verify()}>
          {submitting ? "Memproses…" : "Konfirmasi pembayaran"}
        </button>
      )}
    </div>
  );
}
