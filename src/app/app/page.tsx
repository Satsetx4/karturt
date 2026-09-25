import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { SignOutButton } from "@/components/sign-out-button";
import { getDb } from "@/db/client";
import { authUser } from "@/db/schema";
import { getCurrentPrincipal, MfaEnrollmentRequiredError } from "@/lib/auth/principal";

export const metadata: Metadata = {
  title: "Ruang akun",
  alternates: { canonical: "/app" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const roleNames = {
  resident: "Warga",
  treasurer: "Bendahara",
  rt_chairman: "Ketua RT",
  system_admin: "System Admin",
} as const;

export default async function AccountHomePage() {
  let principal;
  try {
    principal = await getCurrentPrincipal();
  } catch (error) {
    if (error instanceof MfaEnrollmentRequiredError) redirect("/system/2fa/setup");
    redirect("/");
  }
  const [user] = await getDb().select({ name: authUser.name }).from(authUser).where(eq(authUser.id, principal.authUserId)).limit(1);

  return (
    <main className="page-shell">
      <header className="topbar"><Brand compact /><SignOutButton /></header>
      <section className="app-card">
        <span className="account-badge">{roleNames[principal.role]}</span>
        <p className="eyebrow" style={{ marginTop: 22 }}>AKUN AKTIF</p>
        <h1>Selamat datang{user?.name ? `, ${user.name}` : ""}.</h1>
        <p>Akun dan batas akses Anda sudah tersambung. Modul kartu bulanan akan dibuka setelah Test Gate A selesai.</p>
        {principal.role === "system_admin" && <><hr className="status-rule" /><p>Ruang System Admin menangani pemulihan sistem. Akses ini tidak memiliki kewenangan transaksi keuangan.</p></>}
        <div className="app-card-actions"><SignOutButton /></div>
      </section>
      <SiteFooter />
    </main>
  );
}
