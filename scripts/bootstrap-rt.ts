import { loadEnvConfig } from "@next/env";
import { closeDb, getDb } from "@/db/client";
import { requireDatabaseEnvironment } from "@/lib/env";
import { bootstrapRtUnit } from "@/lib/rt/bootstrap";

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
  const result = await bootstrapRtUnit(db, values);
  console.info(JSON.stringify({ event: "rt_unit.bootstrapped", rtUnitId: result.id, created: result.created }));
}

main()
  .catch((error: unknown) => {
    console.error("RT setup failed.", error instanceof Error ? error.message : "Unexpected failure.");
    process.exitCode = 1;
  })
  .finally(closeDb);
