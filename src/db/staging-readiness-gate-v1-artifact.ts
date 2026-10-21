import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StagingReadinessCheck, StagingReadinessState } from "./staging-readiness-gate-v1";
import { STAGING_MIGRATION_TARGET_MANIFEST } from "../lib/staging-database-target";

const EVIDENCE_ARTIFACT_SCHEMA = "staging-readiness-gate-v1/evidence-artifact/v1";
const EVIDENCE_ARTIFACT_MAX_BYTES = 128 * 1024;
const PROBE_FRESHNESS_MAX_AGE_MS = 120_000;
const FUTURE_TOLERANCE_MS = 60_000;
const REQUIRED_OMITTED_LINEAGE_FIELDS = [
  "parent_id",
  "parent_project_id",
  "source_project_id",
  "clone",
  "import",
  "restore",
] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableJsonValue(left)) === JSON.stringify(stableJsonValue(right));
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) {
    return null;
  }
  const fraction = value.match(/\.(\d{1,7})Z$/)?.[1];
  const normalized = fraction
    ? value.replace(/\.\d{1,7}Z$/, `.${fraction.padEnd(3, "0").slice(0, 3)}Z`)
    : value.replace(/Z$/, ".000Z");
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === normalized ? parsed : null;
}

function check(status: StagingReadinessState, reason: string): StagingReadinessCheck {
  return { status, reason };
}

export function databaseProbeFreshnessCheck(artifact: unknown, nowMs: number): StagingReadinessCheck {
  if (!isRecord(artifact) || !Number.isFinite(nowMs)) {
    return check("UNKNOWN", "Database probe completion time is missing or invalid.");
  }
  const startedAt = timestampMs(artifact.startedAtUtc);
  const completedAt = timestampMs(artifact.completedAtUtc);
  if (startedAt === null || completedAt === null || completedAt < startedAt) {
    return check("UNKNOWN", "Database probe timestamps are missing, malformed, or out of order.");
  }
  if (completedAt - startedAt > PROBE_FRESHNESS_MAX_AGE_MS) {
    return check("UNKNOWN", "Database probe duration exceeds the freshness window.");
  }
  const ageMs = nowMs - completedAt;
  if (ageMs < -FUTURE_TOLERANCE_MS || ageMs > PROBE_FRESHNESS_MAX_AGE_MS) {
    return check("UNKNOWN", "Database probe completion is stale or too far in the future.");
  }
  return check("PASS", "Database probe completed within the 120-second freshness window.");
}

function boundedRelativePath(root: string, reference: unknown): string | null {
  if (typeof reference !== "string" || reference.length === 0 || reference.length > 1024 ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/.test(reference) ||
      reference.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, reference);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return resolvedPath;
}

function readReferencedArtifact(
  root: string,
  reference: unknown,
  expectedSha256: unknown,
  expectedType: string,
  sourceSha: unknown,
): { status: "PASS" | "UNKNOWN" | "FAIL"; value?: JsonRecord } {
  const resolved = boundedRelativePath(root, reference);
  if (!resolved || typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return { status: "UNKNOWN" };
  }
  try {
    let directory = path.dirname(resolved);
    while (directory !== path.dirname(directory)) {
      const directoryStat = lstatSync(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return { status: "FAIL" };
      if (path.resolve(directory) === path.resolve(root)) break;
      const relative = path.relative(path.resolve(root), directory);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { status: "FAIL" };
      directory = path.dirname(directory);
    }
    const fileStat = lstatSync(resolved);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size < 2 || fileStat.size > EVIDENCE_ARTIFACT_MAX_BYTES) {
      return { status: "FAIL" };
    }
    const bytes = readFileSync(resolved);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== expectedSha256) return { status: "FAIL" };
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(parsed) || parsed.schemaVersion !== EVIDENCE_ARTIFACT_SCHEMA ||
        parsed.artifactType !== expectedType || parsed.sourceSha !== sourceSha) {
      return { status: "FAIL" };
    }
    return { status: "PASS", value: parsed };
  } catch {
    return { status: "UNKNOWN" };
  }
}

function matchesTarget(value: unknown): boolean {
  return field(value, "targetProjectId") === STAGING_MIGRATION_TARGET_MANIFEST.projectId &&
    field(value, "targetBranchId") === STAGING_MIGRATION_TARGET_MANIFEST.branchId;
}

function isTrue(value: unknown): boolean {
  return value === true;
}

