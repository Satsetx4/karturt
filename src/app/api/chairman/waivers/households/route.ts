import { getDb } from "@/db/client";
import { getCurrentPrincipal } from "@/lib/auth/principal";
import { searchChairmanWaiverHouseholds } from "@/lib/billing/chairman-waiver";
import { waiverErrorResponse, waiverJson } from "../response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => key !== "q") || url.searchParams.getAll("q").length > 1) {
      return waiverJson({ message: "Pencarian tidak valid." }, 400);
    }
    const principal = await getCurrentPrincipal();
    const households = await searchChairmanWaiverHouseholds(
      getDb(),
      principal,
      url.searchParams.get("q") ?? "",
    );
    return waiverJson({ households });
  } catch (error) {
    return waiverErrorResponse(error, "Daftar rumah belum dapat dimuat. Silakan coba lagi.");
  }
}
