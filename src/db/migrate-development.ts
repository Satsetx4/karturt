import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { closeDb, getDb, type AppDatabase } from "@/db/client";
import {
  type ProjectEnvironment,
  loadProjectEnvConfig,
} from "@/lib/env-file-preflight";
import { assertBootstrapDatabaseTarget } from "@/lib/staging-database-target";

const migrationsFolder = "./drizzle";

type MigrationDependencies = {
  environment: ProjectEnvironment;
  projectDirectory: string;
  loadEnvironment: (
    projectDirectory: string,
    options: { environment: ProjectEnvironment },
  ) => unknown;
  getDatabase: () => AppDatabase;
  applyMigrations: (database: AppDatabase, options: { migrationsFolder: string }) => Promise<void>;
  closeDatabase: () => Promise<void>;
};

/**
 * Enforces the parent-process labels before any project .env file can load.
 * Local env-file opt-in and CI restrictions are enforced by env-file-preflight.
 */
export function assertDevelopmentMigrationLabels(environment: ProjectEnvironment): void {
  if (environment.APP_ENV !== "development" || environment.DATABASE_ENV !== "development") {
    throw new Error("Local database migrations require explicit matching APP_ENV and DATABASE_ENV development labels.");
  }
  if (environment.NODE_ENV !== undefined && environment.NODE_ENV !== "development") {
    throw new Error("Local database migrations require NODE_ENV to be unset or development.");
  }
  if (environment.CI !== undefined && environment.CI !== "") {
    throw new Error("Local database migrations are disabled in CI.");
  }
}

/** Validates the exact, repository-approved local bootstrap target without connecting. */
export function assertDevelopmentMigrationTarget(environment: ProjectEnvironment): string {
  assertDevelopmentMigrationLabels(environment);
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for local development migrations.");
  }
  assertBootstrapDatabaseTarget(databaseUrl, "development", "development");
  return databaseUrl;
}

/**
 * Injectable command flow so the preflight and fail-closed ordering can be
 * verified offline. This function never creates a database client before the
 * post-load local target validation succeeds.
 */
export async function runDevelopmentMigration(dependencies: MigrationDependencies): Promise<void> {
  assertDevelopmentMigrationLabels(dependencies.environment);
  dependencies.loadEnvironment(dependencies.projectDirectory, {
    environment: dependencies.environment,
  });
  assertDevelopmentMigrationTarget(dependencies.environment);

  const database = dependencies.getDatabase();
  try {
    await dependencies.applyMigrations(database, { migrationsFolder });
  } finally {
    await dependencies.closeDatabase();
  }
}

async function main() {
  await runDevelopmentMigration({
    environment: process.env,
    projectDirectory: process.cwd(),
    loadEnvironment: loadProjectEnvConfig,
    getDatabase: getDb,
    applyMigrations: migrate,
    closeDatabase: closeDb,
  });
  console.info(JSON.stringify({ event: "database.migrations.applied", environment: "development" }));
}

const isDirectExecution = /(?:^|[\\/])migrate-development\.ts$/.test(process.argv[1] ?? "");

if (isDirectExecution) {
  main().catch(() => {
    // Driver errors can include connection details. Keep command output free of URLs and credentials.
    console.error("Local development database migration failed. Check the local target and PostgreSQL logs.");
    process.exitCode = 1;
  });
}
