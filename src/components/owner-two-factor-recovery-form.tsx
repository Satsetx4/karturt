"use client";

import Link from "next/link";
import { ArrowLeft, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

type RecoveryResponse = {
  ok?: boolean;
  message?: string;
  recoveryReference?: string;
};

export function OwnerTwoFactorRecoveryForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [recoveryReference, setRecoveryReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/system-admin/owner-recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ identifier, password, reason }),
      });
      const result = await response.json().catch(() => ({})) as RecoveryResponse;
      if (!response.ok || !result.recoveryReference) {
        setError(result.message ?? "Pemulihan belum dapat diproses. Coba lagi nanti.");
        return;
      }
      setPassword("");
      setIdentifier("");
      setReason("");
      setRecoveryReference(result.recoveryReference);
    } catch {
      setError("Koneksi belum berhasil. Periksa jaringan, lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  if (recoveryReference) {
    return (
      <section className="security-card" aria-labelledby="recovery-complete-title">
        <span className="mfa-symbol"><ShieldCheck size={24} aria-hidden="true" /></span>
        <p className="eyebrow">PEMULIHAN TERCATAT</p>
        <h1 id="recovery-complete-title">Siapkan ulang verifikasi dua langkah</h1>
        <p>Semua sesi lama sudah dicabut dan pemulihan tercatat dengan referensi:</p>
        <p className="recovery-reference"><code>{recoveryReference}</code></p>
        <p>Verifikasi dua langkah tetap diwajibkan. Sesi sementara hanya membuka halaman penyiapan ini; akses Admin baru aktif setelah TOTP baru berhasil diverifikasi.</p>
        <Link className="button button--primary login-submit" href="/system/2fa/setup">
          Siapkan autentikator baru <ArrowLeft className="arrow-forward" size={17} aria-hidden="true" />
        </Link>
      </section>
    );
  }

  return (
    <section className="security-card" aria-labelledby="owner-recovery-title">
      <span className="mfa-symbol"><ShieldAlert size={24} aria-hidden="true" /></span>
      <p className="eyebrow">KHUSUS PEMILIK</p>
      <h1 id="owner-recovery-title">Pulihkan verifikasi dua langkah</h1>
      <p>Gunakan hanya jika Anda pemilik akun System Admin dan tidak lagi memiliki akses ke autentikator. Akses halaman ini dilindungi oleh akun tim Vercel.</p>
      <form className="login-form security-form" onSubmit={submit}>
        <label className="field-label" htmlFor="owner-recovery-identifier">Nama akun System Admin</label>
        <input
          className="form-input"
          id="owner-recovery-identifier"
          name="identifier"
          autoComplete="username"
          maxLength={100}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          required
        />
        <label className="field-label" htmlFor="owner-recovery-password">Kata sandi akun</label>
        <input
          className="form-input"
          id="owner-recovery-password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={16}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <label className="field-label" htmlFor="owner-recovery-reason">Alasan pemulihan</label>
        <textarea
          className="form-input form-textarea"
          id="owner-recovery-reason"
          name="reason"
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
        <p className="form-note">Jangan masukkan kata sandi, kode autentikator, nomor telepon, atau alamat email ke alasan. Tindakan ini mencabut semua sesi dan mewajibkan penyiapan TOTP baru.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary login-submit" type="submit" disabled={busy || identifier.trim().length === 0 || password.length < 16 || password.length > 128 || reason.trim().length === 0}>
          {busy ? <LoaderCircle className="spinner" size={18} aria-hidden="true" /> : <><span>Pulihkan dan catat</span><ShieldCheck size={17} aria-hidden="true" /></>}
        </button>
      </form>
    </section>
  );
}
