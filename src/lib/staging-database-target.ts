import { createHash } from "node:crypto";

/**
 * Reviewed source mapping for the Wave 12.6B staging resource.
 *
 * This mapping is not live provider attestation. It does not prove project or
 * branch ownership, grants, credential state, database contents, migration
 * approval, or runtime readiness.
 */
export const STAGING_MIGRATION_TARGET_MANIFEST = Object.freeze({
  organizationId: "org-ancient-boat-57106549",
  projectId: "falling-bread-33359184",
  projectName: "karturt-v1-staging-clean",
  branchName: "staging",
  branchId: "br-muddy-frost-azot13fb",
  region: "aws-ap-southeast-1",
  databaseName: "karturt_staging",
  databaseId: 702718,
  roleName: "karturt_staging_owner",
  endpointId: "ep-silent-butterfly-azrflu40",
  directHostname: "ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech",
  port: 5432,
} as const);

const legacyStagingTarget = {
  projectId: "wild-art-99835126",
  branchId: "br-hidden-cake-a1ge5xqp",
  databaseId: 42079960,
  endpointId: "ep-snowy-meadow-a10304d9",
  hostname: "ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech",
} as const;

// Do not change this to true based on the source mapping or catalog-scope evidence.
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
  const endpointIds = [STAGING_MIGRATION_TARGET_MANIFEST.endpointId, legacyStagingTarget.endpointId];
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
      throw new Error(
        "The legacy staging Neon endpoint for project " +
          legacyStagingTarget.projectId +
          ", branch " +
          legacyStagingTarget.branchId +
          ", database " +
          legacyStagingTarget.databaseId +
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
