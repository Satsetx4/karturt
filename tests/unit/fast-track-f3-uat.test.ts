import { describe, expect, it } from "vitest";
import {
  F3_UAT_EVIDENCE_FIELDS,
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
    expect(renderF3UatPlan(result.scenarios)).toContain("Sanitized evidence fields");
    for (const { label } of F3_UAT_EVIDENCE_FIELDS) {
      expect(renderF3UatPlan(result.scenarios)).toContain(label);
    }
    expect(renderF3UatPlan(result.scenarios)).toContain("full 40-character Git SHA");
    expect(renderF3UatPlan(result.scenarios)).toContain("ISO 8601 timestamp with timezone");
    expect(renderF3UatPlan(result.scenarios)).toContain("authorized verifier role or non-personal reviewer ID");
    expect(renderF3UatPlan(result.scenarios)).toContain("without secrets, connection strings");
    expect(renderF3UatPlan(result.scenarios)).not.toContain("postgresql://");
  });

  it("describes the cash versus transfer-request race and both valid outcomes", () => {
    const scenario = F3_UAT_SCENARIOS.find(({ id }) => id === "cash-transfer-race");

    expect(scenario?.action).toContain("cash recording against resident online transfer-request creation");
    expect(scenario?.action).not.toContain("cash verification");
    expect(scenario?.expected).toContain("If cash wins");
    expect(scenario?.expected).toContain("if request creation wins");
    expect(scenario?.expected).toContain("no cash payment");
  });

  it("includes concurrent duplicate, verification, reversal, and rollback outcomes", () => {
    const request = F3_UAT_SCENARIOS.find(({ id }) => id === "concurrent-resident-transfer-request");
    const verification = F3_UAT_SCENARIOS.find(({ id }) => id === "concurrent-treasurer-payment-verification");
    const reversal = F3_UAT_SCENARIOS.find(({ id }) => id === "concurrent-payment-reversal");
    const rollback = F3_UAT_SCENARIOS.find(({ id }) => id === "financial-transaction-rollback");

    expect(request?.action).toContain("concurrent transfer requests");
    expect(request?.expected).toContain("Only one pending request owns the due claim");
    expect(request?.expected).toContain("same-key retry returns the original request");
    expect(verification?.actor).toContain("Two active Treasurers");
    expect(verification?.expected).toContain("Exactly one verification succeeds");
    expect(verification?.expected).toContain("one verification audit");
    expect(reversal?.expected).toContain("Exactly one reversal succeeds");
    expect(reversal?.expected).toContain("active settlements are released");
    expect(rollback?.action).toContain("approved test harness");
    expect(rollback?.expected).toContain("leaves no partial payment");
    expect(rollback?.expected).toContain("pre-operation state remains intact");
  });

  it("includes cancellation and reversal outcomes with role and household boundaries", () => {
    const cancellation = F3_UAT_SCENARIOS.find(({ id }) => id === "payment-request-cancellation");
    const reversal = F3_UAT_SCENARIOS.find(({ id }) => id === "payment-reversal-and-repayment");

    expect(cancellation?.expected).toContain("releases its claims");
    expect(cancellation?.expected).toContain("leaves dues unpaid");
    expect(cancellation?.expected).toContain("foreign request is denied");
    expect(reversal?.action).toContain("retry reversal");
    expect(reversal?.expected).toContain("pending request blocks reversal");
    expect(reversal?.expected).toContain("second reversal is rejected");
    expect(reversal?.expected).toContain("replacement payment uses a fresh key");
    expect(reversal?.expected).toContain("unauthorized attempts do not mutate state");
  });

  it("includes mobile viewport checks at the supported phone widths", () => {
    const mobile = F3_UAT_SCENARIOS.find(({ id }) => id === "mobile-viewport-smoke");

    expect(mobile?.action).toContain("360×800");
    expect(mobile?.action).toContain("390×844");
    expect(mobile?.action).toContain("420×900");
    expect(mobile?.expected).toContain("No horizontal overflow");
    expect(mobile?.expected).toContain("44×44 CSS-pixel touch targets");
  });

  it("includes deterministic Chairman report totals and the May due-date boundary", () => {
    const report = F3_UAT_SCENARIOS.find(({ id }) => id === "chairman-report-reconciliation");

    expect(report?.actor).toBe("RT Chairman");
    expect(report?.action).toContain("2026-05-05");
    expect(report?.action).toContain("2026-05-10");
    expect(report?.action).toContain("2026-05-20");
    expect(report?.expected).toContain("due-now is Rp 195.000");
    expect(report?.expected).toContain("future-unpaid is Rp 840.000");
    expect(report?.expected).toContain("Rp 1.365.000 reconciles to Rp 290.000 received + Rp 40.000 waived + Rp 1.035.000 outstanding");
    expect(report?.expected).toContain("Rp 115.000 across 3 periods");
    expect(report?.expected).toContain("Rp 195.000 across 5 periods");
    expect(report?.expected).toContain("future unpaid periods stay outside arrears");
    expect(report?.expected).not.toMatch(/resident names|household identifiers/i);
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
