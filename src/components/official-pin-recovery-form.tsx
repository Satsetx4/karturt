"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";

export function OfficialPinRecoveryForm() {
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (newPin !== confirmPin) {
      setError("PIN baru belum sama dengan ulangannya.");
      return;
    }
    if (currentPassword.length < 16 || currentPassword.length > 128 || !/^\d{6}$/.test(newPin)) {
      setError("Masukkan kata sandi akun 16–128 karakter dan PIN tepat enam digit.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/official-pin/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, currentPassword, newPin, website: honeypot }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(response.status === 429
          ? "Terlalu banyak percobaan. Tunggu 15 menit sebelum mencoba lagi."
          : result.message ?? "Pemulihan PIN belum berhasil. Periksa data akun lalu coba lagi.");
        return;
      }

      setCurrentPassword("");
      setNewPin("");
      setConfirmPin("");
      setSuccess("PIN berhasil disiapkan. Silakan masuk menggunakan username dan PIN baru.");
    } catch {
      setError("Koneksi belum berhasil. Periksa jaringan lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pin-recovery" aria-label="Pemulihan PIN akun pengurus">
      <button
        className="security-recovery-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setError("");
        }}
      >
        Lupa atau belum punya PIN?
      </button>
      {open && <form className="login-form security-form" onSubmit={recover} noValidate>
        <p className="form-note">Siapkan PIN menggunakan username dan kata sandi akun pengurus saat ini. Kata sandi kuat tetap tersimpan sebagai jalur pemulihan.</p>
        <div className="honeypot" aria-hidden="true">
          <label htmlFor="official-recovery-website">Biarkan kolom ini kosong</label>
          <input id="official-recovery-website" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
        </div>
        <label className="field-label" htmlFor="official-recovery-identifier">Username pengurus</label>
        <input
          className="form-input"
          id="official-recovery-identifier"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          maxLength={100}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          required
        />
        <label className="field-label" htmlFor="official-recovery-password">Kata sandi akun saat ini</label>
        <input
          className="form-input"
          id="official-recovery-password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
        <label className="field-label" htmlFor="official-recovery-pin">PIN baru</label>
        <input
          className="form-input code-input"
          id="official-recovery-pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          pattern="[0-9]{6}"
          maxLength={6}
          value={newPin}
          onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
          required
        />
        <label className="field-label" htmlFor="official-recovery-pin-confirm">Ulangi PIN baru</label>
        <input
          className="form-input code-input"
          id="official-recovery-pin-confirm"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          pattern="[0-9]{6}"
          maxLength={6}
          value={confirmPin}
          onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
          required
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        {success && <p className="form-note" role="status">{success}</p>}
        <button className="button button--primary login-submit" type="submit" disabled={busy || !identifier || currentPassword.length < 16 || currentPassword.length > 128 || newPin.length !== 6 || confirmPin.length !== 6}>
          {busy ? <LoaderCircle className="spinner" size={18} aria-hidden="true" /> : <><span>Siapkan PIN dan masuk ulang</span><ArrowRight size={18} aria-hidden="true" /></>}
        </button>
      </form>}
    </section>
  );
}
