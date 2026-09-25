import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, House, ShieldCheck, UsersRound } from "lucide-react";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Administrasi iuran RT yang lebih jelas",
  description: "KartuRT membantu warga dan pengurus melihat administrasi iuran RT dengan alur yang mudah dipahami.",
  alternates: { canonical: "/" },
};

const entryPoints = [
  { href: "/login/warga", icon: House, title: "Saya warga", description: "Lihat kartu iuran dan informasi akun warga." },
  { href: "/login/pengurus", icon: UsersRound, title: "Saya pengurus", description: "Masuk dengan akun Bendahara atau Ketua RT." },
];

export default function Home() {
  return (
    <main className="page-shell home-shell">
      <header className="topbar">
        <Brand />
        <span className="topbar-note"><span className="live-dot" />Ruang administrasi warga</span>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <p className="eyebrow"><ShieldCheck size={16} aria-hidden="true" />JELAS UNTUK WARGA, TERTATA UNTUK PENGURUS</p>
          <h1 id="home-title">Iuran RT, <span>tercatat rapi.</span></h1>
          <p className="hero-description">Satu tempat untuk melihat informasi iuran dan mengelola administrasi lingkungan dengan lebih mudah.</p>
          <div className="hero-rule"><span />Data akun dikelola oleh pengurus RT</div>
        </div>

        <div className="entry-panel">
          <div className="entry-panel-head">
            <div>
              <span className="step-label">MULAI DARI SINI</span>
              <h2>Pilih jenis akun</h2>
            </div>
            <span className="entry-count">01 <span>/ 02</span></span>
          </div>
          <div className="entry-list">
            {entryPoints.map(({ href, icon: Icon, title, description }, index) => (
              <Link className="entry-link" href={href} key={href} style={{ animationDelay: `${index * 90}ms` }}>
                <span className="entry-icon"><Icon size={21} aria-hidden="true" /></span>
                <span className="entry-text"><strong>{title}</strong><span>{description}</span></span>
                <ArrowUpRight className="entry-arrow" size={19} aria-hidden="true" />
              </Link>
            ))}
          </div>
          <p className="entry-help">Belum mendapat akses? Hubungi pengurus di lingkungan Anda.</p>
        </div>
      </section>

      <section className="home-note" aria-label="Prinsip akun KartuRT">
        <div><span className="note-number">01</span><p><strong>Informasi terpisah</strong><br />Setiap akun hanya melihat ruang sesuai tugasnya.</p></div>
        <div><span className="note-number">02</span><p><strong>Riwayat tetap tertata</strong><br />Perubahan penting dirancang agar dapat ditelusuri.</p></div>
        <div><span className="note-number">03</span><p><strong>Nyaman di ponsel</strong><br />Tombol dan tulisan dibuat mudah dijangkau dan dibaca.</p></div>
      </section>

      <SiteFooter />
    </main>
  );
}
