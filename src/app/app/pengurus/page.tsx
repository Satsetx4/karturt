import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteFooter } from "@/components/site-footer";
import { OfficialManagement } from "@/components/official-management";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { canPerform } from "@/lib/auth/permissions";
import { listOfficials } from "@/lib/officials/management";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jabatan pengurus", alternates: { canonical: "/app/pengurus" }, robots: { index: false, follow: false } };
export default async function OfficialsPage() {
  let principal;
  try { principal = await getCurrentPrincipal(); }
  catch (error) {
    if (error instanceof MfaEnrollmentRequiredError) redirect("/system/2fa/setup");
    if (error instanceof UnauthenticatedError) redirect("/login/pengurus");
    throw error;
  }
  if (!principal.rtUnitId || !canPerform(principal, "official:manage", { rtUnitId: principal.rtUnitId })) notFound();
  return <main className="page-shell"><header className="topbar"><Brand compact /><SignOutButton /></header>
    <nav className="breadcrumb" aria-label="Jejak halaman"><Link href="/app">Kembali ke ruang akun</Link><span>/</span><span>Jabatan pengurus</span></nav>
    <OfficialManagement initial={await listOfficials(getDb(), principal)} /><SiteFooter /></main>;
}
