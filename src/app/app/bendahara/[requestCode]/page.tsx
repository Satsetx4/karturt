import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock3, Home } from "lucide-react";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { SignOutButton } from "@/components/sign-out-button";
import { TreasurerVerificationButton } from "@/components/treasurer-verification-button";
import { TreasurerRejectionForm } from "@/components/treasurer-rejection-form";
import { TreasurerResolutionCoordinator } from "@/components/treasurer-resolution-coordinator";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getTreasurerPaymentRequestDetail } from "@/lib/billing/treasurer-payment-requests";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rincian permintaan pembayaran",
  alternates: { canonical: "/app/bendahara" },
  robots: { index: false, follow: false },
};

const rupiah = (amount: number) => new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
}).format(amount);

const requestDate = (value: Date) => new Intl.DateTimeFormat("id-ID", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
}).format(value);

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function periodName(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

export default async function TreasurerPaymentRequestDetailPage({
  params,
}: {
  params: Promise<{ requestCode: string }>;
}) {
  const { requestCode } = await params;
  if (!/^KRT-[A-F0-9]{16}$/.test(requestCode)) notFound();

  let principal;
  try {
    principal = await getCurrentPrincipal();
  } catch (error) {
    if (error instanceof MfaEnrollmentRequiredError) redirect("/system/2fa/setup");
    if (error instanceof UnauthenticatedError) redirect("/login/pengurus");
    throw error;
  }
  if (principal.role !== "treasurer") notFound();

  const paymentRequest = await getTreasurerPaymentRequestDetail(getDb(), principal, requestCode);
  if (!paymentRequest) notFound();
  const processed = paymentRequest.status !== "pending";

  return (
    <main className="page-shell">
      <header className="topbar">
        <Brand compact />
        <SignOutButton />
      </header>
      <nav className="breadcrumb" aria-label="Jejak halaman">
        <Link href="/app">Antrean Bendahara</Link>
        <span aria-hidden="true">/</span>
        <span>Rincian permintaan</span>
      </nav>
      <section className="treasurer-area treasurer-detail-area" aria-labelledby="request-detail-title">
        <Link className="treasurer-back-link" href="/app"><ArrowLeft size={18} aria-hidden="true" /> Kembali ke antrean</Link>
        <div className="treasurer-heading">
          <p className="eyebrow">VERIFIKASI TRANSFER</p>
          <h1 id="request-detail-title">Rincian permintaan</h1>
          <p>Kode permintaan <strong>{paymentRequest.requestCode}</strong></p>
        </div>

        <section className="treasurer-detail-card" aria-label="Data warga dan permintaan">
          <div className={processed ? "treasurer-status treasurer-status--done" : "treasurer-status"}>
            {processed ? <CheckCircle2 size={19} aria-hidden="true" /> : <Clock3 size={19} aria-hidden="true" />}
            <span>{paymentRequest.status === "verified"
              ? "Sudah dikonfirmasi"
              : paymentRequest.status === "rejected"
                ? "Ditolak"
                : paymentRequest.status === "cancelled"
                  ? "Dibatalkan warga"
                  : "Menunggu konfirmasi"}</span>
          </div>
          <h2>{paymentRequest.residentName}</h2>
          <p className="treasurer-house"><Home size={17} aria-hidden="true" /> Rumah {paymentRequest.houseNumber}</p>
          <div className="treasurer-request-meta">
            <span>Waktu pengajuan</span>
            <time dateTime={paymentRequest.createdAt.toISOString()}>{requestDate(paymentRequest.createdAt)}</time>
          </div>

          <h3>Bulan dan jumlah</h3>
          <ul className="treasurer-detail-items">
            {paymentRequest.items.map((item) => (
              <li key={item.period}>
                <span>{periodName(item.period)}</span>
                <strong>{rupiah(item.amount)}</strong>
              </li>
            ))}
          </ul>
          <div className="treasurer-detail-total">
            <span>Total permintaan</span>
            <strong>{rupiah(paymentRequest.totalAmount)}</strong>
          </div>

          {paymentRequest.status === "verified" && paymentRequest.verifiedAt && (
            <p className="treasurer-verified-time">Dikonfirmasi {requestDate(paymentRequest.verifiedAt)}</p>
          )}
          {paymentRequest.status === "rejected" && paymentRequest.resolvedAt && (
            <p className="treasurer-verified-time">
              Ditolak {requestDate(paymentRequest.resolvedAt)}
              {paymentRequest.resolutionReason && <><br /><strong>Alasan:</strong> {paymentRequest.resolutionReason}</>}
            </p>
          )}
          {paymentRequest.status === "cancelled" && paymentRequest.resolvedAt && (
            <p className="treasurer-verified-time">Dibatalkan warga {requestDate(paymentRequest.resolvedAt)}</p>
          )}

          {!processed ? (
            <>
              <p className="treasurer-warning">Pastikan transfer sudah diterima sebelum mengonfirmasi.</p>
              <TreasurerResolutionCoordinator>
                <TreasurerVerificationButton requestCode={paymentRequest.requestCode} />
                <TreasurerRejectionForm requestCode={paymentRequest.requestCode} />
              </TreasurerResolutionCoordinator>
            </>
          ) : (
            <p className="treasurer-processed-note" role="status">Permintaan ini sudah diproses dan tidak dapat diubah.</p>
          )}
        </section>
      </section>
      <SiteFooter />
    </main>
  );
}
