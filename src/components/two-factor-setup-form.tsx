"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth/client";

export function TwoFactorSetupForm() {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  async function startEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await authClient.twoFactor.enable({ password, method: "totp", issuer: "KartuRT" });
    if (result.error || !result.data || result.data.method !== "totp") {
      setError("Penyiapan belum berhasil. Pastikan kata sandi akun benar, lalu coba lagi.");
      setBusy(false);
      return;
    }
    setTotpUri(result.data.totpURI);
    setBackupCodes(result.data.backupCodes);
    setBusy(false);
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice: false });
    if (result.error) {
      setError("Kode belum cocok. Periksa waktu perangkat dan coba kode terbaru.");
      setBusy(false);
      return;
    }
    setComplete(true);
    setBusy(false);
  }

  if (complete) {
    return (
      <div className="security-card">
        <span className="mfa-symbol"><Check size={24} aria-hidden="true" /></span>
        <p className="eyebrow">PENYIAPAN SELESAI</p>
        <h1>Verifikasi dua langkah aktif</h1>
        <p>Simpan kode pemulihan ini di tempat aman. Kode hanya ditampilkan pada sesi ini.</p>
        <div className="backup-codes" aria-label="Kode pemulihan">{backupCodes.join("  ·  ")}</div>
        <Link className="button button--primary login-submit" href="/app">Lanjutkan ke ruang akun <ArrowLeft size={17} className="arrow-forward" /></Link>
      </div>
    );
  }

  return (
    <div className="security-card">
      <span className="mfa-symbol"><ShieldCheck size={24} aria-hidden="true" /></span>
      <p className="eyebrow">WAJIB UNTUK SYSTEM ADMIN</p>
      <h1>Aktifkan verifikasi dua langkah</h1>
      <p>Akun System Admin tidak mendapat akses sistem sebelum verifikasi ini aktif.</p>
      {!totpUri ? (
        <form className="login-form security-form" onSubmit={startEnrollment}>
          <label className="field-label" htmlFor="admin-password">Kata sandi akun</label>
          <input className="form-input" id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button--primary login-submit" type="submit" disabled={busy || password.length < 6}>
            {busy ? <LoaderCircle className="spinner" size={18} /> : <><span>Siapkan autentikator</span><ArrowLeft className="arrow-forward" size={17} /></>}
          </button>
        </form>
      ) : (
        <>
          <p>Buka aplikasi autentikator, lalu pindai kode ini.</p>
          <div className="qr-panel"><QRCodeSVG value={totpUri} size={208} includeMargin aria-label="Kode QR untuk menghubungkan aplikasi autentikator" /></div>
          <details className="manual-secret"><summary>Masukkan kunci secara manual</summary><code>{new URL(totpUri).searchParams.get("secret")}</code></details>
          <form className="login-form security-form" onSubmit={verifyEnrollment}>
            <label className="field-label" htmlFor="enrollment-code">Kode dari aplikasi autentikator</label>
            <input className="form-input code-input" id="enrollment-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} required />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button--primary login-submit" type="submit" disabled={busy || code.trim().length < 6}>
              {busy ? <LoaderCircle className="spinner" size={18} /> : <><span>Verifikasi dan aktifkan</span><Check size={17} /></>}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
