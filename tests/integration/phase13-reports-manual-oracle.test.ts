import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  billingYears,
  households,
  monthlyDues,
  officialAssignments,
  payments,
  people,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createResidentAuthRecords } from "@/lib/accounts/resident-auth-records";
import { resolveResidentProvisioningTarget } from "@/lib/accounts/resident-provisioning";
import { createChairmanAdjustment } from "@/lib/billing/chairman-adjustment";
import { createChairmanWaiver } from "@/lib/billing/chairman-waiver";
import { createResidentPaymentRequest } from "@/lib/billing/resident-payment-request";
import { recordTreasurerCashPayment } from "@/lib/billing/treasurer-cash-payments";
import { reverseTreasurerPayment } from "@/lib/billing/treasurer-payment-reversal";
import { verifyTreasurerPaymentRequest } from "@/lib/billing/treasurer-payment-verification";
import { getRtFinancialReport } from "@/lib/reports/rt-financial-report";
import { buildAnnualDues } from "@/lib/billing/generator";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
  ensureTestChairman,
} from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

const YEAR = 2026;
const BUSINESS_DATE = "2026-05-20";
const BEFORE_MAY_DUE_DATE = "2026-05-05";
const BEFORE_REPLACEMENT_DATE = "2026-02-28";

const JAN_TO_MAY_EXPECTED = [
  { month: 1, target: 80_000, effectiveTarget: 80_000, received: 80_000, transferReceived: 80_000, cashReceived: 0, waived: 0, outstanding: 0, obligationCount: 2, waivedCount: 0, notDueCount: 2, overdueCount: 0 },
  { month: 2, target: 80_000, effectiveTarget: 90_000, received: 50_000, transferReceived: 0, cashReceived: 50_000, waived: 0, outstanding: 40_000, obligationCount: 2, waivedCount: 0, notDueCount: 2, overdueCount: 1 },
  { month: 3, target: 120_000, effectiveTarget: 115_000, received: 80_000, transferReceived: 40_000, cashReceived: 40_000, waived: 0, outstanding: 35_000, obligationCount: 3, waivedCount: 0, notDueCount: 1, overdueCount: 1 },
  { month: 4, target: 120_000, effectiveTarget: 120_000, received: 40_000, transferReceived: 0, cashReceived: 40_000, waived: 40_000, outstanding: 40_000, obligationCount: 3, waivedCount: 1, notDueCount: 1, overdueCount: 1 },
  { month: 5, target: 120_000, effectiveTarget: 120_000, received: 40_000, transferReceived: 0, cashReceived: 40_000, waived: 0, outstanding: 80_000, obligationCount: 3, waivedCount: 0, notDueCount: 1, overdueCount: 2 },
] as const;

const ANNUAL_EXPECTED = {
  target: 1_360_000,
  effectiveTarget: 1_365_000,
  received: 290_000,
  transferReceived: 120_000,
  cashReceived: 170_000,
  waived: 40_000,
  outstanding: 1_035_000,
  obligationCount: 34,
  waivedCount: 1,
  notDueCount: 14,
  overdueCount: 5,
};

function projection(value: unknown) {
  const row = value as Record<string, unknown>;
  return {
    month: row.month,
    target: row.target,
    effectiveTarget: row.effectiveTarget,
    received: row.received,
    transferReceived: row.transferReceived,
    cashReceived: row.cashReceived,
    waived: row.waived,
    outstanding: row.outstanding,
    obligationCount: row.obligationCount,
    waivedCount: row.waivedCount,
    notDueCount: row.notDueCount,
    overdueCount: row.overdueCount,
  };
}

function financialProjection(value: unknown) {
  const row = value as Record<string, unknown>;
  return {
    month: row.month,
    target: row.target,
    effectiveTarget: row.effectiveTarget,
    received: row.received,
    transferReceived: row.transferReceived,
    cashReceived: row.cashReceived,
    waived: row.waived,
    outstanding: row.outstanding,
    obligationCount: row.obligationCount,
    waivedCount: row.waivedCount,
    notDueCount: row.notDueCount,
  };
}

async function createOfficialPrincipal(
  database: TestDatabase["db"],
  rtUnitId: string,
  role: "rt_chairman" | "treasurer",
  personId: string,
): Promise<Principal> {
  if (role === "rt_chairman") {
    const appAccountId = await ensureTestChairman(database, rtUnitId);
    const [account] = await database.select({
      authUserId: appAccounts.authUserId,
      personId: appAccounts.personId,
    }).from(appAccounts).where(eq(appAccounts.id, appAccountId));
    if (!account) throw new Error("The F13 oracle Chairman account was not created.");
    return { authUserId: account.authUserId, appAccountId, role, rtUnitId, householdId: null, personId: account.personId! };
  }

  const user = await createAuthUser(database, "F13 oracle Treasurer");
  const [account] = await database.insert(appAccounts).values({
    rtUnitId,
    authUserId: user.id,
    accountType: "official",
    loginIdentifier: `f13-treasurer-${randomUUID()}`,
    personId,
  }).returning({ id: appAccounts.id });
  if (!account) throw new Error("The F13 oracle Treasurer account was not created.");
  await database.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: account.id,
    role,
    startsOn: "2020-01-01",
  });
  return { authUserId: user.id, appAccountId: account.id, role, rtUnitId, householdId: null, personId };
}

