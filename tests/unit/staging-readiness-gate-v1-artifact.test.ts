import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  databaseProbeFreshnessCheck,
  referencedEvidenceIntegrityCheck,
} from "../../src/db/staging-readiness-gate-v1-artifact";
import {
  evaluateDatabaseProbeArtifact,
  formatDatabaseProbeEvaluationSummary,
} from "../../src/db/staging-readiness-gate-v1-cli-policy";
import type { StagingReadinessEvidence } from "../../src/db/staging-readiness-gate-v1";
import { STAGING_MIGRATION_TARGET_MANIFEST } from "../../src/lib/staging-database-target";

const sourceSha = "a".repeat(40);
const nowMs = Date.parse("2026-10-21T10:00:00.000Z");
const schemaVersion = "staging-readiness-gate-v1/evidence-artifact/v1";
let temporaryDirectory: string | null = null;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeArtifact(directory: string, reference: string, artifact: Record<string, unknown>): string {
  const filePath = path.join(directory, reference);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(artifact)}\n`, "utf8");
  writeFileSync(filePath, bytes, { flag: "wx" });
  return sha256(bytes);
}

function createEvidenceBundle(bundleSourceSha = sourceSha, observedAtMs = nowMs) {
  temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "karturt-gate-v1-"));
  const target = {
    targetProjectId: STAGING_MIGRATION_TARGET_MANIFEST.projectId,
    targetBranchId: STAGING_MIGRATION_TARGET_MANIFEST.branchId,
  };
  const createRequest = {
    schemaVersion,
    artifactType: "lineage-create-request",
    sourceSha: bundleSourceSha,
    ...target,
    method: "POST",
    operation: "create-project",
    sourceFieldsOmitted: ["parent_id", "parent_project_id", "source_project_id", "clone", "import", "restore"],
  };
  const readback = {
    schemaVersion,
    artifactType: "provider-lineage-readback",
    sourceSha: bundleSourceSha,
    ...target,
    projectParentIdFieldObserved: true,
    projectParentId: null,
    sourceProjectIdFieldObserved: true,
    sourceProjectId: null,
    branchParentIdFieldObserved: true,
    branchParentId: null,
    init_source: "blank",
  };
  const datasetManifest = {
    schemaVersion,
    artifactType: "synthetic-dataset-manifest",
    sourceSha: bundleSourceSha,
    ...target,
    classification: "SYNTHETIC_ONLY",
    noProductionData: true,
  };
  const attestation = {
    schemaVersion,
    artifactType: "synthetic-only-attestation",
    sourceSha: bundleSourceSha,
    ...target,
    classification: "SYNTHETIC_ONLY",
    noProductionData: true,
  };
  const references = {
    createRequestSha256: writeArtifact(temporaryDirectory, "lineage/create-request.json", createRequest),
    providerReadbackSha256: writeArtifact(temporaryDirectory, "lineage/provider-readback.json", readback),
    datasetManifestSha256: writeArtifact(temporaryDirectory, "provenance/dataset-manifest.json", datasetManifest),
    attestationSha256: writeArtifact(temporaryDirectory, "provenance/attestation.json", attestation),
  };
  const provider = {
    provider: "neon",
    organizationId: STAGING_MIGRATION_TARGET_MANIFEST.organizationId,
    projectId: STAGING_MIGRATION_TARGET_MANIFEST.projectId,
    branchId: STAGING_MIGRATION_TARGET_MANIFEST.branchId,
    endpointId: STAGING_MIGRATION_TARGET_MANIFEST.endpointId,
    plan: "free",
    computeMinCU: 0.25,
    computeMaxCU: 0.25,
    postgresMajor: 18,
    evidenceReference: "provider-evidence.json",
    branch: {
      state: "ready",
      primary: true,
      default: true,
      parent_id: null,
      init_source: "blank",
    },
  };
  const isolation = {
    observedAtUtc: new Date(observedAtMs - 30_000).toISOString(),
    targetProjectId: target.targetProjectId,
    targetBranchId: target.targetBranchId,
    lineage: {
      sourceSha: bundleSourceSha,
      createRequestMethod: "POST",
      createRequestOperation: "create-project",
      createRequestReference: "lineage/create-request.json",
      createRequestSha256: references.createRequestSha256,
      providerReadbackReference: "lineage/provider-readback.json",
      providerReadbackSha256: references.providerReadbackSha256,
      projectParentIdFieldObserved: true,
      projectParentId: null,
      sourceProjectIdFieldObserved: true,
      sourceProjectId: null,
      branchParentIdFieldObserved: true,
      branchParentId: null,
      parentDataResolution: null,
    },
    syntheticOnly: {
      classification: "SYNTHETIC_ONLY",
      sourceSha: bundleSourceSha,
      datasetManifestReference: "provenance/dataset-manifest.json",
      datasetManifestSha256: references.datasetManifestSha256,
      attestationReference: "provenance/attestation.json",
      attestationSha256: references.attestationSha256,
      noProductionData: true,
    },
  };
  const providerArtifact = {
    schemaVersion,
    artifactType: "provider-metadata",
    sourceSha: bundleSourceSha,
    provider: { ...provider, observedAtUtc: new Date(observedAtMs - 30_000).toISOString() },
    stagingIsolation: isolation,
  };
  const providerSha256 = writeArtifact(temporaryDirectory, "provider-evidence.json", providerArtifact);
  const evidence = {
    sourceSha: bundleSourceSha,
    provider: { ...provider, observedAtUtc: providerArtifact.provider.observedAtUtc, evidenceSha256: providerSha256 },
    stagingIsolation: isolation,
  };
  return { directory: temporaryDirectory, evidence };
}

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe("Staging Readiness Gate V1 artifact boundary", () => {
  it("accepts only byte-verified, exact-target, source-bound referenced evidence", () => {
    const bundle = createEvidenceBundle();
    expect(referencedEvidenceIntegrityCheck(bundle.evidence, bundle.directory).status).toBe("PASS");
  });

  it("fails when a referenced artifact digest does not match its bytes", () => {
    const bundle = createEvidenceBundle();
    bundle.evidence.stagingIsolation.lineage.createRequestSha256 = "b".repeat(64);
    expect(referencedEvidenceIntegrityCheck(bundle.evidence, bundle.directory).status).toBe("FAIL");
  });

  it("keeps readiness UNKNOWN when a referenced artifact is missing", () => {
    const bundle = createEvidenceBundle();
    bundle.evidence.stagingIsolation.syntheticOnly.attestationReference = "provenance/missing.json";
    expect(referencedEvidenceIntegrityCheck(bundle.evidence, bundle.directory).status).toBe("UNKNOWN");
  });

  it("rejects artifacts bound to a different source SHA", () => {
    const bundle = createEvidenceBundle();
    const filePath = path.join(bundle.directory, "lineage/provider-readback.json");
    const artifact = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    artifact.sourceSha = "f".repeat(40);
    writeFileSync(filePath, `${JSON.stringify(artifact)}\n`);
    bundle.evidence.stagingIsolation.lineage.providerReadbackSha256 = sha256(Buffer.from(`${JSON.stringify(artifact)}\n`));
    expect(referencedEvidenceIntegrityCheck(bundle.evidence, bundle.directory).status).toBe("FAIL");
  });

  it("rejects traversal references", () => {
    const bundle = createEvidenceBundle();
    bundle.evidence.provider.evidenceReference = "../provider-evidence.json";
    expect(referencedEvidenceIntegrityCheck(bundle.evidence, bundle.directory).status).toBe("UNKNOWN");
  });

  it("keeps old probe artifacts UNKNOWN even when their embedded provider time is fresh", () => {
    const artifact = {
      startedAtUtc: new Date(nowMs - 300_000).toISOString(),
      completedAtUtc: new Date(nowMs - 180_000).toISOString(),
    };
    expect(databaseProbeFreshnessCheck(artifact, nowMs).status).toBe("UNKNOWN");
  });

  it("rejects future or out-of-order probe timestamps", () => {
    expect(databaseProbeFreshnessCheck({
      startedAtUtc: new Date(nowMs + 10_000).toISOString(),
      completedAtUtc: new Date(nowMs + 5_000).toISOString(),
    }, nowMs).status).toBe("UNKNOWN");
  });

  it("accepts a recently completed probe", () => {
    expect(databaseProbeFreshnessCheck({
      startedAtUtc: "2026-10-21T09:59:40.1234567Z",
      completedAtUtc: "2026-10-21T09:59:50.7654321Z",
    }, nowMs).status).toBe("PASS");
  });

  it("prints the combined report status and never the base evaluator status", () => {
    const bundle = createEvidenceBundle();
    const staleProbeArtifact = {
      startedAtUtc: new Date(nowMs - 300_000).toISOString(),
      completedAtUtc: new Date(nowMs - 180_000).toISOString(),
    };
    const combined = evaluateDatabaseProbeArtifact(
      { ...bundle.evidence, nowMs },
      staleProbeArtifact,
      bundle.directory,
      nowMs,
    );
    expect(combined.readiness).not.toBe("PASS");
    expect(combined.migrationAllowed).toBe(false);
    expect(combined.checks.providerCaptureAuthentication.status).toBe("UNKNOWN");
    expect(combined.checks.databaseProbeAuthentication.status).toBe("UNKNOWN");
    expect(combined.checks.providerIdentity.status).toBe("UNKNOWN");
    expect(combined.checks.transactionReadOnly.status).toBe("UNKNOWN");
    const summary = formatDatabaseProbeEvaluationSummary({
      readiness: combined.readiness,
      migrationAllowed: combined.migrationAllowed,
      sourceSha,
      inputArtifactSha256: "c".repeat(64),
      evaluationEvidenceSha256: "d".repeat(64),
    });
    expect(summary).toContain(`Staging Readiness Gate V1 evaluation: ${combined.readiness}\n`);
    expect(summary).toContain("migrationAllowed=false\n");
    expect(summary).not.toContain("evaluation: PASS");
    expect(summary).not.toContain("migrationAllowed=true");
  });

  it("runs the evaluator CLI and prints the same fail-closed status as its report", () => {
    const repositoryRoot = process.cwd();
    const sourceHeadSha = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const evaluationNowMs = Date.now();
    const bundle = createEvidenceBundle(sourceHeadSha, evaluationNowMs);
    const queryBytes = readFileSync(path.join(repositoryRoot, "docs/codex/staging-readiness-gate-v1.sql"));
    const probePath = path.join(bundle.directory, "database-probe.json");
    const reportPath = path.join(bundle.directory, "evaluation.json");
    const probeStartedAtUtc = new Date(evaluationNowMs - 20_000).toISOString();
    const probeCompletedAtUtc = new Date(evaluationNowMs - 10_000).toISOString();
    const probeArtifact = {
      schemaVersion: "staging-readiness-gate-v1/database-probe-evidence/v1",
      result: "DATABASE_PROBE_PASS",
      overallGate: "NOT_EVALUATED",
      sourceSha: sourceHeadSha,
      evidence: { ...bundle.evidence, nowMs: evaluationNowMs } as unknown as StagingReadinessEvidence,
      providerEvidence: {
        evidenceReference: bundle.evidence.provider.evidenceReference,
        evidenceSha256: bundle.evidence.provider.evidenceSha256,
      },
      databaseProbe: { status: "DATABASE_PROBE_PASS", psqlExitCode: 0 },
      psqlVersion: "psql (PostgreSQL) 18.0",
      querySha256: sha256(queryBytes),
      target: {
        projectId: STAGING_MIGRATION_TARGET_MANIFEST.projectId,
        branchId: STAGING_MIGRATION_TARGET_MANIFEST.branchId,
      },
      startedAtUtc: probeStartedAtUtc,
      completedAtUtc: probeCompletedAtUtc,
    };
    writeFileSync(probePath, `${JSON.stringify(probeArtifact)}\n`, { flag: "wx" });

    const tsxCliOverride = process.env.STAGING_READINESS_GATE_V1_TSX_CLI;
    const tsxCliCandidates = [
      tsxCliOverride,
      path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
    const tsxCli = tsxCliCandidates.find(existsSync);
    if (!tsxCli) throw new Error("tsx CLI entry point is unavailable for the evaluator subprocess test.");

    const stdout = execFileSync(process.execPath, [
      tsxCli,
      path.join(repositoryRoot, "scripts/evaluate-staging-readiness-gate-v1.ts"),
      probePath,
      reportPath,
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      readiness: string;
      migrationAllowed: boolean;
      checks: Record<string, { status: string }>;
    };

    expect(report.readiness).toBe("UNKNOWN");
    expect(report.migrationAllowed).toBe(false);
    expect(report.checks.providerCaptureAuthentication.status).toBe("UNKNOWN");
    expect(report.checks.databaseProbeAuthentication.status).toBe("UNKNOWN");
    expect(stdout).toContain(`Staging Readiness Gate V1 evaluation: ${report.readiness}\n`);
    expect(stdout).toContain(`migrationAllowed=${report.migrationAllowed}\n`);
    expect(stdout).not.toContain("Staging Readiness Gate V1 evaluation: PASS");
    expect(stdout).not.toContain("migrationAllowed=true");
  });
});
