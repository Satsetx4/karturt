import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { recoverSystemAdminTwoFactor } from "@/lib/auth/recover-system-admin-two-factor";
import { isSameOriginRequest } from "@/lib/http/request-security";

export const runtime = "nodejs";

const payloadSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  recoveryReference: z.string().trim().min(1).max(100).regex(/^[A-Z]{2,10}-\d{4}-\d{3,8}$/),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ message: "Permintaan tidak dapat diproses dari alamat ini." }, {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "Periksa kembali data pemulihan." }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Alasan dan nomor referensi wajib diisi." }, { status: 400 });

  const { accountId } = await context.params;
  if (!z.string().uuid().safeParse(accountId).success) return NextResponse.json({ message: "Akun System Admin tidak ditemukan." }, { status: 404 });

  try {
    const principal = await getCurrentPrincipal();
    const result = await recoverSystemAdminTwoFactor(getDb(), principal, {
      targetAccountId: accountId,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return NextResponse.json({ message: "Silakan masuk dengan akun System Admin yang sudah memverifikasi TOTP." }, { status: 401 });
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return NextResponse.json({ message: "Tindakan hanya tersedia bagi System Admin lain yang berwenang." }, { status: 403 });
    }
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ message: "Akun System Admin tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({ message: "Pemulihan faktor keamanan belum dapat dilakukan." }, { status: 500 });
  }
}
