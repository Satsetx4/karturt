import { loadEnvConfig } from "@next/env";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { rtSettings, rtUnits } from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  loadEnvConfig(process.cwd());
  requireDatabaseEnvironment();
  const values = {
    code: required("KARTUR_RT_CODE"),
    rwCode: required("KARTUR_RW_CODE"),
    name: required("KARTUR_RT_NAME"),
    village: required("KARTUR_VILLAGE"),
    district: process.env.KARTUR_DISTRICT?.trim() || null,
    city: process.env.KARTUR_CITY?.trim() || null,
    province: process.env.KARTUR_PROVINCE?.trim() || null,
  };

  const db = getDb();
  const [existing] = await db.select({ id: rtUnits.id }).from(rtUnits)
    .where(and(
      eq(rtUnits.code, values.code),
      eq(rtUnits.rwCode, values.rwCode),
      eq(rtUnits.village, values.village),
    )).limit(1);
  if (existing) throw new Error("An RT unit with that code already exists. No record was changed.");

  const id = await db.transaction(async (transaction) => {
    const [unit] = await transaction.insert(rtUnits).values(values).returning({ id: rtUnits.id });
    await transaction.insert(rtSettings).values({ rtUnitId: unit.id });
    return unit.id;
  });
  console.info(JSON.stringify({ event: "rt_unit.bootstrapped", rtUnitId: id }));
}

main()
  .catch((error: unknown) => {
    console.error("RT setup failed.", error instanceof Error ? error.message : "Unexpected failure.");
    process.exitCode = 1;
  })
  .finally(closeDb);
