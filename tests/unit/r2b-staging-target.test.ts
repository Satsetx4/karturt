import { describe, expect, it } from "vitest";
import { stagingDatabaseTarget } from "@/db/staging-target";

describe("R2B SQL-created least privilege staging target", () => {
  it("pins only the canonical isolated Free staging target", () => {
    expect(stagingDatabaseTarget).toMatchObject({
      projectId: "flat-cloud-57657711",
      branchId: "br-sparkling-flower-azordm9k",
      endpointId: "ep-red-boat-azzqyf45",
      database: "karturt_staging",
      directHost: "ep-red-boat-azzqyf45.c-3.ap-southeast-1.aws.neon.tech",
    });
  });

  it("rejects reusing the legacy console-reset roles with neon_superuser membership", () => {
    expect(stagingDatabaseTarget.runtimeRole).toBe("karturt_stg_runtime_v2");
    expect(stagingDatabaseTarget.migrationRole).toBe("karturt_stg_migrator_v2");
    expect(stagingDatabaseTarget.runtimeRole).not.toBe("karturt_stg_runtime");
    expect(stagingDatabaseTarget.migrationRole).not.toBe("karturt_stg_migrator");
    expect(stagingDatabaseTarget.runtimeRole).not.toBe(stagingDatabaseTarget.migrationRole);
  });
});
