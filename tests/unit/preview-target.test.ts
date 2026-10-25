import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPreviewConnectionTarget, parsePreviewMigrationMode, parsePreviewTargetIdentity, previewDatabaseTarget } from "@/db/preview-target";

const previewTargetId = "flat-cloud-12345678/br-synthetic-123456/ep-synthetic-123456/karturt_preview";
const productionTargetId = "solid-cloud-87654321/br-prodtest-123456/ep-prodtest-123456/karturt_prod";
const directHost = "ep-synthetic-123456.c-3.ap-southeast-1.aws.neon.tech";

function setTargets(preview = previewTargetId, production = productionTargetId) {
  vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", preview);
  vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", production);
}

afterEach(() => vi.unstubAllEnvs());

describe("isolated Preview target", () => {
  it("requires a separate Neon project from the production target", () => {
    setTargets(previewTargetId, "flat-cloud-12345678/br-production-123456/ep-production-123456/karturt_prod");
    expect(() => parsePreviewTargetIdentity()).toThrow("separate Neon projects and endpoints");
  });

  it("rejects missing, malformed, and canonical staging target identities", () => {
    vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", "");
    vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", productionTargetId);
    expect(() => parsePreviewTargetIdentity()).toThrow("KARTURT_PREVIEW_TARGET_ID is required");

    setTargets("not-a-target", productionTargetId);
    expect(() => parsePreviewTargetIdentity()).toThrow("must identify one Neon project/branch/endpoint/database");

    setTargets("flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_preview", productionTargetId);
    expect(() => parsePreviewTargetIdentity()).toThrow("disputed canonical staging target");
  });

  it("binds runtime and migration URLs to distinct Preview roles and the declared direct endpoint", () => {
    setTargets();
    expect(parsePreviewTargetIdentity().database).toBe(previewDatabaseTarget.database);
    expect(assertPreviewConnectionTarget(
      `postgresql://${previewDatabaseTarget.runtimeRole}:test-only@${directHost}/karturt_preview?sslmode=require`,
      "runtime",
    ).endpointId).toBe("ep-synthetic-123456");
    expect(assertPreviewConnectionTarget(
      `postgresql://${previewDatabaseTarget.migrationRole}:test-only@${directHost}/karturt_preview?sslmode=verify-full`,
      "migration",
    ).endpointId).toBe("ep-synthetic-123456");
  });

  it.each([
    `postgresql://${previewDatabaseTarget.runtimeRole}:test-only@ep-production-123456.c-3.ap-southeast-1.aws.neon.tech/karturt_preview`,
    `postgresql://karturt_stg_runtime_v2:test-only@${directHost}/karturt_preview`,
    `postgresql://${previewDatabaseTarget.runtimeRole}:test-only@${directHost}/karturt_staging`,
    `postgresql://${previewDatabaseTarget.runtimeRole}:test-only@ep-synthetic-123456-pooler.c-3.ap-southeast-1.aws.neon.tech/karturt_preview`,
    `postgresql://${previewDatabaseTarget.runtimeRole}:test-only@${directHost}/karturt_preview?sslmode=no-verify`,
    `postgresql://${previewDatabaseTarget.runtimeRole}:test-only@${directHost}/karturt_preview?sslrootcert=%2Ftmp%2Fcustom-ca.pem`,
  ])("rejects Preview connection URLs outside the isolated target and verified TLS policy", (url) => {
    setTargets();
    expect(() => assertPreviewConnectionTarget(url, "runtime")).toThrow("does not match the isolated Neon target and role");
  });

  it("requires an explicit Preview migration command", () => {
    expect(parsePreviewMigrationMode(["--preview"])).toBe("apply");
    expect(parsePreviewMigrationMode(["--preview", "--plan"])).toBe("plan");
    expect(() => parsePreviewMigrationMode([])).toThrow("Preview migration accepts only");
    expect(() => parsePreviewMigrationMode(["--apply"])).toThrow("Preview migration accepts only");
  });
});
