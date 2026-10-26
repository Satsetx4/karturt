import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabasePoolConfig, isVerifiedNodeTlsSocket } from "@/db/pool";
import { stagingDatabaseTarget } from "@/db/staging-target";
import { previewDatabaseTarget } from "@/db/preview-target";
import { productionDatabaseTarget } from "@/db/production-target";

describe("PostgreSQL TLS socket evidence", () => {
  it.each(["TLSv1.2", "TLSv1.3"])("accepts a certificate-authorized encrypted %s socket", (protocol) => {
    expect(isVerifiedNodeTlsSocket({
      encrypted: true,
      authorized: true,
      authorizationError: undefined,
      getProtocol: (): string | null => protocol,
    })).toBe(true);
  });

  it.each([
    ["unencrypted", { encrypted: false, authorized: true, getProtocol: (): string | null => "TLSv1.3" }],
    ["unverified", { encrypted: true, authorized: false, authorizationError: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", getProtocol: (): string | null => "TLSv1.3" }],
    ["authorization error present", { encrypted: true, authorized: true, authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID", getProtocol: (): string | null => "TLSv1.3" }],
    ["old protocol", { encrypted: true, authorized: true, getProtocol: (): string | null => "TLSv1.1" }],
    ["incomplete handshake", { encrypted: true, authorized: true, getProtocol: (): string | null => null }],
  ])("rejects %s socket evidence", (_case, evidence) => {
    expect(isVerifiedNodeTlsSocket(evidence)).toBe(false);
  });
});

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

  it("binds Preview connections to the declared isolated Neon target with full TLS verification", () => {
    vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", "flat-cloud-12345678/br-synthetic-123456/ep-synthetic-123456/karturt_preview");
    vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", "solid-cloud-87654321/br-prodtest-123456/ep-prodtest-123456/karturt_prod");
    const host = "ep-synthetic-123456.c-3.ap-southeast-1.aws.neon.tech";
    const config = createDatabasePoolConfig(
      `postgresql://${previewDatabaseTarget.runtimeRole}:test-only@${host}/karturt_preview?sslmode=require`,
      "preview",
      "runtime",
    );

    expect(config.ssl).toEqual(expect.objectContaining({ rejectUnauthorized: true, servername: host, ca: expect.any(Array) }));
    expect(config.ssl).toHaveProperty("checkServerIdentity");
    expect(config.host).toBe(host);
  });

  it("binds Production connections to the declared direct Neon target and verify-full TLS", () => {
    vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", "misty-king-95262980/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview");
    vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", "mute-meadow-51843316/br-winter-violet-a1az4w20/ep-curly-voice-a17q2gf5/karturt_production");
    const host = "ep-curly-voice-a17q2gf5.ap-southeast-1.aws.neon.tech";
    const config = createDatabasePoolConfig(
      `postgresql://${productionDatabaseTarget.runtimeRole}:test-only@${host}/karturt_production?sslmode=verify-full&sslrootcert=system`,
      "production",
      "runtime",
    );

    expect(config.host).toBe(host);
    expect(config.ssl).toEqual(expect.objectContaining({ rejectUnauthorized: true, servername: host, ca: expect.any(Array) }));
    expect(config.ssl).toHaveProperty("checkServerIdentity");
  });

  it("rejects Production connections outside the target, role, or verify-full TLS contract", () => {
    vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", "misty-king-95262980/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview");
    vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", "mute-meadow-51843316/br-winter-violet-a1az4w20/ep-curly-voice-a17q2gf5/karturt_production");
    const host = "ep-curly-voice-a17q2gf5.ap-southeast-1.aws.neon.tech";

    expect(() => createDatabasePoolConfig(
      `postgresql://${productionDatabaseTarget.runtimeRole}:test-only@ep-other-123456.ap-southeast-1.aws.neon.tech/karturt_production?sslmode=verify-full&sslrootcert=system`,
      "production",
      "runtime",
    )).toThrow("Production runtime connection does not match the isolated Neon target");
    expect(() => createDatabasePoolConfig(
      `postgresql://${productionDatabaseTarget.migrationRole}:test-only@${host}/karturt_production?sslmode=verify-full&sslrootcert=system`,
      "production",
      "runtime",
    )).toThrow("Production runtime connection does not match the isolated Neon target");
    expect(() => createDatabasePoolConfig(
      `postgresql://${productionDatabaseTarget.runtimeRole}:test-only@${host}/karturt_production?sslmode=require&sslrootcert=system`,
      "production",
      "runtime",
    )).toThrow("Production runtime connection does not match the isolated Neon target");
  });

  it("rejects staging and production targets under the Preview label", () => {
    vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", "flat-cloud-12345678/br-synthetic-123456/ep-synthetic-123456/karturt_preview");
    vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", "solid-cloud-87654321/br-prodtest-123456/ep-prodtest-123456/karturt_prod");
    expect(() => createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.runtimeRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}`,
      "preview",
      "runtime",
    )).toThrow("canonical staging database cannot be used");
    expect(() => createDatabasePoolConfig(
      `postgresql://${previewDatabaseTarget.runtimeRole}:test-only@ep-prodtest-123456.c-3.ap-southeast-1.aws.neon.tech/karturt_preview`,
      "preview",
      "runtime",
    )).toThrow("does not match the isolated Neon target and role");
  });

  it("binds a bounded R3 worker application name to one staging runtime connection", () => {
    const config = createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.runtimeRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}`,
      "staging",
      "runtime",
      1,
      "krt-r3-r3run20261025-R3-RACE-VERIFY-a",
    );

    expect(config.application_name).toBe("krt-r3-r3run20261025-R3-RACE-VERIFY-a");
    expect(config.max).toBe(1);
    expect(() => createDatabasePoolConfig(
      `postgresql://${stagingDatabaseTarget.migrationRole}:test-only@${stagingDatabaseTarget.directHost}/${stagingDatabaseTarget.database}`,
      "staging",
      "migration",
      1,
      "krt-r3-r3run20261025-R3-RACE-VERIFY-a",
    )).toThrow("R3 application name is allowed only for a bounded one-connection staging or approved Preview runtime worker.");
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
