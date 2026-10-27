import type { AppDatabase } from "@/db/client";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { getRtFinancialReport } from "@/lib/reports/rt-financial-report";
import { billingYears } from "@/db/schema";
import {
  createWorkbookFinancialSettlementFixture,
  WORKBOOK_FINANCIAL_BUSINESS_DATE,
} from "../tests/fixtures/workbook-financial-settlement";
import { bootstrapWorkbookSyntheticAccountFixture } from "../tests/fixtures/workbook-account-fixture";
import { readSyntheticAccountWorkbook } from "../tests/fixtures/workbook-account-roster";
import { createFeeRateFixture, createTestDatabase } from "../tests/helpers/database";

const MONTHLY_AMOUNT = 40_000;

async function main() {
  const workbookPath = process.argv[2];
  if (!workbookPath) throw new Error("Provide the uploaded workbook path.");

  const roster = await readSyntheticAccountWorkbook(workbookPath);
  const testDatabase = await createTestDatabase();
  try {
    const database = testDatabase.db;
    const appDatabase = database as unknown as AppDatabase;
    const fixture = await bootstrapWorkbookSyntheticAccountFixture(appDatabase, roster);
    const [year] = await database.insert(billingYears).values({
      rtUnitId: fixture.rtUnitId,
      year: 2026,
      status: "draft",
    }).returning({ id: billingYears.id });
    if (!year) throw new Error("The disposable billing fixture could not be created.");

    const feeRates = await createFeeRateFixture(database, {
      rtUnitId: fixture.rtUnitId,
      billingYearId: year.id,
      effectiveMonth: 1,
      monthlyAmount: MONTHLY_AMOUNT,
    });
    if (feeRates.length !== 1) throw new Error("The disposable billing tariff could not be created.");

    const settlements = [];
    for (const residentPrincipal of fixture.principals.residents) {
      if (!residentPrincipal.householdId) throw new Error("A resident fixture household is missing.");
      settlements.push(await createWorkbookFinancialSettlementFixture({
        database: appDatabase,
        rtUnitId: fixture.rtUnitId,
        householdId: residentPrincipal.householdId,
        billingYearId: year.id,
        chairmanPrincipal: fixture.principals.chairman,
        residentPrincipal,
        treasurerPrincipal: fixture.principals.treasurer,
      }));
    }

    if (settlements.length !== 2 || settlements.some((settlement) => (
      settlement.generatedDuesCount !== 12 ||
      settlement.replayedGenerationInsertCount !== 0 ||
      settlement.requestPeriods.length !== 9 ||
      settlement.requestTotalAmount !== 9 * MONTHLY_AMOUNT ||
      !settlement.requestReplayMatched ||
      settlement.verifiedItemCount !== 9 ||
      settlement.verifiedTotalAmount !== 9 * MONTHLY_AMOUNT ||
      !settlement.duplicateVerificationRejected
    ))) {
      throw new Error("The disposable workbook financial verification did not match the locked 2026 fixture.");
    }

    for (const residentPrincipal of fixture.principals.residents) {
      const dues = await getResidentMonthlyDues(appDatabase, residentPrincipal, WORKBOOK_FINANCIAL_BUSINESS_DATE);
      const paid = dues.filter((due) => due.month <= 9);
      const october = dues.find((due) => due.month === 10);
      const future = dues.filter((due) => due.month === 11 || due.month === 12);
      if (
        paid.length !== 9 || paid.some((due) => due.status !== "paid" || due.receipts.length !== 1) ||
        !october || october.status !== "unpaid" || october.activeReceived !== 0 || october.receipts.length !== 0 ||
        future.length !== 2 || future.some((due) => due.periodTiming !== "future" || due.receipts.length !== 0)
      ) throw new Error("The disposable workbook payment read model did not match the locked fixture.");
    }

    const report = await getRtFinancialReport(appDatabase, fixture.principals.chairman, {
      year: 2026,
      businessDate: WORKBOOK_FINANCIAL_BUSINESS_DATE,
    });
    if (
      report.yearly.received !== 18 * MONTHLY_AMOUNT ||
      report.yearly.outstanding !== 6 * MONTHLY_AMOUNT ||
      report.yearly.overdueCount !== 2 ||
      report.futureUnpaidOutstanding !== 4 * MONTHLY_AMOUNT ||
      report.arrears.householdCount !== 2
    ) throw new Error("The disposable workbook financial report did not match the locked fixture.");

    console.info(JSON.stringify({
      outcome: "PASS",
      database: "PGlite in-memory only",
      roster: { accounts: 5, systemAdmins: 1, chairmen: 1, treasurers: 1, residents: 2, active: 5 },
      finance: { year: 2026, residentsSettled: 2, paidMonthsPerResident: 9, octoberEvidence: 0, futureMonthsInArrears: 0 },
    }));
  } finally {
    await testDatabase.close();
  }
}

main().catch(() => {
  console.error("Offline workbook verification failed. Workbook values were not written to files or output.");
  process.exitCode = 1;
});
