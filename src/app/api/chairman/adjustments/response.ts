import { NextResponse } from "next/server";
import { MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  ChairmanAdjustmentConflictError,
  ChairmanAdjustmentForbiddenError,
  ChairmanAdjustmentInvariantError,
  ChairmanAdjustmentNotFoundError,
  InvalidChairmanAdjustmentInputError,
} from "@/lib/billing/chairman-adjustment";

export function adjustmentJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function adjustmentErrorResponse(error: unknown) {
  if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
    return adjustmentJson({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
  }
  if (error instanceof ChairmanAdjustmentForbiddenError || (error instanceof Error && error.message.startsWith("Forbidden:"))) {
    return adjustmentJson({ message: "Penyesuaian hanya tersedia untuk Ketua RT aktif." }, 403);
  }
  if (error instanceof InvalidChairmanAdjustmentInputError) {
    return adjustmentJson({ message: error.message }, 400);
  }
  if (error instanceof ChairmanAdjustmentNotFoundError) {
    return adjustmentJson({ message: "Rumah atau tagihan tidak ditemukan." }, 404);
  }
  if (error instanceof ChairmanAdjustmentConflictError) {
    return adjustmentJson({ message: error.message }, 409);
  }
  if (error instanceof ChairmanAdjustmentInvariantError) {
    return adjustmentJson({ message: "Saldo tagihan belum dapat diverifikasi. Coba lagi." }, 500);
  }
  return adjustmentJson({ message: "Penyesuaian belum dapat diproses. Silakan coba lagi." }, 500);
}
