import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getPublicAppUrl } from "@/lib/env";
import { isSameOriginMutation } from "@/app/api/chairman/waivers/response";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import {
  AccountPinRecoveryLockedError,
  AccountPinRecoveryNotAvailableError,
  DuplicateOfficialAccountPinError,
  InvalidAccountPasswordForPinRecoveryError,
  InvalidPinRecoveryInputError,
  recoverAccountPin,
} from "@/lib/auth/recover-account-pin";

export const runtime = "nodejs";

const payloadSchema = z.object({
  currentPassword: z.string().min(16).max(128),
  newPin: z.string().regex(/^\d{6}$/),
}).strict();

function response(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request, getPublicAppUrl())) {
    return response("Permintaan tidak dapat diproses dari alamat ini.", 403);
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return response("Format permintaan tidak valid.", 415);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return response("Periksa kembali data yang dikirim.", 400);
  }
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return response("Kata sandi harus berisi 16–128 karakter dan PIN tepat enam digit.", 400);

  try {
    const principal = await getCurrentPrincipal();
    await recoverAccountPin(getDb(), principal, parsed.data);
    return NextResponse.json({ ok: true, reauthenticationRequired: true }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response("Silakan masuk kembali setelah memenuhi verifikasi akun.", 401);
    }
    if (error instanceof AccountPinRecoveryLockedError) {
      return response("Terlalu banyak percobaan. Tunggu 15 menit sebelum mencoba lagi.", 429);
    }
    if (error instanceof InvalidAccountPasswordForPinRecoveryError) {
      return response("Kata sandi akun belum cocok. Periksa kembali lalu coba lagi.", 401);
    }
    if (error instanceof InvalidPinRecoveryInputError) {
      return response("Kata sandi atau PIN baru tidak memenuhi kebijakan akun.", 400);
    }
    if (error instanceof DuplicateOfficialAccountPinError) {
      return response("PIN pengurus harus berbeda dari PIN akun pengurus lain.", 409);
    }
    if (error instanceof AccountPinRecoveryNotAvailableError) {
      return response("Pemulihan PIN hanya tersedia bagi pengurus dan System Admin aktif.", 403);
    }
    return response("Pemulihan PIN belum dapat dilakukan. Silakan coba lagi.", 500);
  }
}
