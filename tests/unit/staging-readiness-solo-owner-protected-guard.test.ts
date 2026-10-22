import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// This test exercises the exact PowerShell embedded in the phase-0 protected job.
// No live GitHub, Neon, PostgreSQL, credentials, or network are involved.
const yaml = readFileSync(join(process.cwd(), ".github", "workflows", "staging-readiness-capture.yml"), "utf8");
const sourceSha = "a".repeat(40);
const launcherSha = "b".repeat(40);
const ticket = "c".repeat(32);

function protectedGuardScript(): string {
  const marker = "      - name: Validate expiring Solo Owner approval and STOP before staging access";
  const start = yaml.indexOf(marker);
  if (start < 0) throw new Error("Solo Owner protected guard step missing");
  const block = yaml.indexOf("\n        run: |\n", start);
  if (block < start) throw new Error("Solo Owner guard script missing");
  const remainder = yaml.slice(block + "\n        run: |\n".length);
  // This guard must be the LAST step of the protected job; whitespace-only
  // line breaks inside the script are harmless, subsequent steps are not.
  if (/^      - name:/m.test(remainder) || /^  [a-zA-Z][\w-]*:/m.test(remainder)) {
    throw new Error("Unexpected step/job after permanent guard");
  }
  const body = yaml.slice(block + "\n        run: |\n".length);
  return body.split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
}

function validEnvironment(): Record<string, string> {
  const approved = new Date(Date.now() - 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const expires = new Date(Date.now() + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    GITHUB_REPOSITORY: "Satsetx4/karturt",
    REPOSITORY_ID: "1386907262",
    OWNER_ID: "304263836",
    ACTOR_ID: "304263836",
    REF_PROTECTED: "true",
    EVENT_SHA: sourceSha,
    WORKFLOW_SHA: launcherSha,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR: "Satsetx4",
    GITHUB_TRIGGERING_ACTOR: "Satsetx4",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "Satsetx4/karturt/.github/workflows/staging-readiness-capture.yml@refs/heads/main",
    GITHUB_SHA: sourceSha,
    EXPECTED_APPROVED_SHA: sourceSha,
    PREFLIGHT_CANDIDATE_SHA: sourceSha,
    EXPECTED_LAUNCHER_SHA: launcherSha,
    EXPECTED_APPROVAL_TICKET: ticket,
    DISPATCH_APPROVAL_TICKET: ticket,
    EXPECTED_APPROVAL_AT: approved,
    EXPECTED_APPROVAL_EXPIRES: expires,
  };
}

function runGuard(overrides: Record<string, string> = {}) {
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", protectedGuardScript()], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, ...validEnvironment(), ...overrides },
  });
  if (result.error) throw result.error;
  return result;
}

