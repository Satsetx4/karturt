import {
  parseStagingMigrationAuthorizationArtifact,
  type StagingMigrationAuthorizationArtifact,
} from "./migration-approval";
import { STAGING_MIGRATION_TARGET_MANIFEST } from "../lib/staging-database-target";

export const STAGING_READINESS_PROVIDER_MAX_AGE_MS = 120_000;
export const STAGING_READINESS_FUTURE_TOLERANCE_MS = 60_000;

export type StagingReadinessState = "PASS" | "FAIL" | "UNKNOWN";

export type StagingReadinessCheck = {
  status: StagingReadinessState;
  reason: string;
};

export type StagingIsolationEvidence = {
  /** Fresh, target-bound normalized readback; hashes refer to captured evidence artifacts. */
  observedAtUtc: string | null;
  targetProjectId: string | null;
  targetBranchId: string | null;
  lineage: {
    sourceSha: string | null;
    createRequestMethod: string | null;
    createRequestOperation: string | null;
    createRequestSha256: string | null;
    sourceFieldsOmitted: string[] | null;
    providerReadbackSha256: string | null;
    verificationSource: string | null;
    verificationStatus: string | null;
    createRequestReference: string | null;
    providerReadbackReference: string | null;
    projectParentIdFieldObserved: boolean | null;
    projectParentId: string | null;
    sourceProjectIdFieldObserved: boolean | null;
    sourceProjectId: string | null;
    branchParentIdFieldObserved: boolean | null;
    branchParentId: string | null;
    rootStructureResolution: {
      sourceSha: string | null;
      verificationStatus: string | null;
      resolvesToNewRoot: boolean | null;
      contractReference: string | null;
      explanation: string | null;
      evidenceReference: string | null;
      evidenceSha256: string | null;
    } | null;
  } | null;
  syntheticOnly: {
    classification: string | null;
    sourceSha: string | null;
    datasetManifestSha256: string | null;
    attestationSha256: string | null;
    datasetManifestReference: string | null;
    attestationReference: string | null;
    noProductionData: boolean | null;
  } | null;
} | null;

export type StagingReadinessEvidence = {
  nowMs: number | null;
  sourceSha: string | null;
  provider: {
    observedAtUtc: string | null;
    provider: string | null;
    organizationId: string | null;
    projectId: string | null;
    branchId: string | null;
    endpointId: string | null;
    endpointBranchId: string | null;
    plan: string | null;
    computeMinCU: number | null;
    computeMaxCU: number | null;
    postgresMajor: number | null;
    evidenceReference: string | null;
    evidenceSha256: string | null;
    branch: {
      state: string | null;
      primary: boolean | null;
      default: boolean | null;
      parent_id?: string | null;
      init_source: string | null;
    } | null;
  } | null;
  stagingIsolation: StagingIsolationEvidence;
  connection: {
    sessionId: string | null;
    target: {
      endpointId: string | null;
      hostname: string | null;
      port: number | null;
      databaseName: string | null;
      roleName: string | null;
      pooled: boolean | null;
    } | null;
    libpq: {
      sessionId: string | null;
      connectionSucceeded: boolean | null;
      sslmode: string | null;
      channelBinding: string | null;
      gssEncryptionMode: string | null;
      rootCertificateSource: string | null;
      rootCertificateSha256: string | null;
      sslInUse: boolean | null;
      sslProtocol: string | null;
      sslCipher: string | null;
    } | null;
    server: {
      sessionId: string | null;
      databaseName: string | null;
      roleName: string | null;
      postgresMajor: number | null;
      transactionReadOnly: boolean | null;
    } | null;
    catalog: {
      sessionId: string | null;
      nonSystemSchemaCount: number | null;
      nonSystemSchemaNames: string[] | null;
      applicationRelationCount: number | null;
      applicationOwnedRelationCount: number | null;
      standaloneApplicationTypeCount: number | null;
      drizzleJournalPresent: boolean | null;
      nonSystemRoutineCount: number | null;
      extensionNames: string[] | null;
      roleMembershipCount: number | null;
      defaultAclCount: number | null;
    } | null;
    pgStatSsl: {
      sessionId: string | null;
      ssl: boolean | null;
    } | null;
  } | null;
  authorization?: {
    artifact: StagingMigrationAuthorizationArtifact;
  } | null;
};

