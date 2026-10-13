const approvedStagingTarget = {
  projectId: "ancient-smoke-51787007",
  branchId: "br-dry-block-b3fsqjo3",
  databaseId: 604003,
  databaseName: "karturt_stage",
  endpointId: "ep-raspy-meadow-b3ppifq6",
  hostname: "ep-raspy-meadow-b3ppifq6.c-4.ap-southeast-1.aws.neon.tech",
} as const;

// Neon reports init_source=parent-data and a 31,686,656-byte logical size for
// this branch, with no visible parent identity. Metadata does not prove that
// inherited data is empty, so staging connections stay disabled until that is
// independently resolved and this value is deliberately changed in review.
const stagingIsolationVerifiedEmpty = false;

const approvedStagingPoolerHostname = `${approvedStagingTarget.endpointId}-pooler${approvedStagingTarget.hostname.slice(approvedStagingTarget.endpointId.length)}`;

const localBootstrapTarget = {
  protocol: "postgresql:",
  username: "karturt",
  hostname: "localhost",
  port: "5432",
  databaseName: "karturt_dev",
} as const;

function parsePostgresUrl(databaseUrl: string, invalidMessage: string) {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(invalidMessage);
  }

  const databaseName = parsed.pathname.startsWith("/") ? parsed.pathname.slice(1) : "";
  const queryKeys = [...parsed.searchParams.keys()];
  const hasDuplicateQueryKeys = new Set(queryKeys).size !== queryKeys.length;
  const hasUnsafeQuery = queryKeys.some((key) => key !== "sslmode" && key !== "channel_binding");
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    !parsed.hostname || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,62}$/.test(parsed.username) ||
    !parsed.password || !/^[a-zA-Z0-9_-]+$/.test(databaseName) || parsed.hash ||
    (parsed.port !== "" && parsed.port !== "5432") || hasDuplicateQueryKeys || hasUnsafeQuery ||
    (parsed.searchParams.has("sslmode") && !new Set(["require", "verify-full"]).has(parsed.searchParams.get("sslmode") ?? "")) ||
    (parsed.searchParams.has("channel_binding") && parsed.searchParams.get("channel_binding") !== "require")
  ) {
    throw new Error(invalidMessage);
  }
  return { parsed, databaseName };
}

function isApprovedStagingEndpoint(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === approvedStagingTarget.hostname || normalizedHostname === approvedStagingPoolerHostname;
}

export function assertDatabaseTargetForEnvironment(databaseUrl: string, databaseEnv: string) {
  const { parsed, databaseName } = parsePostgresUrl(
    databaseUrl,
    databaseEnv === "staging"
      ? "Staging DATABASE_URL is not an unambiguous PostgreSQL connection URL."
      : "DATABASE_URL is not an unambiguous PostgreSQL connection URL.",
  );

  if (databaseEnv === "test") {
    throw new Error("Database URL connections are disabled in test; use in-memory PGlite instead.");
  }

  if (databaseEnv !== "staging") {
    if (isApprovedStagingEndpoint(parsed.hostname)) {
      throw new Error("The approved staging Neon endpoint cannot be used unless APP_ENV and DATABASE_ENV both equal staging.");
    }
    return;
  }

  const port = parsed.port || "5432";
  const endpointParameter = parsed.searchParams.get("endpoint");

  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname.toLowerCase() !== approvedStagingTarget.hostname ||
    port !== "5432" ||
    databaseName !== approvedStagingTarget.databaseName ||
    (endpointParameter !== null && endpointParameter !== approvedStagingTarget.endpointId)
  ) {
    throw new Error(
      `Staging DATABASE_URL must target approved Neon project ${approvedStagingTarget.projectId}, branch ${approvedStagingTarget.branchId}, database ${approvedStagingTarget.databaseName} (database id ${approvedStagingTarget.databaseId}) through its direct endpoint ${approvedStagingTarget.endpointId}.`,
    );
  }

  if (!stagingIsolationVerifiedEmpty) {
    throw new Error(
      `Staging database access is blocked for Neon project ${approvedStagingTarget.projectId}, branch ${approvedStagingTarget.branchId}: provider metadata reports parent-data initialization and does not prove the branch is empty.`,
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

  const { parsed, databaseName } = parsePostgresUrl(databaseUrl, "Bootstrap DATABASE_URL must target the documented local development database.");
  if (
    parsed.protocol !== localBootstrapTarget.protocol || parsed.href !== databaseUrl ||
    parsed.username !== localBootstrapTarget.username || parsed.hostname !== localBootstrapTarget.hostname ||
    parsed.port !== localBootstrapTarget.port || databaseName !== localBootstrapTarget.databaseName ||
    parsed.search || parsed.hash
  ) {
    throw new Error("Bootstrap DATABASE_URL must match the documented local development target exactly.");
  }
  return "local-development-postgres";
}
