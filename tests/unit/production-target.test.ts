import { describe, expect, it } from "vitest";
import {
  assertProductionConnectionTarget,
  parseProductionTargetIdentity,
  productionDatabaseTarget,
} from "@/db/production-target";

const productionTarget = "mute-meadow-51843316/br-winter-violet-a1az4w20/ep-curly-voice-a17q2gf5/karturt_production";
const previewTarget = "misty-king-95262980/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview";
const environment = {
  KARTURT_PRODUCTION_TARGET_ID: productionTarget,
  KARTURT_PREVIEW_TARGET_ID: previewTarget,
};
const host = "ep-curly-voice-a17q2gf5.ap-southeast-1.aws.neon.tech";

describe("Production target identity", () => {
  it("requires a separate Neon project, branch, endpoint, and fixed production database", () => {
    expect(parseProductionTargetIdentity(environment)).toEqual({
      projectId: "mute-meadow-51843316",
      branchId: "br-winter-violet-a1az4w20",
      endpointId: "ep-curly-voice-a17q2gf5",
      database: productionDatabaseTarget.database,
    });
    expect(() => parseProductionTargetIdentity({ ...environment, KARTURT_PRODUCTION_TARGET_ID: "" }))
      .toThrow("KARTURT_PRODUCTION_TARGET_ID is required");
    expect(() => parseProductionTargetIdentity({
      ...environment,
      KARTURT_PRODUCTION_TARGET_ID: "other-project/br-other-123456/ep-other-123456/karturt_preview",
    })).toThrow("Production target database must be karturt_production");
  });

  it("rejects Preview or canonical staging identities", () => {
    expect(() => parseProductionTargetIdentity({
      ...environment,
      KARTURT_PRODUCTION_TARGET_ID: "misty-king-95262980/br-other-123456/ep-other-123456/karturt_production",
    })).toThrow("separate Neon projects, branches, and endpoints");
    expect(() => parseProductionTargetIdentity({
      ...environment,
      KARTURT_PRODUCTION_TARGET_ID: "flat-cloud-57657711/br-other-123456/ep-other-123456/karturt_production",
    })).toThrow("disputed canonical staging target");
  });

  it("binds runtime and migrator URLs to the exact direct endpoint and verify-full TLS", () => {
    for (const purpose of ["runtime", "migration"] as const) {
      const role = purpose === "runtime" ? productionDatabaseTarget.runtimeRole : productionDatabaseTarget.migrationRole;
      const url = "postgresql://" + role + ":synthetic-only@" + host + "/karturt_production?sslmode=verify-full&sslrootcert=system";
      expect(assertProductionConnectionTarget(url, purpose, environment)).toEqual(
        parseProductionTargetIdentity(environment),
      );
    }
  });

  it.each([
    "postgresql://karturt_production_runtime:test-only@ep-other-123456.ap-southeast-1.aws.neon.tech/karturt_production?sslmode=verify-full&sslrootcert=system",
    "postgresql://karturt_production_runtime:test-only@ep-curly-voice-a17q2gf5-pooler.ap-southeast-1.aws.neon.tech/karturt_production?sslmode=verify-full&sslrootcert=system",
    "postgresql://karturt_production_migrator:test-only@" + host + "/karturt_production?sslmode=verify-full&sslrootcert=system",
    "postgresql://karturt_production_runtime:test-only@" + host + "/karturt_preview?sslmode=verify-full&sslrootcert=system",
    "postgresql://karturt_production_runtime:test-only@" + host + "/karturt_production?sslmode=require&sslrootcert=system",
    "postgresql://karturt_production_runtime:test-only@" + host + "/karturt_production?sslmode=verify-full",
  ])("rejects a connection that does not match the Production target and TLS policy", (url) => {
    expect(() => assertProductionConnectionTarget(url, "runtime", environment)).toThrow(
      "Production runtime connection does not match the isolated Neon target, role, and verify-full TLS policy.",
    );
  });
});