export type StagingReadinessSignalsV1Result = {
  /** Rollup of technical evidence checks only; this is not a readiness or authorization decision. */
  technicalStatus: StagingReadinessState;
  checks: {
    providerFreshness: StagingReadinessCheck;
    sourceSha: StagingReadinessCheck;
    providerIdentity: StagingReadinessCheck;
    providerScope: StagingReadinessCheck;
    providerBranch: StagingReadinessCheck;
    providerEvidenceReference: StagingReadinessCheck;
    stagingLineage: StagingReadinessCheck;
    syntheticOnlyProvenance: StagingReadinessCheck;
    stagingIsolation: StagingReadinessCheck;
    directConnectionTarget: StagingReadinessCheck;
    sameSession: StagingReadinessCheck;
    libpqConnection: StagingReadinessCheck;
    libpqSslMode: StagingReadinessCheck;
    libpqChannelBinding: StagingReadinessCheck;
    libpqGssEncryption: StagingReadinessCheck;
    libpqRootCertificatePin: StagingReadinessCheck;
    libpqSslInUse: StagingReadinessCheck;
    libpqTlsProtocol: StagingReadinessCheck;
    libpqTlsCipher: StagingReadinessCheck;
    serverIdentity: StagingReadinessCheck;
    transactionReadOnly: StagingReadinessCheck;
    applicationRelationsEmpty: StagingReadinessCheck;
    applicationOwnedRelationsEmpty: StagingReadinessCheck;
    applicationTypesEmpty: StagingReadinessCheck;
    drizzleJournalAbsent: StagingReadinessCheck;
    defaultSchemaOnly: StagingReadinessCheck;
    applicationRoutinesAbsent: StagingReadinessCheck;
    allowedExtensionsOnly: StagingReadinessCheck;
    roleMembershipsAbsent: StagingReadinessCheck;
    defaultAclsAbsent: StagingReadinessCheck;
  };
  authorizationCheck: StagingReadinessCheck;
  diagnostics: {
    pgStatSsl: "UNKNOWN" | "SESSION_MISMATCH" | "TLS_ACTIVE_ON_BACKEND" | "TLS_INACTIVE_ON_BACKEND";
    clientTlsEvidenceSource: "LIBPQ_SAME_SESSION_ONLY";
    note: string;
  };
};

function check(status: StagingReadinessState, reason: string): StagingReadinessCheck {
  return { status, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringMatch(value: unknown, expected: string, reason: string): StagingReadinessCheck {
  if (!nonEmptyString(value)) return check("UNKNOWN", `Missing ${reason} evidence.`);
  return value === expected ? check("PASS", `${reason} matches the reviewed target.`) :
    check("FAIL", `${reason} does not match the reviewed target.`);
}

function exactNumber(value: unknown, expected: number, reason: string): StagingReadinessCheck {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return check("UNKNOWN", `Missing or invalid ${reason} evidence.`);
  }
  return value === expected ? check("PASS", `${reason} matches the reviewed target.`) :
    check("FAIL", `${reason} does not match the reviewed target.`);
}

function exactBoolean(value: unknown, expected: boolean, reason: string): StagingReadinessCheck {
  if (typeof value !== "boolean") return check("UNKNOWN", `Missing ${reason} evidence.`);
  return value === expected ? check("PASS", `${reason} is confirmed.`) :
    check("FAIL", `${reason} is not satisfied.`);
}

function parseUtcTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) {
    return null;
  }
  const fraction = value.match(/\.(\d{1,7})Z$/)?.[1];
  const normalizedInput = fraction
    ? value.replace(/\.\d{1,7}Z$/, `.${fraction.padEnd(3, "0").slice(0, 3)}Z`)
    : value.replace(/Z$/, ".000Z");
  const parsed = Date.parse(normalizedInput);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === normalizedInput ? parsed : null;
}

function providerFreshnessCheck(provider: Record<string, unknown> | null, nowMs: unknown) {
  if (!provider) return check("UNKNOWN", "Provider metadata is missing.");
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    return check("UNKNOWN", "The provider metadata freshness reference time is missing or invalid.");
  }
  const observedAtMs = parseUtcTimestamp(provider.observedAtUtc);
  if (observedAtMs === null) return check("UNKNOWN", "The provider readback timestamp is missing or invalid.");
  const ageMs = nowMs - observedAtMs;
  if (ageMs < -STAGING_READINESS_FUTURE_TOLERANCE_MS) {
    return check("UNKNOWN", "The provider readback timestamp is too far in the future.");
  }
  if (ageMs > STAGING_READINESS_PROVIDER_MAX_AGE_MS) {
    return check("UNKNOWN", "Provider metadata is stale; refresh the provider readback.");
  }
  return check("PASS", "Provider metadata is within the 120-second freshness window.");
}

