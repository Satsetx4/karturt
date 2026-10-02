import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  dueAdjustments,
  feeRates,
  monthlyDues,
  officialAssignments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { createChairmanAdjustment } from "@/lib/billing/chairman-adjustment";
import { createChairmanFeeRate } from "@/lib/billing/chairman-fee-rates";
import {
  createAuthUser,
  createFeeRateFixture,
  createHousehold,
  createRt,
  createTestDatabase,
} from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
const businessDate = "2026-10-02";
const triggerName = "phase11_audit_failure_test_trigger";
const functionName = "phase11_audit_failure_test";

describe("phase 11 financial mutations roll back when audit fails", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createChairman() {
    const rtUnitId = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitId);
    const user = await createAuthUser(testDatabase.db);
    const [account] = await testDatabase.db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `phase11-chair-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await testDatabase.db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });
    const chairman: Principal = {
      authUserId: user.id,
      appAccountId: account!.id,
      role: "rt_chairman",
      rtUnitId,
      householdId: null,
      personId: household.personId,
    };
    return { rtUnitId, household, chairman };
  }

  async function failAuditAction(action: "fee_rate.created" | "billing.adjustment_created") {
    await testDatabase.client.exec(`
      CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = '${action}' THEN
          RAISE EXCEPTION 'forced phase 11 audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON public.audit_events
      FOR EACH ROW EXECUTE FUNCTION public.${functionName}();
    `);
  }

  async function removeAuditFailure() {
    await testDatabase.client.exec(`
      DROP TRIGGER ${triggerName} ON public.audit_events;
      DROP FUNCTION public.${functionName}();
    `);
  }

  it("rolls back a new tariff when its audit insert fails", async () => {
    const { rtUnitId, chairman } = await createChairman();
    const [year] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    const initialRates = await testDatabase.db.select({ id: feeRates.id })
      .from(feeRates)
      .where(eq(feeRates.billingYearId, year!.id));
    await failAuditAction("fee_rate.created");

    try {
      await expect(createChairmanFeeRate(database, chairman, {
        billingYearId: year!.id,
        effectiveMonth: 11,
        monthlyAmount: 50000,
        idempotencyKey: randomUUID(),
      }, businessDate)).rejects.toThrow('insert into "audit_events"');
    } finally {
      await removeAuditFailure();
    }

    const ratesAfter = await testDatabase.db.select({ id: feeRates.id })
      .from(feeRates)
      .where(eq(feeRates.billingYearId, year!.id));
    expect(ratesAfter).toEqual(initialRates);
    expect(await testDatabase.db.select().from(auditEvents)
      .where(eq(auditEvents.action, "fee_rate.created"))).toHaveLength(1);
  });

  it("rolls back the adjustment ledger and due status when its audit insert fails", async () => {
    const { rtUnitId, household, chairman } = await createChairman();
    const [year] = await testDatabase.db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [feeRate] = await createFeeRateFixture(testDatabase.db, {
      rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    });
    const [due] = await testDatabase.db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year!.id,
      feeRateId: feeRate!.id,
      month: 1,
      amount: 40000,
      dueDate: "2026-01-10",
      status: "unpaid",
    }).returning({ id: monthlyDues.id });
    await failAuditAction("billing.adjustment_created");

    try {
      await expect(createChairmanAdjustment(database, chairman, {
        monthlyDueId: due!.id,
        amountDelta: 10000,
        reason: "Penyesuaian sesuai keputusan rapat RT",
        idempotencyKey: randomUUID(),
      }, businessDate)).rejects.toThrow('insert into "audit_events"');
    } finally {
      await removeAuditFailure();
    }

    const [dueAfter] = await testDatabase.db.select().from(monthlyDues)
      .where(eq(monthlyDues.id, due!.id));
    expect(dueAfter).toMatchObject({ amount: 40000, status: "unpaid" });
    expect(await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, due!.id))).toHaveLength(0);
    expect(await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "billing.adjustment_created"),
      eq(auditEvents.actorAppAccountId, chairman.appAccountId),
    ))).toHaveLength(0);
  });
});
