import { afterEach, describe, expect, it } from "vitest";
import { getPublicAppUrl, requireAuthEnvironment, requireDatabaseEnvironment, requireLocalDevelopmentBootstrapDatabaseEnvironment } from "../../src/lib/env";
import { assertBootstrapDatabaseTarget } from "../../src/lib/staging-database-target";

const variableNames = ["APP_ENV", "DATABASE_ENV", "DATABASE_URL", "BETTER_AUTH_SECRET", "NEXT_PUBLIC_APP_URL"] as const;
const originalValues = new Map(variableNames.map((name) => [name, process.env[name]]));

function setEnvironment(values: Partial<Record<(typeof variableNames)[number], string>>) {
  for (const name of variableNames) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

afterEach(() => {
  for (const name of variableNames) {
    const value = originalValues.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("runtime environment guards", () => {
  it("requires explicit matching application and database labels", () => {
    setEnvironment({ APP_ENV: "development", DATABASE_ENV: "production", DATABASE_URL: "postgresql://local/db" });
    expect(() => requireDatabaseEnvironment()).toThrow("Environment mismatch");

    setEnvironment({
      APP_ENV: "development",
      DATABASE_ENV: "staging",
      DATABASE_URL:
        "postgresql://karturt_staging_owner:synthetic-password@ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech:5432/karturt_staging?sslmode=require",
    });
    expect(() => requireDatabaseEnvironment()).toThrow("Environment mismatch");

    setEnvironment({ DATABASE_URL: "postgresql://local/db" });
    expect(() => requireDatabaseEnvironment()).toThrow("must both be set explicitly");
  });

  it("fails closed on malformed PostgreSQL URLs before a database client can be created", () => {
    setEnvironment({ APP_ENV: "development", DATABASE_ENV: "development", DATABASE_URL: "postgresql://" });
    expect(() => requireDatabaseEnvironment()).toThrow("unambiguous PostgreSQL connection URL");
  });

  it("allows only the documented local bootstrap target and URL-free PGlite tests", () => {
    const localDatabaseUrl = "postgresql://karturt:synthetic-local-password@localhost:5432/karturt_dev";
    expect(assertBootstrapDatabaseTarget(localDatabaseUrl, "development", "development"))
      .toBe("local-development-postgres");
    expect(assertBootstrapDatabaseTarget(undefined, "test", "test")).toBe("pglite");
    expect(() => assertBootstrapDatabaseTarget("postgresql://synthetic:synthetic@test.invalid:5432/karturt", "test", "test"))
      .toThrow("must use in-memory PGlite");

    setEnvironment({
      APP_ENV: "test",
      DATABASE_ENV: "test",
      DATABASE_URL: "postgresql://synthetic:synthetic@test.invalid:5432/karturt",
    });
    expect(() => requireDatabaseEnvironment()).toThrow("disabled in test");

    setEnvironment({ APP_ENV: "development", DATABASE_ENV: "development", DATABASE_URL: localDatabaseUrl });
    expect(requireLocalDevelopmentBootstrapDatabaseEnvironment().databaseUrl).toBe(localDatabaseUrl);

    setEnvironment({
      APP_ENV: "development",
      DATABASE_ENV: "development",
      DATABASE_URL: "postgresql://synthetic:synthetic@ep-quiet-cake-azrhjiyh.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
    });
    expect(() => requireLocalDevelopmentBootstrapDatabaseEnvironment())
      .toThrow("must match the documented local development target exactly");
  });

  it("rejects host, port, database, user, protocol, and URL spoofing in bootstrap targets", () => {
    const invalidUrls = [
      "postgres://karturt:synthetic-local-password@localhost:5432/karturt_dev",
      "postgresql://other:synthetic-local-password@localhost:5432/karturt_dev",
      "postgresql://karturt:synthetic-local-password@localhost.evil:5432/karturt_dev",
      "postgresql://karturt:synthetic-local-password@127.0.0.1:5432/karturt_dev",
      "postgresql://karturt:synthetic-local-password@localhost:5433/karturt_dev",
      "postgresql://karturt:synthetic-local-password@localhost:5432/karturt_stage",
      "postgresql://karturt:synthetic-local-password@localhost:5432/karturt_dev/extra",
      "postgresql://karturt:synthetic-local-password@localhost:5432/karturt_dev?host=localhost",
      "postgresql://karturt:synthetic-local-password@localhost:5432/karturt_dev?sslmode=require",
      "postgresql://karturt:synthetic-local-password@localhost:5432/karturt_dev#fragment",
      "postgresql://karturt:synthetic-local-password@localhost:5432/karturt%2Fdev",
      "postgresql://karturt:synthetic-local-password@ep-raspy-meadow-b3ppifq6.c-4.ap-southeast-1.aws.neon.tech/karturt_stage",
      "postgresql://karturt:synthetic-local-password@production.example:5432/karturt",
      "postgresql://:synthetic-local-password@localhost:5432/karturt_dev",
      "postgresql://karturt@localhost:5432/karturt_dev",
    ];
    for (const databaseUrl of invalidUrls) {
      expect(() => assertBootstrapDatabaseTarget(databaseUrl, "development", "development"), databaseUrl)
        .toThrow();
    }
  });

  it("rejects production, staging, and mismatched labels for the bootstrap path", () => {
    const url = "postgresql://karturt:synthetic-local-password@localhost:5432/karturt_dev";
    for (const environmentName of ["production", "staging"] as const) {
      expect(() => assertBootstrapDatabaseTarget(url, environmentName, environmentName))
        .toThrow("disabled for production and staging");
    }
    expect(() => assertBootstrapDatabaseTarget(url, "development", "staging"))
      .toThrow("matching application and database environment labels");

    setEnvironment({ APP_ENV: "production", DATABASE_ENV: "production", DATABASE_URL: url });
    expect(() => requireLocalDevelopmentBootstrapDatabaseEnvironment()).toThrow("limited to matching development labels");
  });

  it("limits RT bootstrap commands to the documented loopback development database", () => {
    const localDatabaseUrl = "postgresql://karturt:synthetic-local-password@localhost:5432/karturt_dev";
    setEnvironment({ APP_ENV: "development", DATABASE_ENV: "development", DATABASE_URL: localDatabaseUrl });
    expect(requireLocalDevelopmentBootstrapDatabaseEnvironment().databaseUrl).toBe(localDatabaseUrl);

    const rejectedTargets = [
      {
        APP_ENV: "staging",
        DATABASE_ENV: "staging",
        DATABASE_URL: "postgresql://synthetic:synthetic@ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech/karturt_staging",
      },
      {
        APP_ENV: "production",
        DATABASE_ENV: "production",
        DATABASE_URL: "postgresql://synthetic:synthetic@production.example:5432/karturt",
      },
      { APP_ENV: "test", DATABASE_ENV: "test", DATABASE_URL: undefined },
    ] as const;

    for (const target of rejectedTargets) {
      setEnvironment(target);
      expect(() => requireLocalDevelopmentBootstrapDatabaseEnvironment()).toThrow(
        "limited to matching development labels",
      );
    }
  });

  it("matches the exact staging target and keeps access blocked while isolation is unverified", () => {
    const approvedTarget = "postgresql://karturt_staging_owner:synthetic-password@ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech:5432/karturt_staging?sslmode=require";
    setEnvironment({ APP_ENV: "staging", DATABASE_ENV: "staging", DATABASE_URL: approvedTarget });
    expect(() => requireDatabaseEnvironment()).toThrow("runtime readiness and verified emptiness are not established");
  });

  it("rejects legacy, mismatched, and unrelated staging target identities", () => {
    const rejectedTargets = [
      "postgresql://karturt_staging_owner:synthetic-password@ep-raspy-meadow-b3ppifq6.c-4.ap-southeast-1.aws.neon.tech/karturt_stage?sslmode=require",
      "postgresql://karturt_staging_owner:synthetic-password@ep-raspy-meadow-b3ppifq6.c-4.ap-southeast-1.aws.neon.tech/karturt_staging?sslmode=require",
      "postgresql://karturt_staging_owner:synthetic-password@ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech/karturt_stage?sslmode=require",
      "postgresql://karturt_staging_owner:synthetic-password@wrong-endpoint.ap-southeast-1.aws.neon.tech/karturt_staging?sslmode=require",
      "postgresql://karturt_staging_owner:synthetic-password@ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech/karturt_staging?sslmode=require&endpoint=ep-raspy-meadow-b3ppifq6",
      "postgresql://synthetic-user:synthetic-password@ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech/karturt_staging?sslmode=require",
    ];

    for (const databaseUrl of rejectedTargets) {
      setEnvironment({ APP_ENV: "staging", DATABASE_ENV: "staging", DATABASE_URL: databaseUrl });
      expect(() => requireDatabaseEnvironment()).toThrow();
    }

    setEnvironment({
      APP_ENV: "staging",
      DATABASE_ENV: "staging",
      DATABASE_URL: rejectedTargets[0],
    });
    let errorMessage = "";
    try {
      requireDatabaseEnvironment();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    expect(errorMessage).toContain("reviewed direct target identity manifest");
    expect(errorMessage).toContain("falling-bread-33359184");
    expect(errorMessage).toContain("br-muddy-frost-azot13fb");
    expect(errorMessage).toContain("karturt_staging / 702718");
    expect(errorMessage).toContain("ep-silent-butterfly-azrflu40");
    expect(errorMessage).not.toContain("synthetic-password");
  });

  it("rejects the approved staging endpoint under non-staging labels before database client creation", () => {
    const stagingHosts = [
      "ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech",
      "ep-silent-butterfly-azrflu40-pooler.c-3.ap-southeast-1.aws.neon.tech",
      "ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech",
      "ep-snowy-meadow-a10304d9-pooler.ap-southeast-1.aws.neon.tech",
    ];

    for (const environmentName of ["development", "production"] as const) {
      for (const hostname of stagingHosts) {
        setEnvironment({
          APP_ENV: environmentName,
          DATABASE_ENV: environmentName,
          DATABASE_URL: `postgresql://synthetic-user:synthetic-password@${hostname}/karturt_staging`,
        });
        expect(() => requireDatabaseEnvironment()).toThrow("cannot be used unless APP_ENV and DATABASE_ENV both equal staging");
      }
    }
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