function providerIdentityCheck(provider: Record<string, unknown> | null) {
  if (!provider) return check("UNKNOWN", "Provider metadata is missing.");
  const fields: Array<[unknown, string, string]> = [
    [provider.provider, "neon", "Provider"],
    [provider.organizationId, STAGING_MIGRATION_TARGET_MANIFEST.organizationId, "Organization identity"],
    [provider.projectId, STAGING_MIGRATION_TARGET_MANIFEST.projectId, "Project identity"],
    [provider.branchId, STAGING_MIGRATION_TARGET_MANIFEST.branchId, "Branch identity"],
    [provider.endpointId, STAGING_MIGRATION_TARGET_MANIFEST.endpointId, "Endpoint identity"],
    [provider.endpointBranchId, STAGING_MIGRATION_TARGET_MANIFEST.branchId, "Endpoint branch binding"],
  ];
  const results = fields.map(([value, expected, name]) => stringMatch(value, expected, name));
  return combineChecks(results, "Provider identity matches the reviewed staging target.", "Provider identity evidence is incomplete.");
}

function sourceShaCheck(value: unknown): StagingReadinessCheck {
  if (!nonEmptyString(value)) return check("UNKNOWN", "Exact source SHA evidence is missing.");
  return /^[a-f0-9]{40}$/.test(value)
    ? check("PASS", "Exact source SHA is present.")
    : check("FAIL", "Source SHA is not a full lowercase 40-character Git SHA.");
}

function providerScopeCheck(provider: Record<string, unknown> | null) {
  if (!provider) return check("UNKNOWN", "Provider metadata is missing.");
  const planCheck = stringMatch(provider.plan, "free", "Organization plan");
  return combineChecks([
    planCheck,
    exactNumber(provider.computeMinCU, 0.25, "Free-plan minimum compute bound"),
    exactNumber(provider.computeMaxCU, 0.25, "Free-plan maximum compute bound"),
    exactNumber(provider.postgresMajor, 18, "Provider PostgreSQL major version"),
  ], "Provider plan, compute size, and PostgreSQL version match staging scope.", "Provider scope evidence is incomplete.");
}

function providerBranchCheck(provider: Record<string, unknown> | null) {
  if (!provider) return check("UNKNOWN", "Provider branch metadata is missing.");
  const branch = record(provider.branch);
  if (!branch) return check("UNKNOWN", "Provider branch metadata is missing.");
  return combineChecks([
    stringMatch(branch.state, "ready", "Provider branch state"),
    exactBoolean(branch.primary, true, "Provider branch primary state"),
    exactBoolean(branch.default, true, "Provider branch default state"),
  ], "Provider branch is ready, primary, and default.", "Provider branch metadata is incomplete.");
}

function boundedReferenceCheck(value: unknown, label: string): StagingReadinessCheck {
  if (!nonEmptyString(value)) return check("UNKNOWN", `${label} is missing.`);
  const safeRelativeLocator = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/.test(value) &&
    !value.split("/").some((part) => part === "." || part === "..");
  if (!safeRelativeLocator || /[\u0000-\u001f\u007f]/.test(value)) {
    return check("FAIL", `${label} is not a safe bounded reference.`);
  }
  return check("PASS", `${label} is present as a bounded reference.`);
}

function boundedTextCheck(value: unknown, label: string): StagingReadinessCheck {
  if (!nonEmptyString(value)) return check("UNKNOWN", `${label} is missing.`);
  if (value.length > 1024 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    return check("FAIL", `${label} is not safe bounded text.`);
  }
  return check("PASS", `${label} is present as safe bounded text.`);
}

function providerEvidenceReferenceCheck(provider: Record<string, unknown> | null) {
  if (!provider) return check("UNKNOWN", "Provider evidence reference is missing.");
  return combineChecks([
    boundedReferenceCheck(provider.evidenceReference, "Provider evidence reference"),
    sha256Check(provider.evidenceSha256, "Provider evidence file"),
  ], "Provider evidence reference and digest are present.", "Provider evidence reference or digest is incomplete.");
}

function verificationStatusCheck(value: unknown, label: string): StagingReadinessCheck {
  if (!nonEmptyString(value)) return check("UNKNOWN", `${label} is missing.`);
  if (value === "VERIFIED") return check("PASS", `${label} is verified.`);
  if (value === "REJECTED") return check("FAIL", `${label} is rejected.`);
  return check("UNKNOWN", `${label} is not verified.`);
}

const REQUIRED_OMITTED_LINEAGE_FIELDS = [
  "parent_id",
  "parent_project_id",
  "source_project_id",
  "clone",
  "import",
  "restore",
] as const;

const branchRootContractReference = "https://neon.com/docs/manage/branches";

