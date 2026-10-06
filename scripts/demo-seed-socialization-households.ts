import { loadEnvConfig } from "@next/env";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { appAccounts, houses, households, monthlyDues, people } from "@/db/schema";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import { createHouseholdResident, updateHouseholdResident } from "@/lib/households/lifecycle";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";
import { requireDatabaseEnvironment } from "@/lib/env";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectedHouseNumbers(): string[] {
  return [
    ...Array.from({ length: 30 }, (_, index) => `D-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 30 }, (_, index) => `C-${String(index + 1).padStart(2, "0")}`),
  ];
}

function assertIsolatedDemoTarget(): { rtUnitId: string; pin: string } {
  const environment = requireDatabaseEnvironment();
  assert(environment.appEnv === "staging" && environment.databaseEnv === "staging", "Fixture seeding requires explicit staging environment labels.");
  assert(environment.databaseUrl, "The isolated demo database URL is missing.");

  const target = new URL(environment.databaseUrl);
  assert(
    target.protocol.startsWith("postgres") &&
      target.hostname.startsWith("ep-lingering-star-azj3l9mj") &&
      !target.hostname.includes("pooler") &&
      target.pathname === "/karturt_demo_20261006_final",
    "Refusing to seed an unexpected database or endpoint.",
  );

  const rtUnitId = process.env.DEMO_RT_UNIT_ID;
  const pin = process.env.KARTUR_DEMO_RESIDENT_PIN;
  assert(rtUnitId && pin, "The local demo RT or Resident PIN configuration is missing.");
  return { rtUnitId, pin };
}

async function main() {
  loadEnvConfig(process.cwd());
  const { rtUnitId, pin } = assertIsolatedDemoTarget();
  const db = getDb();
  const expectedNumbers = expectedHouseNumbers();
  const today = jakartaBusinessDate();
  const fixtureStartDate = "2026-01-01";

  const [chairman] = await db.select({ authUserId: appAccounts.authUserId, status: appAccounts.status })
    .from(appAccounts)
    .where(and(
      eq(appAccounts.rtUnitId, rtUnitId),
      eq(appAccounts.accountType, "official"),
      eq(appAccounts.loginIdentifier, "ketua.rt"),
    )).limit(1);
  assert(chairman?.status === "active", "The active demo Chairman account is required for canonical household lifecycle operations.");
  const principal = await resolvePrincipalForUser(db, chairman.authUserId, today);
  assert(principal.role === "rt_chairman" && principal.rtUnitId === rtUnitId, "The demo Chairman assignment is not active for today.");

  const beforeRows = await db.select({
    houseId: houses.id,
    houseNumber: houses.number,
    householdId: households.id,
    startsOn: households.startsOn,
    householdStatus: households.status,
    personId: people.id,
    fullName: people.fullName,
    phone: people.phone,
    personActive: people.isActive,
  }).from(houses)
    .leftJoin(households, and(eq(households.houseId, houses.id), eq(households.rtUnitId, houses.rtUnitId)))
    .leftJoin(people, and(eq(people.householdId, households.id), eq(people.rtUnitId, households.rtUnitId)))
    .where(eq(houses.rtUnitId, rtUnitId));

  assert(beforeRows.every((row) => expectedNumbers.includes(row.houseNumber)), "Unexpected house exists in the demo RT; refusing to reconcile or overwrite it.");
  assert(beforeRows.every((row) => row.householdId === null || row.householdStatus === "active"), "An inactive household already occupies a demo house; refusing to alter lifecycle history.");
  assert(beforeRows.every((row) => row.householdId === null || row.personId !== null), "An existing household is missing its resident person.");

  let createdHouseholds = 0;
  let updatedResidentNames = 0;
  for (const houseNumber of expectedNumbers) {
    const houseRows = beforeRows.filter((row) => row.houseNumber === houseNumber && row.householdId !== null);
    if (houseRows.length === 0) {
      await createHouseholdResident(db, principal, {
        newHouse: { number: houseNumber },
        startsOn: fixtureStartDate,
        fullName: `NAMA ${houseNumber}`,
        phone: null,
        initialPin: pin,
      }, fixtureStartDate);
      createdHouseholds += 1;
      continue;
    }

    assert(houseRows.length === 1, `Expected exactly one active household/person for ${houseNumber}.`);
    const existing = houseRows[0]!;
    assert(existing.personId && existing.householdId, `Household records are incomplete for ${houseNumber}.`);
    assert(existing.householdStatus === "active" && existing.personActive && existing.phone === null, `Existing fixture for ${houseNumber} is not active and phone-free.`);
    assert(existing.startsOn === fixtureStartDate && existing.startsOn <= today, `Existing household ${houseNumber} does not match the approved full-year fixture start date.`);

    if (existing.fullName !== `NAMA ${houseNumber}`) {
      await updateHouseholdResident(db, principal, {
        householdId: existing.householdId,
        personId: existing.personId,
        fullName: `NAMA ${houseNumber}`,
        phone: null,
      }, today);
      updatedResidentNames += 1;
    }
  }

  const finalRows = await db.select({
    houseId: houses.id,
    houseNumber: houses.number,
    householdId: households.id,
    startsOn: households.startsOn,
    householdStatus: households.status,
    personId: people.id,
    fullName: people.fullName,
    phone: people.phone,
    personActive: people.isActive,
  }).from(houses)
    .innerJoin(households, and(eq(households.houseId, houses.id), eq(households.rtUnitId, houses.rtUnitId)))
    .innerJoin(people, and(eq(people.householdId, households.id), eq(people.rtUnitId, households.rtUnitId)))
    .where(eq(houses.rtUnitId, rtUnitId));

  assert(finalRows.length === 60, `Expected exactly 60 house/household/person rows, found ${finalRows.length}.`);
  assert(new Set(finalRows.map((row) => row.houseNumber)).size === 60, "Duplicate demo house numbers were found.");
  assert(finalRows.every((row) => row.householdStatus === "active" && row.personActive && row.phone === null), "A demo household/person is inactive or has a phone number.");
  assert(finalRows.every((row) => row.fullName === `NAMA ${row.houseNumber}`), "A demo resident name does not match the synthetic naming rule.");
  assert(finalRows.every((row) => expectedNumbers.includes(row.houseNumber) && row.startsOn === fixtureStartDate && row.startsOn <= today), "A demo house has an unexpected start date or its Resident is not active today.");

  const accountRows = await db.select({
    houseNumber: houses.number,
    accountId: appAccounts.id,
    accountStatus: appAccounts.status,
    loginIdentifier: appAccounts.loginIdentifier,
    personId: appAccounts.personId,
  }).from(appAccounts)
    .innerJoin(houses, and(eq(houses.rtUnitId, appAccounts.rtUnitId), eq(houses.number, appAccounts.loginIdentifier)))
    .where(and(eq(appAccounts.rtUnitId, rtUnitId), eq(appAccounts.accountType, "resident")));

  assert(accountRows.length === 60, `Expected exactly 60 Resident accounts, found ${accountRows.length}.`);
  assert(new Set(accountRows.map((row) => row.loginIdentifier)).size === 60, "Duplicate Resident login identifiers were found.");
  assert(accountRows.every((row) => row.accountStatus === "active" && expectedNumbers.includes(row.houseNumber)), "A Resident account is inactive or outside the allowed fixture houses.");

  const dues = await db.select({
    houseNumber: houses.number,
    month: monthlyDues.month,
    amount: monthlyDues.amount,
    status: monthlyDues.status,
  }).from(monthlyDues)
    .innerJoin(households, and(eq(households.rtUnitId, monthlyDues.rtUnitId), eq(households.id, monthlyDues.householdId)))
    .innerJoin(houses, and(eq(houses.rtUnitId, households.rtUnitId), eq(houses.id, households.houseId)))
    .where(eq(monthlyDues.rtUnitId, rtUnitId));
  const expectedDueCount = 60 * 12;
  assert(dues.length === expectedDueCount, `Expected ${expectedDueCount} canonical dues across the fixture, found ${dues.length}.`);
  assert(dues.every((due) => Number(due.amount) === 40000 && due.status === "unpaid"), "A fixture due has an unexpected canonical amount or financial state.");

  console.info(JSON.stringify({
    event: "demo.socialization.households.seeded",
    target: { endpoint: "ep-lingering-star-azj3l9mj", database: "karturt_demo_20261006_final" },
    rt: "RT.05 / RW.04 / Jrebeng Wetan",
    businessDate: today,
    householdStartsOn: fixtureStartDate,
    counts: {
      houses: new Set(finalRows.map((row) => row.houseId)).size,
      households: new Set(finalRows.map((row) => row.householdId)).size,
      activePeople: finalRows.filter((row) => row.personActive).length,
      residentAccounts: accountRows.length,
      canonicalDues: dues.length,
      dueMonths: [...new Set(dues.map((due) => due.month))].sort((left, right) => left - right),
      dueAmounts: [...new Set(dues.map((due) => Number(due.amount)))],
      dueStates: [...new Set(dues.map((due) => due.status))],
      accountsCreatedByCanonicalFlow: createdHouseholds,
      namesUpdated: updatedResidentNames,
      phoneNumbers: finalRows.filter((row) => row.phone !== null).length,
    },
    createdAccountStatuses: [...new Set(accountRows.map((row) => row.accountStatus))],
    accountLogins: accountRows.map((row) => row.loginIdentifier).sort(),
    residentsActiveToday: finalRows.every((row) => row.householdStatus === "active" && row.startsOn <= today),
    dueCountByNewHouseholds: "Canonical createHouseholdResident generates 12 historical 2026 dues using the approved fixture business date.",
  }));
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ event: "demo.socialization.households.seed.failed", reason: error instanceof Error ? error.message : "unknown error" }));
    process.exitCode = 1;
  })
  .finally(closeDb);
