import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { evaluateDatabaseProbeArtifact } from "./staging-readiness-gate-v1-cli-policy";
import type { StagingReadinessEvidence } from "./staging-readiness-gate-v1";
import { STAGING_MIGRATION_TARGET_MANIFEST } from "../lib/staging-database-target";

const MAX_ARTIFACT_BYTES = 128 * 1024;
const MAX_FRESHNESS_AGE_MS = 120_000;
const FUTURE_TOLERANCE_MS = 60_000;
const EVALUATION_SCHEMA = "staging-readiness-gate-v1/evaluation/v1";
const PROBE_SCHEMA = "staging-readiness-gate-v1/database-probe-evidence/v1";

type JsonRecord = Record<string, unknown>;

export type StagingReadinessBindingInput = {
  repositoryRoot: string;
  evaluationPath: string;
  probeEvidencePath: string;
  sourceSha: string;
  nowMs: number;
};

export type VerifiedStagingReadinessBinding = {
  evaluationSha256: string;
  completedAtUtc: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(stableJsonValue(left)) === JSON.stringify(stableJsonValue(right));
}

function parseCanonicalUtc(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return null;
  return parsed;
}

function assertSafeExternalFile(filePath: string, repositoryRoot: string): Buffer {
  if (!isAbsolute(filePath)) throw new Error("path");
  const resolvedPath = resolve(filePath);
  const relativePath = relative(resolve(repositoryRoot), resolvedPath);
  if (relativePath === "" ||
      (!relativePath.startsWith(".." + sep) && relativePath !== ".." && !isAbsolute(relativePath))) {
    throw new Error("path");
  }

  let current = resolvedPath;
  while (true) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("path");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const stat = lstatSync(resolvedPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_ARTIFACT_BYTES) {
    throw new Error("file");
  }
  return readFileSync(resolvedPath);
}

function parseJsonRecord(bytes: Buffer): JsonRecord {
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(value)) throw new Error("json");
  return value;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertExactProbeTarget(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, [
    "organizationId", "projectId", "branchId", "endpointId", "directHostname", "port", "database", "role",
  ])) throw new Error("target");

  const expected = STAGING_MIGRATION_TARGET_MANIFEST;
  if (value.organizationId !== expected.organizationId ||
      value.projectId !== expected.projectId ||
      value.branchId !== expected.branchId ||
      value.endpointId !== expected.endpointId ||
      value.directHostname !== expected.directHostname ||
      value.port !== expected.port ||
      value.database !== expected.databaseName ||
      value.role !== expected.roleName) throw new Error("target");
}

