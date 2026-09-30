import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { assertCanPerform, type Principal } from "@/lib/auth/permissions";
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
  householdEndsOn?: string | null;
  dueDay?: number;
  feeRates: FeeRateInput[];
}

export function buildAnnualDues(input: AnnualDueInput) {
  const dueDay = input.dueDay ?? 10;
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200) {
    throw new Error("Billing year must be between 2000 and 2200.");
  }
  if (dueDay !== 10) throw new Error("KartuRT's current monthly due day is the 10th.");
  for (const [label, value] of [["start", input.householdStartsOn], ["end", input.householdEndsOn]] as const) {
    if (value == null) continue;
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
      throw new Error(`Household ${label} date must be a valid YYYY-MM-DD date.`);
    }
  }
  if (input.householdEndsOn && input.householdEndsOn < input.householdStartsOn) {
    throw new Error("Household end date cannot be before its start date.");
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
  const endYearMonth = input.householdEndsOn?.slice(0, 7);
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const monthKey = `${input.year}-${String(month).padStart(2, "0")}`;
    const dueDate = `${input.year}-${String(month).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;

    if (monthKey < startYearMonth || (endYearMonth != null && monthKey > endYearMonth)) {
      return {
        rtUnitId: input.rtUnitId,
        householdId: input.householdId,
        billingYearId: input.billingYearId,
        feeRateId: null,
        month,
        amount: 0,
        dueDate,
        status: "not_due" as const,
        waivedReason: null,
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
  principal: Principal,
  input: { householdId: string; billingYearId: string },
) {
  const rtUnitId = principal.rtUnitId;
  if (!rtUnitId) throw new Error("Forbidden: billing actions require an RT principal.");
  assertCanPerform(principal, "billing:generate", { rtUnitId });
  const [household] = await database
    .select({ id: households.id, rtUnitId: households.rtUnitId, startsOn: households.startsOn, endsOn: households.endsOn, status: households.status })
    .from(households)
    .where(and(eq(households.id, input.householdId), eq(households.rtUnitId, rtUnitId)))
    .limit(1);
  if (!household) throw new Error("Household was not found in this RT.");
  if (household.status === "active" && household.endsOn !== null) throw new Error("Active households cannot have an end date.");
  if (household.status === "inactive" && household.endsOn === null) throw new Error("Inactive households require an end date.");

  const [year] = await database
    .select({ id: billingYears.id, year: billingYears.year, status: billingYears.status, rtUnitId: billingYears.rtUnitId })
    .from(billingYears)
    .where(and(eq(billingYears.id, input.billingYearId), eq(billingYears.rtUnitId, rtUnitId)))
    .limit(1);
  if (!year) throw new Error("Billing year was not found in this RT.");
  if (year.status !== "open") throw new Error("Monthly dues can only be generated for an open billing year.");

  const [settings] = await database
    .select({ dueDay: rtSettings.dueDay })
    .from(rtSettings)
    .where(eq(rtSettings.rtUnitId, rtUnitId))
    .limit(1);
  if (!settings) throw new Error("RT billing settings were not found.");

  const rates = await database
    .select({ id: feeRates.id, effectiveMonth: feeRates.effectiveMonth, monthlyAmount: feeRates.monthlyAmount })
    .from(feeRates)
    .where(and(eq(feeRates.rtUnitId, rtUnitId), eq(feeRates.billingYearId, year.id)))
    .orderBy(feeRates.effectiveMonth);

  const proposed = buildAnnualDues({
    rtUnitId,
    ...input,
    year: year.year,
    householdStartsOn: household.startsOn,
    householdEndsOn: household.endsOn,
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
