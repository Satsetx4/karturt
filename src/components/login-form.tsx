"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export type LoginKind = "resident" | "official" | "system_admin";

const copy: Record<LoginKind, { identifierLabel: string; identifierHint: string; passwordLabel: string; submit: string }> = {
  resident: {
    identifierLabel: "Nomor rumah",
    identifierHint: "Sesuai nomor yang tercatat di RT",
    passwordLabel: "PIN",
    submit: "Masuk sebagai warga",
  },
  official: {
    identifierLabel: "Nama akun",
    identifierHint: "Nama akun dari Ketua RT",
    passwordLabel: "Kata sandi",
    submit: "Masuk sebagai pengurus",
  },
  system_admin: {
    identifierLabel: "Nama akun System Admin",
    identifierHint: "Gunakan akun pemulihan sistem",
    passwordLabel: "Kata sandi",
    submit: "Masuk ke konsol sistem",
  },
};

export function LoginForm({ kind }: { kind: LoginKind }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const text = copy[kind];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/login/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password, website: honeypot }),
      });
      const result = (await response.json().catch(() => ({}))) as { twoFactorRedirect?: boolean; message?: string };

      if (!response.ok) {
        setError(response.status === 429
          ? "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."
          : result.message ?? "Data masuk belum cocok atau akun belum aktif. Periksa kembali atau hubungi pengurus.");
        return;
      }

      if (result.twoFactorRedirect) {
        router.replace("/system/2fa");
        return;
      }
      router.replace("/app");
    } catch {
      setError("Koneksi belum berhasil. Periksa jaringan Anda lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <label className="field-label" htmlFor="login-identifier">{text.identifierLabel}</label>
      <input
        className="form-input"
        id="login-identifier"
        name="identifier"
        autoComplete="username"
        autoCapitalize={kind === "resident" ? "characters" : "none"}
        maxLength={100}
        placeholder={text.identifierHint}
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        required
      />

      <label className="field-label" htmlFor="login-password">{text.passwordLabel}</label>
      <input
        className="form-input"
        id="login-password"
        name="password"
        type="password"
        autoComplete="current-password"
        inputMode={kind === "resident" ? "numeric" : undefined}
        maxLength={128}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      <div className="honeypot" aria-hidden="true">
        <label htmlFor="login-website">Website</label>
        <input id="login-website" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button className="button button--primary login-submit" type="submit" disabled={busy || !identifier || !password}>
        {busy ? <LoaderCircle className="spinner" size={18} aria-hidden="true" /> : <span>{text.submit}</span>}
        {!busy && <ArrowRight size={18} aria-hidden="true" />}
      </button>
      <p className="form-note">Informasi masuk Anda hanya dipakai untuk memeriksa akun.</p>
    </form>
  );
}
