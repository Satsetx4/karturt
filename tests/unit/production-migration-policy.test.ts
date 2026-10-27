import { describe, expect, it } from "vitest";
import { parseProductionMigrationAuthorization } from "@/db/production-migration-policy";
import { parseProductionTargetIdentity } from "@/db/production-target";

const releaseSha = "88a013a7153c0f5efd41e62d1f79ff63b8e0b0c0";
const environment = {
  KARTURT_PRODUCTION_TARGET_ID: "mute-meadow-51843316/br-winter-violet-a1az4w20/ep-curly-voice-a17q2gf5/karturt_production",
  KARTURT_PREVIEW_TARGET_ID: "rough-queen-62552713/br-fragrant-poetry-aousu14b/ep-green-smoke-aobgfksu/karturt_preview",
  KARTURT_PRODUCTION_MIGRATION_AUTHORIZED_SHA: releaseSha,
  KARTURT_PRODUCTION_MIGRATION_AUTHORIZED_TARGET: "mute-meadow-51843316/br-winter-violet-a1az4w20/ep-curly-voice-a17q2gf5/karturt_production",
  KARTURT_PRODUCTION_MIGRATION_AUTHORIZATION_REF: "https://github.com/Satsetx4/karturt/issues/110#issuecomment-1234",
  KARTURT_PRODUCTION_GO_REF: "https://github.com/Satsetx4/karturt/issues/107#issuecomment-5678",
  KARTURT_PRODUCTION_PREFLIGHT_REF: "https://github.com/Satsetx4/karturt/issues/110#issuecomment-9012",
  KARTURT_PRODUCTION_RECOVERY_REF: "https://github.com/Satsetx4/karturt/issues/107#issuecomment-3456",
};

describe("Production migration authorization", () => {
  it("binds preflight and apply to a full SHA, exact target, issue authorization, and owner GO", () => {
    const target = parseProductionTargetIdentity(environment);
    expect(parseProductionMigrationAuthorization(environment, "preflight", releaseSha, target)).toMatchObject({
      authorizedSha: releaseSha,
      authorizedTarget: environment.KARTURT_PRODUCTION_TARGET_ID,
      authorizationRef: environment.KARTURT_PRODUCTION_MIGRATION_AUTHORIZATION_REF,
      productionGoRef: environment.KARTURT_PRODUCTION_GO_REF,
    });
    expect(parseProductionMigrationAuthorization(environment, "apply", releaseSha, target)).toMatchObject({
      preflightRef: environment.KARTURT_PRODUCTION_PREFLIGHT_REF,
      recoveryRef: environment.KARTURT_PRODUCTION_RECOVERY_REF,
    });
  });

  it("rejects SHA and target drift", () => {
    const target = parseProductionTargetIdentity(environment);
    expect(() => parseProductionMigrationAuthorization(environment, "preflight", "b86c3721dbcc1b5b5db78d5f8fa939ad88053437", target))
      .toThrow("exact checked-out release SHA");
    expect(() => parseProductionMigrationAuthorization({
      ...environment,
      KARTURT_PRODUCTION_MIGRATION_AUTHORIZED_TARGET: "other-project/br-other-123456/ep-other-123456/karturt_production",
    }, "preflight", releaseSha, target)).toThrow("exact Neon project/branch/endpoint/database");
  });

  it("requires durable preflight and recovery references for apply", () => {
    const target = parseProductionTargetIdentity(environment);
    const missingPreflight: Record<string, string | undefined> = { ...environment };
    delete missingPreflight.KARTURT_PRODUCTION_PREFLIGHT_REF;
    expect(() => parseProductionMigrationAuthorization(missingPreflight, "apply", releaseSha, target))
      .toThrow("KARTURT_PRODUCTION_PREFLIGHT_REF is required");
    const missingRecovery: Record<string, string | undefined> = { ...environment };
    delete missingRecovery.KARTURT_PRODUCTION_RECOVERY_REF;
    expect(() => parseProductionMigrationAuthorization(missingRecovery, "apply", releaseSha, target))
      .toThrow("KARTURT_PRODUCTION_RECOVERY_REF is required");
  });

  it("accepts only a KartuRT issue-comment reference", () => {
    const target = parseProductionTargetIdentity(environment);
    expect(() => parseProductionMigrationAuthorization({
      ...environment,
      KARTURT_PRODUCTION_GO_REF: "https://example.com/approval",
    }, "preflight", releaseSha, target)).toThrow("GitHub issue comment reference for KartuRT");
  });
});
