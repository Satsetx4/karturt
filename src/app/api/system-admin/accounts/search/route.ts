import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { RecoveryDirectoryForbiddenError, recoverySearchSchema, searchRecoveryAccounts } from "@/lib/accounts/recovery-directory";
import { isSameOriginRequest } from "@/lib/http/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return json({ message: "Alamat pengiriman tidak diizinkan." }, 403);
  if (new URL(request.url).search) return json({ message: "Gunakan formulir pencarian akun." }, 400);
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return json({ message: "Format permintaan tidak valid." }, 415);
  try {
    const principal = await getCurrentPrincipal();
    let body: unknown;
    try { body = await request.json(); } catch { return json({ message: "Pencarian tidak dapat dibaca." }, 400); }
    return json(await searchRecoveryAccounts(getDb(), principal, recoverySearchSchema.parse(body)));
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) return json({ message: "Masuk kembali dengan System Admin dan MFA terverifikasi." }, 401);
    if (error instanceof RecoveryDirectoryForbiddenError) return json({ message: "Pencarian pemulihan hanya untuk System Admin." }, 403);
    if (error instanceof ZodError) return json({ message: "Masukkan nomor rumah atau username persis, maksimal 100 karakter." }, 400);
    return json({ message: "Pencarian akun belum dapat dilakukan. Coba lagi." }, 500);
  }
}
