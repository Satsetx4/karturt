import { defineConfig } from "drizzle-kit";
import { loadProjectEnvConfig } from "./src/lib/env-file-preflight";
import { requireDatabaseEnvironment } from "./src/lib/env";

loadProjectEnvConfig(process.cwd());
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