function sha256Check(value: unknown, label: string): StagingReadinessCheck {
  if (!nonEmptyString(value)) return check("UNKNOWN", `${label} evidence is missing.`);
  return /^[a-f0-9]{64}$/.test(value)
    ? check("PASS", `${label} is present as a SHA-256 digest.`)
    : check("FAIL", `${label} is not a valid SHA-256 digest.`);
}

function lineageCheck(
  isolation: Record<string, unknown> | null,
  nowMs: unknown,
  provider: Record<string, unknown> | null,
  sourceSha: unknown,
): StagingReadinessCheck {
  if (!isolation) return check("UNKNOWN", "Explicit staging lineage evidence is missing.");
  const lineage = record(isolation.lineage);
  if (!lineage) return check("UNKNOWN", "Explicit staging lineage evidence is missing.");
  const branch = record(provider?.branch);

  const observedAtMs = parseUtcTimestamp(isolation.observedAtUtc);
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs) || observedAtMs === null) {
    return check("UNKNOWN", "Staging lineage readback time is missing or invalid.");
  }
  const ageMs = nowMs - observedAtMs;
  if (ageMs > STAGING_READINESS_PROVIDER_MAX_AGE_MS || ageMs < -STAGING_READINESS_FUTURE_TOLERANCE_MS) {
    return check("UNKNOWN", "Staging lineage readback is stale or too far in the future.");
  }

  const targetChecks = [
    stringMatch(isolation.targetProjectId, STAGING_MIGRATION_TARGET_MANIFEST.projectId, "Lineage project identity"),
    stringMatch(isolation.targetBranchId, STAGING_MIGRATION_TARGET_MANIFEST.branchId, "Lineage branch identity"),
  ];
  const requestChecks = [
    !nonEmptyString(lineage.sourceSha) || !nonEmptyString(sourceSha)
      ? check("UNKNOWN", "Staging lineage is not bound to an exact source SHA.")
      : lineage.sourceSha === sourceSha
        ? check("PASS", "Staging lineage is bound to the evaluated source SHA.")
        : check("FAIL", "Staging lineage is bound to a different source SHA."),
    stringMatch(lineage.createRequestMethod, "POST", "Lineage create-request method"),
    stringMatch(lineage.createRequestOperation, "create-project", "Lineage create-request operation"),
    stringMatch(lineage.verificationSource, "provider-api-create-request-and-readback", "Lineage verification source"),
    verificationStatusCheck(lineage.verificationStatus, "Lineage verification status"),
    boundedReferenceCheck(lineage.createRequestReference, "Lineage create-request reference"),
    boundedReferenceCheck(lineage.providerReadbackReference, "Provider lineage readback reference"),
    sha256Check(lineage.createRequestSha256, "Lineage create-request evidence"),
    sha256Check(lineage.providerReadbackSha256, "Provider lineage readback evidence"),
  ];
  const omittedFields = lineage.sourceFieldsOmitted;
  let omittedFieldsCheck: StagingReadinessCheck;
  if (!Array.isArray(omittedFields) || omittedFields.some((field) => typeof field !== "string")) {
    omittedFieldsCheck = check("UNKNOWN", "Create-request source-field omission evidence is missing or invalid.");
  } else if (!REQUIRED_OMITTED_LINEAGE_FIELDS.every((field) => omittedFields.includes(field))) {
    omittedFieldsCheck = check("FAIL", "The create request does not attest omission of every clone, import, restore, and parent-source field.");
  } else {
    omittedFieldsCheck = check("PASS", "The create request attests omission of all parent, clone, import, and restore source fields.");
  }

  const rootResolution = rootStructureResolutionCheck(lineage.rootStructureResolution, sourceSha);
  const parentFieldChecks: StagingReadinessCheck[] = [];
  for (const [observedKey, valueKey, label] of [
    ["projectParentIdFieldObserved", "projectParentId", "Project parent id"],
    ["sourceProjectIdFieldObserved", "sourceProjectId", "Project source id"],
    ["branchParentIdFieldObserved", "branchParentId", "Branch parent id"],
  ] as const) {
    if (typeof lineage[observedKey] !== "boolean") {
      parentFieldChecks.push(check("UNKNOWN", `${label} provider readback is missing.`));
    } else if (lineage[observedKey] === false) {
      parentFieldChecks.push(rootResolution.status === "PASS"
        ? check("PASS", `${label} is omitted by the provider response and resolved by the verified new-project root contract.`)
        : check("UNKNOWN", `${label} was omitted from provider readback without a verified new-project root resolution.`));
    } else if (lineage[valueKey] === null) {
      parentFieldChecks.push(check("PASS", `${label} was explicitly read back as null.`));
    } else if (nonEmptyString(lineage[valueKey])) {
      parentFieldChecks.push(check("FAIL", `${label} identifies a parent or source project.`));
    } else {
      parentFieldChecks.push(check("UNKNOWN", `${label} provider readback is incomplete.`));
    }
  }

  const branchParentIdCheck = !branch || !Object.prototype.hasOwnProperty.call(branch, "parent_id")
    ? rootResolution.status === "PASS"
      ? check("PASS", "Provider omits branch parent_id; the exact new-project root contract resolves the branch as root.")
      : check("UNKNOWN", "Provider branch parent_id was omitted without a verified new-project root resolution.")
    : branch.parent_id === null
      ? check("PASS", "Provider branch parent_id was explicitly read back as null.")
      : nonEmptyString(branch.parent_id)
        ? check("FAIL", "Provider branch parent_id identifies a parent branch.")
        : check("UNKNOWN", "Provider branch parent_id readback is incomplete.");
  const branchParentObservationCheck = !branch || typeof lineage.branchParentIdFieldObserved !== "boolean"
    ? check("UNKNOWN", "Provider branch parent_id presence is not bound to its raw readback.")
    : Object.prototype.hasOwnProperty.call(branch, "parent_id") === lineage.branchParentIdFieldObserved
      ? check("PASS", "Provider branch parent_id presence matches the recorded observed-versus-omitted state.")
      : check("FAIL", "Provider branch parent_id was normalized differently from the raw field-presence evidence.");

  const initSource = branch?.init_source;
  const rootResolutionRequired = initSource === "parent-data" || !branch ||
    !Object.prototype.hasOwnProperty.call(branch, "parent_id") ||
    lineage.projectParentIdFieldObserved === false ||
    lineage.sourceProjectIdFieldObserved === false ||
    lineage.branchParentIdFieldObserved === false;
  const initSourceCheck = !nonEmptyString(initSource)
    ? check("UNKNOWN", "Provider branch initialization source is missing.")
    : initSource.trim().toLowerCase() === "blank"
      ? check("PASS", "Provider branch initialization source is explicitly blank.")
    : initSource.trim().toLowerCase() === "parent-data"
      ? rootResolution
        : ["unknown", "omitted", "not-returned"].includes(initSource.trim().toLowerCase())
          ? check("UNKNOWN", "Provider branch initialization source is ambiguous and does not prove isolation.")
          : check("FAIL", "Provider branch initialization source is not an explicitly blank or resolved root source.");

  return combineChecks(
    [...targetChecks, ...requestChecks, omittedFieldsCheck, ...parentFieldChecks, branchParentIdCheck, branchParentObservationCheck,
      ...(rootResolutionRequired ? [rootResolution] : []), initSourceCheck],
    "Provider-bound creation and readback fields match the reviewed root-lineage criteria.",
    "Staging lineage evidence is incomplete; isolation remains UNKNOWN.",
  );
}

