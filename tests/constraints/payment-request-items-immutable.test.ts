import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import {
  appAccounts,
  auditEvents,
  billingYears,
  feeRates,
  monthlyDues,
  paymentRequestClaims,
  paymentRequestItems,
  paymentRequests,
  relationalSchema,
} from "../../src/db/schema";
import { resolvePrincipalForUser } from "../../src/lib/auth/principal";
import { createResidentPaymentRequest } from "../../src/lib/billing/resident-payment-request";
import { createAuthUser, createHousehold, createRt } from "../helpers/database";

function sqlState(error: unknown): string | undefined {
  let current = error;
  while (current && typeof current === "object") {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

describe("payment request item snapshot migration", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof relationalSchema>>;

  beforeAll(async () => {
    client = new PGlite();
    const migrationFolder = resolve(process.cwd(), "drizzle");
    const migrations = readdirSync(migrationFolder)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const hardeningMigration = "0005_phase_5_1_payment_request_items_immutable.sql";

    for (const name of migrations.filter((migration) => migration < hardeningMigration)) {
      await client.exec(readFileSync(resolve(migrationFolder, name), "utf8"));
    }

    database = drizzle(client, { schema: relationalSchema });
    const rtUnitId = await createRt(database);
    const household = await createHousehold(database, rtUnitId);
    const auth = await createAuthUser(database);
    await database.insert(appAccounts).values({
      rtUnitId,
      authUserId: auth.id,
      accountType: "resident",
      loginIdentifier: `resident-${randomUUID()}`,
      personId: household.personId,
      householdId: household.householdId,
    }).returning({ id: appAccounts.id });
    const [billingYear] = await database.insert(billingYears).values({
      rtUnitId,
      year: 2026,
      status: "open",
    }).returning({ id: billingYears.id });
    const [feeRate] = await database.insert(feeRates).values({
      rtUnitId,
      billingYearId: billingYear.id,
      effectiveMonth: 1,
      monthlyAmount: 40000,
    }).returning({ id: feeRates.id });

    await database.insert(monthlyDues).values([1, 2].map((month) => ({
      rtUnitId,
      householdId: household.householdId,
      billingYearId: billingYear.id,
      feeRateId: feeRate.id,
      month,
      amount: 40000,
      dueDate: `2026-${String(month).padStart(2, "0")}-10`,
      status: "unpaid" as const,
    })));

    const principal = await resolvePrincipalForUser(database as never, auth.id, "2026-06-18");
    const beforeMigration = await createResidentPaymentRequest(database as never, principal, {
      period: "2026-01",
      idempotencyKey: randomUUID(),
    });

    await client.exec(readFileSync(resolve(migrationFolder, hardeningMigration), "utf8"));

    const afterMigration = await createResidentPaymentRequest(database as never, principal, {
      period: "2026-02",
      idempotencyKey: randomUUID(),
    });
    expect(beforeMigration.status).toBe("pending");
    expect(afterMigration.periods).toEqual(["2026-02"]);
  });

  afterAll(async () => {
    if (client) await client.close();
  });

  it("allows normal inserts and rejects UPDATE, DELETE, and TRUNCATE without changing financial records", async () => {
    const initialItems = await database.select().from(paymentRequestItems);
    expect(initialItems).toHaveLength(2);
    expect(initialItems.map((item) => item.amount)).toEqual([40000, 40000]);

    const requestId = initialItems[0]!.requestId;
    const itemDueId = initialItems[0]!.monthlyDueId;
    const requestBefore = await database.select().from(paymentRequests)
      .where(eq(paymentRequests.id, requestId));

    const mutationSqlState = async (mutation: () => Promise<unknown>) => {
      let failure: unknown;
      try {
        await mutation();
      } catch (error) {
        failure = error;
      }
      return sqlState(failure);
    };

    expect(await mutationSqlState(() => database.update(paymentRequestItems)
      .set({ amount: 99999 })
      .where(and(
        eq(paymentRequestItems.requestId, requestId),
        eq(paymentRequestItems.monthlyDueId, itemDueId),
      )))).toBe("55000");
    expect(await mutationSqlState(() => database.delete(paymentRequestItems)
      .where(and(
        eq(paymentRequestItems.requestId, requestId),
        eq(paymentRequestItems.monthlyDueId, itemDueId),
      )))).toBe("55000");

    const truncateSqlState = await mutationSqlState(() => client.exec("TRUNCATE TABLE public.payment_request_items"));
    expect(["0A000", "55000"]).toContain(truncateSqlState);
    expect(await mutationSqlState(() => client.exec("TRUNCATE TABLE public.payment_request_items CASCADE"))).toBe("55000");

    const items = await database.select().from(paymentRequestItems);
    const requests = await database.select().from(paymentRequests);
    const claims = await database.select().from(paymentRequestClaims);
    const dues = await database.select({ status: monthlyDues.status })
      .from(monthlyDues)
      .where(eq(monthlyDues.householdId, requestBefore[0]!.householdId));
    const audit = await database.select({ action: auditEvents.action }).from(auditEvents);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.amount)).toEqual([40000, 40000]);
    expect(requests).toHaveLength(2);
    expect(requests.find((request) => request.id === requestId)).toMatchObject({
      status: "pending",
      totalAmount: 40000,
      itemCount: 1,
    });
    expect(claims).toHaveLength(2);
    expect(dues).toEqual([{ status: "unpaid" }, { status: "unpaid" }]);
    expect(audit.filter((event) => event.action === "payment_request.created")).toHaveLength(2);
  });
});
