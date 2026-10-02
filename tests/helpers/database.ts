import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
  appAccounts,
  auditEvents,
  authUser,
  billingYears,
  feeRates,
  houses,
  households,
  officialAssignments,
  people,
  relationalSchema,
  rtSettings,
  rtUnits,
} from "../../src/db/schema";

export async function createTestDatabase() {
  const client = new PGlite();
  const migrationFolder = resolve(process.cwd(), "drizzle");
  const migrations = readdirSync(migrationFolder).filter((name) => name.endsWith(".sql")).sort();
  if (migrations.length === 0) throw new Error("No SQL migration exists. Run npm run db:generate first.");
  for (const name of migrations) {
    await client.exec(readFileSync(resolve(migrationFolder, name), "utf8"));
  }
  return { client, db: drizzle(client, { schema: relationalSchema }), close: () => client.close() };
}

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

function jakartaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function ensureTestChairman(database: TestDatabase["db"], rtUnitId: string) {
  const today = jakartaToday();
  const assignments = await database
    .select({
      accountId: appAccounts.id,
      startsOn: officialAssignments.startsOn,
      endsOn: officialAssignments.endsOn,
    })
    .from(officialAssignments)
    .innerJoin(appAccounts, and(
      eq(appAccounts.id, officialAssignments.appAccountId),
      eq(appAccounts.rtUnitId, officialAssignments.rtUnitId),
      eq(appAccounts.accountType, "official"),
      eq(appAccounts.status, "active"),
    ))
    .where(and(
      eq(officialAssignments.rtUnitId, rtUnitId),
      eq(officialAssignments.appAccountType, "official"),
      eq(officialAssignments.role, "rt_chairman"),
      lte(officialAssignments.startsOn, today),
      or(isNull(officialAssignments.endsOn), gte(officialAssignments.endsOn, today)),
    ));
  const activeCounts = new Map<string, number>();
  for (const assignment of assignments) {
    activeCounts.set(assignment.accountId, (activeCounts.get(assignment.accountId) ?? 0) + 1);
  }
  const existingAccountId = [...activeCounts].find(([, count]) => count === 1)?.[0];
  if (existingAccountId) return existingAccountId;

  const household = await createHousehold(database, rtUnitId);
  const user = await createAuthUser(database, `Chairman fixture ${randomUUID().slice(0, 8)}`);
  const [account] = await database.insert(appAccounts).values({
    rtUnitId,
    authUserId: user.id,
    accountType: "official",
    loginIdentifier: `chair-fixture-${randomUUID()}`,
    personId: household.personId,
  }).returning({ id: appAccounts.id });
  await database.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: account!.id,
    role: "rt_chairman",
    startsOn: "2000-01-01",
  });
  return account!.id;
}

/**
 * Seed an attributed, audited tariff for database tests. Older-period fixtures
 * are staged through a free future year inside the transaction so the real
 * F11 insert trigger is exercised, then the billing-year snapshot is restored
 * before the deferred audit constraint checks its canonical period.
 */
