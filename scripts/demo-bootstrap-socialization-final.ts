import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { billingYears, feeRates } from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";
import { bootstrapRtUnit } from "@/lib/rt/bootstrap";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertIsolatedTarget() {
  const environment = requireDatabaseEnvironment();
  assert(environment.appEnv === "staging" && environment.databaseEnv === "staging", "Bootstrap requires explicit staging environment labels.");
  assert(environment.databaseUrl, "The final demo database URL is missing.");
  const url = new URL(environment.databaseUrl);
  assert(
    url.hostname === "ep-lingering-star-azj3l9mj.c-3.ap-southeast-1.aws.neon.tech" &&
      url.pathname === "/karturt_demo_20261006_final" &&
      !url.hostname.includes("pooler"),
    "Refusing to bootstrap an unexpected or pooled database target.",
  );
}

async function main() {
  loadEnvConfig(process.cwd());
  assertIsolatedTarget();
  const db = getDb();
  const emptyCheck = await db.execute(sql<{ public_table_count: string }>`
    SELECT count(*)::text AS public_table_count FROM information_schema.tables WHERE table_schema = 'public'
  `);
  const publicTableCount = Number(emptyCheck.rows[0]?.public_table_count);
  assert(publicTableCount === 0 || publicTableCount > 0, "Could not inspect target database emptiness.");
  if (publicTableCount === 0) {
    const migrationSource = path.resolve(process.cwd(), "drizzle");
    const tempMigrationFolder = path.join(tmpdir(), `karturt-socialization-pre-0012-${randomUUID()}`);
    const journalPath = path.join(migrationSource, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string; [key: string]: unknown }>;
    };
    const preF11Entries = journal.entries.filter((entry) => entry.idx <= 11);
    assert(preF11Entries.length === 12, "The official journal does not contain exactly migrations 0000–0011.");
    await mkdir(path.join(tempMigrationFolder, "meta"), { recursive: true });
    for (const entry of preF11Entries) {
      await cp(
        path.join(migrationSource, `${entry.tag}.sql`),
        path.join(tempMigrationFolder, `${entry.tag}.sql`),
      );
    }
    await writeFile(path.join(tempMigrationFolder, "meta", "_journal.json"), JSON.stringify({
      version: journal.version,
      dialect: journal.dialect,
      entries: preF11Entries,
    }, null, 2));

    await migrate(db, { migrationsFolder: tempMigrationFolder });
  }
  const postMigrationCount = await db.execute(sql<{ entry_count: string }>`
    SELECT count(*)::text AS entry_count FROM drizzle.__drizzle_migrations
  `);
  assert(Number(postMigrationCount.rows[0]?.entry_count) === 12, "Expected official migrations 0000–0011 to be recorded before the historical seed.");

  const preSeedState = await db.execute(sql<{ rt_count: string; settings_count: string; year_count: string; rate_count: string; people_count: string; houses_count: string; households_count: string; account_count: string; due_count: string; request_count: string; payment_count: string; allocation_count: string; reversal_count: string; waiver_action_count: string; waiver_item_count: string }>`
    SELECT
      (SELECT count(*)::text FROM public.rt_units) AS rt_count,
      (SELECT count(*)::text FROM public.rt_settings) AS settings_count,
      (SELECT count(*)::text FROM public.billing_years) AS year_count,
      (SELECT count(*)::text FROM public.fee_rates) AS rate_count,
      (SELECT count(*)::text FROM public.people) AS people_count,
      (SELECT count(*)::text FROM public.houses) AS houses_count,
      (SELECT count(*)::text FROM public.households) AS households_count,
      (SELECT count(*)::text FROM public.app_accounts) AS account_count,
      (SELECT count(*)::text FROM public.monthly_dues) AS due_count,
      (SELECT count(*)::text FROM public.payment_requests) AS request_count,
      (SELECT count(*)::text FROM public.payments) AS payment_count,
      (SELECT count(*)::text FROM public.payment_allocations) AS allocation_count,
      (SELECT count(*)::text FROM public.payment_reversals) AS reversal_count,
      (SELECT count(*)::text FROM public.waiver_actions) AS waiver_action_count,
      (SELECT count(*)::text FROM public.waiver_items) AS waiver_item_count
  `);
  const state = preSeedState.rows[0];
  assert(state, "Could not inspect the pre-F11 seed state.");
  assert(
    Number(state.rt_count) <= 1 && Number(state.settings_count) <= 1 &&
      Number(state.year_count) <= 1 && Number(state.rate_count) <= 1 &&
      Number(state.people_count) === 0 && Number(state.houses_count) === 0 &&
      Number(state.households_count) === 0 && Number(state.account_count) === 0 &&
      Number(state.due_count) === 0 && Number(state.request_count) === 0 &&
      Number(state.payment_count) === 0 && Number(state.allocation_count) === 0 &&
      Number(state.reversal_count) === 0 && Number(state.waiver_action_count) === 0 &&
      Number(state.waiver_item_count) === 0,
    "Target contains unexpected records; refusing to continue historical bootstrap.",
  );

  const rt = await bootstrapRtUnit(db, {
    code: "RT.05",
    name: "RT.05",
    rwCode: "RW.04",
    village: "Jrebeng Wetan",
  });
  const [year] = await db.select({ id: billingYears.id, status: billingYears.status })
    .from(billingYears).where(and(eq(billingYears.rtUnitId, rt.id), eq(billingYears.year, 2026))).limit(1);
  const seededYear = year ?? (await db.insert(billingYears).values({
    rtUnitId: rt.id,
    year: 2026,
    status: "draft",
  }).returning({ id: billingYears.id, status: billingYears.status }))[0];
  assert(seededYear?.status === "draft", "The historical billing year must be a single draft year.");
  if (Number(state.rate_count) === 0) {
    await db.execute(sql`
      INSERT INTO public.fee_rates (rt_unit_id, billing_year_id, effective_month, monthly_amount)
      VALUES (${rt.id}::uuid, ${seededYear.id}::uuid, 1, 40000)
    `);
  }

  const [verifiedRate] = await db.select({
    effectiveMonth: feeRates.effectiveMonth,
    monthlyAmount: feeRates.monthlyAmount,
  }).from(feeRates).where(and(eq(feeRates.rtUnitId, rt.id), eq(feeRates.billingYearId, seededYear.id))).limit(1);
  assert(
    verifiedRate?.effectiveMonth === 1 &&
      verifiedRate.monthlyAmount === 40000,
    "The historical January 2026 rate does not match the authorized pre-F11 configuration.",
  );

  console.info(JSON.stringify({
    event: "demo.socialization.bootstrap.pre_f11.complete",
    target: { endpoint: "ep-lingering-star-azj3l9mj", database: "karturt_demo_20261006_final" },
    officialMigrationsApplied: "0000–0011",
    migrationJournalEntries: 12,
    rt: "RT.05 / RW.04 / Jrebeng Wetan",
    billingYear: { year: 2026, status: seededYear.status },
    historicalRate: { effectiveMonth: 1, monthlyAmount: 40000 },
    paymentRequests: 0,
    payments: 0,
    allocations: 0,
    reversals: 0,
    waivers: 0,
  }));
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ event: "demo.socialization.bootstrap.pre_f11.failed", reason: error instanceof Error ? error.message : "unknown error" }));
    process.exitCode = 1;
  })
  .finally(closeDb);
