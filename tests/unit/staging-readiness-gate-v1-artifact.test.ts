import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  databaseProbeFreshnessCheck,
  referencedEvidenceIntegrityCheck,
} from "../../src/db/staging-readiness-gate-v1-artifact";
import {
  evaluateDatabaseProbeArtifact,
  formatDatabaseProbeEvaluationSummary,
} from "../../src/db/staging-readiness-gate-v1-cli-policy";
import * as stagingReadinessCliPolicy from "../../src/db/staging-readiness-gate-v1-cli-policy";
import { verifyStagingReadinessBinding } from "../../src/db/staging-readiness-migration-binding";
import { evaluateStagingReadinessSignalsV1, type StagingReadinessEvidence } from "../../src/db/staging-readiness-gate-v1";
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
    branchParentIdFieldObserved: false,
    branchParentId: null,
    init_source: "parent-data",
  };
  const rootResolution = {
    schemaVersion,
    artifactType: "root-branch-resolution",
    sourceSha: bundleSourceSha,
    ...target,
    verificationStatus: "VERIFIED",
    resolvesToNewRoot: true,
    contractReference: "https://neon.com/docs/manage/branches",
    explanation: "Neon creates a root/default branch for a new project; exact request and readback identify the selected branch.",
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
    rootStructureResolutionSha256: writeArtifact(temporaryDirectory, "lineage/root-branch-resolution.json", rootResolution),
    datasetManifestSha256: writeArtifact(temporaryDirectory, "provenance/dataset-manifest.json", datasetManifest),
    attestationSha256: writeArtifact(temporaryDirectory, "provenance/attestation.json", attestation),
  };
  const provider = {
    provider: "neon",
    organizationId: STAGING_MIGRATION_TARGET_MANIFEST.organizationId,
    projectId: STAGING_MIGRATION_TARGET_MANIFEST.projectId,
    branchId: STAGING_MIGRATION_TARGET_MANIFEST.branchId,
    endpointId: STAGING_MIGRATION_TARGET_MANIFEST.endpointId,
    endpointBranchId: STAGING_MIGRATION_TARGET_MANIFEST.branchId,
    plan: "free",
    computeMinCU: 0.25,
    computeMaxCU: 0.25,
    postgresMajor: 18,
    evidenceReference: "provider-evidence.json",
    branch: {
      state: "ready",
      primary: true,
      default: true,
      init_source: "parent-data",
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
      sourceFieldsOmitted: ["parent_id", "parent_project_id", "source_project_id", "clone", "import", "restore"],
      verificationSource: "provider-api-create-request-and-readback",
      verificationStatus: "VERIFIED",
      providerReadbackReference: "lineage/provider-readback.json",
      providerReadbackSha256: references.providerReadbackSha256,
      projectParentIdFieldObserved: true,
      projectParentId: null,
      sourceProjectIdFieldObserved: true,
      sourceProjectId: null,
      branchParentIdFieldObserved: false,
      branchParentId: null,
      rootStructureResolution: {
        sourceSha: bundleSourceSha,
        verificationStatus: "VERIFIED",
        resolvesToNewRoot: true,
        contractReference: "https://neon.com/docs/manage/branches",
        explanation: rootResolution.explanation,
        evidenceReference: "lineage/root-branch-resolution.json",
        evidenceSha256: references.rootStructureResolutionSha256,
      },
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
    connection: {
      sessionId: null,
      target: null,
      libpq: null,
      server: null,
      catalog: null,
      pgStatSsl: null,
    },
  };
  return { directory: temporaryDirectory, evidence };
}

