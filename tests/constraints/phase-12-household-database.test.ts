import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appAccounts,
  billingYears,
  households,
  monthlyDues,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
} from "../../src/db/schema";
import { createAuthUser, createFeeRateFixture, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

describe("F12 household database guards", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase?.close();
  });

  async function createUnpaidDue(yearNumber: number, month: number) {
    const { db } = testDatabase;
    const rtUnitId = await createRt(db);
    const household = await createHousehold(db, rtUnitId, { startsOn: `${yearNumber - 1}-01-01` });
    const [year] = await db.insert(billingYears).values({ rtUnitId, year: yearNumber, status: "open" })
      .returning({ id: billingYears.id });
    const [rate] = await createFeeRateFixture(db, {
      rtUnitId,
      billingYearId: year!.id,
      effectiveMonth: month,
      monthlyAmount: 40_000,
    });
    const [due] = await db.insert(monthlyDues).values({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: year!.id,
      feeRateId: rate!.id,
      month,
      amount: 40_000,
      dueDate: `${yearNumber}-${String(month).padStart(2, "0")}-10`,
      status: "unpaid",
    }).returning({ id: monthlyDues.id });
    return { rtUnitId, household, due: due!, year: year! };
  }

  it("allows only the exact clean future UNPAID to NOT_DUE transition after household end", async () => {
    const { db, client } = testDatabase;
    const safeDue = await createUnpaidDue(2200, 1);
    const alteredDue = await createUnpaidDue(2200, 2);

    await db.update(households)
      .set({ status: "inactive", endsOn: "2199-12-31" })
      .where(eq(households.id, safeDue.household.householdId));
    await db.update(households)
      .set({ status: "inactive", endsOn: "2199-12-31" })
      .where(eq(households.id, alteredDue.household.householdId));

    const [reconciled] = (await client.query<{
      status: string;
      amount: number;
      fee_rate_id: string | null;
      waived_reason: string | null;
    }>(`
      UPDATE public.monthly_dues
      SET status = 'not_due', amount = 0, fee_rate_id = NULL, waived_reason = NULL
      WHERE id = $1
      RETURNING status::text, amount, fee_rate_id, waived_reason
    `, [safeDue.due.id])).rows;
    expect(reconciled).toEqual({ status: "not_due", amount: 0, fee_rate_id: null, waived_reason: null });

    await expect(client.query(`
      UPDATE public.monthly_dues
      SET status = 'not_due', amount = 0, fee_rate_id = NULL, waived_reason = NULL,
          created_at = created_at + interval '1 minute'
      WHERE id = $1
    `, [alteredDue.due.id])).rejects.toThrow(/obligation snapshot rewritten/);

    await expect(client.query(
      "UPDATE public.monthly_dues SET status = 'unpaid' WHERE id = $1",
      [safeDue.due.id],
    )).rejects.toThrow(/NOT_DUE is terminal and immutable/);
  });

  it("rejects post-end reconciliation when the due has payment-request history", async () => {
    const { db, client } = testDatabase;
    const dueFixture = await createUnpaidDue(2200, 3);
    const residentUser = await createAuthUser(db);
    const [residentAccount] = await db.insert(appAccounts).values({
      rtUnitId: dueFixture.rtUnitId,
      authUserId: residentUser.id,
      accountType: "resident",
      loginIdentifier: `F12-${residentUser.id}`,
      personId: dueFixture.household.personId,
      householdId: dueFixture.household.householdId,
    }).returning({ id: appAccounts.id });
    const requestId = randomUUID();
    await db.transaction(async (transaction) => {
      await transaction.insert(paymentRequests).values({
        id: requestId,
        requestCode: `F12-${requestId.slice(0, 12)}`,
        rtUnitId: dueFixture.rtUnitId,
        householdId: dueFixture.household.householdId,
        requestedByAccountId: residentAccount!.id,
        requestedByAccountType: "resident",
        status: "pending",
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
        totalAmount: 40_000,
        itemCount: 1,
      });
      await transaction.insert(paymentRequestItems).values({
        requestId,
        rtUnitId: dueFixture.rtUnitId,
        householdId: dueFixture.household.householdId,
        monthlyDueId: dueFixture.due.id,
        period: "2200-03",
        amount: 40_000,
      });
      await transaction.insert(paymentRequestClaims).values({ requestId, monthlyDueId: dueFixture.due.id });
    });

    await db.update(households)
      .set({ status: "inactive", endsOn: "2199-12-31" })
      .where(eq(households.id, dueFixture.household.householdId));

    await expect(client.query(`
      UPDATE public.monthly_dues
      SET status = 'not_due', amount = 0, fee_rate_id = NULL, waived_reason = NULL
      WHERE id = $1
    `, [dueFixture.due.id])).rejects.toThrow(/obligation snapshot rewritten/);

    const [unchanged] = (await client.query<{ status: string; amount: number }>(
      "SELECT status::text, amount FROM public.monthly_dues WHERE id = $1",
      [dueFixture.due.id],
    )).rows;
    expect(unchanged).toEqual({ status: "unpaid", amount: 40_000 });
  });

  it("rejects a past due even when its period follows the household end", async () => {
    const { db, client } = testDatabase;
    const dueFixture = await createUnpaidDue(2024, 1);
    await db.update(households)
      .set({ status: "inactive", endsOn: "2023-12-31" })
      .where(eq(households.id, dueFixture.household.householdId));

    await expect(client.query(`
      UPDATE public.monthly_dues
      SET status = 'not_due', amount = 0, fee_rate_id = NULL, waived_reason = NULL
      WHERE id = $1
    `, [dueFixture.due.id])).rejects.toThrow(/obligation snapshot rewritten/);
  });
});