function rootStructureResolutionCheck(resolution: unknown, sourceSha: unknown): StagingReadinessCheck {
  const details = record(resolution);
  if (!details) return check("UNKNOWN", "Provider-omitted parent fields or init_source=parent-data have no source-bound root-contract resolution.");

  const status = verificationStatusCheck(details.verificationStatus, "new-project root-contract verification status");
  const resolutionCheck = exactBoolean(details.resolvesToNewRoot, true, "new-project root-contract resolution");
  const sourceBinding = !nonEmptyString(details.sourceSha) || !nonEmptyString(sourceSha)
    ? check("UNKNOWN", "New-project root-contract resolution is not bound to a source SHA.")
    : details.sourceSha === sourceSha
      ? check("PASS", "New-project root-contract resolution is bound to the evaluated source SHA.")
      : check("FAIL", "New-project root-contract resolution is bound to a different source SHA.");
  const reference = stringMatch(details.contractReference, branchRootContractReference, "Neon root-branch contract reference");
  return combineChecks([
    status,
    resolutionCheck,
    sourceBinding,
    reference,
    boundedTextCheck(details.explanation, "new-project root resolution explanation"),
    boundedReferenceCheck(details.evidenceReference, "new-project root resolution evidence reference"),
    sha256Check(details.evidenceSha256, "new-project root resolution evidence"),
  ], "The exact new-project request and provider readback resolve to the Neon root/default branch contract.", "Provider root-branch structure remains unresolved.");
}

