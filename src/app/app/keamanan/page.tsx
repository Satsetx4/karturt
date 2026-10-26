import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { ChangeAccountPinForm } from "@/components/change-account-pin-form";
import { getDb } from "@/db/client";
import { appAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getCurrentPrincipal,
  MfaEnrollmentRequiredError,
  UnauthenticatedError,
} from "@/lib/auth/principal";

export const metadata: Metadata = {
  title: "Keamanan akun",
  alternates: { canonical: "/app/keamanan" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  let principal;
  try {
    principal = await getCurrentPrincipal();
  } catch (error) {
    if (error instanceof MfaEnrollmentRequiredError) redirect("/system/2fa/setup");
    if (error instanceof UnauthenticatedError) redirect("/login/warga");
    throw error;
  }

  const [account] = await getDb()
    .select({ hasPin: appAccounts.pinHash })
    .from(appAccounts)
    .where(eq(appAccounts.id, principal.appAccountId))
    .limit(1);

  return (
    <main className="page-shell">
      <header className="topbar">
        <Brand compact />
        <Link className="back-link" href="/app"><ArrowLeft size={17} aria-hidden="true" /> Kembali</Link>
      </header>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Beranda</Link><span aria-hidden="true">/</span>
        <Link href="/app">Ruang akun</Link><span aria-hidden="true">/</span>
        <span>Keamanan akun</span>
      </nav>
      <section className="security-card" aria-labelledby="account-security-title">
        <span className="mfa-symbol"><ShieldCheck size={24} aria-hidden="true" /></span>
        <p className="eyebrow">PENGATURAN AKUN</p>
        <h1 id="account-security-title">Keamanan akun</h1>
        <p>PIN awal mengikuti workbook dan boleh sama untuk pengguna dengan peran yang sama. Mengubah PIN hanya memperbarui akun Anda.</p>
        <div className="security-policy-note">
          <strong>Perlindungan akun pengurus dan System Admin</strong>
          <p>Ketua RT, Bendahara, dan System Admin tetap masuk dengan kata sandi 16–128 karakter. System Admin juga wajib menyelesaikan TOTP. PIN enam digit tidak dapat digunakan untuk masuk atau menyetujui tindakan mereka.</p>
        </div>
        <ChangeAccountPinForm role={principal.role} canChangePin={Boolean(account?.hasPin)} />
      </section>
      <SiteFooter />
    </main>
  );
}
