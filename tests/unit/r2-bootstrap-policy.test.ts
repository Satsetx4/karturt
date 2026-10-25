import { describe, expect, it } from "vitest";
import { parseR2BootstrapInputs } from "@/db/r2-bootstrap-policy";

const releaseSha = "a".repeat(40);

function environment(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    APP_ENV: "staging",
    DATABASE_ENV: "staging",
    KARTURT_RELEASE_SHA: releaseSha,
    KARTURT_R2_FIXTURE_AUTHORIZED_SHA: releaseSha,
    KARTURT_R2_FIXTURE_AUTHORIZED_TARGET: "flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_staging",
    KARTURT_R2_FIXTURE_AUTHORIZED_OPERATION: "synthetic-fixture-create",
    KARTURT_R2_FIXTURE_AUTHORIZATION_REF: "#98/9999999999",
    KARTURT_R2_CI_HEAD_SHA: releaseSha,
    KARTURT_R2_CI_RUN_ID: "40121846664",
    KARTURT_R2_CI_ATTEMPT: "1",
    KARTURT_R2_MIGRATION_PASS_SHA: releaseSha,
    KARTURT_R2_MIGRATION_EVIDENCE_REF: "r2-migration-evidence",
    KARTURT_R2_ISOLATION_EVIDENCE_REF: "owner-isolation-readback",
    DATABASE_URL: "postgresql://karturt_stg_runtime:local-fixture-only@ep-red-boat-azzqyf45.c-3.ap-southeast-1.aws.neon.tech/karturt_staging",
    ...overrides,
  };
}

describe("RELEASE FIRST R2 bootstrap input policy", () => {
  it("accepts only a current-SHA authorized runtime connection to the canonical target", () => {
    const parsed = parseR2BootstrapInputs(environment(), releaseSha, "plan");
    expect(parsed).toEqual(expect.objectContaining({
      releaseSha,
      ciHeadSha: releaseSha,
      ciRunId: "40121846664",
      ciAttempt: "1",
      authorizationRef: "#98/9999999999",
      migrationEvidenceRef: "r2-migration-evidence",
      isolationEvidenceRef: "owner-isolation-readback",
      target: "flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_staging",
    }));
    expect(JSON.stringify(parsed)).not.toContain("local-fixture-only");
  });

  it("fails closed when the environment or either exact-SHA binding is stale", () => {
    expect(() => parseR2BootstrapInputs(environment({ APP_ENV: "production" }), releaseSha, "apply"))
      .toThrow("must both be staging");
    expect(() => parseR2BootstrapInputs(environment({ KARTURT_RELEASE_SHA: "0".repeat(40) }), releaseSha, "apply"))
      .toThrow("KARTURT_RELEASE_SHA must match current Git HEAD");
    expect(() => parseR2BootstrapInputs(environment({ KARTURT_R2_FIXTURE_AUTHORIZED_SHA: "0".repeat(40) }), releaseSha, "apply"))
      .toThrow("fixture authorization must match current Git HEAD");
    expect(() => parseR2BootstrapInputs(environment({ KARTURT_R2_MIGRATION_PASS_SHA: "0".repeat(40) }), releaseSha, "apply"))
      .toThrow("migration evidence must match current Git HEAD");
  });

  it("rejects wrong endpoints, databases, poolers, and non-runtime roles", () => {
    for (const databaseUrl of [
      "postgresql://karturt_stg_runtime:local-fixture-only@ep-other.c-3.ap-southeast-1.aws.neon.tech/karturt_staging",
      "postgresql://karturt_stg_runtime:local-fixture-only@ep-red-boat-azzqyf45-pooler.c-3.ap-southeast-1.aws.neon.tech/karturt_staging",
      "postgresql://karturt_stg_runtime:local-fixture-only@ep-red-boat-azzqyf45.c-3.ap-southeast-1.aws.neon.tech/other",
      "postgresql://karturt_stg_migrator:local-fixture-only@ep-red-boat-azzqyf45.c-3.ap-southeast-1.aws.neon.tech/karturt_staging",
    ]) {
      expect(() => parseR2BootstrapInputs(environment({ DATABASE_URL: databaseUrl }), releaseSha, "apply"))
        .toThrow("canonical direct staging runtime target");
    }
  });

  it("requires non-secret owner, migration, isolation, and exact-head CI references", () => {
    for (const key of [
      "KARTURT_R2_FIXTURE_AUTHORIZATION_REF",
      "KARTURT_R2_CI_RUN_ID",
      "KARTURT_R2_CI_ATTEMPT",
      "KARTURT_R2_MIGRATION_EVIDENCE_REF",
      "KARTURT_R2_ISOLATION_EVIDENCE_REF",
    ]) {
      expect(() => parseR2BootstrapInputs(environment({ [key]: "" }), releaseSha, "apply"))
        .toThrow(`${key} is required`);
    }
  });

  it("binds fixture authorization to the canonical target and create operation", () => {
    expect(() => parseR2BootstrapInputs(environment({
      KARTURT_R2_FIXTURE_AUTHORIZED_TARGET: "another-project/another-branch/another-endpoint/production",
    }), releaseSha, "apply")).toThrow("canonical staging target");
    expect(() => parseR2BootstrapInputs(environment({
      KARTURT_R2_FIXTURE_AUTHORIZED_OPERATION: "database-migrate",
    }), releaseSha, "apply")).toThrow("synthetic-fixture-create");
  });

  it("rejects CI evidence bound to a different source SHA", () => {
    expect(() => parseR2BootstrapInputs(environment({ KARTURT_R2_CI_HEAD_SHA: "b".repeat(40) }), releaseSha, "apply"))
      .toThrow("exact-head CI evidence");
  });

  it("does not treat plan mode as write authorization", () => {
    expect(parseR2BootstrapInputs(environment(), releaseSha, "plan").mode).toBe("plan");
  });
});
