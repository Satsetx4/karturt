import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, UnauthenticatedError, MfaEnrollmentRequiredError } from "@/lib/auth/principal";
import { getPaymentNotifications, PaymentNotificationsForbiddenError } from "@/lib/billing/payment-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", "vary": "Cookie" };

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (new URL(request.url).search) return NextResponse.json({ message: "Filter tidak tersedia." }, { status: 400, headers });
    return NextResponse.json(await getPaymentNotifications(getDb(), principal), { headers });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return NextResponse.json({ message: "Silakan masuk kembali." }, { status: 401, headers });
    }
    if (error instanceof PaymentNotificationsForbiddenError) {
      return NextResponse.json({ message: "Pemberitahuan tidak tersedia untuk akun ini." }, { status: 403, headers });
    }
    return NextResponse.json({ message: "Pemberitahuan belum dapat diperbarui." }, { status: 500, headers });
  }
}
