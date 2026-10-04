import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { appAccounts, billingYears, houses, households, monthlyDues, officialAssignments, people, rtSettings, rtUnits } from "@/db/schema";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { getResidentPaymentHistory, getTreasurerPaymentHistory } from "@/lib/billing/payment-history";
import { getTreasurerPaymentRequestQueue } from "@/lib/billing/treasurer-payment-requests";
import { duesSummary } from "@/lib/billing/resident-card";
import { getRtFinancialReport } from "@/lib/reports/rt-financial-report";
import { listHouseholdManagement } from "@/lib/households/lifecycle";
import { createAuthUser, createFeeRateFixture, createTestDatabase } from "../tests/helpers/database";

const YEAR = 2026;
const DATE = "2026-10-04";
type TestDb = Awaited<ReturnType<typeof createTestDatabase>>["db"];
const uuid = () => randomUUID();
const timed = async <T>(fn: () => Promise<T>) => {
  const start = performance.now();
  const value = await fn();
  return { ms: Number((performance.now() - start).toFixed(2)), value };
};
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function seedScale(db: TestDb, count: number, tag: string) {
  const rtId = uuid();
  await db.insert(rtUnits).values({ id: rtId, code: `PERF-${tag}`, rwCode: `PERF-${tag}`, name: "Synthetic RT", village: "Synthetic" });
  await db.insert(rtSettings).values({ rtUnitId: rtId });
  const yearId = uuid();
  await db.insert(billingYears).values({ id: yearId, rtUnitId: rtId, year: YEAR, status: "open" });
  const houseIds = Array.from({ length: count }, uuid);
  const householdIds = Array.from({ length: count }, uuid);
  const personIds = Array.from({ length: count }, uuid);
  await db.insert(houses).values(houseIds.map((id, i) => ({ id, rtUnitId: rtId, number: `H-${tag}-${String(i + 1).padStart(4, "0")}` })));
  await db.insert(households).values(householdIds.map((id, i) => ({ id, rtUnitId: rtId, houseId: houseIds[i]!, status: "active" as const, startsOn: "2020-01-01" })));
  await db.insert(people).values(personIds.map((id, i) => ({ id, rtUnitId: rtId, householdId: householdIds[i]!, fullName: `Synthetic resident ${i + 1}` })));

  const chairUser = await createAuthUser(db, `Synthetic Chairman ${tag}`);
  const chairAccountId = uuid();
  await db.insert(appAccounts).values({ id: chairAccountId, rtUnitId: rtId, authUserId: chairUser.id, accountType: "official", loginIdentifier: `perf-chair-${tag}`, personId: personIds[0]! });
  await db.insert(officialAssignments).values({ rtUnitId: rtId, appAccountId: chairAccountId, role: "rt_chairman", startsOn: "2000-01-01" });
  const treasurerUser = await createAuthUser(db, `Synthetic Treasurer ${tag}`);
  const treasurerAccountId = uuid();
  await db.insert(appAccounts).values({ id: treasurerAccountId, rtUnitId: rtId, authUserId: treasurerUser.id, accountType: "official", loginIdentifier: `perf-treasurer-${tag}`, personId: personIds[0]! });
  await db.insert(officialAssignments).values({ rtUnitId: rtId, appAccountId: treasurerAccountId, role: "treasurer", startsOn: "2000-01-01" });
  const residentUser = await createAuthUser(db, `Synthetic Resident ${tag}`);
  const residentAccountId = uuid();
  await db.insert(appAccounts).values({ id: residentAccountId, rtUnitId: rtId, authUserId: residentUser.id, accountType: "resident", loginIdentifier: `perf-resident-${tag}`, personId: personIds[0]!, householdId: householdIds[0]! });
  const [rate] = await createFeeRateFixture(db, { rtUnitId: rtId, billingYearId: yearId, effectiveMonth: 1, monthlyAmount: 30000 });
  const dueRows = householdIds.flatMap((householdId) => Array.from({ length: 12 }, (_, month) => ({
    rtUnitId: rtId, householdId, billingYearId: yearId, feeRateId: rate!.id, month: month + 1, amount: 30000,
    dueDate: `${YEAR}-${String(month + 1).padStart(2, "0")}-10`, status: "unpaid" as const,
  })));
  for (let i = 0; i < dueRows.length; i += 500) await db.insert(monthlyDues).values(dueRows.slice(i, i + 500));

  return {
    rtId, householdIds, personIds, chairUser, chairAccountId, treasurerUser, treasurerAccountId, residentUser, residentAccountId,
    chairman: { authUserId: chairUser.id, appAccountId: chairAccountId, role: "rt_chairman" as const, rtUnitId: rtId, householdId: null, personId: personIds[0]! },
    treasurer: { authUserId: treasurerUser.id, appAccountId: treasurerAccountId, role: "treasurer" as const, rtUnitId: rtId, householdId: null, personId: personIds[0]! },
    resident: { authUserId: residentUser.id, appAccountId: residentAccountId, role: "resident" as const, rtUnitId: rtId, householdId: householdIds[0]!, personId: personIds[0]! },
    duesCount: dueRows.length,
  };
}

