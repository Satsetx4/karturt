import { NextResponse } from "next/server";
import { MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  ChairmanFeeRateConflictError,
  ChairmanFeeRateForbiddenError,
  ChairmanFeeRateNotFoundError,
  InvalidChairmanFeeRateInputError,
} from "@/lib/billing/chairman-fee-rates";

export function feeRateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function feeRateErrorResponse(error: unknown) {
  if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
    return feeRateJson({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
  }
  if (error instanceof ChairmanFeeRateForbiddenError || (error instanceof Error && error.message.startsWith("Forbidden:"))) {
    return feeRateJson({ message: "Tarif iuran hanya tersedia untuk Ketua RT aktif." }, 403);
  }
  if (error instanceof InvalidChairmanFeeRateInputError) {
    return feeRateJson({ message: error.message }, 400);
  }
  if (error instanceof ChairmanFeeRateNotFoundError) {
    return feeRateJson({ message: "Tahun tagihan tidak ditemukan." }, 404);
  }
  if (error instanceof ChairmanFeeRateConflictError) {
    return feeRateJson({ message: error.message }, 409);
  }
  return feeRateJson({ message: "Tarif iuran belum dapat diproses. Silakan coba lagi." }, 500);
}