function syntheticOnlyProvenanceCheck(
  isolation: Record<string, unknown> | null,
  sourceSha: unknown,
): StagingReadinessCheck {
  if (!isolation) return check("UNKNOWN", "Synthetic-only provenance evidence is missing.");
  const provenance = record(isolation.syntheticOnly);
  if (!provenance) return check("UNKNOWN", "Synthetic-only provenance evidence is missing.");

  const classification = stringMatch(provenance.classification, "SYNTHETIC_ONLY", "Data provenance classification");
  const sourceBinding = !nonEmptyString(provenance.sourceSha) || !nonEmptyString(sourceSha)
    ? check("UNKNOWN", "Synthetic-data provenance is not bound to a source SHA.")
    : provenance.sourceSha === sourceSha
      ? check("PASS", "Synthetic-data provenance is bound to the evaluated source SHA.")
      : check("FAIL", "Synthetic-data provenance is bound to a different source SHA.");
  const noProductionData = exactBoolean(provenance.noProductionData, true, "No-production-data attestation");
  const checks = [
    classification,
    sourceBinding,
    sha256Check(provenance.datasetManifestSha256, "Synthetic dataset manifest"),
    sha256Check(provenance.attestationSha256, "Synthetic-only provenance attestation"),
    boundedReferenceCheck(provenance.datasetManifestReference, "Synthetic dataset manifest reference"),
    boundedReferenceCheck(provenance.attestationReference, "Synthetic-only provenance attestation reference"),
    noProductionData,
  ];
  return combineChecks(
    checks,
    "Synthetic-only provenance fields are source-bound and exclude production data.",
    "Synthetic-only provenance evidence is incomplete; isolation remains UNKNOWN.",
  );
}

function combineChecks(checks: StagingReadinessCheck[], passReason: string, unknownReason: string) {
  if (checks.some((item) => item.status === "FAIL")) {
    return checks.find((item) => item.status === "FAIL")!;
  }
  if (checks.some((item) => item.status === "UNKNOWN")) return check("UNKNOWN", unknownReason);
  return check("PASS", passReason);
}

function directTargetCheck(target: Record<string, unknown> | null) {
  if (!target) return check("UNKNOWN", "Direct connection target evidence is missing.");
  return combineChecks([
    stringMatch(target.endpointId, STAGING_MIGRATION_TARGET_MANIFEST.endpointId, "Direct endpoint identity"),
    stringMatch(target.hostname, STAGING_MIGRATION_TARGET_MANIFEST.directHostname, "Direct endpoint hostname"),
    exactNumber(target.port, STAGING_MIGRATION_TARGET_MANIFEST.port, "Direct endpoint port"),
    stringMatch(target.databaseName, STAGING_MIGRATION_TARGET_MANIFEST.databaseName, "Direct database identity"),
    stringMatch(target.roleName, STAGING_MIGRATION_TARGET_MANIFEST.roleName, "Direct role identity"),
    exactBoolean(target.pooled, false, "Direct non-pooler connection"),
  ], "Connection uses the reviewed direct staging endpoint, database, and role.", "Direct target evidence is incomplete.");
}

function sameSessionCheck(
  connection: Record<string, unknown> | null,
  libpq: Record<string, unknown> | null,
  server: Record<string, unknown> | null,
  catalog: Record<string, unknown> | null,
) {
  if (!connection || !libpq || !server || !catalog) {
    return check("UNKNOWN", "Same-session libpq, server, and catalog evidence is incomplete.");
  }
  const sessionIds = [connection.sessionId, libpq.sessionId, server.sessionId, catalog.sessionId];
  if (sessionIds.some((id) => !nonEmptyString(id))) {
    return check("UNKNOWN", "Same-session identifiers are missing.");
  }
  if (sessionIds.some((id) => id !== sessionIds[0])) {
    return check("FAIL", "libpq, server, and catalog evidence do not share one session identifier.");
  }
  return check("PASS", "libpq, server, and catalog evidence share one session identifier.");
}

function tlsProtocolCheck(value: unknown) {
  if (!nonEmptyString(value)) return check("UNKNOWN", "libpq TLS protocol evidence is missing.");
  return /^TLSv1\.(2|3)$/i.test(value.trim())
    ? check("PASS", "libpq negotiated TLS 1.2 or later.")
    : check("FAIL", "libpq negotiated an unsupported or weak TLS protocol.");
}

function tlsCipherCheck(value: unknown) {
  if (!nonEmptyString(value)) return check("UNKNOWN", "libpq TLS cipher evidence is missing.");
  const weakCipherToken = /(?:^|[_-])(?:NULL|ANON|ADH|AECDH|EXPORT|RC4|DES|3DES|MD5)(?:$|[_-])/i;
  return weakCipherToken.test(value.trim())
    ? check("FAIL", "libpq negotiated a weak or unauthenticated TLS cipher.")
    : check("PASS", "libpq reports a nonempty TLS cipher.");
}

