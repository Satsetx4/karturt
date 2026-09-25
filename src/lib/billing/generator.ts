import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  billingYears,
  feeRates,
  households,
  monthlyDues,
  rtSettings,
} from "@/db/schema";

export interface FeeRateInput {
  id: string;
  effectiveMonth: number;
  monthlyAmount: number;
}

export interface AnnualDueInput {
  rtUnitId: string;
  householdId: string;
  billingYearId: string;
  year: number;
  householdStartsOn: string;
  dueDay?: number;
  feeRates: FeeRateInput[];
}

export function buildAnnualDues(input: AnnualDueInput) {
  const dueDay = input.dueDay ?? 10;
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200) {
    throw new Error("Billing year must be between 2000 and 2200.");
  }
  if (dueDay !== 10) throw new Error("KartuRT's current monthly due day is the 10th.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.householdStartsOn)) {
    throw new Error("Household start date must use YYYY-MM-DD format.");
  }

  const rates = [...input.feeRates].sort((left, right) => left.effectiveMonth - right.effectiveMonth);
  for (const rate of rates) {
    if (!Number.isInteger(rate.effectiveMonth) || rate.effectiveMonth < 1 || rate.effectiveMonth > 12) {
      throw new Error("Fee rate effective month must be between 1 and 12.");
    }
    if (!Number.isSafeInteger(rate.monthlyAmount) || rate.monthlyAmount <= 0) {
      throw new Error("Monthly fee amounts must be positive whole rupiah values.");
    }
  }
  if (new Set(rates.map((rate) => rate.effectiveMonth)).size !== rates.length) {
    throw new Error("Only one fee rate may take effect in a billing month.");
  }

  const startYearMonth = input.householdStartsOn.slice(0, 7);
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const monthKey = `${input.year}-${String(month).padStart(2, "0")}`;
    const dueDate = `${input.year}-${String(month).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;

    if (monthKey < startYearMonth) {
      return {
        rtUnitId: input.rtUnitId,
        householdId: input.householdId,
        billingYearId: input.billingYearId,
        feeRateId: null,
        month,
        amount: 0,
        dueDate,
        status: "waived" as const,
        waivedReason: "not_yet_resident" as const,
      };
    }

    const rate = [...rates].reverse().find((candidate) => candidate.effectiveMonth <= month);
    if (!rate) {
      throw new Error(`No fee rate is configured for ${monthKey}.`);
    }
    return {
      rtUnitId: input.rtUnitId,
      householdId: input.householdId,
      billingYearId: input.billingYearId,
      feeRateId: rate.id,
      month,
      amount: rate.monthlyAmount,
      dueDate,
      status: "unpaid" as const,
      waivedReason: null,
    };
  });
}

export async function generateHouseholdDues(
  database: AppDatabase,
  input: { rtUnitId: string; householdId: string; billingYearId: string },
) {
  const [household] = await database
    .select({ id: households.id, rtUnitId: households.rtUnitId, startsOn: households.startsOn })
    .from(households)
    .where(and(eq(households.id, input.householdId), eq(households.rtUnitId, input.rtUnitId)))
    .limit(1);
  if (!household) throw new Error("Household was not found in this RT.");

  const [year] = await database
    .select({ id: billingYears.id, year: billingYears.year, status: billingYears.status, rtUnitId: billingYears.rtUnitId })
    .from(billingYears)
    .where(and(eq(billingYears.id, input.billingYearId), eq(billingYears.rtUnitId, input.rtUnitId)))
    .limit(1);
  if (!year) throw new Error("Billing year was not found in this RT.");
  if (year.status !== "open") throw new Error("Monthly dues can only be generated for an open billing year.");

  const [settings] = await database
    .select({ dueDay: rtSettings.dueDay })
    .from(rtSettings)
    .where(eq(rtSettings.rtUnitId, input.rtUnitId))
    .limit(1);
  if (!settings) throw new Error("RT billing settings were not found.");

  const rates = await database
    .select({ id: feeRates.id, effectiveMonth: feeRates.effectiveMonth, monthlyAmount: feeRates.monthlyAmount })
    .from(feeRates)
    .where(and(eq(feeRates.rtUnitId, input.rtUnitId), eq(feeRates.billingYearId, year.id)))
    .orderBy(feeRates.effectiveMonth);

  const proposed = buildAnnualDues({
    ...input,
    year: year.year,
    householdStartsOn: household.startsOn,
    dueDay: settings.dueDay,
    feeRates: rates,
  });
  const inserted = await database
    .insert(monthlyDues)
    .values(proposed)
    .onConflictDoNothing({
      target: [monthlyDues.householdId, monthlyDues.billingYearId, monthlyDues.month],
    })
    .returning({ id: monthlyDues.id, month: monthlyDues.month, status: monthlyDues.status });

  return { insertedCount: inserted.length, rows: inserted };
}
