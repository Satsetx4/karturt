import { z } from "zod";
import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { replaceHouseholdResident } from "@/lib/households/lifecycle";
import { getPublicAppUrl } from "@/lib/env";
import { householdErrorResponse, householdJson, isSameOriginMutation } from "../../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const phoneSchema = z.string().trim().max(32).refine((value) => value === "" || /^[+0-9(). -]{5,32}$/.test(value));
const bodySchema = z.object({
  effectiveMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  fullName: z.string().trim().min(1).max(160),
  phone: phoneSchema.optional(),
  initialPin: z.string().regex(/^\d{6}$/),
  reason: z.string().trim().min(1).max(500),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ householdId: string }> },
) {
  if (!isSameOriginMutation(request, getPublicAppUrl())) {
    return householdJson({ message: "Permintaan tidak dapat diproses dari alamat ini." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return householdJson({ message: "Format permintaan tidak valid." }, 415);
  }
  const { householdId } = await context.params;
  if (!uuidV4Schema.safeParse(householdId).success) {
    return householdJson({ message: "Rumah atau data warga tidak ditemukan." }, 404);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return householdJson({ message: "Data pergantian penghuni belum dapat dibaca." }, 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return householdJson({ message: "Periksa bulan efektif, nama, telepon, PIN enam digit, dan alasan." }, 400);
  }

  try {
    const principal = await getCurrentPrincipal();
    await replaceHouseholdResident(getDb(), principal, { householdId, ...parsed.data }, jakartaBusinessDate());
    return householdJson({
      ok: true,
      message: "Penghuni baru berhasil ditambahkan. Tagihan dan riwayat lama tetap pada rumah tangga sebelumnya.",
    });
  } catch (error) {
    return householdErrorResponse(error);
  }
}
