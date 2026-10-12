import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { jakartaBusinessDate } from "@/lib/time/jakarta";

export const runtime = "nodejs";
const privateNoStoreHeaders = { "cache-control": "private, no-store" };

export async function GET() {
  try {
    const principal = await getCurrentPrincipal();
    const businessDate = jakartaBusinessDate();
    const dues = await getResidentMonthlyDues(getDb(), principal, businessDate);
    return NextResponse.json({ dues, businessDate }, { headers: privateNoStoreHeaders });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return NextResponse.json({ message: "Silakan masuk terlebih dahulu." }, { status: 401, headers: privateNoStoreHeaders });
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return NextResponse.json({ message: "Data iuran hanya tersedia untuk akun warga yang aktif." }, { status: 403, headers: privateNoStoreHeaders });
    }
    return NextResponse.json({ message: "Data iuran belum dapat dimuat." }, { status: 500, headers: privateNoStoreHeaders });
  }
}