export async function createFeeRateFixture(
  database: TestDatabase["db"],
  input: { rtUnitId: string; billingYearId: string; effectiveMonth: number; monthlyAmount: number },
) {
  const actorAccountId = await ensureTestChairman(database, input.rtUnitId);
  return database.transaction(async (transaction) => {
    const [originalYear] = await transaction
      .select({ id: billingYears.id, rtUnitId: billingYears.rtUnitId, year: billingYears.year, status: billingYears.status })
      .from(billingYears)
      .where(and(eq(billingYears.id, input.billingYearId), eq(billingYears.rtUnitId, input.rtUnitId)))
      .limit(1)
      .for("update");
    if (!originalYear) throw new Error("Fee-rate fixture requires an existing same-RT billing year.");

    const today = jakartaToday();
    const currentYear = Number(today.slice(0, 4));
    const currentMonth = Number(today.slice(5, 7));
    let insertionYear = originalYear.year;
    if (insertionYear < currentYear || (insertionYear === currentYear && input.effectiveMonth <= currentMonth)) {
      const occupiedYears = new Set((await transaction
        .select({ year: billingYears.year })
        .from(billingYears)
        .where(eq(billingYears.rtUnitId, input.rtUnitId)))
        .map(({ year }) => year));
      insertionYear = Math.max(currentYear + 1, originalYear.year + 1);
      while (occupiedYears.has(insertionYear) && insertionYear <= 2200) insertionYear += 1;
      if (insertionYear > 2200) throw new Error("No future billing year is available for a tariff fixture.");
    }

    const openYears = await transaction
      .select({ id: billingYears.id, status: billingYears.status })
      .from(billingYears)
      .where(and(eq(billingYears.rtUnitId, input.rtUnitId), eq(billingYears.status, "open")))
      .for("update");
    const priorOpenYearIds = openYears
      .filter(({ id }) => id !== originalYear.id)
      .map(({ id }) => id);
    if (priorOpenYearIds.length > 0) {
      await transaction.update(billingYears)
        .set({ status: "draft" })
        .where(and(eq(billingYears.rtUnitId, input.rtUnitId), eq(billingYears.status, "open")));
    }
    if (originalYear.status !== "open" || insertionYear !== originalYear.year) {
      await transaction.update(billingYears)
        .set({ year: insertionYear, status: "open" })
        .where(eq(billingYears.id, originalYear.id));
    }

    const idempotencyKey = randomUUID();
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      version: 1,
      billingYearId: input.billingYearId,
      effectiveMonth: input.effectiveMonth,
      monthlyAmount: input.monthlyAmount,
    })).digest("hex");
    const [created] = await transaction.insert(feeRates).values({
      rtUnitId: input.rtUnitId,
      billingYearId: input.billingYearId,
      effectiveMonth: input.effectiveMonth,
      monthlyAmount: input.monthlyAmount,
      createdByAccountId: actorAccountId,
      createdByAccountType: "official",
      idempotencyKey,
      requestFingerprint,
    }).returning({ id: feeRates.id });
    const period = `${originalYear.year}-${String(input.effectiveMonth).padStart(2, "0")}`;
    await transaction.insert(auditEvents).values({
      actorAppAccountId: actorAccountId,
      action: "fee_rate.created",
      entityType: "fee_rate",
      entityId: created!.id,
      reason: null,
      context: { period, monthlyAmount: input.monthlyAmount },
    });

    await transaction.update(billingYears)
      .set({ year: originalYear.year, status: originalYear.status })
      .where(eq(billingYears.id, originalYear.id));
    for (const priorOpenYearId of priorOpenYearIds) {
      await transaction.update(billingYears)
        .set({ status: "open" })
        .where(eq(billingYears.id, priorOpenYearId));
    }
    return [created!];
  });
}

export async function createRt(database: Awaited<ReturnType<typeof createTestDatabase>>["db"]) {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const [unit] = await database.insert(rtUnits).values({
    code: `RT-${suffix}`,
    rwCode: `RW-${suffix}`,
    name: `RT unit ${suffix}`,
    village: `Village ${suffix}`,
  }).returning({ id: rtUnits.id });
  await database.insert(rtSettings).values({ rtUnitId: unit.id });
  return unit.id;
}

export async function createHousehold(
  database: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  rtUnitId: string,
  options: { number?: string; startsOn?: string } = {},
) {
  const [house] = await database.insert(houses).values({
    rtUnitId,
    number: options.number ?? `H-${randomUUID().slice(0, 8)}`,
  }).returning({ id: houses.id });
  const [household] = await database.insert(households).values({
    rtUnitId,
    houseId: house.id,
    startsOn: options.startsOn ?? "2020-01-01",
  }).returning({ id: households.id });
  const [person] = await database.insert(people).values({
    rtUnitId,
    householdId: household.id,
    fullName: `Fixture ${randomUUID().slice(0, 8)}`,
  }).returning({ id: people.id });
  return { houseId: house.id, householdId: household.id, personId: person.id };
}

export async function createAuthUser(
  database: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  name = `Fixture ${randomUUID().slice(0, 8)}`,
) {
  const id = randomUUID();
  const email = `${randomUUID()}@accounts.test.invalid`;
  await database.insert(authUser).values({ id, name, email, emailVerified: true });
  return { id, email };
}
