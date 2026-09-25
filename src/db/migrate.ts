import { loadEnvConfig } from "@next/env";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { closeDb, getDb } from "@/db/client";
import { requireDatabaseEnvironment } from "@/lib/env";

async function main() {
  loadEnvConfig(process.cwd());
  requireDatabaseEnvironment();
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.info(JSON.stringify({ event: "database.migrations.applied", environment: process.env.DATABASE_ENV ?? "development" }));
}

main()
  .catch((error: unknown) => {
    console.error("Database migration failed.", error);
    process.exitCode = 1;
  })
  .finally(closeDb);
