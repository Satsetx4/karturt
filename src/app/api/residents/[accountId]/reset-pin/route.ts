import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getDb } from "@/db/client";
import { resetResidentPin } from "@/lib/auth/reset-resident-pin";
import { getPublicAppUrl } from "@/lib/env";
import { isSameOriginMutation } from "@/app/api/chairman/waivers/response";

export const runtime = "nodejs";

const payloadSchema = z.object({
  pin: z.string().regex(/^\d{6}$/),
  reason: z.string().trim().min(1).max(500),
  recoveryReference: z.string().trim().min(1).max(100).regex(/^[A-Z]{2,10}-\d{4}-\d{3,8}$/).optional(),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  if (!isSameOriginMutation(request, getPublicAppUrl())) {
    return NextResponse.json({ message: "Permintaan tidak dapat diproses dari alamat ini." }, {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ message: "Format permintaan tidak valid." }, {
      status: 415,
      headers: { "cache-control": "no-store" },
    });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "Periksa kembali data yang dikirim." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Data pemulihan PIN tidak valid. Periksa PIN, alasan, dan format referensi." }, { status: 400, headers: { "cache-control": "no-store" } });

  const { accountId } = await context.params;
  if (!z.string().uuid().safeParse(accountId).success) return NextResponse.json({ message: "Akun warga tidak ditemukan." }, { status: 404, headers: { "cache-control": "no-store" } });

  try {
    const principal = await getCurrentPrincipal();
    if (principal.role === "system_admin" && !parsed.data.recoveryReference) {
      return NextResponse.json({ message: "Referensi pemulihan wajib diisi untuk System Admin." }, {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    const result = await resetResidentPin(getDb(), principal, {
      residentAccountId: accountId,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return NextResponse.json({ message: "Silakan masuk dengan akun yang berwenang." }, { status: 401, headers: { "cache-control": "no-store" } });
    }
    if (error instanceof Error && error.message.startsWith("Forbidden:")) {
      return NextResponse.json({ message: "Akun tidak memiliki wewenang untuk tindakan ini." }, { status: 403, headers: { "cache-control": "no-store" } });
    }
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ message: "Akun warga tidak ditemukan dalam cakupan yang diizinkan." }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ message: "PIN warga belum dapat diubah." }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
