import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  billingYears,
  households,
  houses,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  payments,
  people,
  waiverItems,
} from "@/db/schema";
import { canPerform, type Principal } from "@/lib/auth/permissions";
import { getDueFinancialBalances } from "@/lib/billing/due-balance";
import { officialAssignmentActiveOn } from "@/lib/officials/lifecycle";
import { ReportForbiddenError, InvalidReportYearError, ReportInvariantError } from "./errors";
import {
  aggregateRtFinancialReport,
  sumActiveAllocationMethods,
  type AllocationMethodRow,
  type ReportDueInput,
  type RtFinancialReportResponse,
} from "./aggregation";

export { ReportForbiddenError, InvalidReportYearError, ReportInvariantError } from "./errors";
export { aggregateRtFinancialReport, sumActiveAllocationMethods } from "./aggregation";
export type {
  AllocationMethodRow,
  ArrearsHousehold,
  ArrearsPeriod,
  MonthlyReportTotals,
  ReportAmounts,
  ReportCounts,
  ReportDueInput,
  ReportTotals,
  RtFinancialReportResponse,
} from "./aggregation";

type ReportDatabase = Pick<AppDatabase, "select">;

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function assertValidYear(year: unknown): asserts year is number {
  if (typeof year !== "number" || !Number.isSafeInteger(year) || year < 2000 || year > 2200) {
    throw new InvalidReportYearError();
  }
}

async function assertActiveChairman(database: ReportDatabase, principal: Principal, businessDate: string) {
  const rtUnitId = principal.rtUnitId;
  if (
    principal.role !== "rt_chairman" ||
    !rtUnitId ||
    !canPerform(principal, "report:read:rt", { rtUnitId })
  ) {
    throw new ReportForbiddenError();
  }

  const [account] = await database
    .select({ id: appAccounts.id, status: appAccounts.status })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.id, principal.appAccountId),
      eq(appAccounts.authUserId, principal.authUserId),
      eq(appAccounts.rtUnitId, rtUnitId),
      eq(appAccounts.accountType, "official"),
    ))
    .limit(1);
  if (!account || account.status !== "active") throw new ReportForbiddenError();

  const assignments = await database
    .select({ id: officialAssignments.id, role: officialAssignments.role })
    .from(officialAssignments)
    .where(and(
      eq(officialAssignments.appAccountId, principal.appAccountId),
      eq(officialAssignments.rtUnitId, rtUnitId),
      officialAssignmentActiveOn(businessDate),
    ))
    .orderBy(asc(officialAssignments.id))
    .limit(2);
  if (assignments.length !== 1 || assignments[0]?.role !== "rt_chairman") throw new ReportForbiddenError();
  return rtUnitId;
}

async function readAllocationMethodRows(database: ReportDatabase, rtUnitId: string, dueIds: readonly string[]) {
  if (dueIds.length === 0) return [] as AllocationMethodRow[];
  const paymentReversed = sql<boolean>`exists (
    select 1 from public.payment_reversals reversal
    where reversal.payment_id = ${payments.id}
  )`;
  const rows = await database
    .select({
      monthlyDueId: paymentAllocations.monthlyDueId,
      householdId: paymentAllocations.householdId,
      rtUnitId: paymentAllocations.rtUnitId,
      method: payments.method,
      amount: sql<string>`sum(${paymentAllocations.amount})::text`,
      paymentReversed,
    })
    .from(paymentAllocations)
    .innerJoin(monthlyDues, and(
      eq(monthlyDues.id, paymentAllocations.monthlyDueId),
      eq(monthlyDues.rtUnitId, paymentAllocations.rtUnitId),
      eq(monthlyDues.householdId, paymentAllocations.householdId),
    ))
    .innerJoin(payments, and(
      eq(payments.id, paymentAllocations.paymentId),
      eq(payments.rtUnitId, paymentAllocations.rtUnitId),
      eq(payments.householdId, paymentAllocations.householdId),
    ))
    .where(and(
      eq(paymentAllocations.rtUnitId, rtUnitId),
      inArray(paymentAllocations.monthlyDueId, [...dueIds]),
    ))
    .groupBy(
      paymentAllocations.monthlyDueId,
      paymentAllocations.householdId,
      paymentAllocations.rtUnitId,
      payments.method,
      paymentReversed,
    );
  return rows as AllocationMethodRow[];
}

