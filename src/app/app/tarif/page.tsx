import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { ChairmanFeeRatesFlow } from "@/components/chairman-fee-rates-flow";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteFooter } from "@/components/site-footer";
import { canPerform } from "@/lib/auth/permissions";
import {
  getCurrentPrincipal,
  MfaEnrollmentRequiredError,
  UnauthenticatedError,
} from "@/lib/auth/principal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tarif iuran",
  alternates: { canonical: "/app/tarif" },
  robots: { index: false, follow: false },
};

export default async function ChairmanFeeRatesPage() {
  let principal;
  try {
    principal = await getCurrentPrincipal();
  } catch (error) {
    if (error instanceof MfaEnrollmentRequiredError) redirect("/system/2fa/setup");
    if (error instanceof UnauthenticatedError) redirect("/login/pengurus");
    throw error;
  }

  if (
    principal.role !== "rt_chairman" ||
    !principal.rtUnitId ||
    !canPerform(principal, "fee_rate:manage", { rtUnitId: principal.rtUnitId })
  ) {
    notFound();
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <Brand compact />
        <SignOutButton />
      </header>
      <nav className="breadcrumb" aria-label="Jejak halaman">
        <Link href="/app">Ruang akun</Link>
        <span aria-hidden="true">/</span>
        <span>Tarif iuran</span>
      </nav>
      <ChairmanFeeRatesFlow />
      <SiteFooter />
    </main>
  );
}
