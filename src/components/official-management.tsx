"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { OfficialList, OfficialMutation } from "@/lib/officials/management";

const roleName = { rt_chairman: "Ketua RT", treasurer: "Bendahara" };
const operationName = { schedule: "Jadwalkan jabatan", handover: "Ganti pengurus", end: "Akhiri jabatan bendahara" };

export function OfficialManagement({ initial }: { initial: OfficialList }) {
  const [list, setList] = useState(initial);
  const [operation, setOperation] = useState<OfficialMutation["operation"]>("schedule");
  const [pending, setPending] = useState<OfficialMutation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const next = new Date(`${list.today}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  const available = list.assignments.filter((row) => (!row.endsOn || row.endsOn >= list.today) && (operation !== "end" || row.role === "treasurer"));
  async function refresh() {
    const response = await fetch("/api/chairman/officials", { cache: "no-store" });
    if (response.status === 401) { setSessionExpired(true); throw new Error("Sesi berakhir. Silakan masuk kembali."); }
    if (!response.ok) throw new Error("Daftar terbaru belum dapat dimuat. Coba muat ulang.");
    setList(await response.json() as OfficialList);
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const fields = new FormData(event.currentTarget);
    const reason = String(fields.get("reason") ?? "").trim();
    if (operation === "schedule") setPending({ operation, accountId: String(fields.get("accountId")), role: fields.get("role") as "treasurer" | "rt_chairman", startsOn: String(fields.get("startsOn")), endsOn: String(fields.get("endsOn")) || null, reason });
    else if (operation === "end") setPending({ operation, assignmentId: String(fields.get("assignmentId")), endsOn: String(fields.get("endsOn")), reason });
    else setPending({ operation, assignmentId: String(fields.get("assignmentId")), accountId: String(fields.get("accountId")), startsOn: String(fields.get("startsOn")), reason });
  }
  async function submit() {
    if (!pending || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/chairman/officials", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(pending) });
      const data = await response.json() as { message?: string };
      if (response.status === 401) setSessionExpired(true);
      if (!response.ok) { setMessage(data.message ?? "Perubahan belum tersimpan. Periksa daftar terbaru."); return; }
      setMessage(data.message ?? "Perubahan tersimpan."); setPending(null); form.current?.reset();
      try { await refresh(); } catch (error) { setMessage(`${data.message ?? "Perubahan tersimpan."} ${error instanceof Error ? error.message : "Muat ulang daftar."}`); }
    } catch { setMessage("Sambungan terputus. Hasil perubahan belum dapat dipastikan. Muat ulang daftar sebelum mencoba lagi."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const target = pending && "accountId" in pending ? list.accounts.find((account) => account.id === pending.accountId) : null;
  const prior = pending && "assignmentId" in pending ? list.assignments.find((row) => row.id === pending.assignmentId) : null;
  return <section className="app-card official-area" aria-labelledby="official-title">
    <h1 id="official-title">Jabatan pengurus</h1>
    <p>Kelola akun pengurus yang sudah tersedia di RT Anda. Tanggal mulai dan akhir dihitung termasuk hari tersebut, dalam WIB. Pergantian paling cepat besok.</p>
    <p>Setiap perubahan mencabut sesi akun terkait saat disimpan. Akun dapat masuk kembali bila masa jabatannya masih aktif. Setelah tanggal akhir, setiap permintaan akses ditolak. Tidak ada antrean perubahan offline.</p>
    {message && <p role="status" className="official-feedback">{message}</p>}
    {sessionExpired && <Link className="button button--primary" href="/login/pengurus">Masuk kembali</Link>}
    {!sessionExpired && <>
      <button className="text-button" type="button" disabled={busy} onClick={() => { setPending(null); void refresh().then(() => setMessage("Daftar diperbarui.")).catch((error: Error) => setMessage(error.message)); }}>Muat ulang daftar</button>
      {pending && <section className="official-confirm" aria-labelledby="official-confirm-title">
        <h2 id="official-confirm-title">Periksa perubahan</h2>
        <p>{operationName[pending.operation]}</p>
        {prior && <p>Jabatan sebelumnya: {roleName[prior.role]} · {prior.name} · mulai {prior.startsOn}</p>}
        {target && <p>Akun yang ditugaskan: {target.name}</p>}
        {pending.operation === "schedule" && <p>Peran: {roleName[pending.role]}</p>}
        {"startsOn" in pending && <p>Mulai: {pending.startsOn} WIB</p>}
        {"endsOn" in pending && <p>Hari terakhir menjabat: {pending.endsOn ?? "Belum ditentukan"}</p>}
        {pending.operation === "handover" && <p>Jabatan lama berakhir sehari sebelum tanggal mulai pengganti. Penetapan pengganti dan akhir jabatan lama disimpan sekaligus.</p>}
        <p>Alasan: {pending.reason}</p>
        <div className="official-buttons"><button type="button" className="button button--primary" disabled={busy} onClick={() => void submit()}>{busy ? "Menyimpan…" : "Konfirmasi perubahan"}</button><button type="button" className="button button--secondary" disabled={busy} onClick={() => setPending(null)}>Kembali mengedit</button></div>
      </section>}
      <form ref={form} onSubmit={review} className="official-form" hidden={Boolean(pending)}>
        <label>Tindakan<select value={operation} onChange={(event) => { setOperation(event.target.value as OfficialMutation["operation"]); setMessage(""); }}>{Object.entries(operationName).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {operation !== "schedule" && <label>Jabatan yang diubah<select name="assignmentId" required defaultValue=""><option value="" disabled>Pilih jabatan</option>{available.map((row) => <option key={row.id} value={row.id}>{roleName[row.role]} · {row.name} · {row.startsOn}</option>)}</select></label>}
        {operation !== "end" && <label>Akun pengurus<select name="accountId" required defaultValue=""><option value="" disabled>Pilih akun</option>{list.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id.slice(-6)}</option>)}</select></label>}
        {operation === "schedule" && <label>Peran<select name="role" defaultValue="treasurer"><option value="treasurer">Bendahara</option><option value="rt_chairman">Ketua RT</option></select></label>}
        {operation !== "end" && <label>Tanggal mulai<input name="startsOn" type="date" min={operation === "handover" ? tomorrow : list.today} required /></label>}
        {operation !== "handover" && <label>Tanggal akhir{operation === "schedule" ? " (opsional)" : ""}<input name="endsOn" type="date" min={list.today} required={operation === "end"} /></label>}
        <label>Alasan<textarea name="reason" required maxLength={500} rows={3} aria-describedby="official-reason-help" /></label>
        <p id="official-reason-help">Tuliskan alasan administratif singkat. Jangan masukkan PIN, password, nomor telepon, atau data pribadi.</p>
        {list.accounts.length === 0 && <p>Belum ada akun pengurus aktif. Hubungi pengelola untuk menyiapkan akun terlebih dahulu.</p>}
        <button className="button button--primary" type="submit" disabled={busy || (operation === "schedule" ? list.accounts.length === 0 : available.length === 0)}>Periksa perubahan</button>
      </form>
    </>}
    <h2>Daftar masa jabatan</h2>
    {list.hasMoreHistory && <p>Menampilkan paling banyak 100 masa jabatan; yang aktif dan terjadwal didahulukan.</p>}
    {list.assignments.length === 0 ? <p>Belum ada masa jabatan.</p> : <ol className="audit-list">{list.assignments.map((row) => <li key={row.id}>
      <h3>{roleName[row.role]} · {row.name}</h3><p>{row.startsOn} sampai {row.endsOn ?? "belum ditentukan"} WIB</p>
      <p>{row.startsOn > list.today ? "Terjadwal" : row.endsOn && row.endsOn < list.today ? "Selesai" : "Aktif"}</p>
    </li>)}</ol>}
  </section>;
}
