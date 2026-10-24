import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: "postgresql://karturt_schema_generation:local-only@127.0.0.1:5432/karturt_schema_generation",
  },
  strict: true,
  verbose: true,
});
