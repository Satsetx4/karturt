import { NextResponse } from "next/server";
import { MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  ChairmanWaiverConflictError,
  ChairmanWaiverForbiddenError,
  ChairmanWaiverHouseholdNotFoundError,
  ChairmanWaiverPeriodUnavailableError,
  InvalidChairmanWaiverInputError,
} from "@/lib/billing/chairman-waiver";

export function waiverJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function waiverErrorResponse(error: unknown, fallback: string) {
  if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
    return waiverJson({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
  }
  if (error instanceof ChairmanWaiverForbiddenError || (error instanceof Error && error.message.startsWith("Forbidden:"))) {
    return waiverJson({ message: "Fitur pemutihan hanya tersedia untuk Ketua RT aktif." }, 403);
  }
  if (error instanceof InvalidChairmanWaiverInputError) {
    return waiverJson({ message: error.message }, 400);
  }
  if (error instanceof ChairmanWaiverHouseholdNotFoundError) {
    return waiverJson({ message: "Rumah tidak ditemukan." }, 404);
  }
  if (error instanceof ChairmanWaiverConflictError || error instanceof ChairmanWaiverPeriodUnavailableError) {
    return waiverJson({ message: error.message }, 409);
  }
  return waiverJson({ message: fallback }, 500);
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
