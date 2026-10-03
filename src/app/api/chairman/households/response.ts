import { NextResponse } from "next/server";
import { MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  HouseholdConflictError,
  HouseholdForbiddenError,
  HouseholdNotFoundError,
  InvalidHouseholdInputError,
} from "@/lib/households/lifecycle";

export function householdJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function householdErrorResponse(error: unknown, operation: "load" | "save" = "save") {
  if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
    return householdJson({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
  }
  if (error instanceof HouseholdForbiddenError || (error instanceof Error && error.message.startsWith("Forbidden:"))) {
    return householdJson({ message: "Pengelolaan rumah hanya tersedia untuk Ketua RT aktif." }, 403);
  }
  if (error instanceof InvalidHouseholdInputError) {
    return householdJson({ message: "Periksa kembali data yang diisi." }, 400);
  }
  if (error instanceof HouseholdNotFoundError) {
    return householdJson({ message: "Rumah atau data warga tidak ditemukan dalam cakupan yang diizinkan." }, 404);
  }
  if (error instanceof HouseholdConflictError) {
    return householdJson({
      message: "Perubahan belum dapat dilakukan karena periode atau riwayat terkait. Muat ulang lalu tinjau datanya.",
    }, 409);
  }
  return householdJson({
    message: operation === "load"
      ? "Daftar rumah belum dapat dimuat. Silakan coba lagi."
      : "Perubahan belum dapat disimpan. Silakan coba lagi.",
  }, 500);
}

export function isSameOriginMutation(request: Request, publicAppUrl: string) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(publicAppUrl).origin;
  } catch {
    return false;
  }
}
