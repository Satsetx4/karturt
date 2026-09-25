"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";

export function TwoFactorChallenge() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const normalizedCode = code.replace(/\s/g, "");
    const result = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code: normalizedCode })
      : await authClient.twoFactor.verifyTotp({ code: normalizedCode, trustDevice: false });
    if (result.error) {
      setError("Kode belum cocok atau sudah kedaluwarsa. Coba kode terbaru dari aplikasi autentikator.");
      setBusy(false);
      return;
    }
    router.replace("/app");
  }

  return (
    <main className="page-shell login-shell">
      <header className="topbar"><Brand compact /><Link className="back-link" href="/system/login"><ArrowLeft size={17} />Kembali</Link></header>
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/">Beranda</Link><span>/</span><Link href="/system/login">System Admin</Link><span>/</span><span>Verifikasi</span></nav>
      <section className="mfa-card" aria-labelledby="mfa-title">
        <span className="mfa-symbol"><ShieldCheck size={24} aria-hidden="true" /></span>
        <p className="eyebrow">LAPIS KEAMANAN TAMBAHAN</p>
        <h1 id="mfa-title">Verifikasi dua langkah</h1>
        <p>Masukkan kode dari aplikasi autentikator untuk melanjutkan ke konsol sistem.</p>
        <form className="login-form" onSubmit={submit}>
          <label className="field-label" htmlFor="totp-code">{useBackupCode ? "Kode pemulihan" : "Kode verifikasi"}</label>
          <input className="form-input code-input" id="totp-code" name="code" inputMode={useBackupCode ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useBackupCode ? 24 : 8} value={code} onChange={(event) => setCode(event.target.value)} placeholder={useBackupCode ? "Masukkan kode pemulihan" : "6 digit"} required />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button--primary login-submit" type="submit" disabled={busy || code.trim().length < 6}>
            {busy ? <LoaderCircle className="spinner" size={18} /> : <><KeyRound size={17} /><span>Verifikasi dan lanjutkan</span></>}
          </button>
        </form>
        <button className="text-button recovery-toggle" type="button" onClick={() => { setUseBackupCode(!useBackupCode); setCode(""); setError(""); }}>
          {useBackupCode ? "Gunakan kode dari autentikator" : "Gunakan kode pemulihan"}
        </button>
        <p className="help-line">Jika kode tidak tersedia, gunakan proses pemulihan System Admin yang terdokumentasi.</p>
      </section>
      <SiteFooter />
    </main>
  );
}
