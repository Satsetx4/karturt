import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { SignOutButton } from "@/components/sign-out-button";
import { TreasurerCashPaymentFlow } from "@/components/treasurer-cash-payment-flow";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { assertActiveTreasurer } from "@/lib/billing/treasurer-payment-requests";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catat pembayaran tunai",
  alternates: { canonical: "/app/bendahara/tunai" },
  robots: { index: false, follow: false },
};

export default async function TreasurerCashPaymentPage() {
  let principal;
  try {
    principal = await getCurrentPrincipal();
  } catch (error) {
    if (error instanceof MfaEnrollmentRequiredError) redirect("/system/2fa/setup");
    if (error instanceof UnauthenticatedError) redirect("/login/pengurus");
    throw error;
  }
  if (principal.role !== "treasurer") notFound();
  try {
    await assertActiveTreasurer(getDb(), principal, jakartaBusinessDate(), "payment:record_cash");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Forbidden:")) notFound();
    throw error;
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <Brand compact />
        <SignOutButton />
      </header>
      <nav className="breadcrumb" aria-label="Jejak halaman">
        <Link href="/app">Ruang Bendahara</Link>
        <span aria-hidden="true">/</span>
        <span>Pembayaran tunai</span>
      </nav>
      <TreasurerCashPaymentFlow />
      <SiteFooter />
    </main>
  );
}
