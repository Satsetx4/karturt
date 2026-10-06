import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  getCurrentPrincipal,
  MfaEnrollmentRequiredError,
  UnauthenticatedError,
} from "@/lib/auth/principal";
import { getResidentProfile } from "@/lib/billing/resident-profile";
import { getResidentPaymentRequestHistory, InvalidResidentPaymentHistoryCursorError } from "@/lib/billing/resident-payment-request-history";
import { getPublicAppUrl } from "@/lib/env";
import {
  createResidentPaymentRequest,
  InvalidPaymentRequestInputError,
  PaymentRequestConflictError,
  PaymentRequestIdempotencyConflictError,
  PaymentRequestPeriodUnavailableError,
} from "@/lib/billing/resident-payment-request";
import { createResidentPaymentWhatsAppLink } from "@/lib/billing/resident-payment-whatsapp";

export const runtime = "nodejs";

const requestBodySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
}).strict();
const idempotencyKeySchema = z.string().uuid().refine(
  (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
);

function response(message: string, status: number) {
  return NextResponse.json({ message }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "resident") {
      return response("Pengajuan pembayaran hanya tersedia untuk akun warga.", 403);
    }
    const origin = request.headers.get("origin");
    let sameOrigin = false;
    try {
      if (origin) sameOrigin = new URL(origin).origin === new URL(getPublicAppUrl()).origin;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      return response("Permintaan tidak dapat diproses dari alamat ini.", 403);
    }

    const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return response("Pengajuan belum dapat diproses. Silakan coba lagi.", 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return response("Pilihan bulan belum dapat dibaca. Silakan pilih kembali.", 400);
    }
    const parsedBody = requestBodySchema.safeParse(body);
    if (!parsedBody.success) return response("Pilih satu bulan iuran yang tersedia.", 400);

    const database = getDb();
    const result = await createResidentPaymentRequest(database, principal, {
      period: parsedBody.data.period,
      idempotencyKey: key.data,
    });

    let whatsappUrl: string | null = null;
    try {
      const profile = await getResidentProfile(database, principal);
      const history = await getResidentPaymentRequestHistory(database, principal);
      const persistedRequest = history.requests.find((request) => request.requestCode === result.requestCode);
      if (!persistedRequest) throw new Error("Created payment request is missing from resident history.");
      whatsappUrl = createResidentPaymentWhatsAppLink({
        destinationNumber: process.env.KARTURT_DEMO_TREASURER_WHATSAPP_NUMBER,
        rtName: profile.rtName,
        houseNumber: profile.houseNumber,
        request: {
          requestCode: persistedRequest.requestCode,
          status: persistedRequest.status,
          periods: persistedRequest.items.map((item) => item.period),
          totalAmount: persistedRequest.totalAmount,
        },
      });
    } catch {
      // The payment request is already committed; a missing contact must not undo it.
    }

    return NextResponse.json({
      requestCode: result.requestCode,
      status: result.status,
      periods: result.periods,
      totalAmount: result.totalAmount,
      createdAt: result.createdAt,
      whatsappUrl,
      message: "Permintaan tercatat dengan status Menunggu konfirmasi.",
      contactMessage: whatsappUrl
        ? null
        : "Tautan WhatsApp demo belum tersedia. Permintaan Anda tetap tercatat.",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response("Sesi berakhir. Silakan masuk kembali.", 401);
    }
    if (error instanceof InvalidPaymentRequestInputError) return response(error.message, 400);
    if (error instanceof PaymentRequestPeriodUnavailableError) return response(error.message, 409);
    if (error instanceof PaymentRequestConflictError || error instanceof PaymentRequestIdempotencyConflictError) {
      return response("Salah satu bulan sudah diajukan atau berubah. Muat ulang iuran untuk melihat status terbaru.", 409);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response("Pengajuan pembayaran hanya tersedia untuk akun warga yang aktif.", 403);
    }
    return response("Permintaan belum dapat disimpan. Periksa sambungan internet lalu coba lagi.", 500);
  }
}

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "resident") {
      return response("Riwayat permintaan hanya tersedia untuk akun warga.", 403);
    }
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    const database = getDb();
    const history = await getResidentPaymentRequestHistory(database, principal, cursor);
    const pendingRequests = history.requests.filter((item) => item.status === "pending");
    let whatsappByCode = new Map<string, string | null>();
    if (pendingRequests.length > 0) {
      try {
        const profile = await getResidentProfile(database, principal);
        whatsappByCode = new Map(pendingRequests.map((item) => [item.requestCode, createResidentPaymentWhatsAppLink({
          destinationNumber: process.env.KARTURT_DEMO_TREASURER_WHATSAPP_NUMBER,
          rtName: profile.rtName,
          houseNumber: profile.houseNumber,
          request: {
            requestCode: item.requestCode,
            status: item.status,
            periods: item.items.map((requestItem) => requestItem.period),
            totalAmount: item.totalAmount,
          },
        })]));
      } catch {
        // The history remains available when demo contact configuration is missing.
      }
    }
    return NextResponse.json({
      ...history,
      requests: history.requests.map((item) => ({
        ...item,
        whatsappUrl: whatsappByCode.get(item.requestCode) ?? null,
        contactMessage: item.status === "pending" && !whatsappByCode.get(item.requestCode)
          ? "Tautan WhatsApp demo belum tersedia. Permintaan Anda tetap tercatat."
          : null,
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response("Sesi berakhir. Silakan masuk kembali.", 401);
    }
    if (error instanceof InvalidResidentPaymentHistoryCursorError) {
      return response("Riwayat permintaan belum dapat dimuat. Muat ulang halaman.", 400);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response("Riwayat permintaan hanya tersedia untuk akun warga aktif.", 403);
    }
    return response("Riwayat permintaan belum dapat dimuat.", 500);
  }
}
