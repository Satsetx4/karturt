import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { TwoFactorSetupForm } from "@/components/two-factor-setup-form";
import { getDb } from "@/db/client";
import { appAccounts, authUser } from "@/db/schema";
import { getAuth } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Aktifkan verifikasi dua langkah",
  alternates: { canonical: "/system/2fa/setup" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TwoFactorSetupPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/system/login");
  const [account] = await getDb()
    .select({ accountType: appAccounts.accountType, enabled: authUser.twoFactorEnabled })
    .from(appAccounts)
    .innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
    .where(and(eq(appAccounts.authUserId, session.user.id), eq(appAccounts.accountType, "system_admin")))
    .limit(1);
  if (!account) redirect("/");
  if (account.enabled) redirect("/app");

  return (
    <main className="page-shell login-shell">
      <header className="topbar"><Brand compact /></header>
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/">Beranda</Link><span>/</span><Link href="/system/login">System Admin</Link><span>/</span><span>Keamanan akun</span></nav>
      <TwoFactorSetupForm />
      <SiteFooter />
    </main>
  );
}
