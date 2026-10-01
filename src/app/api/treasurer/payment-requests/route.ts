import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getTreasurerPaymentRequestQueue } from "@/lib/billing/treasurer-payment-requests";

export const runtime = "nodejs";

function response(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "treasurer") {
      return response("Antrean pembayaran hanya tersedia untuk akun Bendahara aktif.", 403);
    }
    const requests = await getTreasurerPaymentRequestQueue(getDb(), principal);
    return NextResponse.json({ pendingCount: requests.length, requests }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response("Sesi berakhir. Silakan masuk kembali.", 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response("Antrean pembayaran hanya tersedia untuk akun Bendahara aktif.", 403);
    }
    return response("Antrean pembayaran belum dapat dimuat. Silakan coba lagi.", 500);
  }
}
