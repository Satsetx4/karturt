import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  activeDueSettlements,
  appAccounts,
  billingYears,
  dueAdjustments,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  payments,
  relationalSchema,
  waiverActions,
  waiverItems,
} from "../../src/db/schema";
import type { AppDatabase } from "../../src/db/client";
import type { Principal } from "../../src/lib/auth/permissions";
import { recordTreasurerCashPayment } from "../../src/lib/billing/treasurer-cash-payments";
import { createChairmanAdjustment } from "../../src/lib/billing/chairman-adjustment";
import { createAuthUser, createHousehold, createRt } from "../helpers/database";

const gateCHistoryTables = [
  ["monthly_dues", "id"],
  ["payment_requests", "id"],
  ["payment_request_items", "request_id, monthly_due_id"],
  ["payment_request_claims", "monthly_due_id"],
  ["payments", "id"],
  ["payment_allocations", "id"],
  ["payment_reversals", "id"],
  ["active_due_settlements", "allocation_id"],
  ["waiver_actions", "id"],
  ["waiver_items", "waiver_action_id, monthly_due_id"],
  ["due_adjustments", "id"],
  ["audit_events", "id"],
] as const;

async function snapshotGateCHistory(client: PGlite) {
  const snapshot: Record<string, string> = {};
  for (const [table, orderBy] of gateCHistoryTables) {
    const [row] = (await client.query<{ rows: string }>(`
      SELECT coalesce(json_agg(row_to_json(snapshot_row) ORDER BY ${orderBy}), '[]'::json)::text AS rows
      FROM public.${table} AS snapshot_row
    `)).rows;
    snapshot[table] = row!.rows;
  }
  return snapshot;
}

