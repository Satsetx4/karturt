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
  feeRates,
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
import { createResidentPaymentRequest } from "../../src/lib/billing/resident-payment-request";
import { recordTreasurerCashPayment } from "../../src/lib/billing/treasurer-cash-payments";
import { createAuthUser, createHousehold, createRt } from "../helpers/database";

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

  it("upgrades intact transfer and cash history from 0009 through 0011, preserving owners and then recording cash", async () => {
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
      const residentPrincipal: Principal = {
        authUserId: residentUser.id,
        appAccountId: residentAccount!.id,
        role: "resident",
        rtUnitId,
        householdId: household.householdId,
        personId: household.personId,
      };

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
      const [feeRate] = await db.insert(feeRates).values({
        rtUnitId,
        billingYearId: year!.id,
        effectiveMonth: 1,
        monthlyAmount: 40000,
      }).returning({ id: feeRates.id });
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

      const request = await createResidentPaymentRequest(db as unknown as AppDatabase, residentPrincipal, {
        period: "2026-01",
        idempotencyKey: randomUUID(),
      });
      const [requestRow] = await db.select().from(paymentRequests)
        .where(eq(paymentRequests.requestCode, request.requestCode));
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
      const [rate] = await db.insert(feeRates).values({
        rtUnitId,
        billingYearId: year!.id,
        effectiveMonth: 1,
        monthlyAmount: 40000,
      }).returning({ id: feeRates.id });
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
