import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getTreasurerPaymentRequestDetail } from "@/lib/billing/treasurer-payment-requests";

export const runtime = "nodejs";

const requestCodeSchema = z.string().regex(/^KRT-[A-F0-9]{16}$/);

function response(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestCode: string }> },
) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "treasurer") {
      return response("Rincian pembayaran hanya tersedia untuk akun Bendahara aktif.", 403);
    }
    const { requestCode: rawRequestCode } = await context.params;
    const parsedCode = requestCodeSchema.safeParse(rawRequestCode);
    if (!parsedCode.success) return response("Permintaan pembayaran tidak ditemukan.", 404);

    const detail = await getTreasurerPaymentRequestDetail(getDb(), principal, parsedCode.data);
    if (!detail) return response("Permintaan pembayaran tidak ditemukan.", 404);
    return NextResponse.json({ request: detail }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response("Sesi berakhir. Silakan masuk kembali.", 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response("Rincian pembayaran hanya tersedia untuk akun Bendahara aktif.", 403);
    }
    return response("Rincian pembayaran belum dapat dimuat. Silakan coba lagi.", 500);
  }
}
