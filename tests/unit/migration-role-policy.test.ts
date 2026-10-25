import { describe, expect, it } from "vitest";
import {
  hasNoStagingMigrationGrantOptions,
  hasRequiredMigrationPublicSchemaPrivileges,
  parseStagingMigrationAuthorization,
  parseStagingPreflightAuthorization,
} from "@/db/migration-role-policy";

const releaseSha = "a".repeat(40);

function migrationEnvironment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    KARTURT_R2_MIGRATION_AUTHORIZED_SHA: releaseSha,
    KARTURT_R2_MIGRATION_AUTHORIZED_TARGET: "flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_staging",
    KARTURT_R2_MIGRATION_AUTHORIZED_OPERATION: "official-migrations-0000-0013",
    KARTURT_R2_CI_HEAD_SHA: releaseSha,
    KARTURT_R2_CI_RUN_ID: "40123595717",
    KARTURT_R2_CI_ATTEMPT: "1",
    KARTURT_R2_MIGRATION_PREFLIGHT_EVIDENCE_REF: "#98/6388444456",
    KARTURT_R2_MIGRATION_ISOLATION_EVIDENCE_REF: "#98/6388444455",
    KARTURT_R2_MIGRATION_AUTHORIZATION_REF: "#98/6388444457",
    ...overrides,
  };
}

function preflightEnvironment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    KARTURT_R2_PREFLIGHT_AUTHORIZED_SHA: releaseSha,
    KARTURT_R2_PREFLIGHT_AUTHORIZED_TARGET: "flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_staging",
    KARTURT_R2_PREFLIGHT_AUTHORIZED_OPERATION: "authenticated-tls-role-preflight",
    KARTURT_R2_CI_HEAD_SHA: releaseSha,
    KARTURT_R2_CI_RUN_ID: "40123595717",
    KARTURT_R2_CI_ATTEMPT: "1",
    KARTURT_R2_PREFLIGHT_AUTHORIZATION_REF: "#98/6388444457",
    KARTURT_R2_ISOLATION_EVIDENCE_REF: "#98/6388444455",
    ...overrides,
  };
}

describe("staging migration authorization", () => {
  it("requires explicit owner authorization and exact-head CI evidence", () => {
    expect(parseStagingMigrationAuthorization(migrationEnvironment(), releaseSha)).toEqual({
      releaseSha,
      ciRunId: "40123595717",
      ciAttempt: "1",
      preflightEvidenceRef: "#98/6388444456",
      isolationEvidenceRef: "#98/6388444455",
      authorizationRef: "#98/6388444457",
      authorizedTarget: "flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_staging",
      authorizedOperation: "official-migrations-0000-0013",
    });
  });

  it("rejects stale SHA, missing authorization, and malformed CI references", () => {
    expect(() => parseStagingMigrationAuthorization(
      migrationEnvironment({ KARTURT_R2_MIGRATION_AUTHORIZED_SHA: "b".repeat(40) }), releaseSha,
    )).toThrow("must match the checked-out release SHA");
    expect(() => parseStagingMigrationAuthorization(
      migrationEnvironment({ KARTURT_R2_CI_HEAD_SHA: "b".repeat(40) }), releaseSha,
    )).toThrow("exact-head CI evidence");
    expect(() => parseStagingMigrationAuthorization(
      migrationEnvironment({ KARTURT_R2_MIGRATION_AUTHORIZATION_REF: "password=secret" }), releaseSha,
    )).toThrow("short, non-secret reference");
    expect(() => parseStagingMigrationAuthorization(
      migrationEnvironment({ KARTURT_R2_MIGRATION_PREFLIGHT_EVIDENCE_REF: "not-an-issue-ref" }), releaseSha,
    )).toThrow("preflight evidence reference");
    expect(() => parseStagingMigrationAuthorization(
      migrationEnvironment({ KARTURT_R2_MIGRATION_ISOLATION_EVIDENCE_REF: "not-an-issue-ref" }), releaseSha,
    )).toThrow("isolation evidence reference");
    expect(() => parseStagingMigrationAuthorization(
      migrationEnvironment({ KARTURT_R2_CI_RUN_ID: "run-1" }), releaseSha,
    )).toThrow("numeric exact-head CI");
  });

  it("binds migration authorization to the canonical target and official migration range", () => {
    expect(() => parseStagingMigrationAuthorization(
      migrationEnvironment({ KARTURT_R2_MIGRATION_AUTHORIZED_TARGET: "production" }), releaseSha,
    )).toThrow("canonical staging target");
    expect(() => parseStagingMigrationAuthorization(
      migrationEnvironment({ KARTURT_R2_MIGRATION_AUTHORIZED_OPERATION: "synthetic-fixture-create" }), releaseSha,
    )).toThrow("official-migrations-0000-0013");
  });
});

describe("staging preflight authorization", () => {
  it("requires an exact SHA, target, operation, CI run, owner GO, and isolation reference", () => {
    expect(parseStagingPreflightAuthorization(preflightEnvironment(), releaseSha)).toEqual({
      releaseSha,
      ciRunId: "40123595717",
      ciAttempt: "1",
      authorizationRef: "#98/6388444457",
      isolationEvidenceRef: "#98/6388444455",
      authorizedTarget: "flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_staging",
      authorizedOperation: "authenticated-tls-role-preflight",
    });
  });

  it("rejects wrong operation, stale SHA, and non-issue references", () => {
    expect(() => parseStagingPreflightAuthorization(
      preflightEnvironment({ KARTURT_R2_PREFLIGHT_AUTHORIZED_SHA: "b".repeat(40) }), releaseSha,
    )).toThrow("full checked-out release SHA");
    expect(() => parseStagingPreflightAuthorization(
      preflightEnvironment({ KARTURT_R2_PREFLIGHT_AUTHORIZED_OPERATION: "official-migrations-0000-0013" }), releaseSha,
    )).toThrow("authenticated-tls-role-preflight");
    expect(() => parseStagingPreflightAuthorization(
      preflightEnvironment({ KARTURT_R2_PREFLIGHT_AUTHORIZATION_REF: "password=secret" }), releaseSha,
    )).toThrow("issue #98 authorization and isolation evidence references");
  });
});

describe("staging migration role public-schema access", () => {
  it("requires both effective USAGE and CREATE", () => {
    expect(hasRequiredMigrationPublicSchemaPrivileges({ usage: true, create: true })).toBe(true);
    expect(hasRequiredMigrationPublicSchemaPrivileges({ usage: true, create: false })).toBe(false);
    expect(hasRequiredMigrationPublicSchemaPrivileges({ usage: false, create: true })).toBe(false);
    expect(hasRequiredMigrationPublicSchemaPrivileges({ usage: false, create: false })).toBe(false);
  });
});

describe("staging migration role grant options", () => {
  it("rejects any grant option on the target database or migration schemas", () => {
    expect(hasNoStagingMigrationGrantOptions(0)).toBe(true);
    expect(hasNoStagingMigrationGrantOptions(1)).toBe(false);
    expect(hasNoStagingMigrationGrantOptions(-1)).toBe(false);
  });
});
