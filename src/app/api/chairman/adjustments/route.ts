import { z } from "zod";
import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { createChairmanAdjustment } from "@/lib/billing/chairman-adjustment";
import { getPublicAppUrl } from "@/lib/env";
import { isSameOriginMutation } from "@/app/api/chairman/waivers/response";
import { adjustmentErrorResponse, adjustmentJson } from "./response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const bodySchema = z.object({
  monthlyDueId: uuidV4Schema,
  amountDelta: z.number().int().safe().min(-2_147_483_647).max(2_147_483_647).refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(500),
}).strict();

export async function POST(request: Request) {
  try {
    if (!isSameOriginMutation(request, getPublicAppUrl())) {
      return adjustmentJson({ message: "Permintaan tidak dapat diproses dari alamat ini." }, 403);
    }
    const principal = await getCurrentPrincipal();
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return adjustmentJson({ message: "Format permintaan tidak valid." }, 415);
    }
    const key = uuidV4Schema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return adjustmentJson({ message: "Permintaan belum dapat diproses. Silakan coba lagi." }, 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return adjustmentJson({ message: "Data penyesuaian belum dapat dibaca." }, 400);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return adjustmentJson({ message: "Periksa nominal dan alasan penyesuaian." }, 400);

    const result = await createChairmanAdjustment(getDb(), principal, {
      ...parsed.data,
      idempotencyKey: key.data,
    });
    return adjustmentJson({
      id: result.id,
      idempotentReplay: result.idempotentReplay,
      message: result.idempotentReplay ? "Penyesuaian ini sudah tercatat sebelumnya." : "Penyesuaian berhasil dicatat.",
    });
  } catch (error) {
    return adjustmentErrorResponse(error);
  }
}
