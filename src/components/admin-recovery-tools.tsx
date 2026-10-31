"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { RecoveryAccount, RecoverySearchResult } from "@/lib/accounts/recovery-directory";

const types = { resident: "Warga", official: "Pengurus", system_admin: "System Admin" };
const statuses = { active: "Aktif", locked: "Terkunci", disabled: "Nonaktif" };
export function AdminRecoveryTools() {
  const [result, setResult] = useState<RecoverySearchResult | null>(null);
  const [target, setTarget] = useState<RecoveryAccount | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const inFlight = useRef(false);
  function clearRecovery() { setPin(""); setRepeat(""); setReason(""); setReference(""); setConfirming(false); setTarget(null); }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
    inFlight.current = true; setBusy(true); setMessage(""); setResult(null); clearRecovery();
    try {
      const response = await fetch("/api/system-admin/accounts/search", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
      const data = await response.json() as RecoverySearchResult & { message?: string };
      if (response.status === 401) setExpired(true);
      if (!response.ok) { setMessage(data.message ?? "Pencarian gagal. Coba lagi."); return; }
      setResult(data);
    } catch { setMessage("Sambungan terputus. Cari akun kembali setelah tersambung."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (target?.recovery === "resident_pin" && pin !== repeat) { setMessage("PIN baru belum sama dengan ulangannya."); return; }
    setConfirming(true);
  }
  async function recover() {
    if (!target?.recovery || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    const resident = target.recovery === "resident_pin";
    try {
      const response = await fetch(resident ? `/api/residents/${encodeURIComponent(target.id)}/reset-pin` : `/api/system-admin/accounts/${encodeURIComponent(target.id)}/recover-two-factor`, {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(resident ? { pin } : {}), reason: reason.trim(), recoveryReference: reference.trim() }),
      });
      const data = await response.json() as { message?: string };
      if (response.status === 401) setExpired(true);
      setMessage(response.ok ? resident ? "PIN warga dipulihkan. Sesi akun dicabut dan tindakan dicatat di audit." : "Pengaturan 2FA akun Admin dipulihkan. Sesi dicabut; akun wajib mengatur MFA kembali sebelum memakai akses Admin."
        : data.message ?? "Hasil pemulihan belum dapat dipastikan. Cari akun kembali sebelum mencoba lagi.");
    } catch { setMessage("Sambungan terputus. Hasil pemulihan belum dapat dipastikan. Periksa audit dan cari akun kembali sebelum mencoba lagi."); }
    finally { clearRecovery(); setResult(null); inFlight.current = false; setBusy(false); }
  }
  return <section className="app-card official-area" aria-labelledby="admin-recovery-title">
    <h1 id="admin-recovery-title">Pemulihan akun</h1>
    <p>Cari akun memakai nomor rumah atau username persis. Pastikan identitas dan RT benar sebelum memulihkan akses. Akun pengurus memulihkan PIN melalui halaman masuk dengan password pemulihan yang dimilikinya.</p>
    {message && <p className="official-feedback" role="status">{message}</p>}
    {expired ? <Link className="button button--primary" href="/system/login">Masuk kembali sebagai Admin</Link> : <>
      <form className="official-form" onSubmit={search}>
        <label>Nomor rumah / username<input name="query" required maxLength={100} autoComplete="off" disabled={busy} /></label>
        <button className="button button--primary" disabled={busy}>{busy ? "Memproses…" : "Cari akun"}</button>
      </form>
      {result?.hasMore && <p>Hanya 10 hasil ditampilkan. Gunakan ID akun untuk pencarian yang lebih tepat.</p>}
      {result && result.accounts.length === 0 && <p>Tidak ada akun yang cocok. Periksa nomor rumah atau username.</p>}
      {result && <ul className="audit-list">{result.accounts.map((account) => <li key={account.id}>
        <h2>{account.name}</h2><p>{types[account.type]} · {statuses[account.status]} · {account.loginIdentifier}</p><p>{account.rtLabel ?? "Akun sistem"}</p>
        {account.recovery ? <button type="button" className="button button--secondary" disabled={busy} onClick={() => { clearRecovery(); setTarget(account); setMessage(""); }}>{account.recovery === "resident_pin" ? "Pulihkan PIN warga" : "Pulihkan 2FA Admin lain"}</button> : <p>Tidak ada tindakan pemulihan yang tersedia melalui halaman ini.</p>}
      </li>)}</ul>}
      {target && <section className="official-confirm" aria-labelledby="recovery-target-title">
        <h2 id="recovery-target-title">{target.recovery === "resident_pin" ? "Pemulihan PIN warga" : "Pemulihan 2FA Admin lain"}</h2>
        <p>{target.name} · {target.loginIdentifier}<br />{target.rtLabel ?? "Akun sistem"}</p>
        <p>Sesi akun terkait akan dicabut. Alasan dan referensi dicatat di audit. Pastikan permintaan pemulihan sudah diverifikasi di luar aplikasi.</p>
        <form className="official-form" hidden={confirming} onSubmit={review}>
          {target.recovery === "resident_pin" && <>
            <label>PIN baru<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} /></label>
            <label>Ulangi PIN baru<input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={repeat} onChange={(event) => setRepeat(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} /></label>
          </>}
          <label>Alasan<textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
          <label>Referensi pemulihan<input required maxLength={100} pattern="[A-Z]{2,10}-[0-9]{4}-[0-9]{3,8}" value={reference} onChange={(event) => setReference(event.target.value)} disabled={busy} aria-describedby="recovery-reference-help" /></label>
          <p id="recovery-reference-help">Gunakan referensi administratif dengan format huruf-tahun-nomor, misalnya REC-2026-001. Jangan menulis PIN, password atau data pribadi dalam alasan/referensi.</p>
          <button className="button button--primary" disabled={busy}>Periksa pemulihan</button>
        </form>
        {confirming && <><h3>Konfirmasi pemulihan</h3><p>Alasan: {reason}</p><p>Referensi: {reference}</p>{target.recovery === "resident_pin" && <p>PIN baru sudah diisi dan disembunyikan.</p>}
          <div className="official-buttons"><button className="button button--primary" type="button" disabled={busy} onClick={() => void recover()}>Konfirmasi pemulihan akun</button><button className="button button--secondary" type="button" disabled={busy} onClick={() => setConfirming(false)}>Kembali mengedit</button></div></>}
        <button className="text-button" type="button" disabled={busy} onClick={clearRecovery}>Batalkan pemulihan</button>
      </section>}
    </>}
    <p><Link className="text-button" href="/app/aktivitas">Lihat riwayat aktivitas</Link></p>
  </section>;
}
