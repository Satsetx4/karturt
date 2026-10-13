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

export function validateDisposablePostgresTarget(env: NodeJS.ProcessEnv): DisposablePostgresTarget {
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
    && target.password.length > 0
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
