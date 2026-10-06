import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { appAccounts, billingYears, houses, households, monthlyDues, people } from "@/db/schema";
import { resolvePrincipalForUser } from "@/lib/auth/principal";
import { activateBillingYear } from "@/lib/billing/activation";
import { generateHouseholdDues } from "@/lib/billing/generator";
import { createHouseholdResident } from "@/lib/households/lifecycle";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnvConfig(process.cwd());
  assert(process.env.APP_ENV === "staging" && process.env.DATABASE_ENV === "staging", "G0 setup requires explicit staging labels.");
  const databaseUrl = process.env.DATABASE_URL;
  const rtUnitId = process.env.DEMO_RT_UNIT_ID;
  const pin = process.env.KARTUR_DEMO_RESIDENT_PIN;
  assert(databaseUrl && rtUnitId && pin, "Local staging setup variables are incomplete.");
  const url = new URL(databaseUrl);
  assert(
    url.hostname === "ep-lingering-star-azj3l9mj.c-3.ap-southeast-1.aws.neon.tech" &&
      url.pathname === "/karturt_demo_20261006_final" &&
      !url.hostname.includes("pooler"),
    "Refusing to create G0 records outside the isolated final database.",
  );

  const db = getDb();
  const journal = await db.execute(sql<{ entries: string; head_hash: string | null }>`
    SELECT count(*)::text AS entries,
      (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) AS head_hash
    FROM drizzle.__drizzle_migrations
  `);
  assert(journal.rows[0]?.entries === "14" && String(journal.rows[0]?.head_hash ?? "").toLowerCase() === "a707f54fb504999323fd65860cfeea247288e20940d1319094195d067f30ab2c", "Final schema journal is not exactly at migration 0013.");

  const [rt] = await db.execute(sql<{ code: string; name: string; rw_code: string; village: string }>`
    SELECT code, name, rw_code, village FROM public.rt_units WHERE id = ${rtUnitId}::uuid
  `).then((result) => result.rows);
  assert(rt?.code === "RT.05" && rt.name === "RT.05" && rt.rw_code === "RW.04" && rt.village === "Jrebeng Wetan", "Final G0 target RT identity does not match.");

  const [year] = await db.select({ id: billingYears.id, status: billingYears.status })
    .from(billingYears).where(and(eq(billingYears.rtUnitId, rtUnitId), eq(billingYears.year, 2026))).limit(1);
  assert(year && (year.status === "draft" || year.status === "open"), "Expected a draft/open 2026 billing year.");

  const [chairman] = await db.select({ id: appAccounts.id, authUserId: appAccounts.authUserId, status: appAccounts.status })
    .from(appAccounts).where(and(
      eq(appAccounts.rtUnitId, rtUnitId),
      eq(appAccounts.accountType, "official"),
      eq(appAccounts.loginIdentifier, "ketua.rt"),
    )).limit(1);
  assert(chairman?.status === "active", "The provisioned active Chairman account is missing.");
  const principal = await resolvePrincipalForUser(db, chairman.authUserId);
  assert(principal.role === "rt_chairman" && principal.rtUnitId === rtUnitId, "Chairman assignment is not active today.");

  const [existing] = await db.select({
    householdId: households.id,
    startsOn: households.startsOn,
    status: households.status,
    houseId: houses.id,
    personId: people.id,
    fullName: people.fullName,
    phone: people.phone,
    personActive: people.isActive,
  }).from(houses)
    .innerJoin(households, and(eq(households.rtUnitId, houses.rtUnitId), eq(households.houseId, houses.id)))
    .innerJoin(people, and(eq(people.rtUnitId, households.rtUnitId), eq(people.householdId, households.id)))
    .where(and(eq(houses.rtUnitId, rtUnitId), eq(houses.number, "D-01"))).limit(1);

  let householdId = existing?.householdId;
  if (!existing) {
    const created = await createHouseholdResident(db, principal, {
      newHouse: { number: "D-01" },
      startsOn: "2026-01-01",
      fullName: "NAMA D-01",
      phone: null,
      initialPin: pin,
    }, "2026-01-01");
    householdId = created.householdId;
  } else {
    assert(
      existing.startsOn === "2026-01-01" && existing.status === "active" && existing.fullName === "NAMA D-01" && existing.phone === null && existing.personActive,
      "Existing D-01 proof fixture does not match; refusing to rewrite household history.",
    );
  }
  assert(householdId, "D-01 household setup did not return an ID.");

  if (year.status === "draft") await activateBillingYear(db, principal, { billingYearId: year.id });
  const generation = await generateHouseholdDues(db, principal, { householdId, billingYearId: year.id });
  const dues = await db.select({ month: monthlyDues.month, amount: monthlyDues.amount, status: monthlyDues.status })
    .from(monthlyDues).where(and(eq(monthlyDues.rtUnitId, rtUnitId), eq(monthlyDues.householdId, householdId), eq(monthlyDues.billingYearId, year.id))).orderBy(monthlyDues.month);
  assert(dues.length === 12, `Expected 12 G0 dues, received ${dues.length}.`);
  assert(dues.every((due, index) => due.month === index + 1 && Number(due.amount) === 40000 && due.status === "unpaid"), "G0 dues do not match 12 x Rp40,000 unpaid.");

  console.info(JSON.stringify({
    event: "demo.g0.final.initialized",
    target: { endpoint: "ep-lingering-star-azj3l9mj", database: "karturt_demo_20261006_final" },
    migrationEntries: 14,
    migrationHead: "0013_phase_12_household_management",
    rt: "RT.05 / RW.04 / Jrebeng Wetan",
    chairmanAccount: "active",
    chairmanAssignmentToday: "PASS",
    billingYear2026: "open",
    household: "D-01",
    startsOn: "2026-01-01",
    residentName: "NAMA D-01",
    phoneNumbers: 0,
    generatedCountThisRun: generation.insertedCount,
    dueCount: dues.length,
    dueMonths: dues.map((due) => due.month),
    amountValues: [...new Set(dues.map((due) => Number(due.amount)))],
    statuses: [...new Set(dues.map((due) => due.status))],
  }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "demo.g0.final.initialization.failed", reason: error instanceof Error ? error.message : "unknown error" }));
  process.exitCode = 1;
}).finally(closeDb);
