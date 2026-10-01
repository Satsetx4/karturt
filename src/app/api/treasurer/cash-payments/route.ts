import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  CashPaymentDueConflictError,
  CashPaymentHouseholdNotFoundError,
  CashPaymentIdempotencyConflictError,
  CashPaymentLedgerInvariantError,
  CashPaymentPendingRequestConflictError,
  InvalidCashPaymentInputError,
  recordTreasurerCashPayment,
} from "@/lib/billing/treasurer-cash-payments";
import { isSameOriginRequest } from "@/lib/http/request-security";

export const runtime = "nodejs";

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const bodySchema = z.object({
  householdId: uuidV4Schema,
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
}).strict();

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "treasurer") {
      return response({ message: "Pencatatan pembayaran tunai hanya tersedia untuk Bendahara aktif." }, 403);
    }
    if (!isSameOriginRequest(request)) {
      return response({ message: "Permintaan tidak dapat diproses dari alamat ini." }, 403);
    }
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
    if (!uuidV4Schema.safeParse(idempotencyKey).success) {
      return response({ message: "Permintaan perlu dimuat ulang sebelum dikirim." }, 400);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return response({ message: "Isi permintaan pembayaran tidak dapat dibaca." }, 400);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return response({ message: "Data rumah atau bulan yang dikirim tidak sesuai." }, 400);
    }

    const result = await recordTreasurerCashPayment(getDb(), principal, {
      ...parsed.data,
      idempotencyKey,
    });
    return response({
      ...result,
      message: result.replayed
        ? "Pembayaran tunai ini sudah tercatat sebelumnya."
        : "Pembayaran tunai berhasil dicatat.",
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response({ message: "Pencatatan pembayaran tunai hanya tersedia untuk Bendahara aktif." }, 403);
    }
    if (error instanceof InvalidCashPaymentInputError) {
      return response({ message: "Data rumah, bulan, atau kunci pengiriman tidak sesuai." }, 400);
    }
    if (error instanceof CashPaymentHouseholdNotFoundError) {
      return response({ message: "Rumah tidak ditemukan." }, 404);
    }
    if (error instanceof CashPaymentPendingRequestConflictError) {
      return response({ code: "pending_request_conflict", message: error.message }, 409);
    }
    if (error instanceof CashPaymentIdempotencyConflictError) {
      return response({ code: "idempotency_conflict", message: error.message }, 409);
    }
    if (error instanceof CashPaymentDueConflictError) {
      return response({ code: "dues_changed", message: error.message }, 409);
    }
    if (error instanceof CashPaymentLedgerInvariantError) {
      return response({ message: "Data pembayaran belum dapat dicatat. Hubungi pengelola sistem." }, 500);
    }
    return response({ message: "Pembayaran tunai belum dapat dicatat. Silakan coba lagi." }, 500);
  }
}
