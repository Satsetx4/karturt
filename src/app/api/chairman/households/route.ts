import { z } from "zod";
import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import {
  createHouseholdResident,
  listHouseholdManagement,
} from "@/lib/households/lifecycle";
import { getPublicAppUrl } from "@/lib/env";
import { householdErrorResponse, householdJson, isSameOriginMutation } from "./response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const dateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const phoneSchema = z.string().trim().max(32).refine((value) => value === "" || /^[+0-9(). -]{5,32}$/.test(value));
const residentFields = {
  fullName: z.string().trim().min(1).max(160),
  phone: phoneSchema.optional(),
};
const newHouseSchema = z.object({
  number: z.string().trim().min(1).max(40),
  label: z.string().trim().max(120).optional(),
}).strict();
const createSchema = z.object({
  houseId: uuidV4Schema.optional(),
  newHouse: newHouseSchema.optional(),
  startsOn: dateSchema,
  ...residentFields,
  initialPin: z.string().regex(/^\d{6}$/),
}).strict().refine((value) => Boolean(value.houseId) !== Boolean(value.newHouse));

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const keys = [...new Set(url.searchParams.keys())];
    const searches = url.searchParams.getAll("search");
    if (keys.some((key) => key !== "search") || searches.length > 1 || (searches[0]?.length ?? 0) > 80) {
      return householdJson({ message: "Filter pencarian tidak valid." }, 400);
    }
    const principal = await getCurrentPrincipal();
    const result = await listHouseholdManagement(getDb(), principal, searches[0] ?? "");
    return householdJson(result);
  } catch (error) {
    return householdErrorResponse(error, "load");
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request, getPublicAppUrl())) {
    return householdJson({ message: "Permintaan tidak dapat diproses dari alamat ini." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return householdJson({ message: "Format permintaan tidak valid." }, 415);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return householdJson({ message: "Data rumah dan warga belum dapat dibaca." }, 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return householdJson({ message: "Periksa nama, nomor rumah, tanggal mulai, telepon, dan PIN enam digit." }, 400);
  }

  try {
    const principal = await getCurrentPrincipal();
    await createHouseholdResident(getDb(), principal, parsed.data, jakartaBusinessDate());
    return householdJson({ ok: true, message: "Rumah dan warga berhasil ditambahkan." }, 201);
  } catch (error) {
    return householdErrorResponse(error);
  }
}