function rootCertificatePinCheck(source: unknown, digest: unknown) {
  if (!nonEmptyString(source) || !nonEmptyString(digest)) {
    return check("UNKNOWN", "Pinned root certificate source or digest evidence is missing.");
  }
  return source === "protected-environment-variable:KARTURT_STAGING_CA_SHA256" && /^[a-f0-9]{64}$/.test(digest)
    ? check("PASS", "The trusted root certificate source and SHA-256 pin are recorded.")
    : check("FAIL", "The trusted root certificate source or SHA-256 pin is invalid.");
}

function serverIdentityCheck(server: Record<string, unknown> | null) {
  if (!server) return check("UNKNOWN", "Server identity evidence is missing.");
  return combineChecks([
    stringMatch(server.databaseName, STAGING_MIGRATION_TARGET_MANIFEST.databaseName, "Connected database"),
    stringMatch(server.roleName, STAGING_MIGRATION_TARGET_MANIFEST.roleName, "Connected role"),
    exactNumber(server.postgresMajor, 18, "Connected PostgreSQL major version"),
  ], "Connected database, role, and PostgreSQL major version match staging scope.", "Server identity evidence is incomplete.");
}

function emptyCountCheck(value: unknown, label: string): StagingReadinessCheck {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return check("UNKNOWN", `${label} evidence is missing or invalid.`);
  }
  return value === 0
    ? check("PASS", `${label} is zero.`)
    : check("FAIL", `${label} is nonzero.`);
}

function exactStringArrayCheck(value: unknown, expected: readonly string[], label: string): StagingReadinessCheck {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return check("UNKNOWN", `${label} evidence is missing or invalid.`);
  }
  const actual = [...value] as string[];
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    return check("FAIL", `${label} does not match the reviewed empty-database baseline.`);
  }
  return check("PASS", `${label} matches the reviewed empty-database baseline.`);
}

function authorizationCheck(authorization: unknown): StagingReadinessCheck {
  if (authorization === null || authorization === undefined) {
    return check("UNKNOWN", "No separate staging migration authorization was supplied.");
  }
  if (!isRecord(authorization)) {
    return check("FAIL", "Separate staging migration authorization is malformed.");
  }
  const artifact = record(authorization.artifact);
  if (!artifact) {
    return check("FAIL", "Separate staging migration authorization is malformed.");
  }
  try {
    parseStagingMigrationAuthorizationArtifact(JSON.stringify(artifact));
    return check("UNKNOWN", "The migration operator verifies this one-shot authorization after the readiness report is finalized.");
  } catch {
    return check("FAIL", "Separate staging migration authorization is malformed.");
  }
}

function pgStatSslDiagnostic(connection: Record<string, unknown> | null, pgStatSsl: Record<string, unknown> | null) {
  if (!connection || !pgStatSsl || typeof pgStatSsl.ssl !== "boolean") return "UNKNOWN" as const;
  if (!nonEmptyString(connection.sessionId) || pgStatSsl.sessionId !== connection.sessionId) {
    return "SESSION_MISMATCH" as const;
  }
  return pgStatSsl.ssl ? "TLS_ACTIVE_ON_BACKEND" as const : "TLS_INACTIVE_ON_BACKEND" as const;
}

function resultStatus(checks: Record<string, StagingReadinessCheck>): StagingReadinessState {
  const states = Object.values(checks).map((item) => item.status);
  if (states.includes("FAIL")) return "FAIL";
  if (states.includes("UNKNOWN")) return "UNKNOWN";
  return "PASS";
}

/**
 * Evaluates sanitized, already-collected technical evidence only. Its
 * `technicalStatus` is a rollup of technical checks, not an overall staging
 * readiness decision. The separate `authorizationCheck` is informative and
 * never grants migration permission. This function never creates a database
 * client, reads environment variables or secret files, runs SQL, or performs
 * writes. `pg_stat_ssl` is retained only as a backend-leg diagnostic; it is
 * never treated as evidence of the libpq client's TLS state or given a cause.
 */