function referencedArtifactChecks(
  evidence: unknown,
  evidenceDirectory: string,
): StagingReadinessCheck[] {
  if (!isRecord(evidence) || !isRecord(evidence.provider) || !isRecord(evidence.stagingIsolation)) {
    return [check("UNKNOWN", "Referenced provider and isolation evidence is missing.")];
  }
  const sourceSha = evidence.sourceSha;
  const provider = evidence.provider;
  const isolation = evidence.stagingIsolation;
  const lineage = field(isolation, "lineage");
  const syntheticOnly = field(isolation, "syntheticOnly");
  if (!isRecord(lineage) || !isRecord(syntheticOnly)) {
    return [check("UNKNOWN", "Referenced lineage and synthetic-only evidence is missing.")];
  }

  const artifacts = [
    readReferencedArtifact(evidenceDirectory, provider.evidenceReference, provider.evidenceSha256, "provider-metadata", sourceSha),
    readReferencedArtifact(evidenceDirectory, lineage.createRequestReference, lineage.createRequestSha256, "lineage-create-request", sourceSha),
    readReferencedArtifact(evidenceDirectory, lineage.providerReadbackReference, lineage.providerReadbackSha256, "provider-lineage-readback", sourceSha),
    readReferencedArtifact(evidenceDirectory, syntheticOnly.datasetManifestReference, syntheticOnly.datasetManifestSha256, "synthetic-dataset-manifest", sourceSha),
    readReferencedArtifact(evidenceDirectory, syntheticOnly.attestationReference, syntheticOnly.attestationSha256, "synthetic-only-attestation", sourceSha),
  ];

  const initSource = field(field(provider, "branch"), "init_source");
  let resolutionArtifact: ReturnType<typeof readReferencedArtifact> | null = null;
  const resolution = field(lineage, "parentDataResolution");
  if (initSource === "parent-data") {
    if (!isRecord(resolution)) {
      artifacts.push({ status: "UNKNOWN" });
    } else {
      resolutionArtifact = readReferencedArtifact(
        evidenceDirectory,
        resolution.evidenceReference,
        resolution.evidenceSha256,
        "parent-data-resolution",
        sourceSha,
      );
      artifacts.push(resolutionArtifact);
    }
  }

  if (artifacts.some((item) => item.status === "FAIL")) {
    return [check("FAIL", "A referenced evidence artifact failed its digest or source binding check.")];
  }
  if (artifacts.some((item) => item.status === "UNKNOWN")) {
    return [check("UNKNOWN", "One or more referenced evidence artifacts are missing or unverifiable.")];
  }

  const [providerArtifact, createRequest, providerReadback, datasetManifest, attestation] = artifacts.map((item) => item.value);
  const rawProvider = field(providerArtifact, "provider");
  const rawProviderBranch = field(rawProvider, "branch");
  const evaluatedBranch = field(provider, "branch");
  const providerForComparison = isRecord(provider) ? { ...provider } : null;
  if (providerForComparison) delete providerForComparison.evidenceSha256;
  const providerFields = ["provider", "organizationId", "projectId", "branchId", "endpointId", "plan",
    "computeMinCU", "computeMaxCU", "postgresMajor", "observedAtUtc", "evidenceReference"] as const;
  const providerMismatch = providerFields.some((name) => field(rawProvider, name) !== field(provider, name)) ||
    !sameJson(providerForComparison, rawProvider);
  const branchFields = ["state", "primary", "default", "parent_id", "init_source"] as const;
  const branchMismatch = branchFields.some((name) => field(rawProviderBranch, name) !== field(evaluatedBranch, name));
  if (!providerArtifact || !isRecord(rawProvider) || !createRequest || !providerReadback || !datasetManifest || !attestation ||
      providerMismatch || branchMismatch || !sameJson(field(providerArtifact, "stagingIsolation"), isolation) ||
      !matchesTarget(createRequest) || !matchesTarget(providerReadback) ||
      createRequest.method !== "POST" || createRequest.operation !== "create-project" ||
      !Array.isArray(createRequest.sourceFieldsOmitted) ||
      !REQUIRED_OMITTED_LINEAGE_FIELDS.every((name) => createRequest.sourceFieldsOmitted.includes(name)) ||
      !matchesTarget(datasetManifest) || !matchesTarget(attestation) ||
      datasetManifest.classification !== "SYNTHETIC_ONLY" || attestation.classification !== "SYNTHETIC_ONLY" ||
      !isTrue(datasetManifest.noProductionData) || !isTrue(attestation.noProductionData)) {
    return [check("FAIL", "Referenced evidence contents do not match the exact target and reviewed provenance requirements.")];
  }

  const parentFields = [
    "projectParentIdFieldObserved",
    "projectParentId",
    "sourceProjectIdFieldObserved",
    "sourceProjectId",
    "branchParentIdFieldObserved",
    "branchParentId",
  ] as const;
  if (parentFields.some((name) => providerReadback[name] !== lineage[name]) ||
      providerReadback.init_source !== initSource ||
      (initSource === "parent-data" && (!resolutionArtifact?.value ||
        !matchesTarget(resolutionArtifact.value) ||
        resolutionArtifact.value.verificationStatus !== "VERIFIED" ||
        resolutionArtifact.value.resolvesToNewRoot !== true))) {
    return [check("FAIL", "Referenced lineage readback does not match the evaluated root-lineage claims.")];
  }
  return [check("PASS", "Every referenced provider, lineage, and synthetic-only artifact matches its exact bytes, target, and source SHA.")];
}

export function referencedEvidenceIntegrityCheck(evidence: unknown, evidenceDirectory: string): StagingReadinessCheck {
  const results = referencedArtifactChecks(evidence, evidenceDirectory);
  return results[0];
}