function validateProbeEvidence(
  probe: JsonRecord,
  sourceSha: string,
  repositoryRoot: string,
  evidenceDirectory: string,
  verificationNowMs: number,
) {
  if (!hasExactKeys(probe, [
    "schemaVersion", "result", "sourceSha", "startedAtUtc", "completedAtUtc", "psqlVersion", "psqlSha256",
    "querySha256", "target", "providerMetadata", "providerEvidence", "stagingIsolation",
    "overallGate", "migrationAuthorization", "databaseProbe", "evidence",
  ]) || probe.schemaVersion !== PROBE_SCHEMA ||
      probe.result !== "DATABASE_PROBE_PASS" ||
      probe.providerMetadata !== "NOT_INCLUDED" ||
      probe.stagingIsolation !== "UNKNOWN" ||
      probe.overallGate !== "NOT_EVALUATED" ||
      probe.migrationAuthorization !== "NOT_GRANTED" ||
      probe.sourceSha !== sourceSha ||
      !isRecord(probe.evidence) ||
      probe.evidence.sourceSha !== sourceSha ||
      probe.evidence.authorization !== undefined ||
      !isRecord(probe.providerEvidence) ||
      !isRecord(probe.databaseProbe) ||
      !hasExactKeys(probe.providerEvidence, ["evidenceReference", "evidenceSha256", "preconnectionValidation"]) ||
      probe.providerEvidence.preconnectionValidation !== "PASS" ||
      !hasExactKeys(probe.databaseProbe, [
        "status", "psqlExitCode", "sessionId", "backendPid", "libpq", "transactionReadOnly",
        "catalogCounts", "pgStatSslDiagnostic",
      ]) ||
      probe.databaseProbe.status !== "DATABASE_PROBE_PASS" ||
      probe.databaseProbe.psqlExitCode !== 0 ||
      typeof probe.psqlVersion !== "string" ||
      !/^psql \(PostgreSQL\) 18\./.test(probe.psqlVersion) ||
      typeof probe.psqlSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(probe.psqlSha256) ||
      typeof probe.querySha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(probe.querySha256)) throw new Error("probe");

  assertExactProbeTarget(probe.target);

  const evidence = probe.evidence;
  if (!hasExactKeys(evidence, ["nowMs", "sourceSha", "provider", "stagingIsolation", "connection"]) ||
      !isRecord(evidence.provider) ||
      !hasExactKeys(evidence.provider, [
        "observedAtUtc", "provider", "organizationId", "projectId", "branchId", "endpointId", "endpointBranchId", "plan",
        "computeMinCU", "computeMaxCU", "postgresMajor", "evidenceReference", "evidenceSha256", "branch",
      ]) ||
      !isRecord(evidence.provider.branch) ||
      !isRecord(evidence.stagingIsolation) ||
      !hasExactKeys(evidence.stagingIsolation, ["observedAtUtc", "targetProjectId", "targetBranchId", "lineage", "syntheticOnly"]) ||
      !isRecord(evidence.stagingIsolation.lineage) ||
      !isRecord(evidence.stagingIsolation.syntheticOnly) ||
      !hasExactKeys(evidence.stagingIsolation.syntheticOnly, [
        "classification", "sourceSha", "datasetManifestReference", "datasetManifestSha256",
        "attestationReference", "attestationSha256", "noProductionData",
      ]) ||
      !isRecord(evidence.connection) ||
      !hasExactKeys(evidence.connection, ["sessionId", "target", "libpq", "server", "catalog", "pgStatSsl"]) ||
      !isRecord(evidence.connection.target) ||
      !hasExactKeys(evidence.connection.target, ["endpointId", "hostname", "port", "databaseName", "roleName", "pooled"]) ||
      !isRecord(evidence.connection.libpq) ||
      !hasExactKeys(evidence.connection.libpq, [
        "sessionId", "connectionSucceeded", "sslmode", "channelBinding", "gssEncryptionMode",
        "rootCertificateSource", "rootCertificateSha256", "sslInUse", "sslProtocol", "sslCipher",
      ]) ||
      !isRecord(evidence.connection.server) ||
      !hasExactKeys(evidence.connection.server, [
        "sessionId", "databaseName", "roleName", "postgresMajor", "transactionReadOnly", "backendPid",
      ]) ||
      !isRecord(evidence.connection.catalog) ||
      !hasExactKeys(evidence.connection.catalog, [
        "sessionId", "nonSystemSchemaCount", "nonSystemSchemaNames", "applicationRelationCount",
        "applicationOwnedRelationCount", "standaloneApplicationTypeCount", "drizzleJournalPresent",
        "nonSystemRoutineCount", "extensionNames", "roleMembershipCount", "defaultAclCount", "counts", "backendPid",
      ]) ||
      !isRecord(evidence.connection.catalog.counts) ||
      !isRecord(evidence.connection.pgStatSsl) ||
      !hasExactKeys(evidence.connection.pgStatSsl, ["sessionId", "ssl"]) ||
      !isRecord(probe.databaseProbe.libpq) ||
      !hasExactKeys(probe.databaseProbe.libpq, [
        "sslmode", "channelBinding", "gssEncryptionMode", "rootCertificateSource", "rootCertificateSha256",
        "tlsProtocol", "tlsCipher", "directHostIdentityVerified",
      ]) ||
      !isRecord(probe.databaseProbe.catalogCounts)) throw new Error("probe-shape");

  const connection = evidence.connection as JsonRecord;
  if (!Number.isSafeInteger(evidence.nowMs)) throw new Error("probe-time");
  const lineage = evidence.stagingIsolation.lineage;
  const branch = evidence.provider.branch;
  const branchParentIdObserved = Object.prototype.hasOwnProperty.call(branch, "parent_id");
  const rootResolutionRequired = evidence.provider.branch.init_source === "parent-data" ||
    !branchParentIdObserved ||
    lineage.projectParentIdFieldObserved === false ||
    lineage.sourceProjectIdFieldObserved === false ||
    lineage.branchParentIdFieldObserved === false;
  const expectedBranchKeys = ["state", "primary", "default", "init_source"];
  if (branchParentIdObserved) expectedBranchKeys.push("parent_id");
  if (!hasExactKeys(branch, expectedBranchKeys) ||
      lineage.branchParentIdFieldObserved !== branchParentIdObserved ||
      (branchParentIdObserved && branch.parent_id !== null) ||
      (!branchParentIdObserved && lineage.branchParentId !== null)) throw new Error("provider-branch-shape");
  const expectedLineageKeys = [
    "sourceSha", "verificationSource", "verificationStatus", "createRequestMethod", "createRequestOperation",
    "createRequestReference", "createRequestSha256", "sourceFieldsOmitted", "providerReadbackReference",
    "providerReadbackSha256", "projectParentIdFieldObserved", "projectParentId", "sourceProjectIdFieldObserved",
    "sourceProjectId", "branchParentIdFieldObserved", "branchParentId",
  ];
  if (rootResolutionRequired) expectedLineageKeys.push("rootStructureResolution");
  if (!hasExactKeys(lineage, expectedLineageKeys)) throw new Error("lineage-shape");
  const server = connection.server as JsonRecord;
  const libpq = connection.libpq as JsonRecord;
  const catalog = connection.catalog as JsonRecord;
  const rawCatalog = probe.databaseProbe.catalogCounts;
  const expectedCounts = {
    non_system_schema_count: catalog.nonSystemSchemaCount,
    application_relation_count: catalog.applicationRelationCount,
    application_owned_relation_count: catalog.applicationOwnedRelationCount,
    standalone_application_type_count: catalog.standaloneApplicationTypeCount,
    drizzle_journal_count: catalog.drizzleJournalPresent ? 1 : 0,
    non_system_routine_count: catalog.nonSystemRoutineCount,
    extension_count: Array.isArray(catalog.extensionNames) ? catalog.extensionNames.length : null,
    role_membership_count: catalog.roleMembershipCount,
    default_acl_count: catalog.defaultAclCount,
  };
  const expectedRawCatalog = {
    ...expectedCounts,
    non_system_schema_names: catalog.nonSystemSchemaNames,
    extension_names: catalog.extensionNames,
  };
  if (!sameJson(catalog.counts, expectedCounts) ||
      !sameJson(rawCatalog, expectedRawCatalog) ||
      probe.databaseProbe.sessionId !== connection.sessionId ||
      probe.databaseProbe.backendPid !== server.backendPid ||
      probe.databaseProbe.backendPid !== catalog.backendPid ||
      probe.databaseProbe.transactionReadOnly !== "on" ||
      probe.databaseProbe.libpq.sslmode !== libpq.sslmode ||
      probe.databaseProbe.libpq.channelBinding !== libpq.channelBinding ||
      probe.databaseProbe.libpq.gssEncryptionMode !== libpq.gssEncryptionMode ||
      probe.databaseProbe.libpq.rootCertificateSource !== libpq.rootCertificateSource ||
      probe.databaseProbe.libpq.rootCertificateSha256 !== libpq.rootCertificateSha256 ||
      probe.databaseProbe.libpq.tlsProtocol !== libpq.sslProtocol ||
      probe.databaseProbe.libpq.tlsCipher !== libpq.sslCipher ||
      probe.databaseProbe.libpq.directHostIdentityVerified !== STAGING_MIGRATION_TARGET_MANIFEST.directHostname ||
      probe.databaseProbe.pgStatSslDiagnostic !== "unknown" &&
        probe.databaseProbe.pgStatSslDiagnostic !== "reported-true" &&
        probe.databaseProbe.pgStatSslDiagnostic !== "reported-false") throw new Error("probe-binding");

  const provider = probe.evidence.provider;
  if (!isRecord(provider) ||
      provider.endpointBranchId !== STAGING_MIGRATION_TARGET_MANIFEST.branchId ||
      probe.providerEvidence.evidenceSha256 !== provider.evidenceSha256 ||
      probe.providerEvidence.evidenceReference !== provider.evidenceReference) throw new Error("provider");

  const startedAtMs = parseCanonicalUtc(probe.startedAtUtc);
  const completedAtMs = parseCanonicalUtc(probe.completedAtUtc);
  if (startedAtMs === null || completedAtMs === null || completedAtMs < startedAtMs ||
      completedAtMs - startedAtMs > MAX_FRESHNESS_AGE_MS ||
      completedAtMs > verificationNowMs + FUTURE_TOLERANCE_MS) {
    throw new Error("probe-time");
  }

  const queryBytes = readFileSync(resolve(repositoryRoot, "docs/codex/staging-readiness-gate-v1.sql"));
  if (sha256(queryBytes) !== probe.querySha256) throw new Error("query");

  return evaluateDatabaseProbeArtifact(
    probe.evidence as unknown as StagingReadinessEvidence,
    probe,
    evidenceDirectory,
    verificationNowMs,
  );
}

