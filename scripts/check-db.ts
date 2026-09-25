import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { requireDatabaseEnvironment } from "@/lib/env";

async function main() {
  loadEnvConfig(process.cwd());
  const env = requireDatabaseEnvironment();
  await getDb().execute(sql`select 1`);
  console.info(JSON.stringify({ event: "database.connection.ready", appEnvironment: env.appEnv, databaseEnvironment: env.databaseEnv }));
}

main()
  .catch((error: unknown) => {
    console.error("Database connection check failed.", error);
    process.exitCode = 1;
  })
  .finally(closeDb);
