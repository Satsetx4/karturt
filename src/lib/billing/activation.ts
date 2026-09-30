import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { billingYears, feeRates } from "@/db/schema";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";

export async function activateBillingYear(
  database: AppDatabase,
  principal: Principal,
  input: { billingYearId: string },
) {
  const rtUnitId = principal.rtUnitId;
  if (!rtUnitId) throw new Error("Forbidden: billing actions require an RT principal.");
  assertCanPerform(principal, "billing:generate", { rtUnitId });
  return database.transaction(async (transaction) => {
    const [year] = await transaction
      .select({ id: billingYears.id, status: billingYears.status })
      .from(billingYears)
      .where(and(eq(billingYears.id, input.billingYearId), eq(billingYears.rtUnitId, rtUnitId)))
      .limit(1)
      .for("update");
    if (!year) throw new Error("Billing year was not found in this RT.");
    if (year.status === "closed") throw new Error("A closed billing year cannot be activated again.");

    const [januaryRate] = await transaction
      .select({ id: feeRates.id })
      .from(feeRates)
      .where(and(
        eq(feeRates.rtUnitId, rtUnitId),
        eq(feeRates.billingYearId, year.id),
        eq(feeRates.effectiveMonth, 1),
      ))
      .limit(1);
    if (!januaryRate) throw new Error("A January fee rate is required before activating a billing year.");
    if (year.status === "open") return { id: year.id, status: "open" as const };

    const [activated] = await transaction
      .update(billingYears)
      .set({ status: "open" })
      .where(and(eq(billingYears.id, year.id), eq(billingYears.status, "draft")))
      .returning({ id: billingYears.id });
    if (!activated) throw new Error("Billing year state changed before activation completed.");
    return { id: activated.id, status: "open" as const };
  });
}
