import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appAccounts,
  authTwoFactor,
  authUser,
  billingYears,
  feeRates,
  houses,
  households,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  payments,
  people,
  sheet2ImportBatches,
  sheet2OpeningBalanceItems,
} from "@/db/schema";
import type { AppDatabase } from "@/db/client";
import type { Principal } from "@/lib/auth/permissions";
import { createChairmanFeeRate } from "@/lib/billing/chairman-fee-rates";
import { getResidentMonthlyDues } from "@/lib/billing/resident-dues";
import { importSheet2, type Sheet2ImportInput, type Sheet2ResidentImportRow } from "@/lib/imports/sheet2-import";
import { createAuthUser, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

function syntheticRows(prefix: string): Sheet2ResidentImportRow[] {
  return Array.from({ length: 73 }, (_, index) => {
    let paidFromMonth: number | null = null;
    let paidThroughMonth: number | null = null;
    if (index < 16) {
      paidFromMonth = 3;
      paidThroughMonth = 12;
    } else if (index < 18) {
      paidFromMonth = 2;
      paidThroughMonth = 11;
    } else if (index < 41) {
      paidFromMonth = 1;
      paidThroughMonth = 10;
    } else if (index < 65) {
      paidFromMonth = 2;
      paidThroughMonth = 10;
    }
    return {
      houseNumber: `SYN-${String(index + 1).padStart(3, "0")}`,
      fullName: `Synthetic Resident ${prefix} ${index + 1}`,
      username: `synthetic-${prefix}-resident-${index + 1}`,
      pin: "123456",
      monthlyAmount: index < 57 ? 45_000 : 60_000,
      paidFromMonth,
      paidThroughMonth,
      ...(index === 0 ? { officialRole: "rt_chairman" as const } : {}),
      ...(index === 1 ? { officialRole: "treasurer" as const } : {}),
    };
  });
}

async function createVerifiedSystemAdmin(database: TestDatabase["db"]): Promise<Principal> {
  const user = await createAuthUser(database, "Synthetic Import Actor");
  await database.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, user.id));
  const [account] = await database.insert(appAccounts).values({
    rtUnitId: null,
    authUserId: user.id,
    accountType: "system_admin",
    loginIdentifier: `synthetic-actor-${randomUUID()}`,
    personId: null,
    householdId: null,
  }).returning({ id: appAccounts.id });
  await database.insert(authTwoFactor).values({
    id: randomUUID(),
    userId: user.id,
    secret: "synthetic-encrypted-totp-secret",
    backupCodes: "synthetic-encrypted-backup-codes",
    verified: true,
  });
  return {
    authUserId: user.id,
    appAccountId: account!.id,
    role: "system_admin",
    rtUnitId: null,
    householdId: null,
    personId: null,
  };
}

