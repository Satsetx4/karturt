import { describe, expect, it } from "vitest";
import {
  assertDatabaseTargetForEnvironment,
  assertStagingMigrationTarget,
  getStagingMigrationTargetManifestFingerprint,
  STAGING_MIGRATION_TARGET_MANIFEST,
  STAGING_ROOT_LINEAGE_ATTESTATION,
} from "../../src/lib/staging-database-target";

const directTarget =
  "postgresql://karturt_owner:synthetic-password@ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech:5432/karturt";
const secureStagingQuery = "?sslmode=verify-full&channel_binding=require";

describe("staging migration target identity guard", () => {
  it("publishes the reviewed identity mapping and stable fingerprint", () => {
    expect(STAGING_MIGRATION_TARGET_MANIFEST).toMatchObject({
      organizationId: "org-ancient-boat-57106549",
      projectId: "wild-darkness-00489132",
      projectName: "karturt-v1-staging-readiness-gate-v1",
      branchName: "staging-readiness-gate-v1",
      branchId: "br-spring-shadow-b37rykzl",
      lineageStatus: "ROOT_BY_NEW_PROJECT_CREATE_CONTRACT",
      region: "aws-ap-southeast-1",
      plan: "free",
      postgresMajor: 18,
      computeCU: 0.25,
      databaseName: "karturt",
      databaseId: 669644,
      roleName: "karturt_owner",
      endpointId: "ep-silent-haze-b3pcaa3t",
      directHostname: "ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech",
      passwordlessAccess: true,
      passwordlessAccessMeaning: "NOT_YET_IMPLEMENTED_UNRELIED_UPON",
      passwordlessAccessContractReference: "https://neon.com/api_spec/release/v2.json",
      passwordlessConnectDocumentationReference: "https://neon.com/docs/connect/passwordless-connect",
      port: 5432,
    });
    expect(getStagingMigrationTargetManifestFingerprint()).toMatch(/^[a-f0-9]{64}$/);
    expect(getStagingMigrationTargetManifestFingerprint()).toBe(getStagingMigrationTargetManifestFingerprint());
  });

  it("records bounded root-by-create-contract evidence separately from unknown catalog state", () => {
    expect(STAGING_ROOT_LINEAGE_ATTESTATION).toMatchObject({
      method: "ROOT_BY_NEW_PROJECT_CREATE_CONTRACT",
      scope: "project-root-lineage-only",
      projectId: "wild-darkness-00489132",
      projectCreatedAtUtc: "2026-10-21T09:23:42Z",
      createRequest: {
        requestSha256: null,
        requestSha256Status: "NOT_CAPTURED_TOOL_CALL_ONLY",
      },
      branch: {
        id: "br-spring-shadow-b37rykzl",
        name: "staging-readiness-gate-v1",
        parentIdReadback: "OMITTED_NOT_RETURNED",
        initSourceObserved: "parent-data",
        initSourceInterpretation: "ROOT_BRANCH_BY_NEW_PROJECT_CREATE_CONTRACT; FIELD_ALONE_IS_NOT_LINEAGE_PROOF",
      },
      rootStructureAssessment: "CONSISTENT_WITH_NEW_PROJECT_ROOT_CONTRACT",
      catalogState: "UNKNOWN",
      syntheticOnlyStatus: "UNKNOWN",
      providerCaptureAuthentication: "UNKNOWN",
    });
    expect("parentId" in STAGING_ROOT_LINEAGE_ATTESTATION.branch).toBe(false);
    expect(STAGING_MIGRATION_TARGET_MANIFEST.rootLineageAttestation).toBe(STAGING_ROOT_LINEAGE_ATTESTATION);
  });

  it("accepts the exact direct target URL without opening a connection", () => {
    expect(() => assertStagingMigrationTarget(directTarget + secureStagingQuery)).not.toThrow();
    expect(() =>
      assertStagingMigrationTarget(
        directTarget +
          secureStagingQuery + "&endpoint=ep-silent-haze-b3pcaa3t",
      ),
    ).not.toThrow();
  });

  it("rejects incorrect host, pooler, alias, database, role, and port", () => {
    const invalidUrls = [
      directTarget.replace(
        "ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech",
        "wrong-endpoint.c-4.ap-southeast-1.aws.neon.tech",
      ) + secureStagingQuery,
      directTarget.replace(
        "ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech",
        "ep-silent-haze-b3pcaa3t-pooler.c-4.ap-southeast-1.aws.neon.tech",
      ) + secureStagingQuery,
      directTarget.replace(
        "ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech",
        "staging-db-alias.internal",
      ) + secureStagingQuery,
      directTarget.replace("/karturt", "/karturt_stage") + secureStagingQuery,
      directTarget.replace("karturt_owner", "other_role") + secureStagingQuery,
      directTarget.replace(":5432/", ":5433/") + secureStagingQuery,
      directTarget.replace("ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech", "ep-silent-haze-b3pcaa3t.pg.neon.tech") + secureStagingQuery,
      "postgresql://neondb_owner:synthetic-password@ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech/neondb" + secureStagingQuery,
      "postgresql://neondb_owner:synthetic-password@ep-snowy-meadow-a10304d9-pooler.ap-southeast-1.aws.neon.tech/neondb" + secureStagingQuery,
      "postgresql://karturt_staging_owner:synthetic-password@ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech:5432/karturt_staging" + secureStagingQuery,
    ];

    for (const databaseUrl of invalidUrls) {
      expect(() => assertStagingMigrationTarget(databaseUrl), databaseUrl).toThrow();
    }
  });

  it("requires explicit channel binding in addition to verified TLS", () => {
    const invalidUrls = [
      directTarget + "?sslmode=verify-full",
      directTarget + "?sslmode=verify-full&channel_binding=prefer",
      directTarget + "?sslmode=verify-full&channel_binding=disable",
      directTarget + secureStagingQuery + "&channel_binding=require",
      directTarget + secureStagingQuery + "&channel_binding=disable",
    ];

    for (const databaseUrl of invalidUrls) {
      expect(() => assertStagingMigrationTarget(databaseUrl), databaseUrl).toThrow();
    }
  });

  it("rejects duplicate or unsupported query parameters and unsafe TLS settings", () => {
    const invalidUrls = [
      directTarget + "?sslmode=verify-full&channel_binding=require&sslmode=verify-full",
      directTarget + secureStagingQuery + "&endpoint=wrong-endpoint",
      directTarget + secureStagingQuery + "&host=localhost",
      directTarget + "?sslmode=prefer&channel_binding=require",
      directTarget + "?sslmode=verify-full&channel_binding=disable",
      directTarget + secureStagingQuery + "&endpoint=ep-silent-haze-b3pcaa3t&endpoint=ep-silent-haze-b3pcaa3t",
      directTarget + secureStagingQuery + "&",
      directTarget + "?&sslmode=verify-full&channel_binding=require",
      directTarget + "?",
      directTarget,
    ];

    for (const databaseUrl of invalidUrls) {
      expect(() => assertStagingMigrationTarget(databaseUrl), databaseUrl).toThrow();
    }

    expect(() =>
      assertDatabaseTargetForEnvironment(directTarget + "?sslmode=require&channel_binding=require", "staging"),
    ).toThrow("reviewed direct target identity manifest");
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
      assertDatabaseTargetForEnvironment(directTarget + secureStagingQuery, "staging"),
    ).toThrow("runtime readiness and verified emptiness are not established");
  });

  it("denies both current and legacy staging endpoints outside staging labels", () => {
    const protectedHosts = [
      "ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech",
      "ep-silent-haze-b3pcaa3t-pooler.c-4.ap-southeast-1.aws.neon.tech",
      "ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech",
      "ep-mute-firefly-azjcru4h-pooler.c-3.ap-southeast-1.aws.neon.tech",
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
      "protected legacy staging Neon endpoint",
    );
  });

  it("rejects the previous falling-bread project under staging labels", () => {
    const previousTarget =
      "postgresql://karturt_staging_owner:synthetic-password@ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech:5432/karturt_staging?sslmode=require";
    expect(() => assertStagingMigrationTarget(previousTarget)).toThrow();
    expect(() => assertDatabaseTargetForEnvironment(previousTarget, "staging")).toThrow(
      "protected legacy staging Neon endpoint for project falling-bread-33359184",
    );
  });

  it("keeps the former broad-star candidate blocked as a legacy staging target", () => {
    const legacyUrl =
      "postgresql://neondb_owner:synthetic-password@ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
    expect(() => assertStagingMigrationTarget(legacyUrl)).toThrow();
    expect(() => assertDatabaseTargetForEnvironment(legacyUrl, "staging")).toThrow(
      "protected legacy staging Neon endpoint for project broad-star-40451875",
    );
  });

  it("rejects the other protected legacy staging project under staging labels", () => {
    const legacyUrl =
      "postgresql://old:synthetic-password@ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech:5432/neondb?sslmode=verify-full";
    expect(() => assertStagingMigrationTarget(legacyUrl)).toThrow();
    expect(() => assertDatabaseTargetForEnvironment(legacyUrl, "staging")).toThrow(
      "protected legacy staging Neon endpoint for project wild-art-99835126",
    );
  });

  it("rejects unknown environment labels and preserves ordinary development and production behavior", () => {
    expect(() => assertDatabaseTargetForEnvironment(directTarget + "?sslmode=verify-full", "preview"))
      .toThrow("DATABASE_ENV must be development, staging, production, or test");
    expect(() => assertDatabaseTargetForEnvironment(
      directTarget.replace("ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech", "ep-silent-haze-b3pcaa3t.pg.neon.tech") + "?sslmode=verify-full",
      "staging",
    )).toThrow();
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
