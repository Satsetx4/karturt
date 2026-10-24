import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabasePoolConfig } from "@/db/pool";
import { stagingDatabaseTarget } from "@/db/staging-target";

describe("database pool security configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses verified PostgreSQL TLS for remote connections and ignores weaker URL SSL modes", () => {
    const config = createDatabasePoolConfig(
      "postgresql://runtime:test-only@db.example.test/karturt?sslmode=no-verify&application_name=karturt",
      "development",
      "runtime",
    );

    expect(config.ssl).toEqual(expect.objectContaining({
      rejectUnauthorized: true,
      servername: "db.example.test",
    }));
    expect(config.ssl).toHaveProperty("checkServerIdentity");
    expect(config.host).toBe("db.example.test");
    expect(config.application_name).toBe("karturt");
    expect(config).not.toHaveProperty("connectionString");
  });

  it("allows unencrypted loopback connections only outside staging and production", () => {
    const config = createDatabasePoolConfig(
      "postgresql://karturt:test-only@localhost:5432/karturt_ci",
      "test",
      "runtime",
    );

    expect(config.ssl).toBeUndefined();
  });

  it("binds staging runtime connections to the canonical target and runtime role", () => {
    const config = createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.runtimeRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}?sslmode=require`,
      "staging",
      "runtime",
    );

    expect(config.ssl).toEqual(expect.objectContaining({
      rejectUnauthorized: true,
      servername: stagingDatabaseTarget.directHost,
    }));
  });

  it("uses trusted Node.js roots and rejects custom CA paths for staging", () => {
    const systemRootsConfig = createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.runtimeRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}?sslrootcert=system`,
      "staging",
      "runtime",
    );
    expect(systemRootsConfig.ssl).toEqual(expect.objectContaining({ rejectUnauthorized: true }));
    expect(systemRootsConfig.ssl).toHaveProperty("ca", expect.any(Array));

    expect(() => createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.runtimeRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}?sslrootcert=%2Ftmp%2Fcustom-root.pem`,
      "staging",
      "runtime",
    )).toThrow("Staging TLS must use the Node.js trusted CA store; custom CA paths are not accepted.");
  });

  it("requires the direct canonical endpoint and migrator role for staging migrations", () => {
    const config = createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.migrationRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}?sslmode=require`,
      "staging",
      "migration",
    );

    expect(config.max).toBe(1);
    expect(config.port).toBe(5432);
    expect(config.ssl).toEqual(expect.objectContaining({
      rejectUnauthorized: true,
      servername: stagingDatabaseTarget.directHost,
    }));
  });

  it("rejects a channel binding mode the driver cannot strictly enforce", () => {
    expect(() => createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.migrationRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}?channel_binding=require`,
      "staging",
      "migration",
    )).toThrow("Strict PostgreSQL channel binding is unsupported; omit channel_binding or use prefer.");
  });

  it.each([
    `postgresql://karturt_staging_owner@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}`,
    `postgresql://${stagingDatabaseTarget.migrationRole}@${stagingDatabaseTarget.directHost}/another_database`,
    `postgresql://${stagingDatabaseTarget.runtimeRole}@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}`,
    `postgresql://${stagingDatabaseTarget.migrationRole}:test-only@${stagingDatabaseTarget.directHost}:6543/${stagingDatabaseTarget.database}`,
  ])("rejects a staging migration URL outside the approved identity and target", (url) => {
    expect(() => createDatabasePoolConfig(url, "staging", "migration")).toThrow(
      "Staging migration connection must target the approved database, endpoint, and role.",
    );
  });

  it("rejects the disabled Neon pooler endpoint for staging runtime", () => {
    expect(() => createDatabasePoolConfig(
      "postgresql://karturt_stg_runtime:test-only@ep-red-boat-azzqyf45-pooler.c-3.ap-southeast-1.aws.neon.tech/karturt_staging",
      "staging",
      "runtime",
    )).toThrow("Staging runtime connection must target the approved database, endpoint, and role.");
  });

  it("rejects plaintext loopback connections in staging and production", () => {
    expect(() => createDatabasePoolConfig(
      "postgresql://karturt:test-only@localhost:5432/karturt_staging",
      "staging",
      "runtime",
    )).toThrow("Staging and production database connections must use a remote TLS endpoint.");
  });

  it.each([
    "host=attacker.example",
    "dbname=another_database",
    "user=another_role",
    "ssl=no-verify",
    "uselibpqcompat=true",
  ])("rejects connection parameters that could override validated fields: %s", (parameter) => {
    expect(() => createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.migrationRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}?${parameter}`,
      "staging",
      "migration",
    )).toThrow(`Unsupported database connection parameter: ${parameter.split("=")[0]}.`);
  });

  it("rejects the canonical staging target when it is labeled as another environment", () => {
    expect(() => createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.runtimeRole}@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}`,
      "development",
      "runtime",
    )).toThrow("The canonical staging database cannot be used under another environment label.");
  });

  it("requires secure out-of-chat credentials for staging connections", () => {
    expect(() => createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.migrationRole}@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}`,
      "staging",
      "migration",
    )).toThrow("Staging migration connection must use credentials provisioned outside chat.");
  });

  it("fails closed when process-wide TLS certificate checks are disabled", () => {
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");

    expect(() => createDatabasePoolConfig(
      "postgresql://runtime:test-only@db.example.test/karturt",
      "development",
      "runtime",
    )).toThrow("Remote database TLS certificate verification is disabled for this process.");
  });

  it("pins host, port, TLS mode, and negotiation against ambient PostgreSQL environment variables", () => {
    vi.stubEnv("PGHOST", "attacker.example");
    vi.stubEnv("PGPORT", "6543");
    vi.stubEnv("PGSSLMODE", "no-verify");
    vi.stubEnv("PGSSLNEGOTIATION", "direct");

    const config = createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.runtimeRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}`,
      "staging",
      "runtime",
    );

    expect(config.host).toBe(stagingDatabaseTarget.directHost);
    expect(config.port).toBe(5432);
    expect(config.ssl).toEqual(expect.objectContaining({ rejectUnauthorized: true }));
    expect(config.sslnegotiation).toBe("postgres");
  });
});
