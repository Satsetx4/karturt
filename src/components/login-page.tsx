import Link from "next/link";
import { ArrowLeft, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { LoginForm, type LoginKind } from "@/components/login-form";
import { SiteFooter } from "@/components/site-footer";

const details: Record<LoginKind, { title: string; eyebrow: string; description: string; icon: typeof CheckCircle2 }> = {
  resident: {
    title: "Masuk ke kartu iuran",
    eyebrow: "Untuk warga",
    description: "Gunakan nomor rumah dan PIN yang diberikan pengurus RT.",
    icon: CheckCircle2,
  },
  official: {
    title: "Ruang pengurus",
    eyebrow: "Untuk bendahara dan Ketua RT",
    description: "Akun pengurus terpisah dari akun warga untuk menjaga batas tugas.",
    icon: ShieldCheck,
  },
  system_admin: {
    title: "Pemulihan sistem",
    eyebrow: "Konsol System Admin",
    description: "Akses ini khusus pemulihan teknis dan dilindungi verifikasi dua langkah.",
    icon: LockKeyhole,
  },
};

export function LoginPage({ kind }: { kind: LoginKind }) {
  const item = details[kind];
  const Icon = item.icon;

  return (
    <main className="page-shell login-shell">
      <header className="topbar">
        <Brand compact />
        <Link className="back-link" href="/">
          <ArrowLeft size={17} aria-hidden="true" /> Beranda
        </Link>
      </header>

      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Beranda</Link><span aria-hidden="true">/</span><span>{item.eyebrow}</span>
      </nav>

      <section className="login-grid" aria-labelledby="login-title">
        <div className="login-intro">
          <p className="eyebrow"><Icon size={16} aria-hidden="true" />{item.eyebrow}</p>
          <h1 id="login-title">{item.title}</h1>
          <p className="intro-copy">{item.description}</p>
          <div className="trust-note">
            <span className="trust-dot" aria-hidden="true" />
            <span>Masuk aman dengan sesi pribadi</span>
          </div>
        </div>

        <div className="login-card">
          <div className="login-card-heading">
            <div>
              <span className="step-label">AKUN KARTURT</span>
              <h2>Silakan masuk</h2>
            </div>
            <span className="card-seal" aria-hidden="true"><LockKeyhole size={18} /></span>
          </div>
          <LoginForm kind={kind} />
          {kind === "resident" && <p className="help-line">Lupa PIN? Hubungi pengurus RT untuk bantuan.</p>}
          {kind === "official" && <p className="help-line">Akun pengurus dibuat terpisah oleh Ketua RT.</p>}
          {kind === "system_admin" && <p className="help-line">System Admin tidak dapat memverifikasi atau mencatat pembayaran.</p>}
        </div>
      </section>

      {kind !== "system_admin" && (
        <div className="alternate-login">
          {kind === "resident" ? (
            <p>Pengurus RT? <Link href="/login/pengurus">Masuk lewat akun pengurus <span aria-hidden="true">→</span></Link></p>
          ) : (
            <p>Warga? <Link href="/login/warga">Kembali ke masuk warga <span aria-hidden="true">→</span></Link></p>
          )}
        </div>
      )}

      <SiteFooter />
    </main>
  );
}
