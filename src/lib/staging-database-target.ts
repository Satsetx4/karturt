import { createHash } from "node:crypto";

/**
 * Candidate target mapping for the separate Staging Readiness Gate V1 project.
 * The original create-request bytes were not retained, and current provider
 * metadata cannot reconstruct them. The selected branch's root lineage is
 * therefore UNKNOWN; default status, an omitted parent_id, and init_source do
 * not establish ancestry. Catalog, synthetic-only data, grants, credential
 * state, migration approval, and runtime readiness are also unproven.
 */
export const STAGING_ROOT_LINEAGE_ATTESTATION = Object.freeze({
  schemaVersion: 1,
  method: "UNKNOWN_CREATE_REQUEST_NOT_RETAINED",
  scope: "project-root-lineage-only",
  organizationId: "org-ancient-boat-57106549",
  projectId: "wild-darkness-00489132",
  projectCreatedAtUtc: "2026-10-21T09:23:42Z",
  createRequest: {
    method: "POST",
    operation: "create-project",
    sourceFieldsOmittedClaimedByToolCall: ["parent_id", "parent_project_id", "source_project_id", "clone", "import", "restore"],
    sourceFieldsOmittedEvidenceStatus: "UNVERIFIED_TOOL_CALL_ONLY",
    requestSha256: null,
    requestSha256Status: "NOT_CAPTURED_TOOL_CALL_ONLY",
  },
  branch: {
    id: "br-spring-shadow-b37rykzl",
    name: "staging-readiness-gate-v1",
    createdAtUtc: "2026-10-21T09:23:42Z",
    isPrimary: true,
    isDefault: true,
    parentIdReadback: "OMITTED_NOT_RETURNED",
    initSourceObserved: "parent-data",
    initSourceInterpretation: "AMBIGUOUS_NOT_LINEAGE_PROOF",
  },
  providerContracts: [
    { url: "https://neon.com/docs/manage/branches", sha256: null },
    { url: "https://api-docs.neon.tech/reference/createproject", sha256: null },
    { url: "https://api-docs.neon.tech/reference/getprojectbranch", sha256: null },
    { url: "https://api-docs.neon.tech/reference/listprojectbranches", sha256: null },
  ],
  rootStructureAssessment: "UNKNOWN_CREATE_REQUEST_HASH_MISSING",
  catalogState: "UNKNOWN",
  syntheticOnlyStatus: "UNKNOWN",
  providerCaptureAuthentication: "UNKNOWN",
} as const);

export const STAGING_MIGRATION_TARGET_MANIFEST = Object.freeze({
  organizationId: "org-ancient-boat-57106549",
  projectId: "wild-darkness-00489132",
  projectName: "karturt-v1-staging-readiness-gate-v1",
  branchName: "staging-readiness-gate-v1",
  branchId: "br-spring-shadow-b37rykzl",
  lineageStatus: "UNKNOWN",
  rootLineageAttestation: STAGING_ROOT_LINEAGE_ATTESTATION,
  region: "aws-ap-southeast-1",
  plan: "free",
  postgresMajor: 18,
  computeCU: 0.25,
  databaseName: "karturt",
  databaseId: 669644,
  roleName: "karturt_owner",
  endpointId: "ep-silent-haze-b3pcaa3t",
  directHostname: "ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech",
  passwordlessAccess: true,
  passwordlessAccessMeaning: "NOT_YET_IMPLEMENTED_UNRELIED_UPON",
  passwordlessAccessContractReference: "https://neon.com/api_spec/release/v2.json",
  passwordlessConnectDocumentationReference: "https://neon.com/docs/connect/passwordless-connect",
  port: 5432,
} as const);

const protectedLegacyStagingTargets = [
  {
    projectId: "broad-star-40451875",
    branchId: "br-orange-recipe-azed9f78",
    databaseId: 708081,
    endpointId: "ep-mute-firefly-azjcru4h",
    hostname: "ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech",
  },
  {
    projectId: "falling-bread-33359184",
    branchId: "br-muddy-frost-azot13fb",
    databaseId: 702718,
    endpointId: "ep-silent-butterfly-azrflu40",
    hostname: "ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech",
  },
  {
    projectId: "wild-art-99835126",
    branchId: "br-hidden-cake-a1ge5xqp",
    databaseId: 42079960,
    endpointId: "ep-snowy-meadow-a10304d9",
    hostname: "ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech",
  },
] as const;

// Do not change this to true based on root-lineage or source-mapping evidence.
const stagingIsolationVerifiedEmpty = false;

const localBootstrapTarget = {
  protocol: "postgresql:",
  username: "karturt",
  hostname: "localhost",
  port: "5432",
  databaseName: "karturt_dev",
} as const;

const postgresProtocols = new Set(["postgres:", "postgresql:"]);
const standardQueryKeys = new Set(["sslmode", "channel_binding"]);
const stagingQueryKeys = new Set([...standardQueryKeys, "endpoint"]);
const sslModes = new Set(["require", "verify-full"]);

