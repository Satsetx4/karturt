import { ZodError } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getPublicAppUrl } from "@/lib/env";
import { changeOfficial, listOfficials, officialMutationSchema, OfficialConflictError, OfficialForbiddenError, OfficialNotFoundError } from "@/lib/officials/management";
import { isSameOriginMutation } from "@/app/api/chairman/waivers/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) return json({ message: "Sesi berakhir. Silakan masuk kembali." }, 401);
  if (error instanceof OfficialForbiddenError) return json({ message: "Pengelolaan jabatan hanya untuk Ketua RT aktif." }, 403);
  if (error instanceof OfficialNotFoundError) return json({ message: "Akun atau jabatan tidak ditemukan di RT Anda." }, 404);
  if (error instanceof ZodError) return json({ message: "Periksa pilihan akun, tanggal, dan alasan. Jangan masukkan PIN atau data pribadi dalam alasan." }, 400);
  if (error instanceof OfficialConflictError) return json({ message: error.message }, 409);
  return json({ message: "Perubahan belum dapat dipastikan. Muat ulang daftar sebelum mencoba lagi." }, 500);
}
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) return json({ message: "Filter tidak didukung." }, 400);
    return json(await listOfficials(getDb(), await getCurrentPrincipal()));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!isSameOriginMutation(request, getPublicAppUrl())) return json({ message: "Alamat pengiriman tidak diizinkan." }, 403);
    const principal = await getCurrentPrincipal();
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return json({ message: "Format permintaan tidak valid." }, 415);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ message: "Data tidak dapat dibaca." }, 400); }
    const result = await changeOfficial(getDb(), principal, officialMutationSchema.parse(body));
    return json({ message: result.replay ? "Perubahan ini sudah tercatat. Periksa daftar terbaru." : "Perubahan jabatan tersimpan. Sesi akun terkait dicabut; akses jabatan mengikuti tanggal WIB.", replay: result.replay });
  } catch (error) { return failure(error); }
}
