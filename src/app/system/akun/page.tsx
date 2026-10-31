import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteFooter } from "@/components/site-footer";
import { AdminRecoveryTools } from "@/components/admin-recovery-tools";
import { canPerform } from "@/lib/auth/permissions";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pemulihan akun", alternates: { canonical: "/system/akun" }, robots: { index: false, follow: false } };
export default async function AdminAccountsPage() {
  let principal;
  try { principal = await getCurrentPrincipal(); }
  catch (error) { if (error instanceof MfaEnrollmentRequiredError) redirect("/system/2fa/setup"); if (error instanceof UnauthenticatedError) redirect("/system/login"); throw error; }
  if (principal.role !== "system_admin" || !canPerform(principal, "system:recover")) notFound();
  return <main className="page-shell"><header className="topbar"><Brand compact /><SignOutButton /></header>
    <nav className="breadcrumb" aria-label="Jejak halaman"><Link href="/app">Kembali ke ruang akun</Link><span>/</span><span>Pemulihan akun</span></nav><AdminRecoveryTools /><SiteFooter /></main>;
}
