"use client";
import Link from "next/link";
export default function OfficialsError({ reset }: { reset: () => void }) {
  return <section className="page-shell app-card"><h1>Daftar pengurus belum dapat dimuat</h1><p>Periksa koneksi lalu coba lagi.</p><button className="button button--primary" onClick={reset}>Coba lagi</button><Link className="text-button" href="/app">Kembali ke ruang akun</Link></section>;
}