async function addResident(
  database: AppDatabase,
  input: { rtUnitId: string; householdId: string; personId: string; fullName: string },
): Promise<Principal> {
  const target = await resolveResidentProvisioningTarget(database, {
    rtUnitId: input.rtUnitId,
    householdId: input.householdId,
    personId: input.personId,
  });
  const records = await database.transaction((transaction) => createResidentAuthRecords(transaction, {
    ...target,
    fullName: input.fullName,
    pin: "624810",
  }));
  return {
    authUserId: records.authUserId,
    appAccountId: records.appAccountId,
    role: "resident",
    rtUnitId: input.rtUnitId,
    householdId: input.householdId,
    personId: input.personId,
  };
}

async function createYearDues(
  database: TestDatabase["db"],
  input: {
    rtUnitId: string;
    householdId: string;
    billingYearId: string;
    startsOn: string;
    endsOn?: string | null;
    feeRateId: string;
  },
) {
  const dues = buildAnnualDues({
    rtUnitId: input.rtUnitId,
    householdId: input.householdId,
    billingYearId: input.billingYearId,
    year: YEAR,
    householdStartsOn: input.startsOn,
    householdEndsOn: input.endsOn,
    feeRates: [{ id: input.feeRateId, effectiveMonth: 1, monthlyAmount: 40_000 }],
  });
  await database.insert(monthlyDues).values(dues);
}

async function settleTransfer(
  database: AppDatabase,
  resident: Principal,
  treasurer: Principal,
  period: string,
  businessDate = BUSINESS_DATE,
) {
  const request = await createResidentPaymentRequest(database, resident, {
    period,
    idempotencyKey: randomUUID(),
  });
  const verification = await verifyTreasurerPaymentRequest(database, treasurer, request.requestCode, businessDate);
  return { request, verification };
}

async function recordCash(
  database: AppDatabase,
  testDatabase: TestDatabase,
  treasurer: Principal,
  input: { rtUnitId: string; householdId: string; period: string },
  businessDate = BUSINESS_DATE,
) {
  const idempotencyKey = randomUUID();
  const result = await recordTreasurerCashPayment(database, treasurer, {
    householdId: input.householdId,
    period: input.period,
    idempotencyKey,
  }, businessDate);
  const [payment] = await testDatabase.db.select({ id: payments.id }).from(payments).where(and(
    eq(payments.rtUnitId, input.rtUnitId),
    eq(payments.cashIdempotencyKey, idempotencyKey),
  ));
  if (!payment) throw new Error(`The F13 oracle cash payment for ${input.period} was not persisted.`);
  return { result, paymentId: payment.id };
}

async function financialSnapshot(testDatabase: TestDatabase, rtUnitId: string) {
  const result = await testDatabase.client.query<Record<string, number>>(`
    SELECT
      (SELECT count(*)::int FROM public.monthly_dues WHERE rt_unit_id = $1::uuid) AS dues,
      (SELECT count(*)::int FROM public.due_adjustments WHERE rt_unit_id = $1::uuid) AS adjustments,
      (SELECT count(*)::int FROM public.payment_requests WHERE rt_unit_id = $1::uuid) AS requests,
      (SELECT count(*)::int FROM public.payment_allocations WHERE rt_unit_id = $1::uuid) AS allocations,
      (SELECT count(*)::int FROM public.payments WHERE rt_unit_id = $1::uuid) AS payments,
      (SELECT count(*)::int FROM public.payment_reversals WHERE rt_unit_id = $1::uuid) AS reversals,
      (SELECT count(*)::int FROM public.waiver_items WHERE rt_unit_id = $1::uuid) AS waivers,
      (SELECT count(*)::int FROM public.audit_events event
        JOIN public.app_accounts account ON account.id = event.actor_app_account_id
        WHERE account.rt_unit_id = $1::uuid) AS audit_events
  `, [rtUnitId]);
  return result.rows[0];
}