async function main() {
  const database = await createTestDatabase();
  try {
    const db = database.db;
    const small = await seedScale(db, 50, "S");
    const large = await seedScale(db, 500, "L");
    const castDb = db as never;
    const scales: Record<string, {
      dataset: { households: number; annualDues: number };
      reads: Record<string, { medianMs: number; [key: string]: unknown }>;
    }> = {};
    for (const [name, fixture] of [["small_50", small], ["large_500", large]] as const) {
      const reportMs: number[] = [];
      const listMs: number[] = [];
      let arrearsHouseholds = 0;
      let returnedRows = 0;
      // Warm both service paths once, then collect three timed runs to reduce first-query startup noise.
      await getRtFinancialReport(castDb, fixture.chairman, { year: YEAR, businessDate: DATE });
      await listHouseholdManagement(castDb, fixture.chairman, "", DATE);
      for (let repeat = 0; repeat < 3; repeat += 1) {
        const report = await timed(() => getRtFinancialReport(castDb, fixture.chairman, { year: YEAR, businessDate: DATE }));
        reportMs.push(report.ms);
        arrearsHouseholds = report.value.arrears.households.length;
        const list = await timed(() => listHouseholdManagement(castDb, fixture.chairman, "", DATE));
        listMs.push(list.ms);
        returnedRows = list.value.households.length;
      }
      scales[name] = {
        dataset: { households: fixture.householdIds.length, annualDues: fixture.duesCount },
        reads: {
          chairman_f13_report_year_and_arrears: { medianMs: median(reportMs), repeatMs: reportMs, arrearsHouseholds },
          household_management_list_first_page: { medianMs: median(listMs), repeatMs: listMs, returnedRows },
        },
      };
    }
    const resident = large.resident;
    const treasurer = large.treasurer;
    const other: Record<string, unknown> = {};
    let dues: Awaited<ReturnType<typeof getResidentMonthlyDues>> = [];
    const residentBilling = await timed(async () => { dues = await getResidentMonthlyDues(castDb, resident); return dues; });
    other.resident_billing_12_dues = { ms: residentBilling.ms, resultRows: dues.length };
    const summary = await timed(async () => duesSummary(dues));
    other.resident_card_domain_summary = { ms: summary.ms, resultRows: dues.length, totals: summary.value };
    const queue = await timed(() => getTreasurerPaymentRequestQueue(castDb, treasurer, DATE));
    other.treasurer_payment_request_queue_empty = { ms: queue.ms, resultRows: queue.value.length };
    const treasurerHistory = await timed(() => getTreasurerPaymentHistory(castDb, treasurer, undefined, DATE));
    other.treasurer_payment_history_empty = { ms: treasurerHistory.ms, resultRows: treasurerHistory.value.transactions.length };
    const residentHistory = await timed(() => getResidentPaymentHistory(castDb, resident));
    other.resident_payment_history_empty = { ms: residentHistory.ms, resultRows: residentHistory.value.payments.length };

    const ratios: Record<string, number> = {};
    for (const key of ["chairman_f13_report_year_and_arrears", "household_management_list_first_page"]) {
      ratios[key] = Number((scales.large_500!.reads[key]!.medianMs / scales.small_50!.reads[key]!.medianMs).toFixed(2));
    }
    const output = {
      result: "COMPLETED_WITH_OBSERVATION",
      environment: "local disposable PGlite; no Neon connection or mutation",
      scalingComparison: {
        method: "Same in-memory database, schema and service functions; independent RT fixtures at 50 and 500 households. One unrecorded warmup then three timed runs per service path and fixture; ratios use the median of three.",
        scales,
        ratios_500_to_50: ratios,
        expectedDatasetMultiplier: 10,
        queryCount: "not instrumented; Drizzle/PGlite wrapper does not expose a reliable count without changing query execution",
        perHouseholdQueryPattern: "No obvious service-level per-household read loop in inspected report/list implementations; each fetch uses batched queries. Source inspection only.",
        interpretation: "Compare warmed median ratios to the 10x dataset multiplier. Shared-process cache effects remain possible; this is PGlite, not Neon, and establishes no production SLA.",
      },
      otherReadSmoke: other,
      paymentFixtureAssessment: "Nonempty payment queue/history not seeded: a valid payment requires the immutable request snapshot, verification path, allocation ledger, status transitions, and audit/constraint invariants. This is not a cheap synthetic row fixture; empty-path timings are retained as a limitation.",
      memory: { heapUsedMiB: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)), note: "single end-of-run sample; no profiler/peak sampling" },
      timestamp: new Date().toISOString(),
    };
    const outDir = resolve(process.cwd(), "docs/launch-safety-evidence");
    await mkdir(outDir, { recursive: true });
    await writeFile(resolve(outDir, "performance-smoke.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(output, null, 2));
  } finally { await database.close(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Performance smoke failed"); process.exitCode = 1; });