/**
 * Verifies a fresh V1 report from its exact probe bytes before migration authorization.
 * This function performs no provider or database access and rejects any report that does
 * not recompute to a complete PASS using the current source and pinned target.
 */
export function verifyStagingReadinessBinding(input: StagingReadinessBindingInput): VerifiedStagingReadinessBinding {
  try {
    if (!/^[a-f0-9]{40}$/.test(input.sourceSha) || !Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
      throw new Error("input");
    }
    const evaluationBytes = assertSafeExternalFile(input.evaluationPath, input.repositoryRoot);
    const probeBytes = assertSafeExternalFile(input.probeEvidencePath, input.repositoryRoot);
    if (dirname(resolve(input.evaluationPath)) !== dirname(resolve(input.probeEvidencePath))) {
      throw new Error("directory");
    }

    const evaluation = parseJsonRecord(evaluationBytes);
    if (!hasExactKeys(evaluation, [
      "schemaVersion", "sourceSha", "inputArtifactSha256", "startedAtUtc", "completedAtUtc",
      "readiness", "migrationAllowed", "authorization", "checks", "diagnostics", "executionBoundary",
    ]) || evaluation.schemaVersion !== EVALUATION_SCHEMA ||
        evaluation.sourceSha !== input.sourceSha ||
        evaluation.inputArtifactSha256 !== sha256(probeBytes) ||
        evaluation.migrationAllowed !== false ||
        evaluation.executionBoundary !== "READINESS_EVALUATION_ONLY_NO_DATABASE_OR_PROVIDER_ACCESS" ||
        !isRecord(evaluation.checks)) throw new Error("evaluation");

    const startedAtMs = parseCanonicalUtc(evaluation.startedAtUtc);
    const completedAtMs = parseCanonicalUtc(evaluation.completedAtUtc);
    if (startedAtMs === null || completedAtMs === null || completedAtMs < startedAtMs ||
        completedAtMs - startedAtMs > MAX_FRESHNESS_AGE_MS ||
        input.nowMs - completedAtMs > MAX_FRESHNESS_AGE_MS ||
        input.nowMs - completedAtMs < -FUTURE_TOLERANCE_MS) throw new Error("evaluation-time");

    const probe = parseJsonRecord(probeBytes);
    const recomputed = validateProbeEvidence(
      probe,
      input.sourceSha,
      input.repositoryRoot,
      dirname(resolve(input.probeEvidencePath)),
      input.nowMs,
    );
    if (evaluation.readiness !== "PASS" ||
        recomputed.readiness !== "PASS" ||
        Object.values(recomputed.checks).some((check) => !isRecord(check) || check.status !== "PASS") ||
        !sameJson(evaluation.authorization, recomputed.authorization) ||
        !sameJson(evaluation.checks, recomputed.checks) ||
        !sameJson(evaluation.diagnostics, recomputed.diagnostics)) throw new Error("readiness");
    const expectedSslDiagnostic = recomputed.diagnostics.pgStatSsl === "TLS_ACTIVE_ON_BACKEND"
      ? "reported-true"
      : recomputed.diagnostics.pgStatSsl === "TLS_INACTIVE_ON_BACKEND" ? "reported-false" : "unknown";
    if ((probe.databaseProbe as JsonRecord).pgStatSslDiagnostic !== expectedSslDiagnostic) throw new Error("ssl-diagnostic");

    return {
      evaluationSha256: sha256(evaluationBytes),
      completedAtUtc: evaluation.completedAtUtc as string,
    };
  } catch {
    throw new Error("A fresh, source-bound Gate V1 PASS evaluation could not be verified.");
  }
}