const DIRECT_COMPONENTS_SQL = `
  WITH selected_dues AS (
    SELECT id, rt_unit_id, household_id, month, due_date, status, amount
    FROM public.monthly_dues
    WHERE rt_unit_id = $1::uuid AND billing_year_id = $2::uuid
  ), adjustment_totals AS (
    SELECT adjustment.monthly_due_id, sum(adjustment.amount_delta)::bigint AS adjustment_total
    FROM public.due_adjustments adjustment
    JOIN selected_dues due
      ON due.id = adjustment.monthly_due_id
     AND due.rt_unit_id = adjustment.rt_unit_id
     AND due.household_id = adjustment.household_id
    GROUP BY adjustment.monthly_due_id
  ), active_allocation_methods AS (
    SELECT allocation.monthly_due_id,
      sum(allocation.amount) FILTER (WHERE payment.method = 'transfer')::bigint AS transfer_received,
      sum(allocation.amount) FILTER (WHERE payment.method = 'cash')::bigint AS cash_received
    FROM public.payment_allocations allocation
    JOIN selected_dues due
      ON due.id = allocation.monthly_due_id
     AND due.rt_unit_id = allocation.rt_unit_id
     AND due.household_id = allocation.household_id
    JOIN public.payments payment
      ON payment.id = allocation.payment_id
     AND payment.rt_unit_id = allocation.rt_unit_id
     AND payment.household_id = allocation.household_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payment_reversals reversal
      WHERE reversal.payment_id = payment.id
    )
    GROUP BY allocation.monthly_due_id
  ), waiver_totals AS (
    SELECT waiver.monthly_due_id, sum(waiver.amount)::bigint AS waiver_amount
    FROM public.waiver_items waiver
    JOIN selected_dues due
      ON due.id = waiver.monthly_due_id
     AND due.rt_unit_id = waiver.rt_unit_id
     AND due.household_id = waiver.household_id
    GROUP BY waiver.monthly_due_id
  ), pending_dues AS (
    SELECT DISTINCT claim.monthly_due_id
    FROM public.payment_request_claims claim
    JOIN public.payment_requests request ON request.id = claim.request_id
    JOIN selected_dues due ON due.id = claim.monthly_due_id
    WHERE request.status = 'pending'
  ), due_components AS (
    SELECT due.id, due.rt_unit_id, due.household_id, due.month, due.due_date, due.status,
      CASE WHEN due.status = 'not_due' THEN 0 ELSE due.amount END::bigint AS target,
      CASE WHEN due.status = 'not_due' THEN 0
        ELSE due.amount + coalesce(adjustment.adjustment_total, 0) END::bigint AS effective_target,
      coalesce(method.transfer_received, 0)::bigint AS transfer_received,
      coalesce(method.cash_received, 0)::bigint AS cash_received,
      CASE WHEN due.status = 'waived' THEN coalesce(waiver.waiver_amount, 0) ELSE 0 END::bigint AS waived,
      EXISTS (SELECT 1 FROM pending_dues pending WHERE pending.monthly_due_id = due.id) AS pending
    FROM selected_dues due
    LEFT JOIN adjustment_totals adjustment ON adjustment.monthly_due_id = due.id
    LEFT JOIN active_allocation_methods method ON method.monthly_due_id = due.id
    LEFT JOIN waiver_totals waiver ON waiver.monthly_due_id = due.id
  ), calculated_dues AS (
    SELECT due_components.*,
      (transfer_received + cash_received)::bigint AS received,
      (effective_target - transfer_received - cash_received - waived)::bigint AS outstanding
    FROM due_components
  )
`;

const DIRECT_MONTHLY_SQL = `${DIRECT_COMPONENTS_SQL}
  SELECT month::int AS month,
    sum(target)::int AS target,
    sum(effective_target)::int AS "effectiveTarget",
    sum(received)::int AS received,
    sum(transfer_received)::int AS "transferReceived",
    sum(cash_received)::int AS "cashReceived",
    sum(waived)::int AS waived,
    sum(outstanding)::int AS outstanding,
    count(*) FILTER (WHERE status <> 'not_due')::int AS "obligationCount",
    count(*) FILTER (WHERE status = 'waived')::int AS "waivedCount",
    count(*) FILTER (WHERE status = 'not_due')::int AS "notDueCount",
    count(*) FILTER (WHERE outstanding > 0 AND due_date < $3::date)::int AS "overdueCount"
  FROM calculated_dues
  GROUP BY month
  ORDER BY month
`;

const DIRECT_YEARLY_SQL = `${DIRECT_COMPONENTS_SQL}
  SELECT sum(target)::int AS target,
    sum(effective_target)::int AS "effectiveTarget",
    sum(received)::int AS received,
    sum(transfer_received)::int AS "transferReceived",
    sum(cash_received)::int AS "cashReceived",
    sum(waived)::int AS waived,
    sum(outstanding)::int AS outstanding,
    count(*) FILTER (WHERE status <> 'not_due')::int AS "obligationCount",
    count(*) FILTER (WHERE status = 'waived')::int AS "waivedCount",
    count(*) FILTER (WHERE status = 'not_due')::int AS "notDueCount",
    count(*) FILTER (WHERE outstanding > 0 AND due_date < $3::date)::int AS "overdueCount"
  FROM calculated_dues
`;

