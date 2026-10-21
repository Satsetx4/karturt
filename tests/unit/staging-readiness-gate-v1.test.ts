import { describe, expect, it } from "vitest";
import {
  evaluateStagingReadinessGateV1,
  STAGING_READINESS_PROVIDER_MAX_AGE_MS,
  type StagingReadinessEvidence,
  type StagingReadinessGateV1Result,
  type StagingReadinessState,
} from "../../src/db/staging-readiness-gate-v1";
import { STAGING_MIGRATION_TARGET_MANIFEST } from "../../src/lib/staging-database-target";

const nowMs = Date.parse("2026-10-21T10:00:00.000Z");
type CheckName = keyof StagingReadinessGateV1Result["checks"];
type EvidenceMutation = (evidence: StagingReadinessEvidence) => void;

function validEvidence(): StagingReadinessEvidence {
  const sessionId = "backend-session-123";
  return {
    nowMs,
    sourceSha: "a".repeat(40),
    provider: {
      observedAtUtc: new Date(nowMs - 30_000).toISOString(),
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
      evidenceSha256: "e".repeat(64),
      branch: {
        state: "ready",
        primary: true,
        default: true,
        parent_id: null,
        init_source: "blank",
      },
    },
    stagingIsolation: null,
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
      },
      pgStatSsl: { sessionId, ssl: false },
    },
  };
}

function withVerifiedIsolation(evidence = validEvidence()): StagingReadinessEvidence {
  evidence.stagingIsolation = {
    observedAtUtc: new Date(nowMs - 30_000).toISOString(),
    targetProjectId: STAGING_MIGRATION_TARGET_MANIFEST.projectId,
    targetBranchId: STAGING_MIGRATION_TARGET_MANIFEST.branchId,
    lineage: {
      sourceSha: evidence.sourceSha,
      createRequestMethod: "POST",
      createRequestOperation: "create-project",
      createRequestSha256: "a".repeat(64),
      sourceFieldsOmitted: ["parent_id", "parent_project_id", "source_project_id", "clone", "import", "restore"],
      providerReadbackSha256: "b".repeat(64),
      verificationSource: "provider-api-create-request-and-readback",
      verificationStatus: "VERIFIED",
      createRequestReference: "lineage/create-project.json",
      providerReadbackReference: "lineage/provider-readback.json",
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
      sourceSha: evidence.sourceSha,
      datasetManifestSha256: "c".repeat(64),
      attestationSha256: "d".repeat(64),
      datasetManifestReference: "provenance/dataset-manifest.json",
      attestationReference: "provenance/attestation.json",
      noProductionData: true,
    },
  };
  return evidence;
}

