import { z } from "zod";
import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import {
  createChairmanFeeRate,
  listChairmanFeeRates,
} from "@/lib/billing/chairman-fee-rates";
import { getPublicAppUrl } from "@/lib/env";
import { isSameOriginMutation } from "@/app/api/chairman/waivers/response";
import { feeRateErrorResponse, feeRateJson } from "./response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const requestBodySchema = z.object({
  billingYearId: uuidV4Schema,
  effectiveMonth: z.number().int().min(1).max(12),
  monthlyAmount: z.number().int().positive().max(2_147_483_647),
}).strict();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const names = [...new Set(url.searchParams.keys())];
    const yearIds = url.searchParams.getAll("billingYearId");
    if (
      names.some((name) => name !== "billingYearId") ||
      yearIds.length > 1 ||
      (yearIds[0] !== undefined && !uuidV4Schema.safeParse(yearIds[0]).success)
    ) {
      return feeRateJson({ message: "Filter tahun tagihan tidak valid." }, 400);
    }

    const principal = await getCurrentPrincipal();
    const result = await listChairmanFeeRates(getDb(), principal, yearIds[0]);
    return feeRateJson(result);
  } catch (error) {
    return feeRateErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOriginMutation(request, getPublicAppUrl())) {
      return feeRateJson({ message: "Permintaan tidak dapat diproses dari alamat ini." }, 403);
    }
    const principal = await getCurrentPrincipal();
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return feeRateJson({ message: "Format permintaan tidak valid." }, 415);
    }

    const idempotencyKey = uuidV4Schema.safeParse(request.headers.get("idempotency-key"));
    if (!idempotencyKey.success) {
      return feeRateJson({ message: "Permintaan belum dapat diproses. Silakan coba lagi." }, 400);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return feeRateJson({ message: "Data tarif belum dapat dibaca." }, 400);
    }
    const parsedBody = requestBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return feeRateJson({ message: "Periksa kembali tahun, bulan efektif, dan nominal tarif." }, 400);
    }

    const result = await createChairmanFeeRate(getDb(), principal, {
      ...parsedBody.data,
      idempotencyKey: idempotencyKey.data,
    });
    return feeRateJson({
      rate: {
        id: result.id,
        billingYearId: result.billingYearId,
        effectiveMonth: result.effectiveMonth,
        monthlyAmount: result.monthlyAmount,
        createdAt: result.createdAt,
      },
      idempotentReplay: result.idempotentReplay,
      message: result.idempotentReplay
        ? "Tarif ini sudah tercatat sebelumnya."
        : "Tarif berhasil ditambahkan.",
    });
  } catch (error) {
    return feeRateErrorResponse(error);
  }
}