const DIRECT_ARREARS_SQL = `${DIRECT_COMPONENTS_SQL}
  SELECT due.household_id AS "householdId", house.number AS "houseNumber",
    household.status AS "householdStatus", household.starts_on AS "startsOn", household.ends_on AS "endsOn",
    due.month::int AS month, due.due_date AS "dueDate", due.outstanding::int AS outstanding,
    due.pending AS pending,
    array_agg(DISTINCT person.full_name ORDER BY person.full_name) FILTER (WHERE person.id IS NOT NULL) AS "residentNames"
  FROM calculated_dues due
  JOIN public.households household
    ON household.id = due.household_id AND household.rt_unit_id = due.rt_unit_id
  JOIN public.houses house
    ON house.id = household.house_id AND house.rt_unit_id = household.rt_unit_id
  LEFT JOIN public.people person
    ON person.household_id = household.id AND person.rt_unit_id = household.rt_unit_id
  WHERE due.outstanding > 0 AND due.due_date < $3::date
  GROUP BY due.household_id, house.number, household.status, household.starts_on,
    household.ends_on, due.month, due.due_date, due.outstanding, due.pending
  ORDER BY house.number, household.starts_on, due.month
`;

function expectedReportHouseholds(report: Awaited<ReturnType<typeof getRtFinancialReport>>) {
  return report.arrears.households.map((household) => {
    const key = household.houseNumber === "A-01"
      ? "H1"
      : household.lifecycle === "historical" ? "H3-old" : "H3-new";
    return {
      key,
      houseNumber: household.houseNumber,
      lifecycle: household.lifecycle,
      startsOn: household.startsOn,
      endsOn: household.endsOn,
      residentNames: household.residentNames,
      totalOutstanding: household.totalOutstanding,
      pending: household.pending,
      periods: household.periods.map((period) => ({
        month: period.month,
        dueDate: period.dueDate,
        outstanding: period.outstanding,
        pending: period.pending,
      })),
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
}

describe("F13 PGlite manual reporting oracle", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  it("matches manual and independent SQL totals, cash-sweep allocation, waiver, reversals, lifecycle, and arrears", async () => {
    const rtUnitId = await createRt(testDatabase.db);
    const h1 = await createHousehold(testDatabase.db, rtUnitId, { number: "A-01", startsOn: "2024-01-01" });
    const h2 = await createHousehold(testDatabase.db, rtUnitId, { number: "A-02", startsOn: "2026-03-01" });
    const h3Old = await createHousehold(testDatabase.db, rtUnitId, { number: "A-03", startsOn: "2024-01-01" });
    const h1Resident = await addResident(database, {
      rtUnitId,
      householdId: h1.householdId,
      personId: h1.personId,
      fullName: "H1 Resident",
    });
    const h3OldResident = await addResident(database, {
      rtUnitId,
      householdId: h3Old.householdId,
      personId: h3Old.personId,
      fullName: "H3 Old Resident",
    });
    await testDatabase.db.update(people).set({ fullName: "H2 Resident" }).where(eq(people.id, h2.personId));
    await testDatabase.db.update(people).set({ fullName: "H1 Resident" }).where(eq(people.id, h1.personId));
    await testDatabase.db.update(people).set({ fullName: "H3 Old Resident" }).where(eq(people.id, h3Old.personId));

    const chairman = await createOfficialPrincipal(testDatabase.db, rtUnitId, "rt_chairman", h1.personId);
    const treasurer = await createOfficialPrincipal(testDatabase.db, rtUnitId, "treasurer", h1.personId);
    const [billingYear] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: YEAR,
      status: "open",
    }).returning({ id: billingYears.id });
    if (!billingYear) throw new Error("Could not create the F13 oracle billing year.");
    const [feeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: billingYear.id,
      effectiveMonth: 1,
      monthlyAmount: 40_000,
    });
    if (!feeRate) throw new Error("Could not create the F13 oracle tariff.");

    await createYearDues(testDatabase.db, {
      rtUnitId,
      householdId: h1.householdId,
      billingYearId: billingYear.id,
      startsOn: "2024-01-01",
      feeRateId: feeRate.id,
    });
    await createYearDues(testDatabase.db, {
      rtUnitId,
      householdId: h2.householdId,
      billingYearId: billingYear.id,
      startsOn: "2026-03-01",
      feeRateId: feeRate.id,
    });
    await createYearDues(testDatabase.db, {
      rtUnitId,
      householdId: h3Old.householdId,
      billingYearId: billingYear.id,
      startsOn: "2024-01-01",
      endsOn: "2026-02-28",
      feeRateId: feeRate.id,
    });

    const dueRows = await testDatabase.db.select({ id: monthlyDues.id, householdId: monthlyDues.householdId, month: monthlyDues.month })
      .from(monthlyDues).where(eq(monthlyDues.rtUnitId, rtUnitId));
    const dueIdByHouseMonth = new Map(dueRows.map((due) => [`${due.householdId}:${due.month}`, due.id]));
    const dueId = (householdId: string, month: number) => {
      const id = dueIdByHouseMonth.get(`${householdId}:${month}`);
      if (!id) throw new Error(`Missing F13 oracle due for month ${month}.`);
      return id;
    };

    // Settle old-household January before seeding the historic F12 boundary.
    await settleTransfer(database, h3OldResident, treasurer, "2026-01", BEFORE_REPLACEMENT_DATE);
    // Seed the historic F12 snapshot directly: this fixture reports May 2026,
    // while the database trigger compares due dates to wall-clock now and
    // correctly rejects retroactive lifecycle mutation after those dates pass.
    await testDatabase.db.update(households).set({ status: "inactive", endsOn: "2026-02-28" })
      .where(eq(households.id, h3Old.householdId));
    await testDatabase.db.update(people).set({ isActive: false }).where(eq(people.id, h3Old.personId));
    await testDatabase.db.update(appAccounts).set({ status: "disabled" })
      .where(eq(appAccounts.id, h3OldResident.appAccountId));
    const [h3NewHousehold] = await testDatabase.db.insert(households).values({
      rtUnitId,
      houseId: h3Old.houseId,
      startsOn: "2026-03-01",
      status: "active",
    }).returning({ id: households.id });
    if (!h3NewHousehold) throw new Error("The seeded H3 successor household was not created.");
    const h3NewHouseholdId = h3NewHousehold.id;
    const [h3NewPerson] = await testDatabase.db.insert(people).values({
      rtUnitId,
      householdId: h3NewHouseholdId,
      fullName: "H3 New Resident",
    }).returning({ id: people.id });
    if (!h3NewPerson) throw new Error("The seeded H3 successor resident was not created.");
    await createYearDues(testDatabase.db, {
      rtUnitId,
      householdId: h3NewHouseholdId,
      billingYearId: billingYear.id,
      startsOn: "2026-03-01",
      feeRateId: feeRate.id,
    });
    const successorDues = await testDatabase.db
      .select({ id: monthlyDues.id, month: monthlyDues.month })
      .from(monthlyDues)
      .where(eq(monthlyDues.householdId, h3NewHouseholdId));
    for (const due of successorDues) dueIdByHouseMonth.set(`${h3NewHouseholdId}:${due.month}`, due.id);

    // H1 January is transferred; February receives a +10,000 adjustment then full cash settlement.
    await settleTransfer(database, h1Resident, treasurer, "2026-01");
    await createChairmanAdjustment(database, chairman, {
      monthlyDueId: dueId(h1.householdId, 2),
      amountDelta: 10_000,
      reason: "F13 manual oracle positive adjustment.",
      idempotencyKey: randomUUID(),
    }, BUSINESS_DATE);
    const h1FebruaryCash = await recordCash(database, testDatabase, treasurer, {
      rtUnitId,
      householdId: h1.householdId,
      period: "2026-02",
    });
    expect(h1FebruaryCash.result).toMatchObject({ periods: ["2026-02"], totalAmount: 50_000 });

    // March H1 remains unpaid at 35,000; H2 transfers March and H3-new pays March cash.
    await createChairmanAdjustment(database, chairman, {
      monthlyDueId: dueId(h1.householdId, 3),
      amountDelta: -5_000,
      reason: "F13 manual oracle negative adjustment.",
      idempotencyKey: randomUUID(),
    }, BUSINESS_DATE);
    const h2Resident = await addResident(database, {
      rtUnitId,
      householdId: h2.householdId,
      personId: h2.personId,
      fullName: "H2 Resident",
    });
    await settleTransfer(database, h2Resident, treasurer, "2026-03");
    // The successor's March dues are cash-settled. May cash follows F8 oldest-unpaid-first semantics.
    const h3NewMarchCash = await recordCash(database, testDatabase, treasurer, {
      rtUnitId,
      householdId: h3NewHouseholdId,
      period: "2026-03",
    });
    expect(h3NewMarchCash.result).toMatchObject({ periods: ["2026-03"], totalAmount: 40_000 });

    await createChairmanWaiver(database, chairman, {
      householdId: h1.householdId,
      periods: ["2026-04"],
      reason: "F13 manual oracle waiver fixture.",
      idempotencyKey: randomUUID(),
    }, BUSINESS_DATE);

    const h2MayCash = await recordCash(database, testDatabase, treasurer, {
      rtUnitId,
      householdId: h2.householdId,
      period: "2026-05",
    });
    expect(h2MayCash.result).toMatchObject({ periods: ["2026-04", "2026-05"], totalAmount: 80_000 });

    const h3NewMayCash = await recordCash(database, testDatabase, treasurer, {
      rtUnitId,
      householdId: h3NewHouseholdId,
      period: "2026-05",
    });
    expect(h3NewMayCash.result).toMatchObject({ periods: ["2026-04", "2026-05"], totalAmount: 80_000 });
    await reverseTreasurerPayment(database, treasurer, {
      paymentId: h3NewMayCash.paymentId,
      reason: "F13 manual oracle reversal fixture.",
    }, BUSINESS_DATE);
    const reversedH3NewAllocations = await testDatabase.client.query<{ month: number; amount: number; reversed: boolean }>(`
      SELECT due.month::int AS month, allocation.amount::int AS amount,
        EXISTS (SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id) AS reversed
      FROM public.payment_allocations allocation
      JOIN public.payments payment ON payment.id = allocation.payment_id
      JOIN public.monthly_dues due ON due.id = allocation.monthly_due_id
      WHERE payment.id = $1::uuid
      ORDER BY due.month
    `, [h3NewMayCash.paymentId]);
    expect(reversedH3NewAllocations.rows).toEqual([
      { month: 4, amount: 40_000, reversed: true },
      { month: 5, amount: 40_000, reversed: true },
    ]);

    // The pending H1 request includes its older March balance as well as May.
    const h1Pending = await createResidentPaymentRequest(database, h1Resident, {
      period: "2026-05",
      idempotencyKey: randomUUID(),
    });
    expect(h1Pending).toMatchObject({ status: "pending", periods: ["2026-03", "2026-05"], totalAmount: 75_000 });

    const may20Before = await financialSnapshot(testDatabase, rtUnitId);
    const reportMay20 = await getRtFinancialReport(database, chairman, { year: YEAR, businessDate: BUSINESS_DATE });
    const reportMay05 = await getRtFinancialReport(database, chairman, { year: YEAR, businessDate: BEFORE_MAY_DUE_DATE });
    const may20After = await financialSnapshot(testDatabase, rtUnitId);
    expect(may20After).toEqual(may20Before);

    expect(reportMay20).toMatchObject({ year: YEAR, availableYears: [YEAR] });
    expect(reportMay20.monthly).toHaveLength(12);
    expect(reportMay20.monthly.slice(0, 5).map(projection)).toEqual(JAN_TO_MAY_EXPECTED);
    expect(reportMay20.monthly.slice(5).every((month) =>
      month.target === 120_000 && month.effectiveTarget === 120_000 && month.received === 0 &&
      month.transferReceived === 0 && month.cashReceived === 0 && month.waived === 0 &&
      month.outstanding === 120_000 && month.notDueCount === 1 && month.obligationCount === 3,
    )).toBe(true);
    expect(reportMay20.yearly).toEqual(ANNUAL_EXPECTED);
    expect(reportMay20.yearly.effectiveTarget).toBe(
      reportMay20.yearly.received + reportMay20.yearly.waived + reportMay20.yearly.outstanding,
    );
    expect(reportMay20.yearly.transferReceived + reportMay20.yearly.cashReceived).toBe(reportMay20.yearly.received);

    const janToMay = reportMay20.monthly.slice(0, 5).reduce((sum, month) => ({
      target: sum.target + month.target,
      effectiveTarget: sum.effectiveTarget + month.effectiveTarget,
      received: sum.received + month.received,
      transferReceived: sum.transferReceived + month.transferReceived,
      cashReceived: sum.cashReceived + month.cashReceived,
      waived: sum.waived + month.waived,
      outstanding: sum.outstanding + month.outstanding,
      notDueCount: sum.notDueCount + month.notDueCount,
    }), { target: 0, effectiveTarget: 0, received: 0, transferReceived: 0, cashReceived: 0, waived: 0, outstanding: 0, notDueCount: 0 });
    expect(janToMay).toEqual({
      target: 520_000,
      effectiveTarget: 525_000,
      received: 290_000,
      transferReceived: 120_000,
      cashReceived: 170_000,
      waived: 40_000,
      outstanding: 195_000,
      notDueCount: 7,
    });
    expect(janToMay.effectiveTarget).toBe(janToMay.received + janToMay.waived + janToMay.outstanding);

    expect(reportMay05.monthly.map(financialProjection)).toEqual(reportMay20.monthly.map(financialProjection));
    expect(reportMay05.monthly.map(({ month, overdueCount }) => ({ month, overdueCount }))).toEqual(
      reportMay20.monthly.map(({ month, overdueCount }) => ({ month, overdueCount: month === 5 ? 0 : overdueCount })),
    );
    expect(reportMay20.yearly.overdueCount).toBe(5);
    expect(reportMay05.yearly).toEqual({ ...ANNUAL_EXPECTED, overdueCount: 3 });

    expect(reportMay20.arrears).toMatchObject({ totalOutstanding: 195_000, count: 5, householdCount: 3 });
    expect(expectedReportHouseholds(reportMay20)).toEqual([
      {
        key: "H1", houseNumber: "A-01", lifecycle: "active", startsOn: "2024-01-01", endsOn: null,
        residentNames: ["H1 Resident"], totalOutstanding: 75_000, pending: true,
        periods: [
          { month: 3, dueDate: "2026-03-10", outstanding: 35_000, pending: true },
          { month: 5, dueDate: "2026-05-10", outstanding: 40_000, pending: true },
        ],
      },
      {
        key: "H3-new", houseNumber: "A-03", lifecycle: "active", startsOn: "2026-03-01", endsOn: null,
        residentNames: ["H3 New Resident"], totalOutstanding: 80_000, pending: false,
        periods: [
          { month: 4, dueDate: "2026-04-10", outstanding: 40_000, pending: false },
          { month: 5, dueDate: "2026-05-10", outstanding: 40_000, pending: false },
        ],
      },
      {
        key: "H3-old", houseNumber: "A-03", lifecycle: "historical", startsOn: "2024-01-01", endsOn: "2026-02-28",
        residentNames: ["H3 Old Resident"], totalOutstanding: 40_000, pending: false,
        periods: [{ month: 2, dueDate: "2026-02-10", outstanding: 40_000, pending: false }],
      },
    ]);

    expect(reportMay05.arrears).toMatchObject({ totalOutstanding: 115_000, count: 3, householdCount: 3 });
    expect(expectedReportHouseholds(reportMay05)).toEqual([
      {
        key: "H1", houseNumber: "A-01", lifecycle: "active", startsOn: "2024-01-01", endsOn: null,
        residentNames: ["H1 Resident"], totalOutstanding: 35_000, pending: true,
        periods: [{ month: 3, dueDate: "2026-03-10", outstanding: 35_000, pending: true }],
      },
      {
        key: "H3-new", houseNumber: "A-03", lifecycle: "active", startsOn: "2026-03-01", endsOn: null,
        residentNames: ["H3 New Resident"], totalOutstanding: 40_000, pending: false,
        periods: [{ month: 4, dueDate: "2026-04-10", outstanding: 40_000, pending: false }],
      },
      {
        key: "H3-old", houseNumber: "A-03", lifecycle: "historical", startsOn: "2024-01-01", endsOn: "2026-02-28",
        residentNames: ["H3 Old Resident"], totalOutstanding: 40_000, pending: false,
        periods: [{ month: 2, dueDate: "2026-02-10", outstanding: 40_000, pending: false }],
      },
    ]);

    // Independently aggregate raw dues, adjustments, active allocation methods, reversals, waivers, and claims in SQL.
    const sqlMay20Monthly = await testDatabase.client.query<Record<string, number>>(
      DIRECT_MONTHLY_SQL, [rtUnitId, billingYear.id, BUSINESS_DATE],
    );
    const sqlMay20Yearly = await testDatabase.client.query<Record<string, number>>(
      DIRECT_YEARLY_SQL, [rtUnitId, billingYear.id, BUSINESS_DATE],
    );
    const sqlMay05Yearly = await testDatabase.client.query<Record<string, number>>(
      DIRECT_YEARLY_SQL, [rtUnitId, billingYear.id, BEFORE_MAY_DUE_DATE],
    );
    expect(sqlMay20Monthly.rows.map(projection)).toEqual(reportMay20.monthly.map(projection));
    expect(sqlMay20Yearly.rows[0]).toMatchObject(ANNUAL_EXPECTED);
    expect(sqlMay05Yearly.rows[0]).toMatchObject({ ...ANNUAL_EXPECTED, overdueCount: 3 });

    const sqlMay20Arrears = await testDatabase.client.query<{
      householdId: string;
      houseNumber: string;
      householdStatus: "active" | "inactive";
      startsOn: string;
      endsOn: string | null;
      month: number;
      dueDate: string;
      outstanding: number;
      pending: boolean;
      residentNames: string[];
    }>(DIRECT_ARREARS_SQL, [rtUnitId, billingYear.id, BUSINESS_DATE]);
    const sqlMay05Arrears = await testDatabase.client.query<{
      householdId: string;
      houseNumber: string;
      month: number;
      outstanding: number;
      pending: boolean;
    }>(DIRECT_ARREARS_SQL, [rtUnitId, billingYear.id, BEFORE_MAY_DUE_DATE]);
    expect(sqlMay20Arrears.rows.reduce((sum, row) => sum + row.outstanding, 0)).toBe(195_000);
    expect(sqlMay20Arrears.rows).toHaveLength(5);
    expect(new Set(sqlMay20Arrears.rows.map((row) => row.householdId)).size).toBe(3);
    expect(sqlMay05Arrears.rows.reduce((sum, row) => sum + row.outstanding, 0)).toBe(115_000);
    expect(sqlMay05Arrears.rows).toHaveLength(3);
    expect(new Set(sqlMay05Arrears.rows.map((row) => row.householdId)).size).toBe(3);

    const serviceArrearsRows = expectedReportHouseholds(reportMay20).flatMap((household) => household.periods.map((period) => ({
      key: household.key,
      month: period.month,
      outstanding: period.outstanding,
      pending: period.pending,
    }))).sort((left, right) => left.key.localeCompare(right.key) || left.month - right.month);
    const independentSqlArrearsRows = sqlMay20Arrears.rows.map((row) => ({
      key: row.houseNumber === "A-01" ? "H1" : row.householdStatus === "inactive" ? "H3-old" : "H3-new",
      month: row.month,
      outstanding: row.outstanding,
      pending: row.pending,
    })).sort((left, right) => left.key.localeCompare(right.key) || left.month - right.month);
    expect(independentSqlArrearsRows).toEqual(serviceArrearsRows);

    const oldAndNewSqlHouseholds = sqlMay20Arrears.rows.filter((row) => row.houseNumber === "A-03");
    expect(oldAndNewSqlHouseholds.map((row) => row.householdId)).toEqual(expect.arrayContaining([
      h3Old.householdId,
      h3NewHouseholdId,
    ]));
    expect(oldAndNewSqlHouseholds[0]?.householdId).not.toBe(oldAndNewSqlHouseholds[1]?.householdId);

    const h1MarchId = dueId(h1.householdId, 3);
    const h1MayId = dueId(h1.householdId, 5);
    const h3NewAprilId = dueId(h3NewHouseholdId, 4);
    const h3NewMayId = dueId(h3NewHouseholdId, 5);
    const ledgerRows = await testDatabase.client.query<{
      dueId: string;
      month: number;
      method: string;
      amount: number;
      reversed: boolean;
      pending: boolean;
    }>(`
      SELECT due.id AS "dueId", due.month::int AS month, payment.method,
        allocation.amount::int AS amount,
        EXISTS (SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id) AS reversed,
        EXISTS (
          SELECT 1 FROM public.payment_request_claims claim
          JOIN public.payment_requests request ON request.id = claim.request_id
          WHERE claim.monthly_due_id = due.id AND request.status = 'pending'
        ) AS pending
      FROM public.monthly_dues due
      JOIN public.payment_allocations allocation ON allocation.monthly_due_id = due.id
      JOIN public.payments payment ON payment.id = allocation.payment_id
      WHERE due.id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
      ORDER BY due.month, payment.method
    `, [h1MarchId, h1MayId, h3NewAprilId, h3NewMayId]);
    expect(ledgerRows.rows).toEqual([
      expect.objectContaining({ dueId: h3NewAprilId, month: 4, method: "cash", amount: 40_000, reversed: true }),
      expect.objectContaining({ dueId: h3NewMayId, month: 5, method: "cash", amount: 40_000, reversed: true }),
    ]);
    const pendingClaims = await testDatabase.client.query<{ month: number; requestStatus: string }>(`
      SELECT due.month::int AS month, request.status AS "requestStatus"
      FROM public.payment_request_claims claim
      JOIN public.payment_requests request ON request.id = claim.request_id
      JOIN public.monthly_dues due ON due.id = claim.monthly_due_id
      WHERE due.id IN ($1::uuid, $2::uuid)
      ORDER BY due.month
    `, [h1MarchId, h1MayId]);
    expect(pendingClaims.rows).toEqual([
      { month: 3, requestStatus: "pending" },
      { month: 5, requestStatus: "pending" },
    ]);

    const h1AprilSql = await testDatabase.client.query<{ status: string; amount: number; waiverAmount: number }>(`
      SELECT due.status, due.amount::int AS amount, waiver.amount::int AS "waiverAmount"
      FROM public.monthly_dues due
      JOIN public.waiver_items waiver ON waiver.monthly_due_id = due.id
      WHERE due.id = $1::uuid
    `, [dueId(h1.householdId, 4)]);
    const h3OldMarchSql = await testDatabase.client.query<{ status: string; amount: number }>(`
      SELECT status, amount::int AS amount FROM public.monthly_dues WHERE id = $1::uuid
    `, [dueId(h3Old.householdId, 3)]);
    expect(h1AprilSql.rows[0]).toEqual({ status: "waived", amount: 40_000, waiverAmount: 40_000 });
    expect(h3OldMarchSql.rows[0]).toEqual({ status: "not_due", amount: 0 });
  });
});
