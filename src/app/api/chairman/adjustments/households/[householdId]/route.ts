import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { getChairmanAdjustmentHousehold } from "@/lib/billing/chairman-adjustment";
import { adjustmentErrorResponse, adjustmentJson } from "../../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ householdId: string }> },
) {
  try {
    const { householdId } = await params;
    const principal = await getCurrentPrincipal();
    const result = await getChairmanAdjustmentHousehold(getDb(), principal, householdId);
    return adjustmentJson(result);
  } catch (error) {
    return adjustmentErrorResponse(error);
  }
}