describe("Solo Owner protected job context bindings", () => {
  it("checks actor ID inside the step, not the job-level condition", () => {
    const protectedJobStart = yaml.indexOf("  protected-approval-boundary:");
    expect(protectedJobStart).toBeGreaterThanOrEqual(0);
    const protectedJob = yaml.slice(protectedJobStart);
    const jobIf = protectedJob.match(/^    if: (.+)$/m)?.[1];
    expect(jobIf).toBeDefined();
    expect(jobIf).not.toContain("github.actor_id");

    const stepStart = protectedJob.indexOf("      - name: Validate expiring Solo Owner approval and STOP before staging access");
    expect(stepStart).toBeGreaterThanOrEqual(0);
    const runStart = protectedJob.indexOf("\n        run: |\n", stepStart);
    expect(runStart).toBeGreaterThan(stepStart);
    expect(protectedJob.slice(stepStart, runStart)).toContain("ACTOR_ID: ${{ github.actor_id }}");
  });
});
describe.skipIf(process.platform !== "linux")("Solo Owner protected Windows guard executed offline", () => {
  it("always refuses live capture even when owner/SHAs/ticket/expiry match", () => {
    const result = runGuard();
    expect(result.status).toBe(78);
    expect(result.stdout).toContain("SOLO_OWNER_APPROVAL_SHAPE_PASS");
    expect(result.stdout).toContain("CAPTURE_STOP: LIVE_CAPTURE_NOT_IMPLEMENTED_OR_AUTHORIZED");
    expect(result.stdout).toContain("Static Environment ticket can be replayed");
    expect(result.stdout).not.toContain(ticket);
  });

  it.each([
    ["another owner", { GITHUB_ACTOR: "untrusted" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["rerun by other actor", { GITHUB_TRIGGERING_ACTOR: "untrusted" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["rerun attempt", { GITHUB_RUN_ATTEMPT: "2" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["wrong branch", { GITHUB_REF: "refs/heads/feature" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["PR event", { GITHUB_EVENT_NAME: "pull_request" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["wrong repository", { GITHUB_REPOSITORY: "other/karturt" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["wrong repository id", { REPOSITORY_ID: "0" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["wrong owner id", { OWNER_ID: "0" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["wrong owner actor id", { ACTOR_ID: "0" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["unprotected ref", { REF_PROTECTED: "false" }, "SOLO_OWNER_PROTECTED_CONTEXT_INVALID"],
    ["workflow substitution", { GITHUB_WORKFLOW_REF: "Satsetx4/karturt/.github/workflows/fake.yml@refs/heads/main" }, "SOLO_OWNER_WORKFLOW_REF_INVALID"],
    ["candidate source mismatch", { PREFLIGHT_CANDIDATE_SHA: "d".repeat(40) }, "PROTECTED_APPROVED_SOURCE_SHA_MISMATCH"],
    ["dispatch source mismatch", { EVENT_SHA: "d".repeat(40) }, "PROTECTED_APPROVED_SOURCE_SHA_MISMATCH"],
    ["run source SHA mismatch", { GITHUB_SHA: "d".repeat(40) }, "PROTECTED_APPROVED_SOURCE_SHA_MISMATCH"],
    ["malformed dispatch source SHA", { EVENT_SHA: "bad" }, "PROTECTED_APPROVED_SOURCE_SHA_MISMATCH"],
    ["missing candidate approval", { EXPECTED_APPROVED_SHA: "" }, "PROTECTED_APPROVED_SOURCE_SHA_MISMATCH"],
    ["launcher workflow SHA substitution", { WORKFLOW_SHA: "d".repeat(40) }, "PROTECTED_APPROVED_LAUNCHER_SHA_MISMATCH"],
    ["missing launcher approval", { EXPECTED_LAUNCHER_SHA: "" }, "PROTECTED_APPROVED_LAUNCHER_SHA_MISMATCH"],
    ["wrong ticket", { DISPATCH_APPROVAL_TICKET: "e".repeat(32) }, "SOLO_OWNER_APPROVAL_TICKET_MISMATCH"],
    ["missing protected ticket", { EXPECTED_APPROVAL_TICKET: "" }, "SOLO_OWNER_APPROVAL_TICKET_MISMATCH"],
    ["invalid expiry", { EXPECTED_APPROVAL_EXPIRES: "tomorrow" }, "SOLO_OWNER_APPROVAL_EXPIRY_INVALID"],
    ["invalid approval issue time", { EXPECTED_APPROVAL_AT: "yesterday" }, "SOLO_OWNER_APPROVAL_ISSUED_AT_INVALID"],
    ["future approval issue time", { EXPECTED_APPROVAL_AT: new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z") }, "SOLO_OWNER_APPROVAL_EXPIRED_OR_TOO_LONG"],
    ["stale approval issue time", { EXPECTED_APPROVAL_AT: new Date(Date.now() - 16 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z") }, "SOLO_OWNER_APPROVAL_EXPIRED_OR_TOO_LONG"],
    ["expired approval", { EXPECTED_APPROVAL_EXPIRES: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z") }, "SOLO_OWNER_APPROVAL_EXPIRED_OR_TOO_LONG"],
    ["excessive validity", { EXPECTED_APPROVAL_EXPIRES: new Date(Date.now() + 60 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z") }, "SOLO_OWNER_APPROVAL_EXPIRED_OR_TOO_LONG"],
  ] as const)("rejects %s before reaching the hard-stop stage", (_name, overrides, code) => {
    const result = runGuard(overrides);
    expect(result.status).not.toBe(0);
    expect(result.status).not.toBe(78);
    expect(result.stderr).toContain(code);
    expect(result.stdout).not.toContain("SOLO_OWNER_APPROVAL_SHAPE_PASS");
    expect(result.stdout).not.toContain(ticket);
  });
});
