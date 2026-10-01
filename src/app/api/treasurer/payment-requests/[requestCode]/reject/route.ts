import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getPublicAppUrl } from "@/lib/env";
import {
  InvalidPaymentRequestResolutionInputError,
  PaymentRequestAlreadyProcessedError,
  PaymentRequestResolutionConflictError,
  PaymentRequestResolutionInvariantError,
  PaymentRequestResolutionNotFoundError,
  rejectTreasurerPaymentRequest,
} from "@/lib/billing/payment-request-resolution";

export const runtime = "nodejs";

const requestCodeSchema = z.string().regex(/^KRT-[A-F0-9]{16}$/);
const requestBodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

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
      return response({ message: "Penolakan hanya tersedia untuk akun Bendahara aktif." }, 403);
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
      return response({ message: "Permintaan penolakan tidak dapat dibaca." }, 400);
    }
    const parsedBody = requestBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return response({ message: "Alasan penolakan wajib diisi dan maksimal 500 karakter." }, 400);
    }

    const result = await rejectTreasurerPaymentRequest(getDb(), principal, parsedCode.data, parsedBody.data.reason);
    return response({
      requestCode: result.requestCode,
      status: result.status,
      resolvedAt: result.resolvedAt,
      message: "Permintaan ditolak. Bulan iuran kembali Belum bayar dan dapat diajukan lagi.",
    }, 200);
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response({ message: "Penolakan hanya tersedia untuk Bendahara aktif pada RT yang sama." }, 403);
    }
    if (error instanceof PaymentRequestResolutionNotFoundError) {
      return response({ message: "Permintaan pembayaran tidak ditemukan." }, 404);
    }
    if (error instanceof InvalidPaymentRequestResolutionInputError) {
      return response({ message: error.message }, 400);
    }
    if (error instanceof PaymentRequestAlreadyProcessedError) {
      return response({ code: "already_processed", message: "Permintaan ini sudah diproses. Muat ulang antrean." }, 409);
    }
    if (error instanceof PaymentRequestResolutionConflictError) {
      return response({ code: "request_changed", message: "Data bulan berubah. Muat ulang antrean sebelum mencoba lagi." }, 409);
    }
    if (error instanceof PaymentRequestResolutionInvariantError) {
      return response({ message: "Permintaan belum dapat ditolak. Hubungi pengelola sistem." }, 500);
    }
    return response({ message: "Permintaan belum dapat ditolak. Silakan coba lagi." }, 500);
  }
}
