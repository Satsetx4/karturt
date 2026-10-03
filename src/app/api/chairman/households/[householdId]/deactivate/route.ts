import { z } from "zod";
import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { deactivateHousehold } from "@/lib/households/lifecycle";
import { getPublicAppUrl } from "@/lib/env";
import { householdErrorResponse, householdJson, isSameOriginMutation } from "../../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const bodySchema = z.object({
  activeThroughMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
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
    return householdJson({ message: "Data penghentian belum dapat dibaca." }, 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return householdJson({ message: "Pilih bulan terakhir aktif dan isi alasan 1–500 karakter." }, 400);

  try {
    const principal = await getCurrentPrincipal();
    await deactivateHousehold(getDb(), principal, {
      householdId,
      effectiveMonth: parsed.data.activeThroughMonth,
      reason: parsed.data.reason,
    }, jakartaBusinessDate());
    return householdJson({ ok: true, message: "Masa rumah dan warga berhasil diakhiri. Tunggakan lama tetap tercatat." });
  } catch (error) {
    return householdErrorResponse(error);
  }
}
