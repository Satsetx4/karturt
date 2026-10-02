import { z } from "zod";
import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { createChairmanWaiver } from "@/lib/billing/chairman-waiver";
import { getPublicAppUrl } from "@/lib/env";
import { isSameOriginMutation, waiverErrorResponse, waiverJson } from "./response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const requestBodySchema = z.object({
  householdId: uuidV4Schema,
  periods: z.array(periodSchema).min(1).max(120),
  reason: z.string().max(1000),
}).strict();

export async function POST(request: Request) {
  try {
    if (!isSameOriginMutation(request, getPublicAppUrl())) {
      return waiverJson({ message: "Permintaan tidak dapat diproses dari alamat ini." }, 403);
    }
    const principal = await getCurrentPrincipal();
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return waiverJson({ message: "Format permintaan tidak valid." }, 415);
    }

    const idempotencyKey = uuidV4Schema.safeParse(request.headers.get("idempotency-key"));
    if (!idempotencyKey.success) {
      return waiverJson({ message: "Permintaan belum dapat diproses. Silakan coba lagi." }, 400);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return waiverJson({ message: "Data pemutihan belum dapat dibaca." }, 400);
    }
    const parsedBody = requestBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return waiverJson({ message: "Periksa kembali rumah, periode, dan alasan pemutihan." }, 400);
    }

    const result = await createChairmanWaiver(getDb(), principal, {
      ...parsedBody.data,
      idempotencyKey: idempotencyKey.data,
    });
    return waiverJson({
      periods: result.periods,
      totalAmount: result.totalAmount,
      reason: result.reason,
      createdAt: result.createdAt,
      idempotentReplay: result.idempotentReplay,
      message: result.idempotentReplay
        ? "Pemutihan ini sudah tercatat sebelumnya."
        : "Pemutihan berhasil dicatat.",
    });
  } catch (error) {
    return waiverErrorResponse(error, "Pemutihan belum dapat disimpan. Silakan coba lagi.");
  }
}