describe("legacy billing migration upgrade", () => {
  let client: PGlite;

  beforeAll(async () => {
    client = new PGlite();
  });

  afterAll(async () => {
    if (client) await client.close();
  });

  it("converts legacy not-yet-resident waivers into zero-obligation NOT_DUE rows", async () => {
    const migrationFolder = resolve(process.cwd(), "drizzle");
    const migrations = readdirSync(migrationFolder)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const upgradeMigration = "0003_due_auth_audit_domain.sql";
    const priorMigrations = migrations.filter((name) => name < upgradeMigration);

    for (const name of priorMigrations) {
      await client.exec(readFileSync(resolve(migrationFolder, name), "utf8"));
    }

    const [rt] = (await client.query<{ id: string }>(`
      INSERT INTO rt_units (code, name, rw_code, village)
      VALUES ('RT-UPGRADE', 'Migration Upgrade RT', 'RW-UPGRADE', 'Village Upgrade')
      RETURNING id
    `)).rows;
    const [house] = (await client.query<{ id: string }>(`
      INSERT INTO houses (rt_unit_id, number) VALUES ($1, 'U-01') RETURNING id
    `, [rt!.id])).rows;
    const [household] = (await client.query<{ id: string }>(`
      INSERT INTO households (rt_unit_id, house_id, starts_on)
      VALUES ($1, $2, '2026-05-01') RETURNING id
    `, [rt!.id, house!.id])).rows;
    const [year] = (await client.query<{ id: string }>(`
      INSERT INTO billing_years (rt_unit_id, year, status) VALUES ($1, 2026, 'open') RETURNING id
    `, [rt!.id])).rows;
    const [due] = (await client.query<{ id: string }>(`
      INSERT INTO monthly_dues (
        rt_unit_id, household_id, billing_year_id, month, amount, due_date, status, waived_reason
      ) VALUES ($1, $2, $3, 1, 0, '2026-01-10', 'waived', 'not_yet_resident')
      RETURNING id
    `, [rt!.id, household!.id, year!.id])).rows;

    await client.exec(readFileSync(resolve(migrationFolder, upgradeMigration), "utf8"));

    const [migrated] = (await client.query<{ status: string; waived_reason: string | null }>(
      "SELECT status::text, waived_reason FROM monthly_dues WHERE id = $1",
      [due!.id],
    )).rows;
    expect(migrated).toEqual({ status: "not_due", waived_reason: null });
  });

  it("applies the clean migration chain through 0013", async () => {
    const cleanClient = new PGlite();
    try {
      const migrationFolder = resolve(process.cwd(), "drizzle");
      const migrations = readdirSync(migrationFolder)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      for (const name of migrations) {
        await cleanClient.exec(readFileSync(resolve(migrationFolder, name), "utf8"));
      }
      const tables = await cleanClient.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'due_adjustments'
      `);
      expect(tables.rows).toHaveLength(1);
      const ownershipKey = await cleanClient.query<{ column_name: string }>(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'active_due_settlements'
          AND tc.constraint_type = 'PRIMARY KEY'
      `);
      expect(ownershipKey.rows.map((row) => row.column_name)).toEqual(["allocation_id"]);
      const phase12Indexes = await cleanClient.query<{ indexname: string }>(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'app_accounts_resident_login_uq',
            'app_accounts_official_login_uq',
            'households_rt_house_period_idx'
          )
        ORDER BY indexname
      `);
      expect(phase12Indexes.rows.map((row) => row.indexname)).toEqual([
        "app_accounts_official_login_uq",
        "app_accounts_resident_login_uq",
        "households_rt_house_period_idx",
      ]);
      const phase12Trigger = await cleanClient.query<{ tgname: string }>(`
        SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'public.households'::regclass
          AND tgname = 'households_guard_phase12_period_v1'
          AND NOT tgisinternal
      `);
      expect(phase12Trigger.rows).toHaveLength(1);
    } finally {
      await cleanClient.close();
    }
  }, 60000);

  it("upgrades intact transfer and cash history through 0013 without changing Gate C ledger history", async () => {
    const upgradeClient = new PGlite();
    try {
      const migrationFolder = resolve(process.cwd(), "drizzle");
      const migrations = readdirSync(migrationFolder)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      const cashMigration = "0009_phase_8_cash_payment.sql";
      for (const name of migrations.filter((migration) => migration < cashMigration)) {
        await upgradeClient.exec(readFileSync(resolve(migrationFolder, name), "utf8"));
      }

      const db = drizzle(upgradeClient, { schema: relationalSchema });
      const rtUnitId = await createRt(db);
      const household = await createHousehold(db, rtUnitId);
      const residentUser = await createAuthUser(db);
      const [residentAccount] = await db.insert(appAccounts).values({
        rtUnitId,
        authUserId: residentUser.id,
        accountType: "resident",
        loginIdentifier: `resident-${residentUser.id}`,
        personId: household.personId,
        householdId: household.householdId,
      }).returning({ id: appAccounts.id });
      const treasurerUser = await createAuthUser(db);
      const [treasurerAccount] = await db.insert(appAccounts).values({
        rtUnitId,
        authUserId: treasurerUser.id,
        accountType: "official",
        loginIdentifier: `treasurer-${treasurerUser.id}`,
        personId: household.personId,
      }).returning({ id: appAccounts.id });
      await db.insert(officialAssignments).values({
        rtUnitId,
        appAccountId: treasurerAccount!.id,
        role: "treasurer",
        startsOn: "2020-01-01",
      });
      const treasurerPrincipal: Principal = {
        authUserId: treasurerUser.id,
        appAccountId: treasurerAccount!.id,
        role: "treasurer",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      };
      const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" })
        .returning({ id: billingYears.id });
      const [feeRate] = (await upgradeClient.query<{ id: string }>(
        "INSERT INTO fee_rates (rt_unit_id, billing_year_id, effective_month, monthly_amount) VALUES ($1, $2, 1, 40000) RETURNING id",
        [rtUnitId, year!.id],
      )).rows;
      const duesBeforeUpgrade = await db.insert(monthlyDues).values([1, 2, 3].map((month) => ({
        rtUnitId,
        householdId: household.householdId,
        billingYearId: year!.id,
        feeRateId: feeRate!.id,
        month,
        amount: 40000,
        dueDate: `2026-${String(month).padStart(2, "0")}-10`,
        status: "unpaid" as const,
      }))).returning({ id: monthlyDues.id, month: monthlyDues.month });

      const requestId = randomUUID();
      const requestCode = `UPG-${requestId.slice(0, 16)}`;
      const requestDueId = duesBeforeUpgrade.find((due) => due.month === 1)!.id;
      await db.transaction(async (transaction) => {
        await transaction.insert(paymentRequests).values({
          id: requestId,
          requestCode,
          rtUnitId,
          householdId: household.householdId,
          requestedByAccountId: residentAccount!.id,
          requestedByAccountType: "resident",
          status: "pending",
          idempotencyKey: randomUUID(),
          requestFingerprint: "a".repeat(64),
          totalAmount: 40000,
          itemCount: 1,
        });
        await transaction.insert(paymentRequestItems).values({
          requestId,
          rtUnitId,
          householdId: household.householdId,
          monthlyDueId: requestDueId,
          period: "2026-01",
          amount: 40000,
        });
        await transaction.insert(paymentRequestClaims).values({ requestId, monthlyDueId: requestDueId });
      });
      const [requestRow] = await db.select().from(paymentRequests)
        .where(eq(paymentRequests.id, requestId));
      const [requestItem] = await db.select().from(paymentRequestItems)
        .where(eq(paymentRequestItems.requestId, requestRow!.id));
      const transferPaymentId = randomUUID();
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`
          INSERT INTO payments (id, rt_unit_id, household_id, payment_request_id, amount, method, verified_by_account_id, verified_by_account_type)
          VALUES (${transferPaymentId}, ${rtUnitId}, ${household.householdId}, ${requestRow!.id}, 40000, 'transfer', ${treasurerAccount!.id}, 'official')
        `);
        await transaction.execute(sql`
          INSERT INTO payment_allocations (rt_unit_id, household_id, payment_request_id, payment_id, monthly_due_id, amount)
          VALUES (${rtUnitId}, ${household.householdId}, ${requestRow!.id}, ${transferPaymentId}, ${requestItem!.monthlyDueId}, 40000)
        `);
        await transaction.execute(sql`
          UPDATE monthly_dues SET status = 'paid' WHERE id = ${requestItem!.monthlyDueId}
        `);
        await transaction.execute(sql`
          UPDATE payment_requests
          SET status = 'verified', verified_at = now(), verified_by_account_id = ${treasurerAccount!.id}, verified_by_account_type = 'official'
          WHERE id = ${requestRow!.id}
        `);
        await transaction.delete(paymentRequestClaims).where(eq(paymentRequestClaims.requestId, requestRow!.id));
        await transaction.execute(sql`
          INSERT INTO audit_events (actor_app_account_id, action, entity_type, entity_id, reason, context)
          VALUES (
            ${treasurerAccount!.id}, 'payment_request.verified', 'payment_request', ${requestRow!.id}, NULL,
            jsonb_build_object('itemCount', 1, 'totalAmount', 40000)
          )
        `);
      });
      const [transferBefore] = (await upgradeClient.query<{
        id: string;
        payment_request_id: string;
        amount: number;
        method: string;
      }>("SELECT id, payment_request_id, amount, method FROM payments WHERE id = $1", [transferPaymentId])).rows;
      const [transferAllocationBefore] = await db.select().from(paymentAllocations);

      await upgradeClient.exec(readFileSync(resolve(migrationFolder, cashMigration), "utf8"));

      const cashPaymentId = randomUUID();
      const cashKey = randomUUID();
      const cashDueId = duesBeforeUpgrade.find((due) => due.month === 2)!.id;
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`
          INSERT INTO payments (
            id, rt_unit_id, household_id, payment_request_id, amount, method,
            verified_by_account_id, verified_by_account_type,
            cash_idempotency_key, cash_idempotency_fingerprint
          ) VALUES (
            ${cashPaymentId}, ${rtUnitId}, ${household.householdId}, NULL, 40000, 'cash',
            ${treasurerAccount!.id}, 'official', ${cashKey}, ${"d".repeat(64)}
          )
        `);
        await transaction.execute(sql`
          INSERT INTO payment_allocations (
            rt_unit_id, household_id, payment_request_id, payment_id, monthly_due_id, amount
          ) VALUES (
            ${rtUnitId}, ${household.householdId}, NULL, ${cashPaymentId}, ${cashDueId}, 40000
          )
        `);
        await transaction.execute(sql`UPDATE monthly_dues SET status = 'paid' WHERE id = ${cashDueId}`);
        await transaction.execute(sql`
          INSERT INTO audit_events (actor_app_account_id, action, entity_type, entity_id, reason, context)
          VALUES (
            ${treasurerAccount!.id}, 'payment.cash_recorded', 'payment', ${cashPaymentId}, NULL,
            jsonb_build_object('itemCount', 1, 'method', 'cash', 'totalAmount', 40000)
          )
        `);
      });

      const [cashBefore] = await db.select().from(payments).where(eq(payments.id, cashPaymentId));
      const [cashAllocationBefore] = await db.select().from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, cashPaymentId));
      expect(cashBefore).toBeDefined();
      expect(cashAllocationBefore).toBeDefined();

      const reversalMigration = "0010_phase_9_payment_reversal.sql";
      await upgradeClient.exec(readFileSync(resolve(migrationFolder, reversalMigration), "utf8"));
      const waiverMigration = "0011_phase_10_waiver.sql";
      await upgradeClient.exec(readFileSync(resolve(migrationFolder, waiverMigration), "utf8"));
      const tariffAdjustmentMigration = "0012_phase_11_tariff_adjustment.sql";
      await upgradeClient.exec(readFileSync(resolve(migrationFolder, tariffAdjustmentMigration), "utf8"));
      const chairmanUser = await createAuthUser(db);
      const [chairmanAccount] = await db.insert(appAccounts).values({
        rtUnitId,
        authUserId: chairmanUser.id,
        accountType: "official",
        loginIdentifier: `chairman-${chairmanUser.id}`,
        personId: household.personId,
      }).returning({ id: appAccounts.id });
      await db.insert(officialAssignments).values({
        rtUnitId,
        appAccountId: chairmanAccount!.id,
        role: "rt_chairman",
        startsOn: "2020-01-01",
      });
      const chairmanPrincipal: Principal = {
        authUserId: chairmanUser.id,
        appAccountId: chairmanAccount!.id,
        role: "rt_chairman",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      };
      await createChairmanAdjustment(db as unknown as AppDatabase, chairmanPrincipal, {
        monthlyDueId: duesBeforeUpgrade.find((due) => due.month === 3)!.id,
        amountDelta: 10000,
        reason: "Development migration preservation fixture",
        idempotencyKey: randomUUID(),
      }, "2026-10-02");
      const gateCHistoryBefore = await snapshotGateCHistory(upgradeClient);
      const householdManagementMigration = "0013_phase_12_household_management.sql";
      await upgradeClient.exec(readFileSync(resolve(migrationFolder, householdManagementMigration), "utf8"));
      expect(await snapshotGateCHistory(upgradeClient)).toEqual(gateCHistoryBefore);

      const [transferAfter] = await db.select().from(payments).where(eq(payments.id, transferPaymentId));
      const [transferAllocationAfter] = await db.select().from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, transferPaymentId));
      const [cashAfter] = await db.select().from(payments).where(eq(payments.id, cashPaymentId));
      const [cashAllocationAfter] = await db.select().from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, cashPaymentId));
      expect(transferAfter).toMatchObject({
        id: transferBefore!.id,
        paymentRequestId: transferBefore!.payment_request_id,
        amount: 40000,
        method: "transfer",
        verifiedByAccountId: treasurerAccount!.id,
        cashIdempotencyKey: null,
        cashIdempotencyFingerprint: null,
      });
      expect(transferAllocationAfter).toMatchObject({
        id: transferAllocationBefore!.id,
        paymentRequestId: transferAllocationBefore!.paymentRequestId,
        paymentId: transferAllocationBefore!.paymentId,
        amount: 40000,
      });
      expect(cashAfter).toEqual(cashBefore);
      expect(cashAllocationAfter).toEqual(cashAllocationBefore);
      const preservedAdjustments = await db.select().from(dueAdjustments);
      expect(preservedAdjustments).toHaveLength(1);
      expect(preservedAdjustments[0]).toMatchObject({
        monthlyDueId: duesBeforeUpgrade.find((due) => due.month === 3)!.id,
        amountDelta: 10000,
        effectiveTargetAfter: 50000,
      });
      expect(await db.select().from(activeDueSettlements)).toHaveLength(2);
      expect(await db.select().from(waiverActions)).toHaveLength(0);
      expect(await db.select().from(waiverItems)).toHaveLength(0);
      expect(await db.select().from(activeDueSettlements)
        .where(eq(activeDueSettlements.paymentId, transferPaymentId))).toHaveLength(1);
      expect(await db.select().from(activeDueSettlements)
        .where(eq(activeDueSettlements.paymentId, cashPaymentId))).toHaveLength(1);

      const cash = await recordTreasurerCashPayment(db as unknown as AppDatabase, treasurerPrincipal, {
        householdId: household.householdId,
        period: "2026-03",
        idempotencyKey: randomUUID(),
      }, "2026-06-01");
      expect(cash.periods).toEqual(["2026-03"]);
      expect((await db.select().from(payments)).filter((payment) => payment.method === "cash")).toHaveLength(2);
      expect((await db.select().from(payments)).filter((payment) => payment.method === "transfer")).toHaveLength(1);
      expect((await db.select().from(monthlyDues)
        .where(eq(monthlyDues.id, duesBeforeUpgrade.find((due) => due.month === 1)!.id)))[0]!.status).toBe("paid");
    } finally {
      await upgradeClient.close();
    }
  });

  it("refuses 0012 to 0013 when existing household periods overlap", async () => {
    const overlapClient = new PGlite();
    try {
      const migrationFolder = resolve(process.cwd(), "drizzle");
      const migrations = readdirSync(migrationFolder)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      const householdManagementMigration = "0013_phase_12_household_management.sql";
      for (const name of migrations.filter((migration) => migration < householdManagementMigration)) {
        await overlapClient.exec(readFileSync(resolve(migrationFolder, name), "utf8"));
      }

      const [rt] = (await overlapClient.query<{ id: string }>(`
        INSERT INTO public.rt_units (code, name, rw_code, village)
        VALUES ('RT-F12-OVERLAP', 'F12 overlap', 'RW-F12-OVERLAP', 'Village F12')
        RETURNING id
      `)).rows;
      const [house] = (await overlapClient.query<{ id: string }>(`
        INSERT INTO public.houses (rt_unit_id, number) VALUES ($1, 'F12-OVERLAP') RETURNING id
      `, [rt!.id])).rows;
      await overlapClient.query(`
        INSERT INTO public.households (rt_unit_id, house_id, starts_on, ends_on, status)
        VALUES ($1, $2, '2020-01-01', '2025-01-01', 'inactive')
      `, [rt!.id, house!.id]);
      await overlapClient.query(`
        INSERT INTO public.households (rt_unit_id, house_id, starts_on, status)
        VALUES ($1, $2, '2024-12-01', 'active')
      `, [rt!.id, house!.id]);

      await expect(overlapClient.exec(readFileSync(
        resolve(migrationFolder, householdManagementMigration),
        "utf8",
      ))).rejects.toThrow(/Phase 12 migration refused: household periods already overlap/);
      const priorLoginIndex = await overlapClient.query<{ indexname: string }>(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'app_accounts_login_identifier_uq'
      `);
      expect(priorLoginIndex.rows).toHaveLength(1);
    } finally {
      await overlapClient.close();
    }
  }, 60000);

  it("refuses 0010 to 0011 when a legacy WAIVED due has no structured history", async () => {
    const upgradeClient = new PGlite();
    try {
      const migrationFolder = resolve(process.cwd(), "drizzle");
      const migrations = readdirSync(migrationFolder)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      for (const name of migrations.filter((migration) => migration < "0011_phase_10_waiver.sql")) {
        await upgradeClient.exec(readFileSync(resolve(migrationFolder, name), "utf8"));
      }

      const db = drizzle(upgradeClient, { schema: relationalSchema });
      const rtUnitId = await createRt(db);
      const household = await createHousehold(db, rtUnitId);
      const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" })
        .returning({ id: billingYears.id });
      const [rate] = (await upgradeClient.query<{ id: string }>(
        "INSERT INTO fee_rates (rt_unit_id, billing_year_id, effective_month, monthly_amount) VALUES ($1, $2, 1, 40000) RETURNING id",
        [rtUnitId, year!.id],
      )).rows;
      await db.insert(monthlyDues).values({
        rtUnitId,
        householdId: household.householdId,
        billingYearId: year!.id,
        feeRateId: rate!.id,
        month: 1,
        amount: 40000,
        dueDate: "2026-01-10",
        status: "waived",
        waivedReason: "Legacy row without action history",
      });

      await expect(upgradeClient.exec(readFileSync(
        resolve(migrationFolder, "0011_phase_10_waiver.sql"),
        "utf8",
      ))).rejects.toThrow(/legacy WAIVED dues have no structured waiver history/i);
      const tables = await upgradeClient.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('waiver_actions', 'waiver_items')
      `);
      expect(tables.rows).toHaveLength(0);
    } finally {
      await upgradeClient.close();
    }
  });
});
