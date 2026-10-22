import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  evaluateDatabaseProbeArtifact,
  formatDatabaseProbeEvaluationSummary,
} from "../src/db/staging-readiness-gate-v1-cli-policy";
import type { StagingReadinessEvidence } from "../src/db/staging-readiness-gate-v1";

const MAX_ARTIFACT_BYTES = 128 * 1024;
const INPUT_SCHEMA = "staging-readiness-gate-v1/database-probe-evidence/v1";

class GateEvaluationError extends Error {}

function fail(code: string): never {
  process.stderr.write(`Staging Readiness Gate V1 evaluator stopped: ${code}\n`);
  process.exitCode = 1;
  throw new GateEvaluationError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function getHeadSha(root: string): string {
  let repositoryRoot: string;
  let sha: string;
  let status: string;
  try {
    repositoryRoot = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    sha = execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    status = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    fail("SOURCE_GIT_VALIDATION_FAILED");
  }
  if (path.resolve(repositoryRoot!) !== path.resolve(root)) fail("SOURCE_GIT_ROOT_MISMATCH");
  if (!/^[a-f0-9]{40}$/.test(sha!)) fail("SOURCE_SHA_INVALID");
  if (status!.length !== 0) fail("SOURCE_WORKTREE_NOT_CLEAN");
  return sha!;
}

function validateArtifactPath(value: string, label: string, root: string, mustExist: boolean): string {
  if (!path.isAbsolute(value)) fail(`${label}_PATH_MUST_BE_ABSOLUTE`);
  const resolved = path.resolve(value);
  const relative = path.relative(root, resolved);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    fail(`${label}_PATH_MUST_BE_OUTSIDE_REPOSITORY`);
  }
  const parent = path.dirname(resolved);
  try {
    let directory = parent;
    while (directory !== path.dirname(directory)) {
      if (lstatSync(directory).isSymbolicLink()) fail(`${label}_DIRECTORY_UNSAFE`);
      directory = path.dirname(directory);
    }
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label}_FILE_UNSAFE`);
    if (!mustExist) fail(`${label}_PATH_ALREADY_EXISTS`);
  } catch (error) {
    if (error instanceof GateEvaluationError) throw error;
    if (mustExist) fail(`${label}_FILE_MISSING`);
  }
  return resolved;
}

function writeImmutableJson(outputPath: string, value: unknown): string {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) fail("OUTPUT_ARTIFACT_TOO_LARGE");
  let fd: number | undefined;
  try {
    fd = openSync(outputPath, "wx", 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } catch {
    fail("OUTPUT_ARTIFACT_CREATE_FAILED");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return sha256(bytes);
}

function main(): void {
  const [inputArg, outputArg, ...extra] = process.argv.slice(2);
  if (!inputArg || !outputArg || extra.length !== 0) fail("USAGE");

  const root = process.cwd();
  const inputPath = validateArtifactPath(inputArg, "INPUT", root, true);
  const outputPath = validateArtifactPath(outputArg, "OUTPUT", root, false);
  if (inputPath === outputPath) fail("INPUT_OUTPUT_PATHS_MATCH");

  const inputBytes = readFileSync(inputPath);
  if (inputBytes.byteLength < 2 || inputBytes.byteLength > MAX_ARTIFACT_BYTES) fail("INPUT_ARTIFACT_SIZE_INVALID");

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputBytes.toString("utf8"));
  } catch {
    fail("INPUT_ARTIFACT_INVALID_JSON");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== INPUT_SCHEMA || parsed.result !== "DATABASE_PROBE_PASS" ||
      parsed.overallGate !== "NOT_EVALUATED" || !isRecord(parsed.evidence) ||
      !isRecord(parsed.providerEvidence) || !isRecord(parsed.databaseProbe) || !isRecord(parsed.target)) {
    fail("INPUT_ARTIFACT_NOT_DATABASE_PROBE_PASS");
  }

  const startedAtUtc = new Date().toISOString();
  const sourceSha = getHeadSha(root);
  if (parsed.sourceSha !== sourceSha || parsed.evidence.sourceSha !== sourceSha) fail("SOURCE_SHA_MISMATCH");
  const provider = parsed.evidence.provider;
  if (!isRecord(provider) || parsed.providerEvidence.evidenceSha256 !== provider.evidenceSha256 ||
      parsed.providerEvidence.evidenceReference !== provider.evidenceReference) fail("PROVIDER_EVIDENCE_BINDING_MISMATCH");
  if (parsed.databaseProbe.status !== "DATABASE_PROBE_PASS" || parsed.databaseProbe.psqlExitCode !== 0 ||
      typeof parsed.psqlVersion !== "string" || !/^psql \(PostgreSQL\) 18\./.test(parsed.psqlVersion)) {
    fail("DATABASE_PROBE_EVIDENCE_INVALID");
  }
  if (typeof parsed.querySha256 !== "string" || !/^[a-f0-9]{64}$/.test(parsed.querySha256)) {
    fail("QUERY_EVIDENCE_INVALID");
  }
  const queryBytes = readFileSync(path.join(root, "docs/codex/staging-readiness-gate-v1.sql"));
  if (sha256(queryBytes) !== parsed.querySha256) fail("QUERY_SHA256_MISMATCH");

  const gateEvaluation = evaluateDatabaseProbeArtifact(
    parsed.evidence as unknown as StagingReadinessEvidence,
    parsed,
    path.dirname(inputPath),
    Date.now(),
  );
  const report = {
    schemaVersion: "staging-readiness-gate-v1/evaluation/v1",
    sourceSha,
    inputArtifactSha256: sha256(inputBytes),
    startedAtUtc,
    completedAtUtc: new Date().toISOString(),
    readiness: gateEvaluation.readiness,
    migrationAllowed: gateEvaluation.migrationAllowed,
    authorization: gateEvaluation.authorization,
    checks: gateEvaluation.checks,
    diagnostics: gateEvaluation.diagnostics,
    executionBoundary: "READINESS_EVALUATION_ONLY_NO_DATABASE_OR_PROVIDER_ACCESS",
  };
  const outputSha256 = writeImmutableJson(outputPath, report);
  process.stdout.write(formatDatabaseProbeEvaluationSummary({
    readiness: report.readiness,
    migrationAllowed: report.migrationAllowed,
    sourceSha,
    inputArtifactSha256: report.inputArtifactSha256,
    evaluationEvidenceSha256: outputSha256,
  }));
}

try {
  main();
} catch {
  if (process.exitCode !== 1) fail("EVALUATION_FAILED");
}
