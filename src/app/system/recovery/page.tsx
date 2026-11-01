import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Brand } from "@/components/brand";
import { OwnerTwoFactorRecoveryForm } from "@/components/owner-two-factor-recovery-form";
import { SiteFooter } from "@/components/site-footer";
import { isOwnerRecoveryHost } from "@/lib/auth/owner-recovery-origin";

export const metadata: Metadata = {
  title: "Pemulihan verifikasi dua langkah System Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SystemAdminOwnerRecoveryPage() {
  if (!isOwnerRecoveryHost(await headers())) notFound();

  return (
    <main className="page-shell login-shell">
      <header className="topbar">
        <Brand compact />
        <Link className="back-link" href="/system/login">Kembali ke masuk</Link>
      </header>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Beranda</Link><span aria-hidden="true">/</span><Link href="/system/login">System Admin</Link><span aria-hidden="true">/</span><span>Pemulihan 2FA</span>
      </nav>
      <OwnerTwoFactorRecoveryForm />
      <SiteFooter />
    </main>
  );
}