function isProtectedStagingEndpoint(hostname: string) {
  const endpointIds = [
    STAGING_MIGRATION_TARGET_MANIFEST.endpointId,
    ...protectedLegacyStagingTargets.map((target) => target.endpointId),
  ];
  const labels = hostname.toLowerCase().split(".");
  return endpointIds.some((endpointId) =>
    labels.some((label) => label === endpointId || label.startsWith(endpointId + "-pooler")),
  );
}

function hasUnambiguousUserInfo(databaseUrl: string) {
  const schemeEnd = databaseUrl.indexOf("://");
  if (schemeEnd < 0) return false;
  const authorityStart = schemeEnd + 3;
  const remainder = databaseUrl.slice(authorityStart);
  const authorityEnd = remainder.search(/[/?#]/);
  const authority = authorityEnd < 0 ? remainder : remainder.slice(0, authorityEnd);
  return authority.split("@").length === 2 && authority.split("@")[0].length > 0;
}

function parsePostgresUrl(
  databaseUrl: string,
  invalidMessage: string,
  allowStagingEndpointParameter = false,
) {
  let parsed: URL;
  try {
    if (
      databaseUrl !== databaseUrl.trim() ||
      /[\u0000-\u0020\u007f]/.test(databaseUrl) ||
      databaseUrl.includes("#")
    ) {
      throw new Error("Invalid PostgreSQL URL syntax.");
    }
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(invalidMessage);
  }

  const databaseName = parsed.pathname.startsWith("/") ? parsed.pathname.slice(1) : "";
  const queryKeys = [...parsed.searchParams.keys()];
  const allowedQueryKeys = allowStagingEndpointParameter ? stagingQueryKeys : standardQueryKeys;
  const hasDuplicateQueryKeys = new Set(queryKeys).size !== queryKeys.length;
  const hasUnsafeQuery = queryKeys.some((key) => !allowedQueryKeys.has(key));
  const hasEmptyQueryDelimiter = databaseUrl.includes("?") && queryKeys.length === 0;
  const rawQueryIndex = databaseUrl.indexOf("?");
  const rawQuery = rawQueryIndex < 0 ? "" : databaseUrl.slice(rawQueryIndex + 1);
  const hasEmptyQueryPart =
    rawQueryIndex >= 0 && rawQuery.split("&").some((part) => part.length === 0);
  const hasUnsafeSslMode =
    parsed.searchParams.has("sslmode") && !sslModes.has(parsed.searchParams.get("sslmode") ?? "");
  const hasUnsafeChannelBinding =
    parsed.searchParams.has("channel_binding") &&
    parsed.searchParams.get("channel_binding") !== "require";

  if (
    !postgresProtocols.has(parsed.protocol) ||
    !parsed.hostname ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,62}$/.test(parsed.username) ||
    !parsed.password ||
    !/^\/[a-zA-Z0-9_-]+$/.test(parsed.pathname) ||
    !/^[a-zA-Z0-9_-]+$/.test(databaseName) ||
    parsed.hash ||
    (allowStagingEndpointParameter && !hasUnambiguousUserInfo(databaseUrl)) ||
    (parsed.port !== "" && parsed.port !== String(STAGING_MIGRATION_TARGET_MANIFEST.port)) ||
    hasDuplicateQueryKeys ||
    hasUnsafeQuery ||
    hasEmptyQueryDelimiter ||
    hasEmptyQueryPart ||
    hasUnsafeSslMode ||
    hasUnsafeChannelBinding
  ) {
    throw new Error(invalidMessage);
  }

  return { parsed, databaseName };
}

function assertStagingTargetIdentity(databaseUrl: string) {
  const { parsed, databaseName } = parsePostgresUrl(
    databaseUrl,
    "Staging migration DATABASE_URL is not an unambiguous PostgreSQL connection URL.",
    true,
  );
  const endpointParameter = parsed.searchParams.get("endpoint");

  if (
    parsed.hostname.toLowerCase() !== STAGING_MIGRATION_TARGET_MANIFEST.directHostname ||
    (parsed.port !== "" && parsed.port !== String(STAGING_MIGRATION_TARGET_MANIFEST.port)) ||
    databaseName !== STAGING_MIGRATION_TARGET_MANIFEST.databaseName ||
    parsed.username !== STAGING_MIGRATION_TARGET_MANIFEST.roleName ||
    !parsed.searchParams.has("sslmode") ||
    parsed.searchParams.get("sslmode") !== "verify-full" ||
    !parsed.searchParams.has("channel_binding") ||
    parsed.searchParams.get("channel_binding") !== "require" ||
    (endpointParameter !== null && endpointParameter !== STAGING_MIGRATION_TARGET_MANIFEST.endpointId)
  ) {
    throw new Error(
      "Staging migration DATABASE_URL must match the reviewed direct target identity manifest " +
        "(project " +
        STAGING_MIGRATION_TARGET_MANIFEST.projectId +
        ", branch " +
        STAGING_MIGRATION_TARGET_MANIFEST.branchId +
        ", database " +
        STAGING_MIGRATION_TARGET_MANIFEST.databaseName +
        " / " +
        STAGING_MIGRATION_TARGET_MANIFEST.databaseId +
        ", role " +
        STAGING_MIGRATION_TARGET_MANIFEST.roleName +
        ", endpoint " +
        STAGING_MIGRATION_TARGET_MANIFEST.endpointId +
        ", port " +
        STAGING_MIGRATION_TARGET_MANIFEST.port +
        ").",
    );
  }
}

/**
 * Validates only that a URL matches the reviewed staging target mapping.
 * It does not check environment labels, authorization, provider metadata,
 * grants, database contents, migration state, or runtime readiness.
 * This function does not open a connection.
 */
export function assertStagingMigrationTarget(databaseUrl: string): void {
  assertStagingTargetIdentity(databaseUrl);
}

/**
 * Returns a stable fingerprint for binding an offline migration approval to
 * this checked-in identity mapping. The fingerprint does not attest the live
 * provider or authorize a migration.
 */
export function getStagingMigrationTargetManifestFingerprint(): string {
  return createHash("sha256")
    .update(JSON.stringify(STAGING_MIGRATION_TARGET_MANIFEST), "utf8")
    .digest("hex");
}

export function assertDatabaseTargetForEnvironment(databaseUrl: string, databaseEnv: string) {
  if (!new Set(["development", "staging", "production", "test"]).has(databaseEnv)) {
    throw new Error("DATABASE_ENV must be development, staging, production, or test.");
  }

  const { parsed } = parsePostgresUrl(
    databaseUrl,
    databaseEnv === "staging"
      ? "Staging DATABASE_URL is not an unambiguous PostgreSQL connection URL."
      : "DATABASE_URL is not an unambiguous PostgreSQL connection URL.",
    databaseEnv === "staging",
  );

  if (databaseEnv === "test") {
    throw new Error("Database URL connections are disabled in test; use in-memory PGlite instead.");
  }

  if (isProtectedStagingEndpoint(parsed.hostname)) {
    if (databaseEnv !== "staging") {
      throw new Error("Staging Neon endpoints cannot be used unless APP_ENV and DATABASE_ENV both equal staging.");
    }
    if (parsed.hostname.toLowerCase() !== STAGING_MIGRATION_TARGET_MANIFEST.directHostname) {
      const legacyTarget = protectedLegacyStagingTargets.find((target) =>
        parsed.hostname.toLowerCase() === target.hostname ||
        parsed.hostname.toLowerCase().split(".").some((label) =>
          label === target.endpointId || label.startsWith(target.endpointId + "-pooler"),
        ),
      );
      throw new Error(
        "The protected legacy staging Neon endpoint for project " +
          (legacyTarget?.projectId ?? "unknown") +
          ", branch " +
          (legacyTarget?.branchId ?? "unknown") +
          ", database " +
          (legacyTarget?.databaseId ?? "unknown") +
          " and all staging pooler endpoints are denied.",
      );
    }
  }

  if (databaseEnv !== "staging") {
    return;
  }

  assertStagingTargetIdentity(databaseUrl);

  if (!stagingIsolationVerifiedEmpty) {
    throw new Error(
      "Staging database runtime access is blocked for project " +
        STAGING_MIGRATION_TARGET_MANIFEST.projectId +
        ", branch " +
        STAGING_MIGRATION_TARGET_MANIFEST.branchId +
        ": runtime readiness and verified emptiness are not established.",
    );
  }
}

export function assertBootstrapDatabaseTarget(
  databaseUrl: string | undefined,
  appEnv: string,
  databaseEnv: string,
): "pglite" | "local-development-postgres" {
  if (appEnv !== databaseEnv) {
    throw new Error("Bootstrap requires matching application and database environment labels.");
  }
  if (appEnv === "test") {
    if (databaseUrl !== undefined) {
      throw new Error("Test bootstrap must use in-memory PGlite and must not receive DATABASE_URL.");
    }
    return "pglite";
  }
  if (appEnv !== "development") {
    throw new Error("Bootstrap database access is disabled for production and staging environments.");
  }
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required for local development bootstrap.");
  }

  const { parsed, databaseName } = parsePostgresUrl(
    databaseUrl,
    "Bootstrap DATABASE_URL must target the documented local development database.",
  );
  if (
    parsed.protocol !== localBootstrapTarget.protocol ||
    parsed.href !== databaseUrl ||
    parsed.username !== localBootstrapTarget.username ||
    parsed.hostname !== localBootstrapTarget.hostname ||
    parsed.port !== localBootstrapTarget.port ||
    databaseName !== localBootstrapTarget.databaseName ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Bootstrap DATABASE_URL must match the documented local development target exactly.");
  }
  return "local-development-postgres";
}
