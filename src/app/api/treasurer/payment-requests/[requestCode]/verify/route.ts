import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getPublicAppUrl } from "@/lib/env";
import {
  TreasurerPaymentLedgerInvariantError,
  TreasurerPaymentRequestAlreadyProcessedError,
  TreasurerPaymentRequestConflictError,
  TreasurerPaymentRequestNotFoundError,
  verifyTreasurerPaymentRequest,
} from "@/lib/billing/treasurer-payment-verification";

export const runtime = "nodejs";

const requestCodeSchema = z.string().regex(/^KRT-[A-F0-9]{16}$/);
const requestBodySchema = z.object({}).strict();

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(getPublicAppUrl()).origin;
  } catch {
    return false;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ requestCode: string }> },
) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "treasurer") {
      return response({ message: "Konfirmasi pembayaran hanya tersedia untuk akun Bendahara aktif." }, 403);
    }
    if (!isSameOrigin(request)) {
      return response({ message: "Permintaan tidak dapat diproses dari alamat ini." }, 403);
    }

    const { requestCode: rawRequestCode } = await context.params;
    const parsedCode = requestCodeSchema.safeParse(rawRequestCode);
    if (!parsedCode.success) return response({ message: "Permintaan pembayaran tidak ditemukan." }, 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return response({ message: "Permintaan konfirmasi tidak dapat dibaca." }, 400);
    }
    if (!requestBodySchema.safeParse(body).success) {
      return response({ message: "Isi permintaan konfirmasi tidak sesuai." }, 400);
    }

    const result = await verifyTreasurerPaymentRequest(getDb(), principal, parsedCode.data);
    return response({
      requestCode: result.requestCode,
      status: result.status,
      itemCount: result.itemCount,
      totalAmount: result.totalAmount,
      verifiedAt: result.verifiedAt,
      message: "Pembayaran berhasil dikonfirmasi.",
    }, 200);
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response({ message: "Konfirmasi pembayaran hanya tersedia untuk akun Bendahara aktif." }, 403);
    }
    if (error instanceof TreasurerPaymentRequestNotFoundError) {
      return response({ message: "Permintaan pembayaran tidak ditemukan." }, 404);
    }
    if (error instanceof TreasurerPaymentRequestAlreadyProcessedError) {
      return response({ code: "already_processed", message: "Permintaan ini sudah diproses. Muat ulang antrean." }, 409);
    }
    if (error instanceof TreasurerPaymentRequestConflictError) {
      return response({ code: "request_changed", message: "Data bulan berubah. Muat ulang antrean sebelum mencoba lagi." }, 409);
    }
    if (error instanceof TreasurerPaymentLedgerInvariantError) {
      return response({ message: "Data permintaan belum dapat diverifikasi. Hubungi pengelola sistem." }, 500);
    }
    return response({ message: "Pembayaran belum dapat dikonfirmasi. Silakan coba lagi." }, 500);
  }
}