export function evaluateStagingReadinessSignalsV1(
  evidence: StagingReadinessEvidence,
): StagingReadinessSignalsV1Result {
  const root = record(evidence);
  const provider = record(root?.provider);
  const stagingIsolation = record(root?.stagingIsolation);
  const connection = record(root?.connection);
  const target = record(connection?.target);
  const libpq = record(connection?.libpq);
  const server = record(connection?.server);
  const catalog = record(connection?.catalog);
  const pgStatSsl = record(connection?.pgStatSsl);

  const sameSession = sameSessionCheck(connection, libpq, server, catalog);
  const clientTlsChecks = {
    libpqConnection: exactBoolean(libpq?.connectionSucceeded, true, "Successful libpq connection"),
    libpqSslMode: stringMatch(libpq?.sslmode, "verify-full", "libpq sslmode"),
    libpqChannelBinding: stringMatch(libpq?.channelBinding, "require", "libpq channel binding"),
    libpqGssEncryption: stringMatch(libpq?.gssEncryptionMode, "disable", "libpq GSS encryption mode"),
    libpqRootCertificatePin: rootCertificatePinCheck(libpq?.rootCertificateSource, libpq?.rootCertificateSha256),
    libpqSslInUse: exactBoolean(libpq?.sslInUse, true, "libpq SSL-in-use state"),
    libpqTlsProtocol: tlsProtocolCheck(libpq?.sslProtocol),
    libpqTlsCipher: tlsCipherCheck(libpq?.sslCipher),
  };

  const checks = {
    providerFreshness: providerFreshnessCheck(provider, root?.nowMs),
    sourceSha: sourceShaCheck(root?.sourceSha),
    providerIdentity: providerIdentityCheck(provider),
    providerScope: providerScopeCheck(provider),
    providerBranch: providerBranchCheck(provider),
    providerEvidenceReference: providerEvidenceReferenceCheck(provider),
    stagingLineage: lineageCheck(stagingIsolation, root?.nowMs, provider, root?.sourceSha),
    syntheticOnlyProvenance: syntheticOnlyProvenanceCheck(stagingIsolation, root?.sourceSha),
    stagingIsolation: check("UNKNOWN", "Staging isolation evidence is incomplete."),
    directConnectionTarget: directTargetCheck(target),
    sameSession,
    ...clientTlsChecks,
    serverIdentity: serverIdentityCheck(server),
    transactionReadOnly: exactBoolean(server?.transactionReadOnly, true, "Read-only transaction"),
    applicationRelationsEmpty: emptyCountCheck(catalog?.applicationRelationCount, "Application relation count"),
    applicationOwnedRelationsEmpty: emptyCountCheck(catalog?.applicationOwnedRelationCount, "Application-owned relation count"),
    applicationTypesEmpty: emptyCountCheck(catalog?.standaloneApplicationTypeCount, "Standalone application type count"),
    drizzleJournalAbsent: exactBoolean(catalog?.drizzleJournalPresent, false, "Drizzle journal absence"),
    defaultSchemaOnly: combineChecks([
      exactNumber(catalog?.nonSystemSchemaCount, 1, "Non-system schema count"),
      exactStringArrayCheck(catalog?.nonSystemSchemaNames, ["public"], "Non-system schema names"),
    ], "Only the default public schema exists.", "Non-system schema baseline evidence is incomplete."),
    applicationRoutinesAbsent: emptyCountCheck(catalog?.nonSystemRoutineCount, "Non-system routine count"),
    allowedExtensionsOnly: exactStringArrayCheck(catalog?.extensionNames, ["plpgsql"], "Installed extensions"),
    roleMembershipsAbsent: emptyCountCheck(catalog?.roleMembershipCount, "Current-role membership count"),
    defaultAclsAbsent: emptyCountCheck(catalog?.defaultAclCount, "Default ACL count"),
  };
  checks.stagingIsolation = combineChecks(
    [checks.providerBranch, checks.stagingLineage, checks.syntheticOnlyProvenance],
    "Staging lineage and synthetic-only provenance are both verified.",
    "Staging isolation is not proven; the technical isolation check remains UNKNOWN.",
  );
  const technicalStatus = resultStatus(checks);
  const separateAuthorizationCheck = authorizationCheck(root?.authorization);
  const pgStatSslState = pgStatSslDiagnostic(connection, pgStatSsl);

  return {
    technicalStatus,
    checks,
    authorizationCheck: separateAuthorizationCheck,
    diagnostics: {
      pgStatSsl: pgStatSslState,
      clientTlsEvidenceSource: "LIBPQ_SAME_SESSION_ONLY",
      note: pgStatSslState === "TLS_INACTIVE_ON_BACKEND"
        ? "pg_stat_ssl reports TLS inactive on the backend connection; this is diagnostic only, does not explain the cause, and does not satisfy or negate the separate libpq client TLS checks."
        : "pg_stat_ssl is diagnostic only and is never treated as libpq client TLS evidence.",
    },
  };
}
