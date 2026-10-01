import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteFooter } from "@/components/site-footer";
import { TreasurerPaymentHistory } from "@/components/treasurer-payment-history";
import { getDb } from "@/db/client";
import { getTreasurerPaymentHistory } from "@/lib/billing/payment-history";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";

export const metadata: Metadata = {
  title: "Riwayat transaksi Bendahara",
  alternates: { canonical: "/app/bendahara/riwayat" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TreasurerPaymentHistoryPage() {
  let principal;
  try {
    principal = await getCurrentPrincipal();
  } catch (error) {
    if (error instanceof MfaEnrollmentRequiredError) redirect("/system/2fa/setup");
    if (error instanceof UnauthenticatedError) redirect("/login/pengurus");
    throw error;
  }
  if (principal.role !== "treasurer") redirect("/app");

  const initialPage = await getTreasurerPaymentHistory(getDb(), principal);
  return (
    <main className="page-shell">
      <header className="topbar">
        <Brand compact />
        <SignOutButton />
      </header>
      <TreasurerPaymentHistory initialPage={initialPage} />
      <SiteFooter />
    </main>
  );
}
