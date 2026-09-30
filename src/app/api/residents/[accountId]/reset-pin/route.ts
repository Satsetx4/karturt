import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getDb } from "@/db/client";
import { resetResidentPin } from "@/lib/auth/reset-resident-pin";

export const runtime = "nodejs";

const payloadSchema = z.object({
  pin: z.string().regex(/^\d{6}$/),
  reason: z.string().trim().min(1).max(500),
  recoveryReference: z.string().trim().min(1).max(100).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "Periksa kembali data yang dikirim." }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "PIN harus tepat enam digit dan alasan wajib diisi." }, { status: 400 });

  const { accountId } = await context.params;
  if (!z.string().uuid().safeParse(accountId).success) return NextResponse.json({ message: "Akun warga tidak ditemukan." }, { status: 404 });

  try {
    const principal = await getCurrentPrincipal();
    const result = await resetResidentPin(getDb(), principal, {
      residentAccountId: accountId,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return NextResponse.json({ message: "Silakan masuk dengan akun yang berwenang." }, { status: 401 });
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return NextResponse.json({ message: "Akun tidak memiliki wewenang untuk tindakan ini." }, { status: 403 });
    }
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ message: "Akun warga tidak ditemukan dalam cakupan yang diizinkan." }, { status: 404 });
    }
    return NextResponse.json({ message: "PIN warga belum dapat diubah." }, { status: 500 });
  }
}
