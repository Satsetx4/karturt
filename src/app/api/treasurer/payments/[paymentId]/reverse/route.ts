import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  InvalidPaymentReversalInputError,
  reverseTreasurerPayment,
  TreasurerPaymentAlreadyReversedError,
  TreasurerPaymentNotFoundError,
  TreasurerPaymentReversalConflictError,
  TreasurerPaymentReversalInvariantError,
} from "@/lib/billing/treasurer-payment-reversal";
import { isSameOriginRequest } from "@/lib/http/request-security";

export const runtime = "nodejs";

const paymentIdSchema = z.string().uuid().refine(
  (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
);
const bodySchema = z.object({ reason: z.string().max(500) }).strict();

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ paymentId: string }> },
) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "treasurer") {
      return response({ message: "Pembatalan pencatatan hanya tersedia untuk Bendahara aktif." }, 403);
    }
    if (!isSameOriginRequest(request)) {
      return response({ message: "Permintaan tidak dapat diproses dari alamat ini." }, 403);
    }

    const { paymentId: rawPaymentId } = await context.params;
    const parsedId = paymentIdSchema.safeParse(rawPaymentId);
    if (!parsedId.success) return response({ message: "Pembayaran tidak ditemukan." }, 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return response({ message: "Alasan pembatalan tidak dapat dibaca." }, 400);
    }
    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return response({ message: "Isi alasan pembatalan belum sesuai." }, 400);
    }

    const result = await reverseTreasurerPayment(getDb(), principal, {
      paymentId: parsedId.data,
      reason: parsedBody.data.reason,
    });
    return response({
      status: result.status,
      method: result.method,
      itemCount: result.itemCount,
      totalAmount: result.totalAmount,
      reversedAt: result.reversedAt,
      message: "Pencatatan pembayaran dibatalkan. Histori tetap tersimpan dan bulan terkait kembali Belum bayar.",
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response({ message: "Pembatalan pencatatan hanya tersedia untuk Bendahara aktif." }, 403);
    }
    if (error instanceof InvalidPaymentReversalInputError) {
      return response({ message: error.message }, 400);
    }
    if (error instanceof TreasurerPaymentNotFoundError) {
      return response({ message: "Pembayaran tidak ditemukan." }, 404);
    }
    if (error instanceof TreasurerPaymentAlreadyReversedError) {
      return response({ code: "already_reversed", message: "Pembayaran ini sudah dibatalkan. Muat ulang riwayat transaksi." }, 409);
    }
    if (error instanceof TreasurerPaymentReversalConflictError) {
      return response({ code: "payment_changed", message: "Status pembayaran berubah. Muat ulang riwayat transaksi." }, 409);
    }
    if (error instanceof TreasurerPaymentReversalInvariantError) {
      return response({ message: "Pembayaran belum dapat dibatalkan. Hubungi pengelola sistem." }, 500);
    }
    return response({ message: "Pembayaran belum dapat dibatalkan. Silakan coba lagi." }, 500);
  }
}
