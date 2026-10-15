export type DisposablePostgresTarget = {
  connectionString: string;
  databaseName: string;
  identityMarker: string;
  identityToken: string;
  port: number;
  runId: string;
  username: string;
};

const runIdPattern = /^[a-z0-9_]{3,24}$/;
const identityTokenPattern = /^[a-f0-9]{64}$/;
const launchSafetyConcurrencyRepository = "Satsetx4/karturt";
const launchSafetyConcurrencyBranchRefs = new Set([
  "refs/heads/codex/wave12-3-pg18-rehearsal-20261014",
  "refs/heads/verify/karturt-v1-rc-wave13b1s-20261015",
  "refs/heads/verify/karturt-v1-rc-quality-wave13b1t-20261015",
  "refs/heads/codex/karturt-v1-staging-activation-20261015",
]);

export function validateLaunchSafetyConcurrencyEnvironment(env: NodeJS.ProcessEnv): string {
  if (env.GITHUB_ACTIONS !== "true") {
    throw new Error("PostgreSQL concurrency initialization is limited to its isolated GitHub Actions service job.");
  }
  if (env.GITHUB_REPOSITORY !== launchSafetyConcurrencyRepository) {
    throw new Error("PostgreSQL concurrency repository identity is not allowed.");
  }
  if (env.GITHUB_EVENT_NAME !== "push" || !launchSafetyConcurrencyBranchRefs.has(env.GITHUB_REF ?? "")) {
    throw new Error("PostgreSQL concurrency accepts only an explicitly approved branch push.");
  }
  if (!env.GITHUB_RUN_ID || !env.GITHUB_RUN_ATTEMPT) {
    throw new Error("PostgreSQL concurrency run identity is missing.");
  }
  if (env.APP_ENV !== "test" || env.DATABASE_ENV !== "test") {
    throw new Error("PostgreSQL concurrency requires APP_ENV=test and DATABASE_ENV=test.");
  }
  for (const forbiddenName of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "DIRECT_URL", "POSTGRES_URL"]) {
    if (env[forbiddenName]) {
      throw new Error("PostgreSQL concurrency rejects general application database connection variables.");
    }
  }
  if (!env.LAUNCH_SAFETY_POSTGRES_URL) {
    throw new Error("LAUNCH_SAFETY_POSTGRES_URL is required for PostgreSQL concurrency initialization.");
  }

  const runId = `${env.GITHUB_RUN_ID}_${env.GITHUB_RUN_ATTEMPT}`;
  if (!runIdPattern.test(runId)) {
    throw new Error("PostgreSQL concurrency run identity is invalid.");
  }
  return runId;
}

export function disposablePostgresNames(runId: string) {
  if (!runIdPattern.test(runId)) {
    throw new Error("The disposable PostgreSQL run identity is invalid; no database connection was opened.");
  }
  return {
    databaseName: `karturt_concurrency_${runId}`,
    username: `karturt_runner_${runId}`,
  };
}

export function disposablePostgresMarker(runId: string, identityToken: string) {
  if (!runIdPattern.test(runId) || !identityTokenPattern.test(identityToken)) {
    throw new Error("The disposable PostgreSQL identity marker is invalid; no database connection was opened.");
  }
  return `karturt-disposable-postgres:${runId}:${identityToken}`;
}

export function validateDisposablePostgresTarget(
  env: NodeJS.ProcessEnv,
  options: { allowPasswordlessPg18?: boolean } = {},
): DisposablePostgresTarget {
  if (env.APP_ENV !== "test" || env.DATABASE_ENV !== "test") {
    throw new Error("PostgreSQL concurrency requires APP_ENV=test and DATABASE_ENV=test; no database connection was opened.");
  }

  const runId = env.KARTURT_POSTGRES_RUN_ID;
  const identityToken = env.KARTURT_POSTGRES_IDENTITY_TOKEN;
  if (!runId || !runIdPattern.test(runId) || !identityToken || !identityTokenPattern.test(identityToken)) {
    throw new Error("A run-scoped disposable PostgreSQL identity is required; no database connection was opened.");
  }

  const { databaseName, username } = disposablePostgresNames(runId);
  const connectionString = env.LAUNCH_SAFETY_POSTGRES_URL;
  if (!connectionString) {
    throw new Error("LAUNCH_SAFETY_POSTGRES_URL is required; the independent PostgreSQL suite fails closed.");
  }

  let target: URL;
  let decodedUsername: string;
  try {
    target = new URL(connectionString);
    decodedUsername = decodeURIComponent(target.username);
    decodeURIComponent(target.password);
  } catch {
    throw new Error("LAUNCH_SAFETY_POSTGRES_URL is malformed; no database connection was opened.");
  }

  const port = Number(target.port);
  let databaseFromUrl: string;
  try {
    databaseFromUrl = decodeURIComponent(target.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("LAUNCH_SAFETY_POSTGRES_URL is malformed; no database connection was opened.");
  }
  const allowedTarget = target.protocol === "postgresql:"
    && target.hostname === "127.0.0.1"
    && Number.isInteger(port)
    && port >= 1
    && port <= 65_535
    && databaseFromUrl === databaseName
    && decodedUsername === username
    && (target.password.length > 0 || (
      options.allowPasswordlessPg18 === true
      && env.GITHUB_ACTIONS === "true"
      && env.GITHUB_REPOSITORY === "Satsetx4/karturt"
      && env.GITHUB_EVENT_NAME === "push"
      && (
        env.GITHUB_REF === "refs/heads/codex/wave12-3-pg18-rehearsal-20261014"
        || env.GITHUB_REF === "refs/heads/verify/karturt-v1-rc-wave13b1s-20261015"
        || env.GITHUB_REF === "refs/heads/verify/karturt-v1-rc-quality-wave13b1t-20261015"
        || env.GITHUB_REF === "refs/heads/codex/karturt-v1-staging-activation-20261015"
      )
      && Boolean(env.PG18_SERVICE_ID && /^[a-f0-9]{64}$/.test(env.PG18_SERVICE_ID))
    ))
    && target.search.length === 0
    && target.hash.length === 0;

  if (!allowedTarget) {
    throw new Error("PostgreSQL concurrency requires the exact loopback database and user derived from this disposable run; no database connection was opened.");
  }

  return {
    connectionString,
    databaseName,
    identityMarker: disposablePostgresMarker(runId, identityToken),
    identityToken,
    port,
    runId,
    username,
  };
}
