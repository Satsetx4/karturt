import { z } from "zod";
import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { updateHouseholdResident } from "@/lib/households/lifecycle";
import { getPublicAppUrl } from "@/lib/env";
import { householdErrorResponse, householdJson, isSameOriginMutation } from "../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const phoneSchema = z.string().trim().max(32).refine((value) => value === "" || /^[+0-9(). -]{5,32}$/.test(value));
const updateSchema = z.object({
  fullName: z.string().trim().min(1).max(160).optional(),
  phone: phoneSchema.optional(),
  houseLabel: z.string().trim().max(120).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

export async function PATCH(
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
  const url = new URL(request.url);
  const queryKeys = [...new Set(url.searchParams.keys())];
  const personIds = url.searchParams.getAll("personId");
  const personId = personIds[0] ?? "";
  if (queryKeys.some((key) => key !== "personId") || personIds.length !== 1 || !uuidV4Schema.safeParse(personId).success) {
    return householdJson({ message: "Data warga tidak ditemukan." }, 404);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return householdJson({ message: "Perubahan belum dapat dibaca." }, 400);
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return householdJson({ message: "Periksa nama, telepon, atau label rumah." }, 400);

  try {
    const principal = await getCurrentPrincipal();
    await updateHouseholdResident(getDb(), principal, {
      householdId,
      personId,
      ...parsed.data,
    }, jakartaBusinessDate());
    return householdJson({ ok: true, message: "Perubahan data berhasil disimpan." });
  } catch (error) {
    return householdErrorResponse(error);
  }
}