function createReadinessBindingFixture(options: {
  stale?: boolean;
  mismatchedTarget?: boolean;
  assertedPass?: boolean;
  assertedFail?: boolean;
} = {}) {
  const repositoryRoot = process.cwd();
  const sourceHeadSha = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const now = Date.now();
  const reportTime = options.stale ? now - 180_000 : now;
  const bundle = createEvidenceBundle(sourceHeadSha, reportTime);
  const sessionId = "karturt-staging-readiness-gate-v1";
  const backendPid = 23456;
  const normalizedIsolation = JSON.parse(JSON.stringify(bundle.evidence.stagingIsolation)) as Record<string, unknown>;
  const evidence = {
    ...bundle.evidence,
    nowMs: reportTime,
    stagingIsolation: normalizedIsolation,
    connection: {
      sessionId,
      target: {
        endpointId: STAGING_MIGRATION_TARGET_MANIFEST.endpointId,
        hostname: STAGING_MIGRATION_TARGET_MANIFEST.directHostname,
        port: STAGING_MIGRATION_TARGET_MANIFEST.port,
        databaseName: STAGING_MIGRATION_TARGET_MANIFEST.databaseName,
        roleName: STAGING_MIGRATION_TARGET_MANIFEST.roleName,
        pooled: false,
      },
      libpq: {
        sessionId,
        connectionSucceeded: true,
        sslmode: "verify-full",
        channelBinding: "require",
        gssEncryptionMode: "disable",
        rootCertificateSource: "protected-environment-variable:KARTURT_STAGING_CA_SHA256",
        rootCertificateSha256: "f".repeat(64),
        sslInUse: true,
        sslProtocol: "TLSv1.3",
        sslCipher: "TLS_AES_256_GCM_SHA384",
      },
      server: {
        sessionId,
        databaseName: STAGING_MIGRATION_TARGET_MANIFEST.databaseName,
        roleName: STAGING_MIGRATION_TARGET_MANIFEST.roleName,
        postgresMajor: 18,
        transactionReadOnly: true,
        backendPid,
      },
      catalog: {
        sessionId,
        nonSystemSchemaCount: 1,
        nonSystemSchemaNames: ["public"],
        applicationRelationCount: 0,
        applicationOwnedRelationCount: 0,
        standaloneApplicationTypeCount: 0,
        drizzleJournalPresent: false,
        nonSystemRoutineCount: 0,
        extensionNames: ["plpgsql"],
        roleMembershipCount: 0,
        defaultAclCount: 0,
        counts: {
          non_system_schema_count: 1,
          application_relation_count: 0,
          application_owned_relation_count: 0,
          standalone_application_type_count: 0,
          drizzle_journal_count: 0,
          non_system_routine_count: 0,
          extension_count: 1,
          role_membership_count: 0,
          default_acl_count: 0,
        },
        backendPid,
      },
      pgStatSsl: { sessionId, ssl: false },
    },
  };
  const probeStartedAtUtc = new Date(reportTime - 20_000).toISOString();
  const probeCompletedAtUtc = new Date(reportTime - 10_000).toISOString();
  const querySha256 = sha256(readFileSync(path.join(repositoryRoot, "docs/codex/staging-readiness-gate-v1.sql")));
  const probe = {
    schemaVersion: "staging-readiness-gate-v1/database-probe-evidence/v1",
    result: "DATABASE_PROBE_PASS",
    sourceSha: sourceHeadSha,
    startedAtUtc: probeStartedAtUtc,
    completedAtUtc: probeCompletedAtUtc,
    psqlVersion: "psql (PostgreSQL) 18.0",
    psqlSha256: "e".repeat(64),
    querySha256,
    target: {
      organizationId: STAGING_MIGRATION_TARGET_MANIFEST.organizationId,
      projectId: options.mismatchedTarget ? "wrong-project" : STAGING_MIGRATION_TARGET_MANIFEST.projectId,
      branchId: STAGING_MIGRATION_TARGET_MANIFEST.branchId,
      endpointId: STAGING_MIGRATION_TARGET_MANIFEST.endpointId,
      directHostname: STAGING_MIGRATION_TARGET_MANIFEST.directHostname,
      port: STAGING_MIGRATION_TARGET_MANIFEST.port,
      database: STAGING_MIGRATION_TARGET_MANIFEST.databaseName,
      role: STAGING_MIGRATION_TARGET_MANIFEST.roleName,
    },
    providerMetadata: "NOT_INCLUDED",
    providerEvidence: {
      evidenceReference: bundle.evidence.provider.evidenceReference,
      evidenceSha256: bundle.evidence.provider.evidenceSha256,
      preconnectionValidation: "PASS",
    },
    stagingIsolation: "UNKNOWN",
    overallGate: "NOT_EVALUATED",
    migrationAuthorization: "NOT_GRANTED",
    databaseProbe: {
      status: "DATABASE_PROBE_PASS",
      psqlExitCode: 0,
      sessionId,
      backendPid,
      libpq: {
        sslmode: "verify-full",
        channelBinding: "require",
        gssEncryptionMode: "disable",
        rootCertificateSource: "protected-environment-variable:KARTURT_STAGING_CA_SHA256",
        rootCertificateSha256: "f".repeat(64),
        tlsProtocol: "TLSv1.3",
        tlsCipher: "TLS_AES_256_GCM_SHA384",
        directHostIdentityVerified: STAGING_MIGRATION_TARGET_MANIFEST.directHostname,
      },
      transactionReadOnly: "on",
      catalogCounts: {
        non_system_schema_count: 1,
        non_system_schema_names: ["public"],
        application_relation_count: 0,
        application_owned_relation_count: 0,
        standalone_application_type_count: 0,
        drizzle_journal_count: 0,
        non_system_routine_count: 0,
        extension_count: 1,
        extension_names: ["plpgsql"],
        role_membership_count: 0,
        default_acl_count: 0,
      },
      pgStatSslDiagnostic: "reported-false",
    },
    evidence,
  };
  const probeBytes = Buffer.from(`${JSON.stringify(probe)}\n`, "utf8");
  const probePath = path.join(bundle.directory, "database-probe.json");
  writeFileSync(probePath, probeBytes, { flag: "wx" });
  const evaluationStartedAtUtc = new Date(reportTime - 2_000).toISOString();
  const evaluationCompletedAtUtc = new Date(reportTime).toISOString();
  const combined = evaluateDatabaseProbeArtifact(
    evidence as unknown as StagingReadinessEvidence,
    probe,
    bundle.directory,
    reportTime,
  );
  const evaluation = {
    schemaVersion: "staging-readiness-gate-v1/evaluation/v1",
    sourceSha: sourceHeadSha,
    inputArtifactSha256: sha256(probeBytes),
    startedAtUtc: evaluationStartedAtUtc,
    completedAtUtc: evaluationCompletedAtUtc,
    readiness: options.assertedPass ? "PASS" : options.assertedFail ? "FAIL" : combined.readiness,
    migrationAllowed: false,
    authorization: combined.authorization,
    checks: combined.checks,
    diagnostics: combined.diagnostics,
    executionBoundary: "READINESS_EVALUATION_ONLY_NO_DATABASE_OR_PROVIDER_ACCESS",
  };
  const evaluationPath = path.join(bundle.directory, "evaluation.json");
  writeFileSync(evaluationPath, `${JSON.stringify(evaluation)}\n`, { flag: "wx" });
  return { bundle, sourceHeadSha, now, probePath, evaluationPath, evaluation, probe };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe("Staging Readiness Gate V1 artifact boundary", () => {
  it("accepts only byte-verified, exact-target, source-bound referenced evidence", () => {
    const bundle = createEvidenceBundle();
    expect(Object.prototype.hasOwnProperty.call(bundle.evidence.provider.branch, "parent_id")).toBe(false);
    expect(bundle.evidence.stagingIsolation.lineage.branchParentIdFieldObserved).toBe(false);
    expect(referencedEvidenceIntegrityCheck(bundle.evidence, bundle.directory).status).toBe("PASS");
  });

  it("rejects normalization that invents an explicit null parent_id", () => {
    const bundle = createEvidenceBundle();
    (bundle.evidence.provider.branch as Record<string, unknown>).parent_id = null;
    expect(referencedEvidenceIntegrityCheck(bundle.evidence, bundle.directory).status).toBe("FAIL");
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
      { ...bundle.evidence, nowMs } as unknown as StagingReadinessEvidence,
      staleProbeArtifact,
      bundle.directory,
      nowMs,
    );
    expect(combined.readiness === "PASS").toBe(false);
    expect(combined.migrationAllowed).toBe(false);
    expect(combined.checks.providerCaptureAuthentication.status).toBe("UNKNOWN");
    expect(combined.checks.databaseProbeAuthentication.status).toBe("UNKNOWN");
    expect(combined.checks.providerIdentity.status).toBe("UNKNOWN");
    expect(combined.checks.libpqGssEncryption.status).toBe("UNKNOWN");
    expect(combined.checks.libpqRootCertificatePin.status).toBe("UNKNOWN");
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
    expect(summary.includes("evaluation: PASS")).toBe(false);
    expect(summary.includes("migrationAllowed=true")).toBe(false);
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
        organizationId: STAGING_MIGRATION_TARGET_MANIFEST.organizationId,
        projectId: STAGING_MIGRATION_TARGET_MANIFEST.projectId,
        branchId: STAGING_MIGRATION_TARGET_MANIFEST.branchId,
        endpointId: STAGING_MIGRATION_TARGET_MANIFEST.endpointId,
        directHostname: STAGING_MIGRATION_TARGET_MANIFEST.directHostname,
        port: STAGING_MIGRATION_TARGET_MANIFEST.port,
        database: STAGING_MIGRATION_TARGET_MANIFEST.databaseName,
        role: STAGING_MIGRATION_TARGET_MANIFEST.roleName,
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
    expect(stdout.includes("Staging Readiness Gate V1 evaluation: PASS")).toBe(false);
    expect(stdout.includes("migrationAllowed=true")).toBe(false);
  });

  it("rejects a byte-bound but unauthenticated UNKNOWN report before it can authorize migration", () => {
    const fixture = createReadinessBindingFixture();
    expect(fixture.evaluation.readiness, JSON.stringify(fixture.evaluation.checks)).toBe("UNKNOWN");
    expect(fixture.evaluation.migrationAllowed).toBe(false);
    expect(() => verifyStagingReadinessBinding({
      repositoryRoot: process.cwd(),
      evaluationPath: fixture.evaluationPath,
      probeEvidencePath: fixture.probePath,
      sourceSha: fixture.sourceHeadSha,
      nowMs: fixture.now,
    })).toThrow("fresh, source-bound Gate V1 PASS evaluation could not be verified");
  });

  it("rejects a probe without a publisher-pinned PostgreSQL client digest", () => {
    const fixture = createReadinessBindingFixture();
    const probe = JSON.parse(readFileSync(fixture.probePath, "utf8")) as Record<string, unknown>;
    delete probe.psqlSha256;
    const probeBytes = Buffer.from(`${JSON.stringify(probe)}\n`, "utf8");
    writeFileSync(fixture.probePath, probeBytes);
    const evaluation = JSON.parse(readFileSync(fixture.evaluationPath, "utf8")) as Record<string, unknown>;
    evaluation.inputArtifactSha256 = sha256(probeBytes);
    writeFileSync(fixture.evaluationPath, `${JSON.stringify(evaluation)}\n`);
    expect(() => verifyStagingReadinessBinding({
      repositoryRoot: process.cwd(),
      evaluationPath: fixture.evaluationPath,
      probeEvidencePath: fixture.probePath,
      sourceSha: fixture.sourceHeadSha,
      nowMs: fixture.now,
    })).toThrow("fresh, source-bound Gate V1 PASS evaluation could not be verified");
  });

  it.each([
    ["a falsely asserted PASS", { assertedPass: true }],
    ["a FAIL report", { assertedFail: true }],
    ["a stale evaluation", { stale: true }],
    ["a mismatched target", { mismatchedTarget: true }],
  ])("rejects %s before migration", (_label, options) => {
    const fixture = createReadinessBindingFixture(options);
    expect(() => verifyStagingReadinessBinding({
      repositoryRoot: process.cwd(),
      evaluationPath: fixture.evaluationPath,
      probeEvidencePath: fixture.probePath,
      sourceSha: fixture.sourceHeadSha,
      nowMs: fixture.now,
    })).toThrow("fresh, source-bound Gate V1 PASS evaluation could not be verified");
  });

  it("recomputes probe and provider freshness against migration time, not the older report time", () => {
    const fixture = createReadinessBindingFixture();
    const verificationNow = fixture.now + 115_000;
    const evaluateSpy = vi.spyOn(stagingReadinessCliPolicy, "evaluateDatabaseProbeArtifact");

    expect(() => verifyStagingReadinessBinding({
      repositoryRoot: process.cwd(),
      evaluationPath: fixture.evaluationPath,
      probeEvidencePath: fixture.probePath,
      sourceSha: fixture.sourceHeadSha,
      nowMs: verificationNow,
    })).toThrow("fresh, source-bound Gate V1 PASS evaluation could not be verified");

    expect(evaluateSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      fixture.bundle.directory,
      verificationNow,
    );
    expect(databaseProbeFreshnessCheck(fixture.probe, verificationNow).status).toBe("UNKNOWN");
    const coreAtMigrationTime = evaluateStagingReadinessSignalsV1({
      ...fixture.bundle.evidence as unknown as StagingReadinessEvidence,
      nowMs: verificationNow,
    });
    expect(coreAtMigrationTime.checks.providerFreshness.status).toBe("UNKNOWN");
    evaluateSpy.mockRestore();
  });

  it("rejects probe bytes that changed after the evaluation digest was created", () => {
    const fixture = createReadinessBindingFixture();
    const probe = JSON.parse(readFileSync(fixture.probePath, "utf8")) as Record<string, unknown>;
    probe.result = "DATABASE_PROBE_STOPPED";
    writeFileSync(fixture.probePath, `${JSON.stringify(probe)}\n`);
    expect(() => verifyStagingReadinessBinding({
      repositoryRoot: process.cwd(),
      evaluationPath: fixture.evaluationPath,
      probeEvidencePath: fixture.probePath,
      sourceSha: fixture.sourceHeadSha,
      nowMs: fixture.now,
    })).toThrow("fresh, source-bound Gate V1 PASS evaluation could not be verified");
  });

  it("rejects a report bound to another source SHA", () => {
    const fixture = createReadinessBindingFixture();
    expect(() => verifyStagingReadinessBinding({
      repositoryRoot: process.cwd(),
      evaluationPath: fixture.evaluationPath,
      probeEvidencePath: fixture.probePath,
      sourceSha: "f".repeat(40),
      nowMs: fixture.now,
    })).toThrow("fresh, source-bound Gate V1 PASS evaluation could not be verified");
  });

  it("rejects a missing evaluation report", () => {
    const fixture = createReadinessBindingFixture();
    expect(() => verifyStagingReadinessBinding({
      repositoryRoot: process.cwd(),
      evaluationPath: path.join(fixture.bundle.directory, "missing-evaluation.json"),
      probeEvidencePath: fixture.probePath,
      sourceSha: fixture.sourceHeadSha,
      nowMs: fixture.now,
    })).toThrow("fresh, source-bound Gate V1 PASS evaluation could not be verified");
  });
});
