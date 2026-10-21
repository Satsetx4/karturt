import {
  evaluateStagingReadinessGateV1,
  type StagingReadinessEvidence,
  type StagingReadinessState,
} from "./staging-readiness-gate-v1";
import {
  databaseProbeFreshnessCheck,
  referencedEvidenceIntegrityCheck,
} from "./staging-readiness-gate-v1-artifact";

export function evaluateDatabaseProbeArtifact(
  evidence: StagingReadinessEvidence,
  probeArtifact: unknown,
  evidenceDirectory: string,
  nowMs: number,
) {
  const databaseProbeFreshness = databaseProbeFreshnessCheck(probeArtifact, nowMs);
  const referencedEvidenceIntegrity = referencedEvidenceIntegrityCheck(evidence, evidenceDirectory);
  const evaluation = evaluateStagingReadinessGateV1({ ...evidence, nowMs });
  const providerCaptureAuthentication = {
    status: "UNKNOWN" as const,
    reason: "Provider and isolation artifacts are unsigned self-assertions; the V1 evaluator has no trusted capture attestation to verify.",
  };
  const databaseProbeAuthentication = {
    status: "UNKNOWN" as const,
    reason: "A database probe JSON file is not proof that the trusted V1 runner produced it; no runner attestation is available.",
  };
  const unauthenticatedProviderCheck = {
    status: "UNKNOWN" as const,
    reason: "Provider and isolation claims cannot be trusted until a signed or in-process control-plane capture is verified.",
  };
  const unauthenticatedProbeCheck = {
    status: "UNKNOWN" as const,
    reason: "Database probe claims cannot be trusted until the runner output is authenticated.",
  };
  const checks = {
    ...evaluation.checks,
    providerFreshness: unauthenticatedProviderCheck,
    providerIdentity: unauthenticatedProviderCheck,
    providerScope: unauthenticatedProviderCheck,
    providerBranch: unauthenticatedProviderCheck,
    providerEvidenceReference: unauthenticatedProviderCheck,
    stagingLineage: unauthenticatedProviderCheck,
    syntheticOnlyProvenance: unauthenticatedProviderCheck,
    stagingIsolation: unauthenticatedProviderCheck,
    directConnectionTarget: unauthenticatedProbeCheck,
    sameSession: unauthenticatedProbeCheck,
    libpqConnection: unauthenticatedProbeCheck,
    libpqSslMode: unauthenticatedProbeCheck,
    libpqChannelBinding: unauthenticatedProbeCheck,
    libpqSslInUse: unauthenticatedProbeCheck,
    libpqTlsProtocol: unauthenticatedProbeCheck,
    libpqTlsCipher: unauthenticatedProbeCheck,
    serverIdentity: unauthenticatedProbeCheck,
    transactionReadOnly: unauthenticatedProbeCheck,
    applicationRelationsEmpty: unauthenticatedProbeCheck,
    applicationOwnedRelationsEmpty: unauthenticatedProbeCheck,
    applicationTypesEmpty: unauthenticatedProbeCheck,
    drizzleJournalAbsent: unauthenticatedProbeCheck,
    defaultSchemaOnly: unauthenticatedProbeCheck,
    applicationRoutinesAbsent: unauthenticatedProbeCheck,
    allowedExtensionsOnly: unauthenticatedProbeCheck,
    roleMembershipsAbsent: unauthenticatedProbeCheck,
    defaultAclsAbsent: unauthenticatedProbeCheck,
    providerCaptureAuthentication,
    databaseProbeAuthentication,
    databaseProbeFreshness,
    referencedEvidenceIntegrity,
  };
  const states: StagingReadinessState[] = [
    evaluation.status,
    providerCaptureAuthentication.status,
    databaseProbeAuthentication.status,
    databaseProbeFreshness.status,
    referencedEvidenceIntegrity.status,
  ];
  const readiness: StagingReadinessState = states.includes("FAIL")
    ? "FAIL"
    : states.includes("UNKNOWN") ? "UNKNOWN" : "PASS";
  return {
    readiness,
    migrationAllowed: readiness === "PASS" && evaluation.migrationAllowed,
    authorization: evaluation.authorization,
    checks,
    diagnostics: evaluation.diagnostics,
  };
}


export function formatDatabaseProbeEvaluationSummary(report: {
  readiness: StagingReadinessState;
  migrationAllowed: boolean;
  sourceSha: string;
  inputArtifactSha256: string;
  evaluationEvidenceSha256: string;
}): string {
  return [
    `Staging Readiness Gate V1 evaluation: ${report.readiness}`,
    `migrationAllowed=${report.migrationAllowed}`,
    `sourceSha=${report.sourceSha}`,
    `inputEvidenceSha256=${report.inputArtifactSha256}`,
    `evaluationEvidenceSha256=${report.evaluationEvidenceSha256}`,
    "",
  ].join("\n");
}
