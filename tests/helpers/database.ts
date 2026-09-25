import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema, authUser, houses, households, people, rtSettings, rtUnits } from "../../src/db/schema";

export async function createTestDatabase() {
  const client = new PGlite();
  const migrationFolder = resolve(process.cwd(), "drizzle");
  const migrations = readdirSync(migrationFolder).filter((name) => name.endsWith(".sql")).sort();
  if (migrations.length === 0) throw new Error("No SQL migration exists. Run npm run db:generate first.");
  for (const name of migrations) {
    await client.exec(readFileSync(resolve(migrationFolder, name), "utf8"));
  }
  return { client, db: drizzle(client, { schema }), close: () => client.close() };
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
