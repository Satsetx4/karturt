import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentPrincipal, MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
import { getDb } from "@/db/client";
import { getPublicAppUrl } from "@/lib/env";
import { isSameOriginMutation } from "@/app/api/chairman/waivers/response";
import {
  AccountPinLockedError,
  AccountPinNotConfiguredError,
  changeAccountPin,
  InvalidCurrentAccountPinError,
} from "@/lib/auth/change-account-pin";

export const runtime = "nodejs";

const payloadSchema = z.object({
  currentPin: z.string().regex(/^\d{6}$/),
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
  if (!parsed.success) return response("PIN harus berisi tepat enam digit.", 400);

  try {
    const principal = await getCurrentPrincipal();
    await changeAccountPin(getDb(), principal, parsed.data);
    return NextResponse.json({ ok: true, reauthenticationRequired: true }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof MfaEnrollmentRequiredError) {
      return response("Silakan masuk kembali sebelum mengubah PIN.", 401);
    }
    if (error instanceof AccountPinLockedError) {
      return response("Terlalu banyak percobaan. Tunggu 15 menit sebelum mencoba lagi.", 429);
    }
    if (error instanceof InvalidCurrentAccountPinError) {
      return response("PIN saat ini belum cocok. Periksa kembali lalu coba lagi.", 401);
    }
    if (error instanceof AccountPinNotConfiguredError) {
      return response("PIN belum disiapkan pada akun ini. Hubungi pengelola melalui jalur resmi.", 409);
    }
    return response("PIN belum dapat diubah. Silakan coba lagi.", 500);
  }
}
