import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  CashPaymentDueConflictError,
  CashPaymentHouseholdNotFoundError,
  InvalidCashPaymentInputError,
  getTreasurerCashPaymentHousehold,
} from "@/lib/billing/treasurer-cash-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ householdId: string }> },
) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "treasurer") {
      return response({ message: "Pencatatan pembayaran tunai hanya tersedia untuk Bendahara aktif." }, 403);
    }
    const { householdId } = await context.params;
    if (!uuidV4Schema.safeParse(householdId).success) {
      return response({ message: "Rumah tidak ditemukan." }, 404);
    }
    const url = new URL(request.url);
    const periods = url.searchParams.getAll("period");
    if (periods.length > 1 || (periods.length === 1 && !periodSchema.safeParse(periods[0]).success)) {
      return response({ message: "Bulan yang dipilih tidak sesuai." }, 400);
    }
    const result = await getTreasurerCashPaymentHousehold(
      getDb(), principal, householdId, periods[0],
    );
    return response(result as unknown as Record<string, unknown>);
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response({ message: "Pencatatan pembayaran tunai hanya tersedia untuk Bendahara aktif." }, 403);
    }
    if (error instanceof InvalidCashPaymentInputError) {
      return response({ message: "Bulan yang dipilih tidak sesuai." }, 400);
    }
    if (error instanceof CashPaymentHouseholdNotFoundError) {
      return response({ message: "Rumah tidak ditemukan." }, 404);
    }
    if (error instanceof CashPaymentDueConflictError) {
      return response({ code: "dues_changed", message: error.message }, 409);
    }
    return response({ message: "Rincian iuran belum dapat dimuat. Silakan coba lagi." }, 500);
  }
}
