import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://karturt:local-development-only@localhost:5432/karturt_dev",
  },
  strict: true,
  verbose: true,
});
