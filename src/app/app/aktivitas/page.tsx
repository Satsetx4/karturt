import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteFooter } from "@/components/site-footer";
import { getDb } from "@/db/client";
import { canPerform } from "@/lib/auth/permissions";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { auditActions, auditFilterSchema, readAuditEvents } from "@/lib/audit/reader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Riwayat aktivitas", alternates: { canonical: "/app/aktivitas" }, robots: { index: false, follow: false } };

export default async function ActivityPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let principal;
  try { principal = await getCurrentPrincipal(); }
  catch (error) {
    if (error instanceof MfaEnrollmentRequiredError) redirect("/system/2fa/setup");
    if (error instanceof UnauthenticatedError) redirect("/login/pengurus");
    throw error;
  }
  if (!canPerform(principal, "audit:read", principal.rtUnitId ? { rtUnitId: principal.rtUnitId } : undefined)) notFound();
  const query = await searchParams;
  const parsed = auditFilterSchema.safeParse(Object.fromEntries(Object.entries(query).filter(([, value]) => value !== "" && value !== undefined)));
  const filters = parsed.success ? parsed.data : {};
  const result = parsed.success ? await readAuditEvents(getDb(), principal, filters) : null;
  const next = new URLSearchParams();
  if (filters.from) next.set("from", filters.from);
  if (filters.to) next.set("to", filters.to);
  if (filters.action) next.set("action", filters.action);
  if (result?.next) next.set("before", result.next);
  const formatTime = (time: string) => new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(time));
  return <main className="page-shell">
    <header className="topbar"><Brand compact /><SignOutButton /></header>
    <nav className="breadcrumb" aria-label="Jejak halaman"><Link href="/app"><ArrowLeft size={16} aria-hidden="true" />Kembali ke ruang akun</Link><span>/</span><span>Aktivitas</span></nav>
    <section className="app-card audit-area">
      <h1>Riwayat aktivitas</h1>
      <p>{principal.role === "system_admin" ? "Aktivitas sistem dan seluruh RT sesuai akses System Admin." : "Aktivitas pengurus dan warga RT Anda, termasuk pemulihan akses oleh System Admin."} Waktu ditampilkan dalam WIB.</p>
      <form className="audit-filters" action="/app/aktivitas">
        <label>Dari tanggal<input type="date" name="from" defaultValue={filters.from} /></label>
        <label>Sampai tanggal<input type="date" name="to" defaultValue={filters.to} /></label>
        <label>Jenis aktivitas<select name="action" defaultValue={filters.action ?? ""}><option value="">Semua aktivitas</option>{Object.entries(auditActions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button className="button button--primary" type="submit">Tampilkan</button>
        <Link className="text-button" href="/app/aktivitas">Hapus filter</Link>
      </form>
      {!parsed.success && <p role="alert">Filter tidak valid. Hapus filter lalu pilih tanggal dan jenis aktivitas kembali.</p>}
      {result && <>
        {result.events.length === 0 ? <p className="audit-empty">Belum ada aktivitas pada pilihan ini.</p> : <ol className="audit-list">{result.events.map((event) => <li key={event.id}>
          <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
          <h2>{event.label}</h2><p>Oleh {event.actorName}</p>
          <small>Referensi: {event.id}</small>
        </li>)}</ol>}
        {result.next && <Link className="button button--secondary" href={`/app/aktivitas?${next.toString()}`}>Aktivitas lebih lama</Link>}
        {filters.before && <Link className="text-button" href={`/app/aktivitas?${new URLSearchParams(Object.entries(filters).filter(([key]) => key !== "before")).toString()}`}>Kembali ke aktivitas terbaru</Link>}
      </>}
    </section><SiteFooter />
  </main>;
}
