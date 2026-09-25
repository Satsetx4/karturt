"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Brand } from "@/components/brand";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ event: "application.error", digest: error.digest ?? "unavailable" }));
  }, [error]);

  return (
    <main className="page-shell">
      <header className="topbar"><Brand compact /></header>
      <section className="not-found-card">
        <span className="not-found-number">KARTURT SEDANG TERGANGGU</span>
        <h1>Halaman belum dapat dibuka.</h1>
        <p>Coba muat ulang. Jika masalah berlanjut, hubungi pengurus RT.</p>
        <div className="app-card-actions" style={{ justifyContent: "center" }}>
          <button className="button button--primary" type="button" onClick={reset}><RefreshCw size={17} />Coba lagi</button>
          <Link className="button" href="/">Beranda</Link>
        </div>
      </section>
    </main>
  );
}
