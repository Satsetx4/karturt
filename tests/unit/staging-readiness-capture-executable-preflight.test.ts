import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";

const yaml = readFileSync(join(process.cwd(), ".github", "workflows", "staging-readiness-capture.yml"), "utf8");
const fullSha = "a".repeat(40);

function sourcePreflight(): string {
  const stepName = "      - name: Validate repository, main ref, workflow and source SHA";
  const begin = yaml.indexOf(stepName);
  const marker = "\n        run: |\n";
  const start = yaml.indexOf(marker, begin);
  const end = yaml.indexOf("\n  protected-approval-boundary:", start);
  if (begin < 0 || start < begin || end < start) throw new Error("No isolated no-secret launcher preflight");
  const body = yaml.slice(start + marker.length, end);
  return body.split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
}

function executePreflight(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "krt-capture-preflight-"));
  try {
    const output = join(directory, "output.txt");
    // Executables are local fake stubs; these tests never contact GitHub, Neon or PostgreSQL.
    const curlPath = join(directory, "curl");
    const jqPath = join(directory, "jq");
    writeFileSync(curlPath, '#!/bin/sh\nprintf \'{"sha":"%s"}\\n\' "$FAKE_GITHUB_COMMIT_SHA"\n');
    writeFileSync(jqPath, '#!/bin/sh\nprintf \'%s\\n\' "$FAKE_GITHUB_COMMIT_SHA"\n');
    chmodSync(curlPath, 0o700);
    chmodSync(jqPath, 0o700);

    const result = spawnSync("bash", ["-c", sourcePreflight()], {
      encoding: "utf8",
      timeout: 5_000,
      env: {
        ...process.env,
        PATH: directory + delimiter + (process.env.PATH ?? ""),
        GITHUB_REPOSITORY: "Satsetx4/karturt",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REF: "refs/heads/main",
        GITHUB_WORKFLOW_REF: "Satsetx4/karturt/.github/workflows/staging-readiness-capture.yml@refs/heads/main",
        GITHUB_OUTPUT: output,
        CANDIDATE_SHA: fullSha,
        FAKE_GITHUB_COMMIT_SHA: fullSha,
        ...overrides,
      },
    });
    let outputText = "";
    try { outputText = readFileSync(output, "utf8"); } catch { /* Guard refuses output */ }
    return { ...result, outputText };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform !== "linux")("trusted capture phase-0 executable preflight (offline)", () => {
  it("accepts a reviewed-shape manual dispatch and records only the exact SHA", () => {
    const result = executePreflight();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CAPTURE_PREFLIGHT_PASS");
    expect(result.outputText.trim()).toBe("candidate_sha=" + fullSha);
  });

  it.each([
    ["wrong repo", { GITHUB_REPOSITORY: "external/fork" }, "TRUSTED_DISPATCH_CONTEXT_INVALID"],
    ["PR event", { GITHUB_EVENT_NAME: "pull_request" }, "TRUSTED_DISPATCH_CONTEXT_INVALID"],
    ["candidate-branch ref", { GITHUB_REF: "refs/heads/feature" }, "TRUSTED_DISPATCH_CONTEXT_INVALID"],
    ["wrong workflow", { GITHUB_WORKFLOW_REF: "Satsetx4/karturt/.github/workflows/other.yml@refs/heads/main" }, "TRUSTED_WORKFLOW_REF_INVALID"],
    ["short SHA", { CANDIDATE_SHA: "bad" }, "CANDIDATE_SHA_FORMAT_INVALID"],
    ["uppercase SHA", { CANDIDATE_SHA: "A".repeat(40) }, "CANDIDATE_SHA_FORMAT_INVALID"],
    ["unverifiable/mismatched SHA", { FAKE_GITHUB_COMMIT_SHA: "b".repeat(40) }, "SOURCE_COMMIT_SHA_MISMATCH"],
  ] as const)("fails closed for %s without any accepted SHA output", (_label, overrides, expected) => {
    const result = executePreflight(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expected);
    expect(result.outputText).toBe("");
  });
});
