import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  getResidentPaymentHistory,
  InvalidResidentPaymentHistoryPageError,
} from "@/lib/billing/payment-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "resident") {
      return response("Riwayat pembayaran hanya tersedia untuk akun warga.", 403);
    }
    const url = new URL(request.url);
    if (url.searchParams.getAll("page").length > 1) {
      return response("Riwayat pembayaran belum dapat dimuat.", 400);
    }
    const rawPage = url.searchParams.get("page") ?? "1";
    if (!/^\d{1,4}$/.test(rawPage)) return response("Riwayat pembayaran belum dapat dimuat.", 400);
    const history = await getResidentPaymentHistory(getDb(), principal, Number(rawPage));
    return NextResponse.json(history, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response("Sesi berakhir. Silakan masuk kembali.", 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response("Riwayat pembayaran hanya tersedia untuk akun warga aktif.", 403);
    }
    if (error instanceof InvalidResidentPaymentHistoryPageError) {
      return response("Riwayat pembayaran belum dapat dimuat.", 400);
    }
    return response("Riwayat pembayaran belum dapat dimuat.", 500);
  }
}
