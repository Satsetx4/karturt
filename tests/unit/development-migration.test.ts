import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertDevelopmentMigrationLabels,
  assertDevelopmentMigrationTarget,
  runDevelopmentMigration,
} from "../../src/db/migrate-development";
import type { AppDatabase } from "../../src/db/client";
import type { ProjectEnvironment } from "../../src/lib/env-file-preflight";

const localUrl = "postgresql://karturt:synthetic-local-password@localhost:5432/karturt_dev";
const stagingUrl =
  "postgresql://karturt_staging_owner:synthetic-only@ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech:5432/karturt_staging?sslmode=require";
const legacyStagingUrl =
  "postgresql://synthetic:synthetic-only@ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech:5432/karturt_staging?sslmode=require";

const environmentNames = ["APP_ENV", "DATABASE_ENV", "NODE_ENV", "CI", "DATABASE_URL"] as const;
const originalValues = new Map(environmentNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of environmentNames) {
    const value = originalValues.get(name);
    if (value === undefined) delete process.env[name];
    else Reflect.set(process.env, name, value);
  }
});

function validEnvironment(overrides: ProjectEnvironment = {}): ProjectEnvironment {
  return {
    APP_ENV: "development",
    DATABASE_ENV: "development",
    DATABASE_URL: localUrl,
    ...overrides,
  };
}

describe("development migration guards", () => {
  it("requires both environment labels explicitly and exactly", () => {
    for (const environment of [
      {},
      { APP_ENV: "development" },
      { DATABASE_ENV: "development" },
      { APP_ENV: "development", DATABASE_ENV: "staging" },
      { APP_ENV: "staging", DATABASE_ENV: "staging" },
      { APP_ENV: "production", DATABASE_ENV: "production" },
      { APP_ENV: "test", DATABASE_ENV: "test" },
    ]) {
      expect(() => assertDevelopmentMigrationLabels(environment), JSON.stringify(environment)).toThrow();
    }

    expect(() => assertDevelopmentMigrationLabels(validEnvironment())).not.toThrow();
    expect(() => assertDevelopmentMigrationLabels(validEnvironment({ NODE_ENV: "test" }))).toThrow("NODE_ENV");
    expect(() => assertDevelopmentMigrationLabels(validEnvironment({ NODE_ENV: "production" }))).toThrow("NODE_ENV");
    expect(() => assertDevelopmentMigrationLabels(validEnvironment({ CI: "true" }))).toThrow("CI");
  });

  it("accepts only the documented local PostgreSQL development target", () => {
    expect(assertDevelopmentMigrationTarget(validEnvironment())).toBe(localUrl);

    const invalidUrls = [
      undefined,
      "postgresql://karturt:synthetic-only@127.0.0.1:5432/karturt_dev",
      "postgresql://other:synthetic-only@localhost:5432/karturt_dev",
      "postgresql://karturt:synthetic-only@localhost:5433/karturt_dev",
      "postgresql://karturt:synthetic-only@localhost:5432/karturt_test",
      "postgresql://karturt:synthetic-only@localhost:5432/karturt_dev?sslmode=require",
      "postgresql://karturt:synthetic-only@remote.example:5432/karturt_dev",
      "postgresql://karturt:synthetic-only@ep-development.example.neon.tech:5432/karturt_dev?sslmode=require",
      stagingUrl,
      legacyStagingUrl,
      "postgresql://karturt:synthetic-only@production.example:5432/karturt_prod",
    ];

    for (const databaseUrl of invalidUrls) {
      expect(
        () => assertDevelopmentMigrationTarget(validEnvironment({ DATABASE_URL: databaseUrl })),
        String(databaseUrl),
      ).toThrow();
    }
  });
});

describe("development migration command flow", () => {
  function dependencies(environment: ProjectEnvironment) {
    const calls: string[] = [];
    const database = { offlineMock: true } as unknown as AppDatabase;
    return {
      calls,
      database,
      dependencies: {
        environment,
        projectDirectory: "synthetic-project",
        loadEnvironment: vi.fn(() => {
          calls.push("load-env");
        }),
        getDatabase: vi.fn(() => {
          calls.push("connect");
          return database;
        }),
        applyMigrations: vi.fn(async (receivedDatabase: unknown, options: { migrationsFolder: string }) => {
          expect(receivedDatabase).toBe(database);
          expect(options).toEqual({ migrationsFolder: "./drizzle" });
          calls.push("migrate");
        }),
        closeDatabase: vi.fn(async () => {
          calls.push("close");
        }),
      },
    };
  }

  it("validates again after env loading and never opens a client for an unsafe URL", async () => {
    const setup = dependencies(validEnvironment());
    setup.dependencies.loadEnvironment.mockImplementation(() => {
      setup.dependencies.environment.DATABASE_URL = stagingUrl;
      setup.calls.push("load-env");
    });

    await expect(runDevelopmentMigration(setup.dependencies)).rejects.toThrow();
    expect(setup.calls).toEqual(["load-env"]);
    expect(setup.dependencies.getDatabase).not.toHaveBeenCalled();
    expect(setup.dependencies.applyMigrations).not.toHaveBeenCalled();
    expect(setup.dependencies.closeDatabase).not.toHaveBeenCalled();
  });

  it("loads approved environment, validates locally, migrates, and closes in order", async () => {
    const setup = dependencies(validEnvironment());

    await runDevelopmentMigration(setup.dependencies);

    expect(setup.calls).toEqual(["load-env", "connect", "migrate", "close"]);
    expect(setup.dependencies.getDatabase).toHaveBeenCalledOnce();
    expect(setup.dependencies.applyMigrations).toHaveBeenCalledOnce();
    expect(setup.dependencies.closeDatabase).toHaveBeenCalledOnce();
  });

  it("does not load environment files or open a client without explicit parent labels", async () => {
    const setup = dependencies({ DATABASE_URL: localUrl });

    await expect(runDevelopmentMigration(setup.dependencies)).rejects.toThrow("explicit matching");
    expect(setup.dependencies.loadEnvironment).not.toHaveBeenCalled();
    expect(setup.dependencies.getDatabase).not.toHaveBeenCalled();
  });
});
