import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";
import { requireDatabaseEnvironment } from "./src/lib/env";

loadEnvConfig(process.cwd());
const { databaseUrl } = requireDatabaseEnvironment();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
