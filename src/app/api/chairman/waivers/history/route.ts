import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { getChairmanWaiverHistory } from "@/lib/billing/chairman-waiver";
import { waiverErrorResponse, waiverJson } from "../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const principal = await getCurrentPrincipal();
    const history = await getChairmanWaiverHistory(getDb(), principal);
    return waiverJson({ history });
  } catch (error) {
    return waiverErrorResponse(error, "Riwayat pemutihan belum dapat dimuat. Silakan coba lagi.");
  }
}