export async function getRtFinancialReport(
  database: AppDatabase,
  principal: Principal,
  input: { year?: number; businessDate: string },
): Promise<RtFinancialReportResponse> {
  if (!input || !validDate(input.businessDate)) throw new InvalidReportYearError();
  if (input.year !== undefined) assertValidYear(input.year);

  const rtUnitId = await assertActiveChairman(database, principal, input.businessDate);
  const yearRows = await database
    .select({ id: billingYears.id, year: billingYears.year })
    .from(billingYears)
    .where(eq(billingYears.rtUnitId, rtUnitId))
    .orderBy(desc(billingYears.year));
  const availableYears = yearRows.map((row) => row.year);
  const currentYear = Number(input.businessDate.slice(0, 4));
  const year = input.year ?? (availableYears.includes(currentYear) ? currentYear : availableYears[0] ?? currentYear);
  assertValidYear(year);
  const yearRow = yearRows.find((row) => row.year === year);

  const dueRows = yearRow
    ? await database
      .select({
        id: monthlyDues.id,
        householdId: monthlyDues.householdId,
        rtUnitId: monthlyDues.rtUnitId,
        year: billingYears.year,
        month: monthlyDues.month,
        dueDate: monthlyDues.dueDate,
        amount: monthlyDues.amount,
        status: monthlyDues.status,
        householdStatus: households.status,
        startsOn: households.startsOn,
        endsOn: households.endsOn,
        houseNumber: houses.number,
        houseLabel: houses.label,
      })
      .from(monthlyDues)
      .innerJoin(billingYears, and(
        eq(billingYears.id, monthlyDues.billingYearId),
        eq(billingYears.rtUnitId, monthlyDues.rtUnitId),
      ))
      .innerJoin(households, and(
        eq(households.id, monthlyDues.householdId),
        eq(households.rtUnitId, monthlyDues.rtUnitId),
      ))
      .innerJoin(houses, and(
        eq(houses.id, households.houseId),
        eq(houses.rtUnitId, households.rtUnitId),
      ))
      .where(and(
        eq(monthlyDues.rtUnitId, rtUnitId),
        eq(monthlyDues.billingYearId, yearRow.id),
      ))
      .orderBy(asc(monthlyDues.month), asc(monthlyDues.householdId), asc(monthlyDues.id))
    : [];

  const dueIds = dueRows.map((due) => due.id);
  const householdIds = [...new Set(dueRows.map((due) => due.householdId))];
  const residentRows = householdIds.length === 0
    ? []
    : await database
      .select({ householdId: people.householdId, fullName: people.fullName })
      .from(people)
      .where(and(eq(people.rtUnitId, rtUnitId), inArray(people.householdId, householdIds)))
      .orderBy(asc(people.householdId), asc(people.fullName), asc(people.id));
  const residentNames = new Map<string, string[]>();
  for (const resident of residentRows) {
    if (!resident.householdId) continue;
    const names = residentNames.get(resident.householdId) ?? [];
    if (!names.includes(resident.fullName)) names.push(resident.fullName);
    residentNames.set(resident.householdId, names);
  }

  let balances;
  try {
    balances = await getDueFinancialBalances(database, dueIds);
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Stored ") || error.message.includes("F11 balance invariant"))) {
      throw new ReportInvariantError();
    }
    throw error;
  }
  if (balances.length !== dueRows.length) throw new ReportInvariantError();
  const balanceByDueId = new Map(balances.map((balance) => [balance.monthlyDueId, balance]));
  if (balanceByDueId.size !== dueRows.length) throw new ReportInvariantError();

  const waiverRows = dueIds.length === 0
    ? []
    : await database
      .select({
        monthlyDueId: waiverItems.monthlyDueId,
        householdId: waiverItems.householdId,
        rtUnitId: waiverItems.rtUnitId,
        amount: waiverItems.amount,
      })
      .from(waiverItems)
      .where(inArray(waiverItems.monthlyDueId, dueIds));
  const waiversByDueId = new Map<string, typeof waiverRows>();
  for (const waiver of waiverRows) {
    const entries = waiversByDueId.get(waiver.monthlyDueId) ?? [];
    entries.push(waiver);
    waiversByDueId.set(waiver.monthlyDueId, entries);
  }

  const allocationRows = await readAllocationMethodRows(database, rtUnitId, dueIds);
  const dueOwners = dueRows.map((due) => ({
    monthlyDueId: due.id,
    household: { householdId: due.householdId, rtUnitId: due.rtUnitId },
  }));
  const methodsByDueId = sumActiveAllocationMethods(allocationRows, dueOwners);

  const reportInputs: ReportDueInput[] = dueRows.map((due) => {
    const balance = balanceByDueId.get(due.id);
    if (
      !balance ||
      balance.rtUnitId !== rtUnitId ||
      balance.householdId !== due.householdId ||
      balance.status !== due.status ||
      balance.originalAmount !== due.amount
    ) {
      throw new ReportInvariantError();
    }
    const waiverEntries = waiversByDueId.get(due.id) ?? [];
    if (due.status === "waived") {
      if (waiverEntries.length !== 1) throw new ReportInvariantError();
      const waiver = waiverEntries[0]!;
      if (waiver.rtUnitId !== rtUnitId || waiver.householdId !== due.householdId) throw new ReportInvariantError();
      if (!Number.isSafeInteger(waiver.amount) || waiver.amount <= 0) throw new ReportInvariantError();
    } else if (waiverEntries.length !== 0) {
      throw new ReportInvariantError();
    }
    const methods = methodsByDueId.get(due.id) ?? { transferReceived: 0, cashReceived: 0 };
    return {
      monthlyDueId: due.id,
      household: {
        householdId: due.householdId,
        rtUnitId: due.rtUnitId,
        houseNumber: due.houseNumber,
        houseLabel: due.houseLabel,
        residentNames: residentNames.get(due.householdId) ?? [],
        lifecycle: due.householdStatus === "active" ? "active" : "historical",
        startsOn: due.startsOn,
        endsOn: due.endsOn,
      },
      year: due.year,
      month: due.month,
      dueDate: due.dueDate,
      status: due.status,
      originalAmount: balance.originalAmount,
      adjustmentTotal: balance.adjustmentTotal,
      activeReceived: balance.activeReceived,
      transferReceived: methods.transferReceived,
      cashReceived: methods.cashReceived,
      waiverAmount: due.status === "waived" ? waiverEntries[0]!.amount : 0,
      hasPendingRequest: balance.hasPendingRequest,
    };
  });

  return aggregateRtFinancialReport(reportInputs, { year, availableYears, businessDate: input.businessDate });
}
