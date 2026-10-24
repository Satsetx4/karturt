import { stagingDatabaseTarget } from "@/db/staging-target";

export type R2BootstrapMode = "plan" | "apply";

export type R2BootstrapInputs = {
  releaseSha: string;
  ciRunId: string;
  ciAttempt: string;
  authorizationRef: string;
  migrationEvidenceRef: string;
  isolationEvidenceRef: string;
  mode: R2BootstrapMode;
  target: string;
};

const evidenceReference = /^[A-Za-z0-9.#:/_-]{3,160}$/;
const allowedConnectionParameters = new Set([
  "sslmode",
  "sslrootcert",
  "sslnegotiation",
  "application_name",
  "channel_binding",
]);

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required; the R2 bootstrap fails closed.`);
  return value;
}

function evidenceRef(environment: NodeJS.ProcessEnv, name: string) {
  const value = required(environment, name);
  if (!evidenceReference.test(value)) {
    throw new Error(`${name} must be a short, non-secret evidence reference.`);
  }
  return value;
}

function assertRuntimeTarget(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must target the canonical direct staging runtime target.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const role = decodeURIComponent(url.username);
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    host !== stagingDatabaseTarget.directHost ||
    (url.port && url.port !== "5432") ||
    database !== stagingDatabaseTarget.database ||
    role !== stagingDatabaseTarget.runtimeRole ||
    !url.password ||
    url.hash
  ) {
    throw new Error("DATABASE_URL must target the canonical direct staging runtime target.");
  }

  for (const parameter of url.searchParams.keys()) {
    if (!allowedConnectionParameters.has(parameter) || url.searchParams.getAll(parameter).length !== 1) {
      throw new Error("DATABASE_URL contains an unsupported or repeated connection parameter.");
    }
  }
}

export function parseR2BootstrapInputs(
  environment: NodeJS.ProcessEnv,
  actualHeadSha: string,
  mode: R2BootstrapMode,
): R2BootstrapInputs {
  if (mode !== "plan" && mode !== "apply") throw new Error("R2 bootstrap mode must be plan or apply.");
  if (environment.APP_ENV !== "staging" || environment.DATABASE_ENV !== "staging") {
    throw new Error("APP_ENV and DATABASE_ENV must both be staging for the R2 bootstrap.");
  }
  if (!/^[0-9a-f]{40}$/.test(actualHeadSha)) {
    throw new Error("R2 bootstrap requires a full current Git HEAD.");
  }
  if (required(environment, "KARTURT_RELEASE_SHA") !== actualHeadSha) {
    throw new Error("KARTURT_RELEASE_SHA must match current Git HEAD.");
  }
  if (required(environment, "KARTURT_R2_FIXTURE_AUTHORIZED_SHA") !== actualHeadSha) {
    throw new Error("R2 fixture authorization must match current Git HEAD.");
  }
  if (required(environment, "KARTURT_R2_MIGRATION_PASS_SHA") !== actualHeadSha) {
    throw new Error("R2 migration evidence must match current Git HEAD.");
  }

  const ciRunId = required(environment, "KARTURT_R2_CI_RUN_ID");
  const ciAttempt = required(environment, "KARTURT_R2_CI_ATTEMPT");
  if (!/^\d+$/.test(ciRunId) || !/^\d+$/.test(ciAttempt)) {
    throw new Error("R2 exact-head CI run ID and attempt must be numeric.");
  }
  assertRuntimeTarget(required(environment, "DATABASE_URL"));

  return {
    releaseSha: actualHeadSha,
    ciRunId,
    ciAttempt,
    authorizationRef: evidenceRef(environment, "KARTURT_R2_FIXTURE_AUTHORIZATION_REF"),
    migrationEvidenceRef: evidenceRef(environment, "KARTURT_R2_MIGRATION_EVIDENCE_REF"),
    isolationEvidenceRef: evidenceRef(environment, "KARTURT_R2_ISOLATION_EVIDENCE_REF"),
    mode,
    target: `${stagingDatabaseTarget.projectId}/${stagingDatabaseTarget.branchId}/${stagingDatabaseTarget.endpointId}/${stagingDatabaseTarget.database}`,
  };
}
