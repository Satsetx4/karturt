import { describe, expect, it } from "vitest";
import {
  F3_UAT_SCENARIOS,
  renderF3UatPlan,
  resolveF3UatCommand,
} from "../../src/lib/fast-track-f3-uat";

describe("Fast Track F3 rehearsal command", () => {
  it("returns a static offline plan without inspecting environment values", () => {
    const result = resolveF3UatCommand(["--plan-only"], {
      APP_ENV: "production",
      DATABASE_ENV: "production",
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://must-not-be-printed.invalid/secret-name",
    });

    expect(result.kind).toBe("plan");
    if (result.kind !== "plan") throw new Error("Expected an offline plan.");
    expect(result.scenarios).toEqual(F3_UAT_SCENARIOS);
    expect(new Set(result.scenarios.map(({ id }) => id)).size).toBe(result.scenarios.length);
    expect(renderF3UatPlan(result.scenarios)).toContain("offline rehearsal only");
    expect(renderF3UatPlan(result.scenarios)).not.toContain("must-not-be-printed");
  });

  it("blocks a production-shaped target before any live mode can be selected", () => {
    expect(resolveF3UatCommand(["--execute"], {
      APP_ENV: "production",
      DATABASE_ENV: "production",
      VERCEL_ENV: "production",
    })).toMatchObject({ kind: "blocked", code: "F3_PRODUCTION_TARGET_FORBIDDEN" });
  });

  it("blocks missing staging labels before any database or server startup", () => {
    expect(resolveF3UatCommand(["--execute"], {})).toMatchObject({
      kind: "blocked",
      code: "F3_STAGING_PREVIEW_LABELS_REQUIRED",
    });
  });

  it("blocks incomplete target identity before any database or server startup", () => {
    expect(resolveF3UatCommand(["--execute"], {
      NODE_ENV: "production",
      APP_ENV: "staging",
      DATABASE_ENV: "staging",
      VERCEL_ENV: "preview",
    })).toMatchObject({ kind: "blocked", code: "F3_STAGING_TARGET_IDENTITY_INCOMPLETE" });
  });

  it("blocks complete-looking but unverified target identifiers before any database or server startup", () => {
    expect(resolveF3UatCommand(["--execute"], {
      APP_ENV: "staging",
      DATABASE_ENV: "staging",
      VERCEL_ENV: "preview",
      F3_STAGING_PROJECT_ID: "unknown-project",
      F3_STAGING_ROOT_BRANCH_ID: "unknown-root",
      F3_STAGING_ENDPOINT_ID: "unknown-endpoint",
    })).toMatchObject({ kind: "blocked", code: "F3_STAGING_TARGET_NOT_VERIFIED" });
  });

  it("does not accept extra flags or a database URL as execution authorization", () => {
    expect(resolveF3UatCommand(["--plan-only", "--execute"], {})).toMatchObject({ kind: "usage" });
    expect(resolveF3UatCommand(["--execute", "--database-url=postgresql://example.invalid/db"], {}))
      .toMatchObject({ kind: "usage" });
  });
});
