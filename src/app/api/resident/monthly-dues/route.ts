import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";

export const runtime = "nodejs";

export async function GET() {
  try {
    const principal = await getCurrentPrincipal();
    const dues = await getResidentMonthlyDues(getDb(), principal);
    return NextResponse.json({ dues }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return NextResponse.json({ message: "Silakan masuk terlebih dahulu." }, { status: 401 });
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return NextResponse.json({ message: "Data iuran hanya tersedia untuk akun warga yang aktif." }, { status: 403 });
    }
    return NextResponse.json({ message: "Data iuran belum dapat dimuat." }, { status: 500 });
  }
}
