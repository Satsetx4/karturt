import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { ChairmanReports } from "@/components/chairman-reports";
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
  title: "Laporan iuran",
  alternates: { canonical: "/app/laporan" },
  robots: { index: false, follow: false },
};

type ChairmanReportsPageProps = {
  searchParams: Promise<{ year?: string | string[] }>;
};

function jakartaCurrentYear() {
  return Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
  }).format(new Date()));
}

function selectedYearFromQuery(value: string | string[] | undefined) {
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) {
    return { year: jakartaCurrentYear(), explicit: false };
  }
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    return { year: jakartaCurrentYear(), explicit: false };
  }
  return { year, explicit: true };
}

export default async function ChairmanReportsPage({ searchParams }: ChairmanReportsPageProps) {
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
    !canPerform(principal, "report:read:rt", { rtUnitId: principal.rtUnitId })
  ) {
    notFound();
  }

  const query = await searchParams;
  const selection = selectedYearFromQuery(query.year);

  return (
    <main className="page-shell chairman-reports-page">
      <header className="topbar">
        <Brand compact />
        <SignOutButton />
      </header>
      <nav className="breadcrumb" aria-label="Jejak halaman">
        <Link href="/app"><ArrowLeft size={16} aria-hidden="true" />Kembali ke ruang akun</Link>
        <span aria-hidden="true">/</span>
        <span>Laporan</span>
      </nav>
      <ChairmanReports
        initialYear={selection.year}
        autoSelectAvailableYear={!selection.explicit}
      />
      <SiteFooter />
    </main>
  );
}
