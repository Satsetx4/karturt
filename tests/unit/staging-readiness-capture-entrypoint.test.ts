import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const launcher = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "staging-readiness-capture.yml"),
  "utf8",
);

describe("staging capture launcher phase-0 trust boundary", () => {
  it("only allows a manually dispatched main-ref launcher with a full candidate SHA", () => {
    expect(launcher).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(launcher).not.toMatch(/^  (push|pull_request|schedule|workflow_call):/m);
    expect(launcher).toContain("GITHUB_EVENT_NAME");
    expect(launcher).toContain("refs/heads/main");
    expect(launcher).toContain("GITHUB_WORKFLOW_REF");
    expect(launcher).toContain("staging-readiness-capture.yml@refs/heads/main");
    expect(launcher).toContain("^[a-f0-9]{40}$");
    expect(launcher).toContain("https://api.github.com/repos/Satsetx4/karturt/commits/");
  });

  it("requires an independently protected Environment before running any second-stage job", () => {
    expect(launcher).toContain("needs: no-secret-preflight");
    expect(launcher).toContain("environment: karturt-staging-readiness");
    expect(launcher).toContain("vars.KARTURT_CAPTURE_APPROVED_SOURCE_SHA");
    expect(launcher).toContain("PROTECTED_APPROVED_SOURCE_SHA_MISMATCH");
    expect(launcher).toContain("LIVE_CAPTURE_NOT_IMPLEMENTED_OR_AUTHORIZED");
    expect(launcher).toContain("exit 78");
  });

  it("cannot accidentally exercise F2, database tools, credentials or a deployment", () => {
    expect(launcher).not.toMatch(/^\s+uses:/m);
    expect(launcher).not.toContain("secrets.");
    expect(launcher).not.toContain("DATABASE_URL");
    expect(launcher).not.toContain("PGPASSWORD");
    expect(launcher).not.toContain("PGPASSFILE");
    expect(launcher).not.toMatch(/\bnpx\s+drizzle\b|\bnpm\s+run\s+db:|\bvercel\s+deploy\b/i);
  });
});
