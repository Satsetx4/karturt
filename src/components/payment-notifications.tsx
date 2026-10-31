"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PaymentNotificationFeed } from "@/lib/billing/payment-notifications";

const labels = { pending: "Menunggu konfirmasi Anda", verified: "Pembayaran telah diverifikasi", rejected: "Pengajuan ditolak", reversed: "Pembayaran dibatalkan; periksa kembali iuran" };
const formatTime = (value: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));

export function PaymentNotifications({ accountId, role }: { accountId: string; role: "resident" | "treasurer" }) {
  const [feed, setFeed] = useState<PaymentNotificationFeed | null>(null);
  const [state, setState] = useState("loading");
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let expired = false;
    const clear = (next: string) => { setFeed(null); setState(next); };
    async function load() {
      if (disposed || expired) return;
      if (!navigator.onLine) { controller?.abort(); controller = null; clear("offline"); return; }
      if (document.visibilityState !== "visible" || controller) return;
      const current = new AbortController();
      controller = current;
      const timeout = window.setTimeout(() => {
        if (!disposed && controller === current) {
          current.abort(); controller = null; clear("error");
        }
      }, 10000);
      try {
        const response = await fetch("/api/notifications", { cache: "no-store", signal: current.signal });
        if (disposed || current.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { expired = true; clear("expired"); return; }
        if (!response.ok) throw new Error("unavailable");
        const data: PaymentNotificationFeed = await response.json();
        if (disposed || current.signal.aborted) return;
        if (data.viewerAccountId !== accountId || data.role !== role) { expired = true; clear("expired"); return; }
        setFeed(data); setState("ready");
      } catch {
        if (!disposed && !current.signal.aborted) clear("error");
      } finally { window.clearTimeout(timeout); if (controller === current) controller = null; }
    }
    const visibility = () => {
      if (document.visibilityState !== "visible") { controller?.abort(); controller = null; clear("loading"); }
      else void load();
    };
    refresh.current = () => { void load(); };
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    window.addEventListener("online", refresh.current);
    window.addEventListener("offline", refresh.current);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true; controller?.abort(); window.clearInterval(timer);
      window.removeEventListener("online", refresh.current); window.removeEventListener("offline", refresh.current);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [accountId, role]);
  return <section className="app-card payment-notifications" aria-labelledby="payment-notifications-title">
    <h2 id="payment-notifications-title">Pemberitahuan pembayaran</h2>
    <p>Status terbaru saat aplikasi terbuka. Diperbarui setiap 30 detik selama tersambung.</p>
    {state === "loading" && <p role="status">Memuat pemberitahuan…</p>}
    {state === "offline" && <p role="status">Anda sedang offline. Sambungkan internet untuk memeriksa status terbaru.</p>}
    {state === "error" && <p role="alert">Status belum dapat diperbarui. Coba muat ulang.</p>}
    {state === "expired" ? <a className="button" href={role === "resident" ? "/login/warga" : "/login/pengurus"}>Masuk kembali</a>
      : <button type="button" className="button button--secondary" onClick={() => refresh.current()} disabled={state === "offline"}>Muat ulang</button>}
    {feed && <>
      <p>Terakhir diperiksa: {formatTime(feed.checkedAt)} WIB.</p>
      {feed.items.length === 0 ? <p>{role === "treasurer" ? "Tidak ada pengajuan menunggu konfirmasi." : "Belum ada hasil pengajuan pembayaran."}</p> : <ul>
        {feed.items.map((item) => <li key={item.requestCode}>
          <strong>{labels[item.status]}</strong><br />
          <span>{item.requestCode} · {formatTime(item.occurredAt)} WIB</span>
          {role === "treasurer" && <Link className="button button--secondary" href={`/app/bendahara/${encodeURIComponent(item.requestCode)}`}>Periksa pengajuan</Link>}
        </li>)}
      </ul>}
      {feed.hasMore && <p>Menampilkan 20 terbaru. Periksa daftar pengajuan atau riwayat iuran untuk rincian lainnya.</p>}
      {role === "resident" && <p>Rincian pengajuan tersedia pada kartu dan riwayat iuran di bawah.</p>}
    </>}
  </section>;
}
