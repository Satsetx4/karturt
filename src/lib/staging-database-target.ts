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

function isApprovedStagingEndpoint(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === approvedStagingTarget.hostname || normalizedHostname === approvedStagingPoolerHostname;
}

export function assertDatabaseTargetForEnvironment(databaseUrl: string, databaseEnv: string) {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    if (databaseEnv === "staging") {
      throw new Error("Staging DATABASE_URL is not a valid PostgreSQL connection URL.");
    }
    return;
  }

  if (databaseEnv !== "staging") {
    if (isApprovedStagingEndpoint(parsed.hostname)) {
      throw new Error("The approved staging Neon endpoint cannot be used unless APP_ENV and DATABASE_ENV both equal staging.");
    }
    return;
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
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