function expectCheck(mutate: EvidenceMutation, name: CheckName, status: StagingReadinessState) {
  const evidence = validEvidence();
  mutate(evidence);
  expect(evaluateStagingReadinessGateV1(evidence).checks[name].status).toBe(status);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("Staging Readiness Gate V1", () => {
  it("passes technical readiness for the exact reviewed target while keeping migration closed without separate authorization", () => {
    const result = evaluateStagingReadinessGateV1(withVerifiedIsolation());

    expect(result.status).toBe("PASS");
    expect(result.checks.stagingLineage.status).toBe("PASS");
    expect(result.checks.syntheticOnlyProvenance.status).toBe("PASS");
    expect(result.checks.stagingIsolation.status).toBe("PASS");
    expect(result.migrationAllowed).toBe(false);
    expect(result.authorization.status).toBe("UNKNOWN");
  });

  it("keeps isolation and overall readiness UNKNOWN when no explicit lineage or synthetic-only evidence exists", () => {
    const result = evaluateStagingReadinessGateV1(validEvidence());

    expect(result.status).toBe("UNKNOWN");
    expect(result.checks.stagingLineage.status).toBe("UNKNOWN");
    expect(result.checks.syntheticOnlyProvenance.status).toBe("UNKNOWN");
    expect(result.checks.stagingIsolation.status).toBe("UNKNOWN");
    expect(result.migrationAllowed).toBe(false);
  });

  it("does not infer isolation from an init_source=parent-data readback", () => {
    const evidence = withVerifiedIsolation();
    evidence.provider!.branch!.init_source = "parent-data";
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.status).toBe("UNKNOWN");
    expect(result.checks.stagingLineage.status).toBe("UNKNOWN");
    expect(result.checks.stagingIsolation.status).toBe("UNKNOWN");
    expect(result.migrationAllowed).toBe(false);
  });

  it("accepts init_source=parent-data only with verified source-bound root-resolution evidence", () => {
    const evidence = withVerifiedIsolation();
    evidence.provider!.branch!.init_source = "parent-data";
    evidence.stagingIsolation!.lineage!.parentDataResolution = {
      sourceSha: evidence.sourceSha,
      verificationStatus: "VERIFIED",
      resolvesToNewRoot: true,
      explanation: "Provider create request and readback independently resolve the branch origin.",
      evidenceReference: "lineage/parent-data-resolution.json",
      evidenceSha256: "e".repeat(64),
    };
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.status).toBe("PASS");
    expect(result.checks.stagingLineage.status).toBe("PASS");
    expect(result.migrationAllowed).toBe(false);
  });

  it("keeps init_source=parent-data UNKNOWN when its resolution is not verified", () => {
    const evidence = withVerifiedIsolation();
    evidence.provider!.branch!.init_source = "parent-data";
    evidence.stagingIsolation!.lineage!.parentDataResolution = {
      sourceSha: evidence.sourceSha,
      verificationStatus: "PENDING",
      resolvesToNewRoot: true,
      explanation: "Pending review.",
      evidenceReference: "lineage/pending.json",
      evidenceSha256: "e".repeat(64),
    };
    expect(evaluateStagingReadinessGateV1(evidence).checks.stagingLineage.status).toBe("UNKNOWN");
  });

  it("keeps isolation UNKNOWN when its provider lineage snapshot is stale", () => {
    const evidence = withVerifiedIsolation();
    evidence.stagingIsolation!.observedAtUtc = new Date(nowMs - STAGING_READINESS_PROVIDER_MAX_AGE_MS - 1).toISOString();
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.checks.stagingLineage.status).toBe("UNKNOWN");
    expect(result.checks.stagingIsolation.status).toBe("UNKNOWN");
    expect(result.migrationAllowed).toBe(false);
  });

  it("accepts the exact 120-second provider-readback age boundary", () => {
    const evidence = validEvidence();
    evidence.provider!.observedAtUtc = new Date(nowMs - STAGING_READINESS_PROVIDER_MAX_AGE_MS).toISOString();

    expect(evaluateStagingReadinessGateV1(evidence).checks.providerFreshness.status).toBe("PASS");
  });

  it("marks provider metadata older than 120 seconds as UNKNOWN", () => {
    const evidence = validEvidence();
    evidence.provider!.observedAtUtc = new Date(nowMs - STAGING_READINESS_PROVIDER_MAX_AGE_MS - 1).toISOString();

    expect(evaluateStagingReadinessGateV1(evidence).checks.providerFreshness.status).toBe("UNKNOWN");
  });

  it("rejects a provider timestamp too far in the future as UNKNOWN", () => {
    const evidence = validEvidence();
    evidence.provider!.observedAtUtc = new Date(nowMs + 60_001).toISOString();

    expect(evaluateStagingReadinessGateV1(evidence).checks.providerFreshness.status).toBe("UNKNOWN");
  });

  it("treats a pg_stat_ssl false result as a backend diagnostic and never as client TLS proof", () => {
    const evidence = withVerifiedIsolation();
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.status).toBe("PASS");
    expect(result.checks.libpqSslInUse.status).toBe("PASS");
    expect(result.diagnostics.pgStatSsl).toBe("TLS_INACTIVE_ON_BACKEND");
    expect(result.diagnostics.clientTlsEvidenceSource).toBe("LIBPQ_SAME_SESSION_ONLY");
    expect(result.diagnostics.note).toContain("does not explain the cause");
    expect(/Neon proxy|proxy causes/i.test(result.diagnostics.note)).toBe(false);
  });

  it("does not allow pg_stat_ssl=true to compensate for missing libpq TLS", () => {
    const evidence = withVerifiedIsolation();
    evidence.connection!.pgStatSsl!.ssl = true;
    evidence.connection!.libpq!.sslInUse = false;
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.status).toBe("FAIL");
    expect(result.checks.libpqSslInUse.status).toBe("FAIL");
    expect(result.diagnostics.pgStatSsl).toBe("TLS_ACTIVE_ON_BACKEND");
    expect(result.migrationAllowed).toBe(false);
  });

  it("reports a pg_stat_ssl session mismatch diagnostically without changing libpq readiness", () => {
    const evidence = withVerifiedIsolation();
    evidence.connection!.pgStatSsl!.sessionId = "different-diagnostic-session";
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.status).toBe("PASS");
    expect(result.checks.sameSession.status).toBe("PASS");
    expect(result.diagnostics.pgStatSsl).toBe("SESSION_MISMATCH");
  });

  it("keeps readiness independent from migration authorization and fails closed without a pinned trust anchor", () => {
    const evidence = withVerifiedIsolation();
    evidence.authorization = {
      artifact: {
        schemaVersion: 1,
        payload: {
          purpose: "karturt-v1-staging-migration",
          authorizationId: "b".repeat(64),
          sourceSha: evidence.sourceSha!,
          targetManifestFingerprint: "c".repeat(64),
          migrationManifestFingerprint: "d".repeat(64),
          issuedAt: new Date(nowMs - 1_000).toISOString(),
          expiresAt: new Date(nowMs + 60_000).toISOString(),
        },
        signature: "AA==",
      },
    };
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.status).toBe("PASS");
    expect(result.authorization.status).toBe("UNKNOWN");
    expect(result.authorization.reason).toContain("No trusted");
    expect(result.migrationAllowed).toBe(false);
  });

  it("fails malformed authorization evidence independently from technical readiness", () => {
    const evidence = withVerifiedIsolation();
    evidence.authorization = { artifact: {} as never };
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.status).toBe("PASS");
    expect(result.authorization.status).toBe("FAIL");
    expect(result.migrationAllowed).toBe(false);
  });

  it("never opens migration when the staging isolation gate fails", () => {
    const evidence = withVerifiedIsolation();
    evidence.stagingIsolation!.lineage!.branchParentId = "br-inherited";
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.status).toBe("FAIL");
    expect(result.checks.stagingIsolation.status).toBe("FAIL");
    expect(result.migrationAllowed).toBe(false);
  });

  it("does not mutate or write to supplied evidence", () => {
    const evidence = deepFreeze(validEvidence());
    const before = structuredClone(evidence);

    let didThrow = false;
    try {
      evaluateStagingReadinessGateV1(evidence);
    } catch {
      didThrow = true;
    }
    expect(didThrow).toBe(false);
    expect(evidence).toEqual(before);
    expect(evaluateStagingReadinessGateV1(evidence).migrationAllowed).toBe(false);
  });

  const unknownCases: Array<{ name: string; check: CheckName; mutate: EvidenceMutation }> = [
    { name: "missing provider timestamp", check: "providerFreshness", mutate: (e) => { e.provider!.observedAtUtc = null; } },
    { name: "missing exact source SHA", check: "sourceSha", mutate: (e) => { e.sourceSha = null; } },
    { name: "missing provider organization", check: "providerIdentity", mutate: (e) => { e.provider!.organizationId = null; } },
    { name: "missing provider plan", check: "providerScope", mutate: (e) => { e.provider!.plan = null; } },
    { name: "missing provider branch", check: "providerBranch", mutate: (e) => { e.provider!.branch = null; } },
    { name: "missing provider evidence reference", check: "providerEvidenceReference", mutate: (e) => { e.provider!.evidenceReference = null; } },
    { name: "missing provider evidence digest", check: "providerEvidenceReference", mutate: (e) => { e.provider!.evidenceSha256 = null; } },
    { name: "missing Free-plan minimum compute bound", check: "providerScope", mutate: (e) => { e.provider!.computeMinCU = null; } },
    { name: "missing Free-plan maximum compute bound", check: "providerScope", mutate: (e) => { e.provider!.computeMaxCU = null; } },
    { name: "missing direct hostname", check: "directConnectionTarget", mutate: (e) => { e.connection!.target!.hostname = null; } },
    { name: "missing session id", check: "sameSession", mutate: (e) => { e.connection!.libpq!.sessionId = null; } },
    { name: "missing libpq connection result", check: "libpqConnection", mutate: (e) => { e.connection!.libpq!.connectionSucceeded = null; } },
    { name: "missing libpq sslmode", check: "libpqSslMode", mutate: (e) => { e.connection!.libpq!.sslmode = null; } },
    { name: "missing libpq channel binding", check: "libpqChannelBinding", mutate: (e) => { e.connection!.libpq!.channelBinding = null; } },
    { name: "missing libpq SSL state", check: "libpqSslInUse", mutate: (e) => { e.connection!.libpq!.sslInUse = null; } },
    { name: "missing TLS protocol", check: "libpqTlsProtocol", mutate: (e) => { e.connection!.libpq!.sslProtocol = null; } },
    { name: "missing TLS cipher", check: "libpqTlsCipher", mutate: (e) => { e.connection!.libpq!.sslCipher = null; } },
    { name: "missing server database", check: "serverIdentity", mutate: (e) => { e.connection!.server!.databaseName = null; } },
    { name: "missing read-only proof", check: "transactionReadOnly", mutate: (e) => { e.connection!.server!.transactionReadOnly = null; } },
    { name: "missing relation count", check: "applicationRelationsEmpty", mutate: (e) => { e.connection!.catalog!.applicationRelationCount = null; } },
    { name: "missing schema names", check: "defaultSchemaOnly", mutate: (e) => { e.connection!.catalog!.nonSystemSchemaNames = null; } },
    { name: "missing routine count", check: "applicationRoutinesAbsent", mutate: (e) => { e.connection!.catalog!.nonSystemRoutineCount = null; } },
    { name: "missing extension names", check: "allowedExtensionsOnly", mutate: (e) => { e.connection!.catalog!.extensionNames = null; } },
    { name: "missing role membership count", check: "roleMembershipsAbsent", mutate: (e) => { e.connection!.catalog!.roleMembershipCount = null; } },
    { name: "missing default ACL count", check: "defaultAclsAbsent", mutate: (e) => { e.connection!.catalog!.defaultAclCount = null; } },
    { name: "missing type count", check: "applicationTypesEmpty", mutate: (e) => { e.connection!.catalog!.standaloneApplicationTypeCount = null; } },
    { name: "missing Drizzle journal state", check: "drizzleJournalAbsent", mutate: (e) => { e.connection!.catalog!.drizzleJournalPresent = null; } },
    { name: "missing lineage provider field", check: "stagingLineage", mutate: (e) => { e.stagingIsolation = null; } },
    { name: "missing synthetic-only provenance", check: "syntheticOnlyProvenance", mutate: (e) => { e.stagingIsolation = null; } },
    { name: "omitted provider branch parent_id", check: "stagingLineage", mutate: (e) => { delete e.provider!.branch!.parent_id; } },
  ];

  for (const testCase of unknownCases) {
    it(`returns UNKNOWN for ${testCase.name}`, () => expectCheck(testCase.mutate, testCase.check, "UNKNOWN"));
  }

  const failureCases: Array<{ name: string; check: CheckName; mutate: EvidenceMutation }> = [
    { name: "wrong provider", check: "providerIdentity", mutate: (e) => { e.provider!.provider = "other"; } },
    { name: "wrong organization", check: "providerIdentity", mutate: (e) => { e.provider!.organizationId = "wrong-org"; } },
    { name: "wrong project", check: "providerIdentity", mutate: (e) => { e.provider!.projectId = "wrong-project"; } },
    { name: "wrong branch", check: "providerIdentity", mutate: (e) => { e.provider!.branchId = "wrong-branch"; } },
    { name: "wrong endpoint", check: "providerIdentity", mutate: (e) => { e.provider!.endpointId = "wrong-endpoint"; } },
    { name: "non-Free plan", check: "providerScope", mutate: (e) => { e.provider!.plan = "pro"; } },
    { name: "internal plan id used as organization plan", check: "providerScope", mutate: (e) => { e.provider!.plan = "free_v3"; } },
    { name: "provider branch is not ready", check: "providerBranch", mutate: (e) => { e.provider!.branch!.state = "idle"; } },
    { name: "provider branch is not primary", check: "providerBranch", mutate: (e) => { e.provider!.branch!.primary = false; } },
    { name: "provider branch is not default", check: "providerBranch", mutate: (e) => { e.provider!.branch!.default = false; } },
    { name: "unsafe provider evidence reference", check: "providerEvidenceReference", mutate: (e) => { e.provider!.evidenceReference = "x".repeat(1025); } },
    { name: "absolute local provider evidence path", check: "providerEvidenceReference", mutate: (e) => { e.provider!.evidenceReference = "D:/Users/owner/private.json"; } },
    { name: "provider evidence path traversal", check: "providerEvidenceReference", mutate: (e) => { e.provider!.evidenceReference = "../../private.json"; } },
    { name: "malformed exact source SHA", check: "sourceSha", mutate: (e) => { e.sourceSha = "not-a-git-sha"; } },
    { name: "Free-plan minimum compute bound is not 0.25 CU", check: "providerScope", mutate: (e) => { e.provider!.computeMinCU = 0.5; } },
    { name: "Free-plan maximum compute bound is not 0.25 CU", check: "providerScope", mutate: (e) => { e.provider!.computeMaxCU = 0.5; } },
    { name: "wrong provider PostgreSQL version", check: "providerScope", mutate: (e) => { e.provider!.postgresMajor = 17; } },
    { name: "wrong direct endpoint", check: "directConnectionTarget", mutate: (e) => { e.connection!.target!.endpointId = "wrong-endpoint"; } },
    { name: "wrong direct hostname", check: "directConnectionTarget", mutate: (e) => { e.connection!.target!.hostname = "pooler.example.invalid"; } },
    { name: "wrong direct port", check: "directConnectionTarget", mutate: (e) => { e.connection!.target!.port = 6432; } },
    { name: "wrong database", check: "directConnectionTarget", mutate: (e) => { e.connection!.target!.databaseName = "postgres"; } },
    { name: "wrong role", check: "directConnectionTarget", mutate: (e) => { e.connection!.target!.roleName = "other_role"; } },
    { name: "pooled endpoint", check: "directConnectionTarget", mutate: (e) => { e.connection!.target!.pooled = true; } },
    { name: "different libpq session", check: "sameSession", mutate: (e) => { e.connection!.libpq!.sessionId = "other-session"; } },
    { name: "failed libpq connection", check: "libpqConnection", mutate: (e) => { e.connection!.libpq!.connectionSucceeded = false; } },
    { name: "sslmode=require", check: "libpqSslMode", mutate: (e) => { e.connection!.libpq!.sslmode = "require"; } },
    { name: "channel_binding not required", check: "libpqChannelBinding", mutate: (e) => { e.connection!.libpq!.channelBinding = "prefer"; } },
    { name: "libpq SSL inactive", check: "libpqSslInUse", mutate: (e) => { e.connection!.libpq!.sslInUse = false; } },
    { name: "weak TLS protocol", check: "libpqTlsProtocol", mutate: (e) => { e.connection!.libpq!.sslProtocol = "TLSv1.1"; } },
    { name: "weak 3DES cipher", check: "libpqTlsCipher", mutate: (e) => { e.connection!.libpq!.sslCipher = "TLS_RSA_WITH_3DES_EDE_CBC_SHA"; } },
    { name: "wrong server database", check: "serverIdentity", mutate: (e) => { e.connection!.server!.databaseName = "postgres"; } },
    { name: "wrong server role", check: "serverIdentity", mutate: (e) => { e.connection!.server!.roleName = "other_role"; } },
    { name: "wrong server PostgreSQL version", check: "serverIdentity", mutate: (e) => { e.connection!.server!.postgresMajor = 17; } },
    { name: "read-write transaction", check: "transactionReadOnly", mutate: (e) => { e.connection!.server!.transactionReadOnly = false; } },
    { name: "application relation exists", check: "applicationRelationsEmpty", mutate: (e) => { e.connection!.catalog!.applicationRelationCount = 1; } },
    { name: "application-owned relation exists", check: "applicationOwnedRelationsEmpty", mutate: (e) => { e.connection!.catalog!.applicationOwnedRelationCount = 1; } },
    { name: "standalone application type exists", check: "applicationTypesEmpty", mutate: (e) => { e.connection!.catalog!.standaloneApplicationTypeCount = 1; } },
    { name: "Drizzle journal exists", check: "drizzleJournalAbsent", mutate: (e) => { e.connection!.catalog!.drizzleJournalPresent = true; } },
    { name: "unexpected non-system schema exists", check: "defaultSchemaOnly", mutate: (e) => { e.connection!.catalog!.nonSystemSchemaNames = ["app", "public"]; e.connection!.catalog!.nonSystemSchemaCount = 2; } },
    { name: "unexpected routine exists", check: "applicationRoutinesAbsent", mutate: (e) => { e.connection!.catalog!.nonSystemRoutineCount = 1; } },
    { name: "unexpected extension installed", check: "allowedExtensionsOnly", mutate: (e) => { e.connection!.catalog!.extensionNames = ["plpgsql", "postgis"]; } },
    { name: "role has unexpected membership", check: "roleMembershipsAbsent", mutate: (e) => { e.connection!.catalog!.roleMembershipCount = 1; } },
    { name: "default ACL exists", check: "defaultAclsAbsent", mutate: (e) => { e.connection!.catalog!.defaultAclCount = 1; } },
  ];

  for (const testCase of failureCases) {
    it(`returns FAIL for ${testCase.name}`, () => expectCheck(testCase.mutate, testCase.check, "FAIL"));
  }

  it("returns UNKNOWN when the connection evidence is absent", () => {
    const evidence = validEvidence();
    evidence.connection = null;
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.status).toBe("UNKNOWN");
    expect(result.checks.directConnectionTarget.status).toBe("UNKNOWN");
    expect(result.checks.sameSession.status).toBe("UNKNOWN");
    expect(result.migrationAllowed).toBe(false);
  });

  it("returns UNKNOWN for invalid catalog counts instead of treating them as empty", () => {
    for (const count of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const evidence = validEvidence();
      evidence.connection!.catalog!.applicationRelationCount = count;
      expect(evaluateStagingReadinessGateV1(evidence).checks.applicationRelationsEmpty.status).toBe("UNKNOWN");
    }
  });

  it("fails lineage when an explicit project or branch parent is present", () => {
    const evidence = withVerifiedIsolation();
    evidence.stagingIsolation!.lineage!.projectParentId = "parent-project";
    expect(evaluateStagingReadinessGateV1(evidence).checks.stagingLineage.status).toBe("FAIL");
  });

  it("fails lineage evidence bound to a different target project", () => {
    const evidence = withVerifiedIsolation();
    evidence.stagingIsolation!.targetProjectId = "different-project";
    expect(evaluateStagingReadinessGateV1(evidence).checks.stagingLineage.status).toBe("FAIL");
  });

  it("keeps lineage UNKNOWN when provider omits parent fields instead of returning explicit nulls", () => {
    const evidence = withVerifiedIsolation();
    evidence.stagingIsolation!.lineage!.branchParentIdFieldObserved = false;
    const result = evaluateStagingReadinessGateV1(evidence);

    expect(result.checks.stagingLineage.status).toBe("UNKNOWN");
    expect(result.checks.stagingIsolation.status).toBe("UNKNOWN");
  });

  it("fails when the create request does not attest omission of all source and clone fields", () => {
    const evidence = withVerifiedIsolation();
    evidence.stagingIsolation!.lineage!.sourceFieldsOmitted = ["parent_id", "clone"];
    expect(evaluateStagingReadinessGateV1(evidence).checks.stagingLineage.status).toBe("FAIL");
  });

  it("fails synthetic provenance that is source-mismatched or includes production data", () => {
    const wrongSource = withVerifiedIsolation();
    wrongSource.stagingIsolation!.syntheticOnly!.sourceSha = "e".repeat(40);
    expect(evaluateStagingReadinessGateV1(wrongSource).checks.syntheticOnlyProvenance.status).toBe("FAIL");

    const productionData = withVerifiedIsolation();
    productionData.stagingIsolation!.syntheticOnly!.noProductionData = false;
    expect(evaluateStagingReadinessGateV1(productionData).checks.syntheticOnlyProvenance.status).toBe("FAIL");
  });

  it("prioritizes any failed safety check over missing evidence", () => {
    const evidence = validEvidence();
    evidence.provider!.organizationId = "wrong-org";
    evidence.connection!.catalog!.standaloneApplicationTypeCount = null;

    expect(evaluateStagingReadinessGateV1(evidence).status).toBe("FAIL");
  });
});
