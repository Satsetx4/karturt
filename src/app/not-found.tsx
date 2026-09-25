import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";

export default function NotFound() {
  return (
    <main className="page-shell">
      <header className="topbar"><Brand compact /></header>
      <section className="not-found-card">
        <span className="not-found-number">HALAMAN TIDAK DITEMUKAN</span>
        <h1>Sepertinya jalurnya berbeda.</h1>
        <p>Halaman ini tidak tersedia atau alamatnya sudah berubah.</p>
        <Link className="button button--primary" href="/"><ArrowLeft size={17} />Kembali ke beranda</Link>
      </section>
      <SiteFooter />
    </main>
  );
}
