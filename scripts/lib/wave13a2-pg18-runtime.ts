export const WAVE13A2_PG18_REPOSITORY = "Satsetx4/karturt";
export const WAVE13A2_PG18_BRANCH = "verify/karturt-wave13a2-pg18-20261014";
export const WAVE13A2_PG18_TEST_PASSWORD = "wave13a2-disposable-test-role-only";

export type Wave13A2Pg18RuntimeConfig = {
  databaseName: string;
  password: string;
  port: number;
  serviceId: string;
  username: string;
};

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateWave13A2Pg18RuntimeEnvironment(env: NodeJS.ProcessEnv): Wave13A2Pg18RuntimeConfig {
  requireCondition(env.GITHUB_ACTIONS === "true", "The PostgreSQL 18 runtime check requires its isolated GitHub Actions service job.");
  requireCondition(env.GITHUB_REPOSITORY === WAVE13A2_PG18_REPOSITORY, "The PostgreSQL 18 runtime repository identity is not allowed.");
  requireCondition(env.GITHUB_EVENT_NAME === "push", "The PostgreSQL 18 runtime check accepts only a push to its exact verification branch.");
  requireCondition(env.GITHUB_REF === `refs/heads/${WAVE13A2_PG18_BRANCH}`, "The PostgreSQL 18 runtime branch identity is not allowed.");
  requireCondition(/^\d{1,20}$/.test(env.GITHUB_RUN_ID ?? ""), "The GitHub run identity is missing or invalid.");
  requireCondition(/^\d{1,5}$/.test(env.GITHUB_RUN_ATTEMPT ?? ""), "The GitHub run attempt is missing or invalid.");
  requireCondition(env.APP_ENV === "test" && env.DATABASE_ENV === "test", "APP_ENV and DATABASE_ENV must both equal test.");
  requireCondition(env.DATABASE_URL === undefined, "DATABASE_URL must be unset for this disposable runtime check.");
  requireCondition(env.MIGRATION_DATABASE_URL === undefined, "MIGRATION_DATABASE_URL must be unset for this disposable runtime check.");

  const serviceId = env.PG18_SERVICE_ID ?? "";
  requireCondition(/^[a-f0-9]{64}$/.test(serviceId), "The PostgreSQL service container identity is missing or invalid.");

  const port = Number(env.PG18_PORT);
  requireCondition(Number.isSafeInteger(port) && port >= 1 && port <= 65_535, "The PostgreSQL service port is missing or invalid.");

  const runId = `${env.GITHUB_RUN_ID}_${env.GITHUB_RUN_ATTEMPT}`;
  const databaseName = env.PG18_TEST_DATABASE ?? "";
  const username = env.PG18_TEST_USER ?? "";
  const password = env.PG18_TEST_PASSWORD ?? "";
  requireCondition(databaseName === `karturt_w13a2_${runId}`, "The PostgreSQL database name is not scoped to this GitHub run.");
  requireCondition(username === "karturt_w13a2_runner", "The PostgreSQL runtime role is not the dedicated least-privilege test role.");
  requireCondition(password === WAVE13A2_PG18_TEST_PASSWORD, "The PostgreSQL runtime password must be the checked-in synthetic test fixture.");

  return { databaseName, password, port, serviceId, username };
}

export function validateWave13A2Pg18ChildEnvironment(env: NodeJS.ProcessEnv) {
  requireCondition(env.APP_ENV === "test" && env.DATABASE_ENV === "test", "Child runtime environment labels must both equal test.");
  requireCondition(env.DATABASE_URL === undefined, "Child DATABASE_URL must be unset.");
  requireCondition(env.MIGRATION_DATABASE_URL === undefined, "Child MIGRATION_DATABASE_URL must be unset.");
  requireCondition(/^[a-f0-9]{64}$/.test(env.PG18_SERVICE_ID ?? ""), "Child PostgreSQL service identity is missing or invalid.");
  requireCondition(env.PG18_HOST === "127.0.0.1", "The child PostgreSQL host must be loopback.");
  requireCondition(Number.isSafeInteger(Number(env.PG18_PORT)) && Number(env.PG18_PORT) >= 1 && Number(env.PG18_PORT) <= 65_535,
    "The child PostgreSQL port is missing or invalid.");
  requireCondition(/^karturt_w13a2_\d{1,20}_\d{1,5}$/.test(env.PG18_TEST_DATABASE ?? ""),
    "The child PostgreSQL database must be scoped to a Wave 13A.2 run.");
  requireCondition(env.PG18_TEST_USER === "karturt_w13a2_runner", "The child must use the dedicated least-privilege PostgreSQL role.");
  requireCondition(env.PG18_TEST_PASSWORD === WAVE13A2_PG18_TEST_PASSWORD,
    "The child PostgreSQL password must be the checked-in synthetic test fixture.");
}

export function buildWave13A2Pg18ChildEnvironment(
  env: NodeJS.ProcessEnv,
  config: Wave13A2Pg18RuntimeConfig,
): NodeJS.ProcessEnv {
  const minimal: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "LANG", "LC_ALL"] as const) {
    if (env[key]) minimal[key] = env[key];
  }
  return {
    ...minimal,
    NODE_ENV: "test",
    APP_ENV: "test",
    DATABASE_ENV: "test",
    PG18_HOST: "127.0.0.1",
    PG18_PORT: String(config.port),
    PG18_SERVICE_ID: config.serviceId,
    PG18_TEST_DATABASE: config.databaseName,
    PG18_TEST_USER: config.username,
    PG18_TEST_PASSWORD: config.password,
  };
}
