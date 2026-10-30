"use client";

import Link from "next/link";

export default function ActivityError({ reset }: { reset: () => void }) {
  return <main className="page-shell"><section className="app-card">
    <h1>Aktivitas belum dapat dimuat</h1>
    <p>Silakan coba kembali atau buka ruang akun.</p>
    <div className="app-card-actions"><button className="button button--primary" onClick={reset}>Coba kembali</button><Link className="button button--secondary" href="/app">Kembali ke ruang akun</Link></div>
  </section></main>;
}
