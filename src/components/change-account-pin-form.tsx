"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth/client";

type AccountRole = "resident" | "rt_chairman" | "treasurer" | "system_admin";

const loginHref: Record<AccountRole, string> = {
  resident: "/login/warga",
  rt_chairman: "/login/pengurus",
  treasurer: "/login/pengurus",
  system_admin: "/system/login",
};

export function ChangeAccountPinForm({ role, canChangePin }: { role: AccountRole; canChangePin: boolean }) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [recoveryPin, setRecoveryPin] = useState("");
  const [recoveryPinConfirm, setRecoveryPinConfirm] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  async function returnToLogin() {
    try {
      await authClient.signOut();
    } catch {
      // Every database session is already revoked by the server.
    }
    window.location.replace(loginHref[role]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPin !== confirmPin) {
      setError("PIN baru belum sama dengan ulangannya.");
      return;
    }
    if (!/^\d{6}$/.test(currentPin) || !/^\d{6}$/.test(newPin)) {
      setError("Masukkan PIN tepat enam digit.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/account/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPin, newPin }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(response.status === 429
          ? "Terlalu banyak percobaan. Tunggu 15 menit sebelum mencoba lagi."
          : result.message ?? "PIN belum dapat diubah. Periksa PIN saat ini lalu coba lagi.");
        return;
      }

      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      await returnToLogin();
    } catch {
      setError("Koneksi belum berhasil. Periksa jaringan lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  if (!canChangePin && role === "resident") {
    return (
      <div className="security-not-ready" role="status">
        <ShieldCheck size={20} aria-hidden="true" />
        <p>PIN belum disiapkan untuk akun ini. Hubungi pengelola melalui jalur resmi.</p>
      </div>
    );
  }

  async function recoverForgottenPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecoveryError("");
    if (recoveryPin !== recoveryPinConfirm) {
      setRecoveryError("PIN baru belum sama dengan ulangannya.");
      return;
    }
    if (currentPassword.length < 16 || currentPassword.length > 128 || !/^\d{6}$/.test(recoveryPin)) {
      setRecoveryError("Masukkan kata sandi akun 16–128 karakter dan PIN tepat enam digit.");
      return;
    }

    setRecoveryBusy(true);
    try {
      const response = await fetch("/api/account/pin/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPin: recoveryPin }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setRecoveryError(response.status === 429
          ? "Terlalu banyak percobaan. Tunggu 15 menit sebelum mencoba lagi."
          : result.message ?? "Pemulihan PIN belum berhasil. Periksa kata sandi akun lalu coba lagi.");
        return;
      }

      setCurrentPassword("");
      setRecoveryPin("");
      setRecoveryPinConfirm("");
      await returnToLogin();
    } catch {
      setRecoveryError("Koneksi belum berhasil. Periksa jaringan lalu coba lagi.");
    } finally {
      setRecoveryBusy(false);
    }
  }

  return (
    <div>
    {canChangePin ? <form className="login-form security-form" onSubmit={submit} noValidate>
      <label className="field-label" htmlFor="current-account-pin">PIN saat ini</label>
      <input
        className="form-input code-input"
        id="current-account-pin"
        name="currentPin"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        pattern="[0-9]{6}"
        maxLength={6}
        value={currentPin}
        onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
        required
      />

      <label className="field-label" htmlFor="new-account-pin">PIN baru</label>
      <input
        className="form-input code-input"
        id="new-account-pin"
        name="newPin"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        pattern="[0-9]{6}"
        maxLength={6}
        value={newPin}
        onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
        required
      />

      <label className="field-label" htmlFor="confirm-account-pin">Ulangi PIN baru</label>
      <input
        className="form-input code-input"
        id="confirm-account-pin"
        name="confirmPin"
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
      <button className="button button--primary login-submit" type="submit" disabled={busy || currentPin.length !== 6 || newPin.length !== 6 || confirmPin.length !== 6}>
        {busy ? <LoaderCircle className="spinner" size={18} aria-hidden="true" /> : <><span>Ubah PIN dan masuk ulang</span><ArrowRight size={18} aria-hidden="true" /></>}
      </button>
      <p className="form-note">PIN lama boleh dipakai kembali. PIN yang sama pada akun lain tidak berubah saat Anda mengubah PIN ini.</p>
    </form> : <div className="security-not-ready" role="status">
      <ShieldCheck size={20} aria-hidden="true" />
      <p>PIN belum disiapkan. Gunakan pemulihan dengan kata sandi akun untuk menyiapkannya.</p>
    </div>}

    {role !== "resident" && <section className="pin-recovery" aria-label="Pemulihan PIN">
      <button
        className="security-recovery-toggle"
        type="button"
        aria-expanded={recoveryOpen}
        onClick={() => {
          setRecoveryOpen((open) => !open);
          setRecoveryError("");
        }}
      >
        {canChangePin ? "Lupa PIN? Pulihkan dengan kata sandi akun" : "Siapkan atau pulihkan PIN"}
      </button>
      {recoveryOpen && <form className="login-form security-form" onSubmit={recoverForgottenPin} noValidate>
        <p className="form-note">Pemulihan mengharuskan kata sandi akun 16–128 karakter. System Admin juga memerlukan sesi dengan TOTP terverifikasi. PIN pengurus dan Admin tetap tidak digunakan untuk login atau otorisasi.</p>
        <label className="field-label" htmlFor="pin-recovery-password">Kata sandi akun saat ini</label>
        <input
          className="form-input"
          id="pin-recovery-password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
        <label className="field-label" htmlFor="pin-recovery-new">PIN baru</label>
        <input
          className="form-input code-input"
          id="pin-recovery-new"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          pattern="[0-9]{6}"
          value={recoveryPin}
          onChange={(event) => setRecoveryPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
          required
        />
        <label className="field-label" htmlFor="pin-recovery-confirm">Ulangi PIN baru</label>
        <input
          className="form-input code-input"
          id="pin-recovery-confirm"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          pattern="[0-9]{6}"
          value={recoveryPinConfirm}
          onChange={(event) => setRecoveryPinConfirm(event.target.value.replace(/\D/g, "").slice(0, 6))}
          required
        />
        {recoveryError && <p className="form-error" role="alert">{recoveryError}</p>}
        <button className="button button--primary login-submit" type="submit" disabled={recoveryBusy || currentPassword.length < 16 || currentPassword.length > 128 || recoveryPin.length !== 6 || recoveryPinConfirm.length !== 6}>
          {recoveryBusy ? <LoaderCircle className="spinner" size={18} aria-hidden="true" /> : <><span>Pulihkan PIN dan masuk ulang</span><ArrowRight size={18} aria-hidden="true" /></>}
        </button>
      </form>}
    </section>}
    </div>
  );
}
