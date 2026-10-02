import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { searchChairmanAdjustmentHouseholds } from "@/lib/billing/chairman-adjustment";
import { adjustmentErrorResponse, adjustmentJson } from "../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const keys = [...new Set(url.searchParams.keys())];
    const queries = url.searchParams.getAll("query");
    if (keys.some((key) => key !== "query") || queries.length > 1) {
      return adjustmentJson({ message: "Pencarian rumah tidak valid." }, 400);
    }
    const principal = await getCurrentPrincipal();
    const result = await searchChairmanAdjustmentHouseholds(getDb(), principal, queries[0] ?? "");
    return adjustmentJson(result);
  } catch (error) {
    return adjustmentErrorResponse(error);
  }
}
