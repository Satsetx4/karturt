import { afterEach, describe, expect, it } from "vitest";
import { databaseUrlMatchesTarget, getPublicAppUrl, requireAuthEnvironment, requireDatabaseEnvironment } from "../../src/lib/env";

const variableNames = ["APP_ENV", "DATABASE_ENV", "DATABASE_URL", "BETTER_AUTH_SECRET", "NEXT_PUBLIC_APP_URL", "VERCEL_ENV"] as const;
const originalValues = new Map(variableNames.map((name) => [name, process.env[name]]));
const originalNodeEnvironment = process.env.NODE_ENV;

function setEnvironment(values: Partial<Record<(typeof variableNames)[number], string>>) {
  for (const name of variableNames) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function setNodeEnvironment(value: string | undefined) {
  if (value === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", value);
}

afterEach(() => {
  for (const name of variableNames) {
    const value = originalValues.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  setNodeEnvironment(originalNodeEnvironment);
});

describe("runtime environment guards", () => {
  it("requires explicit matching application and database labels", () => {
    setEnvironment({ APP_ENV: "development", DATABASE_ENV: "production", DATABASE_URL: "postgresql://local/db" });
    expect(() => requireDatabaseEnvironment()).toThrow("Environment mismatch");

    setEnvironment({ DATABASE_URL: "postgresql://local/db" });
    expect(() => requireDatabaseEnvironment()).toThrow("must both be set explicitly");
  });

  it("fails closed when staging has no approved database target", () => {
    setEnvironment({
      APP_ENV: "staging",
      DATABASE_ENV: "staging",
      DATABASE_URL: "postgresql://staging-user@ep-unverified.region.aws.neon.tech/karturt",
      VERCEL_ENV: "preview",
    });

    expect(() => requireDatabaseEnvironment()).toThrow("approved staging database target");
  });

  it("requires a Vercel Preview marker for staging database operations outside optimized production builds", () => {
    setEnvironment({
      APP_ENV: "staging",
      DATABASE_ENV: "staging",
      DATABASE_URL: "postgresql://staging-user@ep-unverified.region.aws.neon.tech/karturt?sslmode=verify-full",
    });
    setNodeEnvironment("development");

    expect(() => requireDatabaseEnvironment()).toThrow("Staging database operations require VERCEL_ENV=preview");
  });

  it("allows local development PostgreSQL but rejects unapproved remote development targets", () => {
    setEnvironment({
      APP_ENV: "development",
      DATABASE_ENV: "development",
      DATABASE_URL: "postgresql://karturt:local-development-only@localhost:5432/karturt_dev",
    });
    expect(requireDatabaseEnvironment().databaseUrl).toBe("postgresql://karturt:local-development-only@localhost:5432/karturt_dev");

    setEnvironment({
      APP_ENV: "development",
      DATABASE_ENV: "development",
      DATABASE_URL: "postgresql://karturt@127.0.0.1:5432/karturt_dev?sslmode=disable",
    });
    expect(requireDatabaseEnvironment().databaseUrl).toBe("postgresql://karturt@127.0.0.1:5432/karturt_dev?sslmode=disable");

    setEnvironment({
      APP_ENV: "development",
      DATABASE_ENV: "development",
      DATABASE_URL: "postgresql://dev-user@ep-unverified.region.aws.neon.tech/karturt?sslmode=require",
    });
    expect(() => requireDatabaseEnvironment()).toThrow("require a local PostgreSQL URL");
  });

  it("requires test database operations to use a local PostgreSQL URL", () => {
    setEnvironment({
      APP_ENV: "test",
      DATABASE_ENV: "test",
      DATABASE_URL: "postgresql://test-user@db.example.invalid/karturt_test",
    });

    expect(() => requireDatabaseEnvironment()).toThrow("Test database operations require a local PostgreSQL URL");
  });

  it("does not let Vercel Preview bypass the staging database label", () => {
    setEnvironment({
      APP_ENV: "development",
      DATABASE_ENV: "development",
      DATABASE_URL: "postgresql://dev-user@ep-unverified.region.aws.neon.tech/karturt",
      VERCEL_ENV: "preview",
    });

    expect(() => requireDatabaseEnvironment()).toThrow("Vercel Preview deployments require staging");
  });

  it("rejects staging database operations in a Vercel Development deployment", () => {
    setEnvironment({
      APP_ENV: "staging",
      DATABASE_ENV: "staging",
      DATABASE_URL: "postgresql://staging-user@ep-unverified.region.aws.neon.tech/karturt?sslmode=require",
      VERCEL_ENV: "development",
    });

    expect(() => requireDatabaseEnvironment()).toThrow("Staging database operations require VERCEL_ENV=preview");
  });

  it("rejects development labels in an optimized production build", () => {
    setEnvironment({
      APP_ENV: "development",
      DATABASE_ENV: "development",
      DATABASE_URL: "postgresql://dev-user@ep-unverified.region.aws.neon.tech/karturt",
      VERCEL_ENV: "development",
    });
    setNodeEnvironment("production");

    expect(() => requireDatabaseEnvironment()).toThrow("APP_ENV must not be development in an optimized production build");
  });

  it("requires a Vercel Preview marker for staging database operations in an optimized production build", () => {
    setEnvironment({
      APP_ENV: "staging",
      DATABASE_ENV: "staging",
      DATABASE_URL: "postgresql://staging-user@ep-unverified.region.aws.neon.tech/karturt?sslmode=require",
    });
    setNodeEnvironment("production");

    expect(() => requireDatabaseEnvironment()).toThrow(
      "Staging database operations require VERCEL_ENV=preview",
    );
  });

  it("requires production environment markers for production database operations", () => {
    setEnvironment({
      APP_ENV: "production",
      DATABASE_ENV: "production",
      DATABASE_URL: "postgresql://production-user@db.example.invalid/karturt",
      VERCEL_ENV: "production",
    });
    setNodeEnvironment("development");

    expect(() => requireDatabaseEnvironment()).toThrow("Production database operations require NODE_ENV=production and VERCEL_ENV=production");

    setNodeEnvironment("production");
    setEnvironment({
      APP_ENV: "production",
      DATABASE_ENV: "production",
      DATABASE_URL: "postgresql://production-user@db.example.invalid/karturt",
    });
    expect(() => requireDatabaseEnvironment()).toThrow("Production database operations require NODE_ENV=production and VERCEL_ENV=production");
  });

  it("fails closed when a production URL does not match an approved database target", () => {
    setEnvironment({
      APP_ENV: "production",
      DATABASE_ENV: "production",
      DATABASE_URL: "postgresql://prod-user@ep-unapproved.region.aws.neon.tech/karturt?sslmode=verify-full",
      VERCEL_ENV: "production",
    });
    setNodeEnvironment("production");

    expect(() => requireDatabaseEnvironment()).toThrow("approved production database target");
  });

  it("matches a staging target only with exact PostgreSQL identity and certificate verification", () => {
    const target = {
      hostname: "ep-approved.region.aws.neon.tech",
      port: 5432,
      databaseName: "karturt_staging",
      username: "karturt_staging_app",
    };

    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-approved.region.aws.neon.tech/karturt_staging?sslmode=verify-full",
      target,
    )).toBe(true);
    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-approved.region.aws.neon.tech/karturt_staging?sslmode=require",
      target,
    )).toBe(false);
    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-approved.region.aws.neon.tech/karturt_staging?sslmode=verify-ca",
      target,
    )).toBe(false);
    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-other.region.aws.neon.tech/karturt_staging?sslmode=verify-full",
      target,
    )).toBe(false);
    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-approved.region.aws.neon.tech/karturt?sslmode=verify-full",
      target,
    )).toBe(false);
    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-approved.region.aws.neon.tech:5433/karturt_staging?sslmode=verify-full",
      target,
    )).toBe(false);
    expect(databaseUrlMatchesTarget(
      "postgresql://other-role@ep-approved.region.aws.neon.tech/karturt_staging?sslmode=verify-full",
      target,
    )).toBe(false);
    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-approved.region.aws.neon.tech/karturt_staging?sslmode=disable",
      target,
    )).toBe(false);
    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-approved.region.aws.neon.tech/karturt_staging?sslmode=verify-full&host=ep-other.region.aws.neon.tech",
      target,
    )).toBe(false);
    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-approved.region.aws.neon.tech/karturt_staging?sslmode=verify-full&channel_binding=require",
      target,
    )).toBe(false);
    expect(databaseUrlMatchesTarget(
      "postgresql://karturt_staging_app@ep-approved.region.aws.neon.tech/karturt_staging?sslmode=verify-full#fragment",
      target,
    )).toBe(false);
  });

  it("requires explicit labels before generating deployment metadata", () => {
    setEnvironment({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
    expect(() => getPublicAppUrl()).toThrow("must both be set explicitly");
  });

  it("rejects localhost, missing, and non-origin URLs for staging and production auth", () => {
    const shared = { DATABASE_ENV: "production", BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-long-enough" };
    setEnvironment({ APP_ENV: "production", ...shared });
    expect(() => requireAuthEnvironment()).toThrow("NEXT_PUBLIC_APP_URL must be set");

    setEnvironment({ APP_ENV: "production", ...shared, NEXT_PUBLIC_APP_URL: "http://karturt.example" });
    expect(() => requireAuthEnvironment()).toThrow("HTTPS origin");

    setEnvironment({ APP_ENV: "staging", DATABASE_ENV: "staging", BETTER_AUTH_SECRET: shared.BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL: "https://preview.example/path" });
    expect(() => requireAuthEnvironment()).toThrow("HTTPS origin");
  });

  it("accepts a configured HTTPS origin and rejects the example secret placeholder", () => {
    setEnvironment({
      APP_ENV: "production",
      DATABASE_ENV: "production",
      DATABASE_URL: "postgresql://production.example/db",
      BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-long-enough",
      NEXT_PUBLIC_APP_URL: "https://karturt.example",
    });
    expect(requireAuthEnvironment().appUrl).toBe("https://karturt.example");

    setEnvironment({
      APP_ENV: "production",
      DATABASE_ENV: "production",
      BETTER_AUTH_SECRET: "replace-with-a-unique-random-secret-at-least-32-characters",
      NEXT_PUBLIC_APP_URL: "https://karturt.example",
    });
    expect(() => requireAuthEnvironment()).toThrow("BETTER_AUTH_SECRET");
  });
});
