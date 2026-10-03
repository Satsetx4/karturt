import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db/client";
import {
  appAccounts,
  auditEvents,
  billingYears,
  dueAdjustments,
  monthlyDues,
  officialAssignments,
} from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import {
  ChairmanAdjustmentIdempotencyConflictError,
  createChairmanAdjustment,
} from "@/lib/billing/chairman-adjustment";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

/*
 * Gate C race matrix cross-reference (existing transactional integration suites):
 * - double verify: treasurer-payment-verification.test.ts, "serializes duplicate verify attempts"
 * - verify/reject and verify/cancel: payment-request-resolution.test.ts, "one terminal winner"
 * - request/cash: treasurer-cash-payment.test.ts, "request creation against cash"
 * - request/waiver, cash/waiver, verify/waiver: chairman-waiver.test.ts
 * - request/adjustment, cash/adjustment, verify/adjustment, reversal/adjustment:
 *   phase-11-adjustment-races.test.ts
 * - reversal/repayment: payment-reversal.test.ts, "reversal against concurrent cash re-payment"
 * - request same-key retry: resident-payment-request.test.ts, "simultaneous retries with one key"
 * - over-allocation, duplicate allocation, cross-RT ledger scope: gate-c-payment-ledger.test.ts
 * - mass assignment/malformed payload: resident-payment-request-route.test.ts and
 *   treasurer-cash-payment-route.test.ts
 * - audit insert rollback: treasurer-payment-verification.test.ts, treasurer-cash-payment.test.ts,
 *   chairman-waiver.test.ts, payment-reversal.test.ts, and phase-11-audit-rollback.test.ts
 *
 * This file adds the uncovered concurrent adjustment-key cases and checks final ledger state,
 * rather than treating request outcomes alone as proof of serialization.
 */

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type ChairmanFixture = {
  rtUnitId: string;
  dueId: string;
  principal: Principal;
};

const businessDate = "2026-10-02";
const originalAmount = 40000;

describe("Gate C financial idempotency races", () => {
  let testDatabase: TestDatabase;
  let database: AppDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    database = testDatabase.db as unknown as AppDatabase;
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createFixture(): Promise<ChairmanFixture> {
    const db = testDatabase.db;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId);
    const user = await createAuthUser(db);
    const [account] = await db.insert(appAccounts).values({
      rtUnitId,
      authUserId: user.id,
      accountType: "official",
      loginIdentifier: `gate-c-race-chair-${randomUUID()}`,
      personId: household.personId,
    }).returning({ id: appAccounts.id });
    await db.insert(officialAssignments).values({
      rtUnitId,
      appAccountId: account!.id,
      role: "rt_chairman",
      startsOn: "2020-01-01",
    });
    const [year] = await db.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [feeRate] = await createFeeRateFixture(db, {
      rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: 1,
      monthlyAmount: originalAmount,
    });
    const [due] = await db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year!.id,
      feeRateId: feeRate!.id,
      month: 1,
      amount: originalAmount,
      dueDate: "2026-01-10",
      status: "unpaid",
    }).returning({ id: monthlyDues.id });

    return {
      rtUnitId,
      dueId: due!.id,
      principal: {
        authUserId: user.id,
        appAccountId: account!.id,
        role: "rt_chairman",
        rtUnitId,
        householdId: null,
        personId: household.personId,
      },
    };
  }

  async function snapshot(fixture: ChairmanFixture) {
    const [due] = await testDatabase.db.select().from(monthlyDues)
      .where(and(eq(monthlyDues.id, fixture.dueId), eq(monthlyDues.rtUnitId, fixture.rtUnitId)));
    const adjustments = await testDatabase.db.select().from(dueAdjustments)
      .where(eq(dueAdjustments.monthlyDueId, fixture.dueId));
    const audits = await testDatabase.db.select().from(auditEvents).where(and(
      eq(auditEvents.action, "billing.adjustment_created"),
      eq(auditEvents.actorAppAccountId, fixture.principal.appAccountId),
    ));

    expect(due).toBeDefined();
    expect(adjustments).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityId).toBe(adjustments[0]?.id);
    expect(adjustments[0]?.monthlyDueId).toBe(fixture.dueId);
    expect(adjustments[0]?.effectiveTargetAfter).toBe(originalAmount + adjustments[0]!.amountDelta);
    expect(due?.amount).toBe(originalAmount);
    expect(due?.status).toBe("unpaid");

    return { due: due!, adjustments, audits };
  }

  it("serializes simultaneous retries with the same adjustment key into one ledger row and one audit", async () => {
    const fixture = await createFixture();
    const idempotencyKey = randomUUID();
    const input = {
      monthlyDueId: fixture.dueId,
      amountDelta: 10000,
      reason: "Penyesuaian sesuai keputusan rapat RT",
      idempotencyKey,
    };

    const attempts = await Promise.all([
      createChairmanAdjustment(database, fixture.principal, input, businessDate),
      createChairmanAdjustment(database, fixture.principal, input, businessDate),
    ]);
    expect(attempts[0]?.id).toBe(attempts[1]?.id);
    expect(attempts.map(({ idempotentReplay }) => idempotentReplay).sort()).toEqual([false, true]);

    const state = await snapshot(fixture);
    expect(state.adjustments[0]).toMatchObject({
      id: attempts[0]?.id,
      amountDelta: 10000,
      effectiveTargetAfter: 50000,
      idempotencyKey,
    });
  });

  it("rejects one concurrent reuse of an adjustment key with a different fingerprint and leaves one serial outcome", async () => {
    const fixture = await createFixture();
    const idempotencyKey = randomUUID();
    const base = {
      monthlyDueId: fixture.dueId,
      reason: "Penyesuaian sesuai keputusan rapat RT",
      idempotencyKey,
    };

    const attempts = await Promise.allSettled([
      createChairmanAdjustment(database, fixture.principal, { ...base, amountDelta: 10000 }, businessDate),
      createChairmanAdjustment(database, fixture.principal, { ...base, amountDelta: 20000 }, businessDate),
    ]);
    const winners = attempts.filter((attempt) => attempt.status === "fulfilled");
    const conflicts = attempts.filter((attempt) => attempt.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0] as PromiseRejectedResult).reason).toBeInstanceOf(ChairmanAdjustmentIdempotencyConflictError);

    const winner = (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createChairmanAdjustment>>>).value;
    const state = await snapshot(fixture);
    expect(state.adjustments[0]?.id).toBe(winner.id);
    expect([10000, 20000]).toContain(state.adjustments[0]?.amountDelta);
    expect(state.adjustments[0]?.idempotencyKey).toBe(idempotencyKey);
    expect(state.due.amount).toBe(originalAmount);
    expect(state.due.status).toBe("unpaid");
  });
});
