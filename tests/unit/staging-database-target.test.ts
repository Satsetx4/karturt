import { describe, expect, it } from "vitest";
import {
  assertDatabaseTargetForEnvironment,
  assertStagingMigrationTarget,
  getStagingMigrationTargetManifestFingerprint,
  STAGING_MIGRATION_TARGET_MANIFEST,
} from "../../src/lib/staging-database-target";

const directTarget =
  "postgresql://karturt_staging_owner:synthetic-password@ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech:5432/karturt_staging";

describe("staging migration target identity guard", () => {
  it("publishes the reviewed identity mapping and stable fingerprint", () => {
    expect(STAGING_MIGRATION_TARGET_MANIFEST).toMatchObject({
      organizationId: "org-ancient-boat-57106549",
      projectId: "falling-bread-33359184",
      projectName: "karturt-v1-staging-clean",
      branchName: "staging",
      branchId: "br-muddy-frost-azot13fb",
      region: "aws-ap-southeast-1",
      databaseName: "karturt_staging",
      databaseId: 702718,
      roleName: "karturt_staging_owner",
      endpointId: "ep-silent-butterfly-azrflu40",
      directHostname: "ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech",
      port: 5432,
    });
    expect(getStagingMigrationTargetManifestFingerprint()).toMatch(/^[a-f0-9]{64}$/);
    expect(getStagingMigrationTargetManifestFingerprint()).toBe(getStagingMigrationTargetManifestFingerprint());
  });

  it("accepts the exact direct target URL without opening a connection", () => {
    expect(() => assertStagingMigrationTarget(directTarget + "?sslmode=require")).not.toThrow();
    expect(() =>
      assertStagingMigrationTarget(
        directTarget +
          "?sslmode=verify-full&channel_binding=require&endpoint=ep-silent-butterfly-azrflu40",
      ),
    ).not.toThrow();
  });

  it("rejects incorrect host, pooler, alias, database, role, and port", () => {
    const invalidUrls = [
      directTarget.replace(
        "ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech",
        "wrong-endpoint.c-3.ap-southeast-1.aws.neon.tech",
      ) + "?sslmode=require",
      directTarget.replace(
        "ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech",
        "ep-silent-butterfly-azrflu40-pooler.c-3.ap-southeast-1.aws.neon.tech",
      ) + "?sslmode=require",
      directTarget.replace(
        "ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech",
        "staging-db-alias.internal",
      ) + "?sslmode=require",
      directTarget.replace("/karturt_staging", "/karturt_stage") + "?sslmode=require",
      directTarget.replace("karturt_staging_owner", "other_role") + "?sslmode=require",
      directTarget.replace(":5432/", ":5433/") + "?sslmode=require",
      "postgresql://karturt_staging_owner:synthetic-password@ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech/karturt_staging?sslmode=require",
      "postgresql://karturt_staging_owner:synthetic-password@ep-snowy-meadow-a10304d9-pooler.ap-southeast-1.aws.neon.tech/karturt_staging?sslmode=require",
    ];

    for (const databaseUrl of invalidUrls) {
      expect(() => assertStagingMigrationTarget(databaseUrl), databaseUrl).toThrow();
    }
  });

  it("rejects duplicate or unsupported query parameters and unsafe TLS settings", () => {
    const invalidUrls = [
      directTarget + "?sslmode=require&sslmode=verify-full",
      directTarget + "?sslmode=require&endpoint=wrong-endpoint",
      directTarget + "?sslmode=require&host=localhost",
      directTarget + "?sslmode=prefer",
      directTarget + "?sslmode=require&channel_binding=disable",
      directTarget + "?sslmode=require&endpoint=ep-silent-butterfly-azrflu40&endpoint=ep-silent-butterfly-azrflu40",
      directTarget + "?sslmode=require&",
      directTarget + "?&&sslmode=require",
      directTarget + "?",
      directTarget,
    ];

    for (const databaseUrl of invalidUrls) {
      expect(() => assertStagingMigrationTarget(databaseUrl), databaseUrl).toThrow();
    }
  });

  it("rejects malformed URLs and fragments without echoing credentials", () => {
    const passwordCanary = "synthetic-secret-canary";
    const invalidUrls = [
      "postgresql://",
      directTarget.replace("synthetic-password", passwordCanary) + "?sslmode=require#fragment",
      directTarget.replace("synthetic-password@", "synthetic-password@extra-host@") + "?sslmode=require",
      " " + directTarget + "?sslmode=require",
      directTarget.replace("synthetic-password", passwordCanary) + "?sslmode=require&options=%0A",
    ];

    for (const databaseUrl of invalidUrls) {
      let errorMessage = "";
      try {
        assertStagingMigrationTarget(databaseUrl);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      expect(errorMessage).toBeTruthy();
      expect(errorMessage).not.toContain(passwordCanary);
      expect(errorMessage).not.toContain("synthetic-password");
    }
  });
});

describe("runtime database target guard", () => {
  it("validates the new staging identity but keeps runtime access closed", () => {
    expect(() =>
      assertDatabaseTargetForEnvironment(directTarget + "?sslmode=require", "staging"),
    ).toThrow("runtime readiness and verified emptiness are not established");
  });

  it("denies both current and legacy staging endpoints outside staging labels", () => {
    const protectedHosts = [
      "ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech",
      "ep-silent-butterfly-azrflu40-pooler.c-3.ap-southeast-1.aws.neon.tech",
      "ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech",
      "ep-snowy-meadow-a10304d9-pooler.ap-southeast-1.aws.neon.tech",
    ];

    for (const environment of ["development", "production"] as const) {
      for (const hostname of protectedHosts) {
        const databaseUrl =
          "postgresql://karturt_staging_owner:synthetic-password@" +
          hostname +
          ":5432/karturt_staging?sslmode=require";
        expect(() => assertDatabaseTargetForEnvironment(databaseUrl, environment)).toThrow(
          "cannot be used unless APP_ENV and DATABASE_ENV both equal staging",
        );
      }
    }
  });

  it("always denies the legacy endpoint, including under staging labels", () => {
    const legacyUrl =
      "postgresql://karturt_staging_owner:synthetic-password@ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech:5432/karturt_staging?sslmode=require";
    expect(() => assertDatabaseTargetForEnvironment(legacyUrl, "staging")).toThrow(
      "legacy staging Neon endpoint",
    );
  });

  it("rejects unknown environment labels and preserves ordinary development and production behavior", () => {
    expect(() => assertDatabaseTargetForEnvironment(directTarget + "?sslmode=require", "preview"))
      .toThrow("DATABASE_ENV must be development, staging, production, or test");
    expect(() =>
      assertDatabaseTargetForEnvironment(
        "postgresql://karturt:synthetic-password@localhost:5432/karturt_dev",
        "development",
      ),
    ).not.toThrow();
    expect(() =>
      assertDatabaseTargetForEnvironment(
        "postgresql://app:synthetic-password@db.production.example:5432/karturt",
        "production",
      ),
    ).not.toThrow();
  });
});