async function seedSyntheticResidue(database: TestDatabase["db"], rtUnitId: string) {
  const residueHouseholds: Array<{ id: string; personId: string }> = [];
  for (let index = 0; index < 2; index += 1) {
    const [house] = await database.insert(houses).values({
      rtUnitId,
      number: `RESIDUE-${index + 1}`,
    }).returning({ id: houses.id });
    const [household] = await database.insert(households).values({
      rtUnitId,
      houseId: house!.id,
      status: "inactive",
      startsOn: "2020-01-01",
      endsOn: "2025-12-31",
    }).returning({ id: households.id });
    const [person] = await database.insert(people).values({
      rtUnitId,
      householdId: household!.id,
      fullName: `Synthetic Residue Resident ${index + 1}`,
      isActive: false,
    }).returning({ id: people.id });
    residueHouseholds.push({ id: household!.id, personId: person!.id });
  }

  for (let index = 0; index < 5; index += 1) {
    const owner = residueHouseholds[index % residueHouseholds.length]!;
    const user = await createAuthUser(database, `Synthetic Disabled Account ${index + 1}`);
    await database.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "resident",
      status: "disabled",
      loginIdentifier: `synthetic-residue-disabled-${index + 1}`,
      personId: owner.personId,
      householdId: owner.id,
    });
  }

  const chairmanUser = await createAuthUser(database, "Synthetic Residue Chairman");
  const [chairmanAccount] = await database.insert(appAccounts).values({
    rtUnitId,
    authUserId: chairmanUser.id,
    accountType: "official",
    loginIdentifier: "synthetic-residue-chairman",
    personId: residueHouseholds[0]!.personId,
  }).returning({ id: appAccounts.id });
  await database.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: chairmanAccount!.id,
    role: "rt_chairman",
    startsOn: "2020-01-01",
  });

  const [residueYear] = await database.insert(billingYears).values({
    rtUnitId,
    year: 2200,
    status: "open",
  }).returning({ id: billingYears.id });
  const chairmanPrincipal: Principal = {
    authUserId: chairmanUser.id,
    appAccountId: chairmanAccount!.id,
    role: "rt_chairman",
    rtUnitId,
    householdId: null,
    personId: residueHouseholds[0]!.personId,
  };
  const rate = await createChairmanFeeRate(asAppDatabase(database), chairmanPrincipal, {
    billingYearId: residueYear!.id,
    effectiveMonth: 1,
    monthlyAmount: 25_000,
    idempotencyKey: randomUUID(),
  });
  await database.update(officialAssignments).set({ endsOn: "2026-10-26" })
    .where(eq(officialAssignments.appAccountId, chairmanAccount!.id));
  const residueDues = residueHouseholds.flatMap(({ id: householdId }) =>
    Array.from({ length: 12 }, (_, index) => ({
      rtUnitId,
      householdId,
      billingYearId: residueYear!.id,
      feeRateId: rate!.id,
      month: index + 1,
      amount: 25_000,
      dueDate: `2200-${String(index + 1).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    })));
  await database.insert(monthlyDues).values(residueDues);
  await database.update(billingYears).set({ status: "closed" }).where(eq(billingYears.id, residueYear!.id));

  const householdRows = await database.select({ id: households.id, status: households.status, endsOn: households.endsOn })
    .from(households).where(eq(households.rtUnitId, rtUnitId));
  const disabledAccounts = await database.select({
    id: appAccounts.id,
    accountType: appAccounts.accountType,
    loginIdentifier: appAccounts.loginIdentifier,
    status: appAccounts.status,
  }).from(appAccounts).where(and(eq(appAccounts.rtUnitId, rtUnitId), eq(appAccounts.status, "disabled")));
  const dueRows = await database.select({
    id: monthlyDues.id,
    householdId: monthlyDues.householdId,
    month: monthlyDues.month,
    status: monthlyDues.status,
    amount: monthlyDues.amount,
  }).from(monthlyDues).where(eq(monthlyDues.billingYearId, residueYear!.id));
  const assignmentRows = await database.select({ id: officialAssignments.id, endsOn: officialAssignments.endsOn })
    .from(officialAssignments).where(eq(officialAssignments.appAccountId, chairmanAccount!.id));
  return { householdRows, disabledAccounts, dueRows, assignmentRows };
}

function importInput(rtUnitId: string, actor: Principal): Sheet2ImportInput {
  const prefix = randomUUID().slice(0, 8);
  return {
    rtUnitId,
    importBatchId: randomUUID(),
    actor,
    residents: syntheticRows(prefix),
    officials: [
      { role: "rt_chairman", loginIdentifier: `synthetic-${prefix}-chairman`, password: "Synthetic-Chairman-Password-01" },
      { role: "treasurer", loginIdentifier: `synthetic-${prefix}-treasurer`, password: "Synthetic-Treasurer-Password-02" },
    ],
    systemAdmin: {
      loginIdentifier: `synthetic-${prefix}-imported-admin`,
      displayName: "Synthetic System Admin",
      password: "Synthetic-System-Admin-Password-03",
    },
  };
}

function asAppDatabase(database: TestDatabase["db"]): AppDatabase {
  return database as unknown as AppDatabase;
}

describe("Sheet2 opening-balance importer (synthetic isolated database)", () => {
  let database: TestDatabase;

  beforeAll(async () => { database = await createTestDatabase(); });
  afterAll(async () => { await database?.close(); });

  it("imports annual dues, keeps opening balances outside receipt history, and replays idempotently", async () => {
    const rtUnitId = await createRt(database.db);
    const actor = await createVerifiedSystemAdmin(database.db);
    const input = importInput(rtUnitId, actor);
    const retainedResidue = await seedSyntheticResidue(database.db, rtUnitId);
    await database.db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" });

    const imported = await importSheet2(asAppDatabase(database.db), input);
    expect(imported).toMatchObject({
      idempotentReplay: false,
      householdCount: 73,
      residentAccountCount: 73,
      officialAccountCount: 2,
      systemAdminAccountCount: 1,
      monthlyDueCount: 876,
      openingBalanceCount: 626,
      arrearsCount: 138,
      futureUnpaidCount: 112,
      prepaidNovemberCount: 18,
      prepaidDecemberCount: 16,
      tariffClassCounts: [57, 16],
    });

    const dues = await database.db.select({ status: monthlyDues.status, count: count() })
      .from(monthlyDues).innerJoin(feeRates, and(
        eq(feeRates.householdId, monthlyDues.householdId),
        eq(feeRates.sheet2ImportBatchId, input.importBatchId),
      )).where(eq(monthlyDues.rtUnitId, rtUnitId)).groupBy(monthlyDues.status);
    expect(Object.fromEntries(dues.map(({ status, count: total }) => [status, total]))).toEqual({ paid: 626, unpaid: 250 });
    const importedDueScope = and(eq(feeRates.householdId, monthlyDues.householdId), eq(feeRates.sheet2ImportBatchId, input.importBatchId));
    const overdueRows = await database.db.select({ count: count() }).from(monthlyDues)
      .innerJoin(feeRates, importedDueScope)
      .where(and(eq(monthlyDues.rtUnitId, rtUnitId), eq(monthlyDues.status, "unpaid"), sql`${monthlyDues.dueDate} <= '2026-10-27'`));
    const futureRows = await database.db.select({ count: count() }).from(monthlyDues)
      .innerJoin(feeRates, importedDueScope)
      .where(and(eq(monthlyDues.rtUnitId, rtUnitId), eq(monthlyDues.status, "unpaid"), sql`${monthlyDues.dueDate} > '2026-10-27'`));
    expect(overdueRows[0]?.count).toBe(138);
    expect(futureRows[0]?.count).toBe(112);

    const rates = await database.db.select({ householdId: feeRates.householdId, amount: feeRates.monthlyAmount })
      .from(feeRates).where(eq(feeRates.sheet2ImportBatchId, input.importBatchId));
    expect(rates).toHaveLength(73);
    expect(rates.filter(({ amount }) => amount === 45_000)).toHaveLength(57);
    expect(rates.filter(({ amount }) => amount === 60_000)).toHaveLength(16);
    expect(rates.every(({ householdId }) => householdId !== null)).toBe(true);

    const officials = await database.db.select({
      role: officialAssignments.role,
      loginIdentifier: appAccounts.loginIdentifier,
      personId: appAccounts.personId,
      householdId: appAccounts.householdId,
      pinHash: appAccounts.pinHash,
    }).from(officialAssignments)
      .innerJoin(appAccounts, and(eq(appAccounts.id, officialAssignments.appAccountId), eq(appAccounts.accountType, "official")))
      .where(and(eq(officialAssignments.rtUnitId, rtUnitId), sql`${officialAssignments.endsOn} IS NULL`));
    expect(officials).toHaveLength(2);
    expect(new Set(officials.map(({ role }) => role))).toEqual(new Set(["rt_chairman", "treasurer"]));
    expect(officials.every(({ personId, householdId, pinHash }) => personId !== null && householdId === null && pinHash === null)).toBe(true);

    const [importedAdmin] = await database.db.select({
      id: appAccounts.id,
      rtUnitId: appAccounts.rtUnitId,
      personId: appAccounts.personId,
      householdId: appAccounts.householdId,
      twoFactorEnabled: authUser.twoFactorEnabled,
    }).from(appAccounts).innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
      .where(and(
        eq(appAccounts.accountType, "system_admin"),
        eq(appAccounts.loginIdentifier, input.systemAdmin.loginIdentifier!.toLocaleUpperCase("id-ID")),
      ));
    expect(importedAdmin).toMatchObject({ rtUnitId: null, personId: null, householdId: null, twoFactorEnabled: false });

    expect(await database.db.select({ id: payments.id }).from(payments).where(eq(payments.rtUnitId, rtUnitId))).toHaveLength(0);
    expect(await database.db.select({ id: paymentAllocations.id }).from(paymentAllocations)).toHaveLength(0);
    expect(await database.db.select({ id: sheet2OpeningBalanceItems.id }).from(sheet2OpeningBalanceItems)).toHaveLength(626);
    expect(await database.db.select({ id: sheet2ImportBatches.id }).from(sheet2ImportBatches)).toHaveLength(1);
    expect(await database.db.select({ id: households.id }).from(households).where(and(
      eq(households.rtUnitId, rtUnitId),
      eq(households.status, "inactive"),
    ))).toHaveLength(2);
    expect(await database.db.select({ id: appAccounts.id }).from(appAccounts).where(and(
      eq(appAccounts.rtUnitId, rtUnitId),
      eq(appAccounts.status, "disabled"),
    ))).toHaveLength(5);
    const residueIds = retainedResidue.householdRows.map(({ id }) => id);
    const dueIds = retainedResidue.dueRows.map(({ id }) => id);
    const assignmentIds = retainedResidue.assignmentRows.map(({ id }) => id);
    const residueAfter = {
      householdRows: await database.db.select({ id: households.id, status: households.status, endsOn: households.endsOn })
        .from(households).where(inArray(households.id, residueIds)),
      disabledAccounts: await database.db.select({
        id: appAccounts.id,
        accountType: appAccounts.accountType,
        loginIdentifier: appAccounts.loginIdentifier,
        status: appAccounts.status,
      }).from(appAccounts).where(and(eq(appAccounts.rtUnitId, rtUnitId), eq(appAccounts.status, "disabled"))),
      dueRows: await database.db.select({
        id: monthlyDues.id,
        householdId: monthlyDues.householdId,
        month: monthlyDues.month,
        status: monthlyDues.status,
        amount: monthlyDues.amount,
      }).from(monthlyDues).where(inArray(monthlyDues.id, dueIds)),
      assignmentRows: await database.db.select({ id: officialAssignments.id, endsOn: officialAssignments.endsOn })
        .from(officialAssignments).where(inArray(officialAssignments.id, assignmentIds)),
    };
    expect(residueAfter.householdRows.sort((left, right) => left.id.localeCompare(right.id)))
      .toEqual(retainedResidue.householdRows.sort((left, right) => left.id.localeCompare(right.id)));
    expect(residueAfter.disabledAccounts.sort((left, right) => left.id.localeCompare(right.id)))
      .toEqual(retainedResidue.disabledAccounts.sort((left, right) => left.id.localeCompare(right.id)));
    expect(residueAfter.dueRows.sort((left, right) => left.id.localeCompare(right.id)))
      .toEqual(retainedResidue.dueRows.sort((left, right) => left.id.localeCompare(right.id)));
    expect(residueAfter.assignmentRows).toEqual(retainedResidue.assignmentRows);
    expect(residueAfter.householdRows).toHaveLength(2);

    const [residentAccount] = await database.db.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      rtUnitId: appAccounts.rtUnitId,
      householdId: appAccounts.householdId,
      personId: appAccounts.personId,
    }).from(appAccounts).where(and(
      eq(appAccounts.rtUnitId, rtUnitId),
      eq(appAccounts.accountType, "resident"),
      eq(appAccounts.loginIdentifier, input.residents[0]!.username!.toLocaleUpperCase("id-ID")),
    )).limit(1);
    const residentDues = await getResidentMonthlyDues(asAppDatabase(database.db), {
      authUserId: residentAccount!.authUserId,
      appAccountId: residentAccount!.id,
      role: "resident",
      rtUnitId: residentAccount!.rtUnitId,
      householdId: residentAccount!.householdId,
      personId: residentAccount!.personId,
    }, "2026-10-27");
    const paidHistoricalMonth = residentDues.find(({ month }) => month === 3)!;
    expect(paidHistoricalMonth.status).toBe("paid");
    expect(paidHistoricalMonth.receipts).toEqual([]);
    expect(paidHistoricalMonth.openingBalanceImport).toMatchObject({
      amount: 45_000,
      sourceSheet: "Sheet2",
      asOfDate: "2026-10-27",
    });

    await expect(importSheet2(asAppDatabase(database.db), input)).resolves.toMatchObject({ idempotentReplay: true });
    expect(await database.db.select({ id: monthlyDues.id }).from(monthlyDues).where(eq(monthlyDues.rtUnitId, rtUnitId))).toHaveLength(900);
    expect(await database.db.select({ id: monthlyDues.id }).from(monthlyDues)
      .innerJoin(feeRates, and(
        eq(feeRates.householdId, monthlyDues.householdId),
        eq(feeRates.sheet2ImportBatchId, input.importBatchId),
      )).where(eq(monthlyDues.rtUnitId, rtUnitId))).toHaveLength(876);
    expect(await database.db.select({ id: sheet2OpeningBalanceItems.id }).from(sheet2OpeningBalanceItems)).toHaveLength(626);
  });

  it("rolls back every import row on a synthetic mid-transaction database failure", async () => {
    const rtUnitId = await createRt(database.db);
    const actor = await createVerifiedSystemAdmin(database.db);
    const input = importInput(rtUnitId, actor);
    await database.client.exec(`
      CREATE OR REPLACE FUNCTION public.test_fail_sheet2_import_v1() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback test'; END $$;
      CREATE TRIGGER test_fail_sheet2_import_v1
      BEFORE INSERT ON public.monthly_dues
      FOR EACH ROW EXECUTE FUNCTION public.test_fail_sheet2_import_v1();
    `);
    await expect(importSheet2(asAppDatabase(database.db), input)).rejects.toThrow("Sheet2 import failed atomically");
    await database.client.exec("DROP TRIGGER test_fail_sheet2_import_v1 ON public.monthly_dues; DROP FUNCTION public.test_fail_sheet2_import_v1();");

    const rollbackState = await database.client.query<{
      houses: number;
      households: number;
      people: number;
      accounts: number;
      assignments: number;
      billingYears: number;
      feeRates: number;
      dues: number;
      openingBalances: number;
      batches: number;
      importAuditEvents: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.houses WHERE rt_unit_id = $1) AS houses,
        (SELECT count(*)::int FROM public.households WHERE rt_unit_id = $1) AS households,
        (SELECT count(*)::int FROM public.people WHERE rt_unit_id = $1) AS people,
        (SELECT count(*)::int FROM public.app_accounts WHERE rt_unit_id = $1) AS accounts,
        (SELECT count(*)::int FROM public.official_assignments WHERE rt_unit_id = $1) AS assignments,
        (SELECT count(*)::int FROM public.billing_years WHERE rt_unit_id = $1 AND year = 2026) AS "billingYears",
        (SELECT count(*)::int FROM public.fee_rates WHERE rt_unit_id = $1) AS "feeRates",
        (SELECT count(*)::int FROM public.monthly_dues WHERE rt_unit_id = $1) AS dues,
        (SELECT count(*)::int FROM public.sheet2_opening_balance_items WHERE rt_unit_id = $1) AS "openingBalances",
        (SELECT count(*)::int FROM public.sheet2_import_batches WHERE rt_unit_id = $1) AS batches,
        (SELECT count(*)::int FROM public.audit_events WHERE actor_app_account_id = $2 AND action = 'billing.sheet2_opening_balance_imported') AS "importAuditEvents"
    `, [rtUnitId, actor.appAccountId]);
    expect(rollbackState.rows[0]).toEqual({
      houses: 0,
      households: 0,
      people: 0,
      accounts: 0,
      assignments: 0,
      billingYears: 0,
      feeRates: 0,
      dues: 0,
      openingBalances: 0,
      batches: 0,
      importAuditEvents: 0,
    });
  });
});
