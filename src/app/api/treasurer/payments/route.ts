import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  getTreasurerPaymentHistory,
  InvalidTreasurerPaymentHistoryCursorError,
} from "@/lib/billing/payment-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "treasurer") {
      return response({ message: "Riwayat transaksi hanya tersedia untuk Bendahara aktif." }, 403);
    }
    const url = new URL(request.url);
    if (url.searchParams.getAll("cursor").length > 1) {
      return response({ message: "Riwayat transaksi belum dapat dimuat. Muat ulang halaman." }, 400);
    }
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const history = await getTreasurerPaymentHistory(getDb(), principal, cursor);
    return response(history);
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response({ message: "Riwayat transaksi hanya tersedia untuk Bendahara aktif." }, 403);
    }
    if (error instanceof InvalidTreasurerPaymentHistoryCursorError) {
      return response({ message: "Riwayat transaksi belum dapat dimuat. Muat ulang halaman." }, 400);
    }
    return response({ message: "Riwayat transaksi belum dapat dimuat." }, 500);
  }
}
