import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { getChairmanWaiverHousehold } from "@/lib/billing/chairman-waiver";
import { waiverErrorResponse, waiverJson } from "../../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ householdId: string }> },
) {
  try {
    const { householdId } = await params;
    const principal = await getCurrentPrincipal();
    const detail = await getChairmanWaiverHousehold(getDb(), principal, householdId);
    return waiverJson(detail);
  } catch (error) {
    return waiverErrorResponse(error, "Data rumah belum dapat dimuat. Silakan coba lagi.");
  }
}
