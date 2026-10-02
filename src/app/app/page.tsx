import { ResidentCard } from "@/components/resident-card";
import { getResidentProfile } from "@/lib/billing/resident-profile";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { SignOutButton } from "@/components/sign-out-button";
import { TreasurerDashboard } from "@/components/treasurer-dashboard";
import Link from "next/link";
import { ArrowRight, Banknote, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { getDb } from "@/db/client";
import { authUser } from "@/db/schema";
import {
  getCurrentPrincipal,
  UnauthenticatedError,
  MfaEnrollmentRequiredError,
} from "@/lib/auth/principal";
import { getTreasurerPaymentRequestQueue } from "@/lib/billing/treasurer-payment-requests";

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
    if (error instanceof MfaEnrollmentRequiredError)
      redirect("/system/2fa/setup");
    if (error instanceof UnauthenticatedError) redirect("/login/warga");
    throw error;
  }
  const profile =
    principal.role === "resident"
      ? await getResidentProfile(getDb(), principal)
      : null;
  const treasurerRequests = principal.role === "treasurer"
    ? await getTreasurerPaymentRequestQueue(getDb(), principal)
    : null;
  const [user] = await getDb()
    .select({ name: authUser.name })
    .from(authUser)
    .where(eq(authUser.id, principal.authUserId))
    .limit(1);

  return (
    <main className="page-shell">
      <header className="topbar">
        <Brand compact />
        <SignOutButton />
      </header>
      {profile ? (
        <ResidentCard profile={profile} businessDate={jakartaBusinessDate()} />
      ) : principal.role === "treasurer" ? (
        <TreasurerDashboard requests={treasurerRequests ?? []} />
      ) : (
        <section className="app-card">
          <span className="account-badge">{roleNames[principal.role]}</span>
          <p className="eyebrow" style={{ marginTop: 22 }}>
            AKUN AKTIF
          </p>
          <h1>Selamat datang{user?.name ? `, ${user.name}` : ""}.</h1>
          <p>
            Akun Anda aktif. Informasi pada halaman ini mengikuti akses akun
            Anda.
          </p>
          {principal.role === "rt_chairman" && (
            <div className="chairman-tools-grid" aria-label="Pengelolaan iuran">
              <section className="chairman-tool-card" aria-labelledby="chairman-rate-entry-title">
                <div className="chairman-tool-icon"><Banknote size={22} aria-hidden="true" /></div>
                <div className="chairman-tool-copy">
                  <h2 id="chairman-rate-entry-title">Tarif iuran</h2>
                  <p>Jadwalkan tarif untuk bulan mendatang dan tinjau riwayat tarif.</p>
                </div>
                <Link className="chairman-tool-link" href="/app/tarif">
                  Buka tarif iuran <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </section>
              <section className="chairman-tool-card" aria-labelledby="chairman-adjustment-entry-title">
                <div className="chairman-tool-icon"><SlidersHorizontal size={22} aria-hidden="true" /></div>
                <div className="chairman-tool-copy">
                  <h2 id="chairman-adjustment-entry-title">Penyesuaian kewajiban</h2>
                  <p>Tinjau saldo tagihan dan catat perubahan dengan alasan.</p>
                </div>
                <Link className="chairman-tool-link" href="/app/penyesuaian">
                  Buka penyesuaian <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </section>
              <section className="chairman-tool-card" aria-labelledby="chairman-waiver-entry-title">
                <div className="chairman-tool-icon"><ShieldCheck size={22} aria-hidden="true" /></div>
                <div className="chairman-tool-copy">
                  <h2 id="chairman-waiver-entry-title">Pemutihan iuran</h2>
                  <p>Pilih bulan yang belum dibayar, catat alasan, dan tinjau riwayat keputusan.</p>
                </div>
                <Link className="chairman-tool-link" href="/app/pemutihan">
                  Buka pemutihan iuran <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </section>
            </div>
          )}
          {principal.role === "system_admin" && (
            <>
              <hr className="status-rule" />
              <p>
                Ruang System Admin menangani pemulihan sistem. Akses ini tidak
                memiliki kewenangan transaksi keuangan.
              </p>
            </>
          )}
          <div className="app-card-actions">
            <SignOutButton />
          </div>
        </section>
      )}
      <SiteFooter />
    </main>
  );
}
