import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  InvalidCashPaymentInputError,
  searchTreasurerCashPaymentHouseholds,
} from "@/lib/billing/treasurer-cash-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  search: z.string().trim().min(1).max(80),
  page: z.coerce.number().int().min(1).max(1000).default(1),
}).strict();

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (principal.role !== "treasurer") {
      return response({ message: "Pencatatan pembayaran tunai hanya tersedia untuk Bendahara aktif." }, 403);
    }
    const url = new URL(request.url);
    if (url.searchParams.getAll("search").length !== 1 || url.searchParams.getAll("page").length > 1) {
      return response({ message: "Kata pencarian rumah tidak sesuai." }, 400);
    }
    const parsed = querySchema.safeParse({
      search: url.searchParams.get("search"),
      page: url.searchParams.get("page") ?? "1",
    });
    if (!parsed.success) return response({ message: "Masukkan nomor rumah atau nama warga untuk mencari." }, 400);
    const result = await searchTreasurerCashPaymentHouseholds(
      getDb(), principal, parsed.data.search, parsed.data.page,
    );
    return response(result);
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return response({ message: "Pencatatan pembayaran tunai hanya tersedia untuk Bendahara aktif." }, 403);
    }
    if (error instanceof InvalidCashPaymentInputError) {
      return response({ message: error.message }, 400);
    }
    return response({ message: "Daftar rumah belum dapat dimuat. Silakan coba lagi." }, 500);
  }
}
