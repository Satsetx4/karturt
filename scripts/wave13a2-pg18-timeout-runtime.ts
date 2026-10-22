import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import {
  closeMigrationPoolForShutdown,
  formatStagingMigrationFailure,
  runStagingMigrationCommandOnce,
} from "../src/db/migration-safety";
import {
  serializeStagingMigrationAuthorizationPayload,
  type StagingMigrationAuthorizationPayload,
} from "../src/db/migration-approval";
import { migrationManifestFingerprint } from "../src/db/migration-manifest";
import {
  getStagingMigrationTargetManifestFingerprint,
  STAGING_MIGRATION_TARGET_MANIFEST,
} from "../src/lib/staging-database-target";
import {
  buildWave13A2Pg18ChildEnvironment,
  validateWave13A2Pg18ChildEnvironment,
  validateWave13A2Pg18RuntimeEnvironment,
  type Wave13A2Pg18RuntimeConfig,
} from "./lib/wave13a2-pg18-runtime";

const CHILD_HARD_TIMEOUT_MS = 8_000;
const MIGRATION_TIMEOUT_MS = 300;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const BACKEND_ACTIVE_OBSERVATION_MS = 3_000;
const BACKEND_COMPLETION_WAIT_MS = 70_000;
const BACKEND_COMPLETION_POLL_MS = 500;
const DISPOSABLE_APP_NAME = "karturt-wave13a2-pg18-timeout-verification";
const ADMIN_USERNAME = "karturt_w13a2_bootstrap";
const ADMIN_PASSWORD = "wave13a2-disposable-bootstrap-only";

type Scenario = "success" | "immediate-error" | "timeout";
type ChildResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};
type ChildEvidence = {
  event: "karturt.wave13a2.pg18.child";
  scenario: Scenario;
  outcome: "pass" | "outcome-unknown";
  migrationInvocationCount: number;
  queryAttemptCount: number;
  closeStatus: "fulfilled" | "rejected" | "timed-out" | null;
  backendPid?: number;
};

let currentStage = "environment and branch preflight";

function pgConnectionConfig(config: Wave13A2Pg18RuntimeConfig, databaseName = config.databaseName) {
  return {
    host: "127.0.0.1",
    port: config.port,
    database: databaseName,
    user: config.username,
    password: config.password,
    application_name: DISPOSABLE_APP_NAME,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 0,
  };
}

function quoteIdentifier(value: string) {
  assert.match(value, /^[a-z0-9_]{1,63}$/, "Synthetic database identifiers must be lowercase ASCII identifiers.");
  return `"${value}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function emitChildEvidence(evidence: ChildEvidence) {
  process.stdout.write(`${JSON.stringify(evidence)}\n`, "utf8");
}

async function runChildScenario(scenario: Scenario) {
  validateWave13A2Pg18ChildEnvironment(process.env);
  const config: Wave13A2Pg18RuntimeConfig = {
    databaseName: process.env.PG18_TEST_DATABASE!,
    password: process.env.PG18_TEST_PASSWORD!,
    port: Number(process.env.PG18_PORT),
    serviceId: process.env.PG18_SERVICE_ID!,
    username: process.env.PG18_TEST_USER!,
  };
  const pool = new Pool(pgConnectionConfig(config));
  pool.on("error", () => undefined);

  const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const sourceSha = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const commonDirectory = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const worktreeStatus = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const targetManifestFingerprint = getStagingMigrationTargetManifestFingerprint();
  const currentMigrationManifestFingerprint = migrationManifestFingerprint();
  const readinessEvaluationSha256 = "e".repeat(64);
  const harnessNow = Date.now();
  const keyPair = generateKeyPairSync("ed25519");
  const approvalPayload: StagingMigrationAuthorizationPayload = {
    purpose: "karturt-v1-staging-migration/v2",
    authorizationId: randomBytes(32).toString("hex"),
    sourceSha,
    targetManifestFingerprint,
    migrationManifestFingerprint: currentMigrationManifestFingerprint,
    readinessEvaluationSha256,
    issuedAt: new Date(harnessNow).toISOString(),
    expiresAt: new Date(harnessNow + 10 * 60 * 1000).toISOString(),
  };
  const approvalSignature = sign(
    null,
    Buffer.from(serializeStagingMigrationAuthorizationPayload(approvalPayload), "utf8"),
    keyPair.privateKey,
  ).toString("base64");
  const authorizationArtifact = JSON.stringify({ schemaVersion: 2, payload: approvalPayload, signature: approvalSignature });
  const syntheticTargetUrl = "synthetic-loopback-runtime-harness-target";
  const consumedAuthorizations = new Set<string>();

  let activeClient: PoolClient | undefined;
  let migrationInvocationCount = 0;
  let queryAttemptCount = 0;
  let closeStatus: ChildEvidence["closeStatus"] = null;
  let backendPid: number | undefined;

  try {
    await runStagingMigrationCommandOnce({
      environment: {
        APP_ENV: "staging",
        DATABASE_ENV: "staging",
        MIGRATION_DATABASE_URL: syntheticTargetUrl,
      },
      argv: [
        "--execute-once",
        "--readiness-evaluation-file", resolve(tmpdir(), "karturt-wave13a2-harness-evaluation.json"),
        "--database-probe-evidence-file", resolve(tmpdir(), "karturt-wave13a2-harness-probe.json"),
        "--authorization-file", resolve(tmpdir(), "karturt-wave13a2-harness-authorization.json"),
      ],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      repositoryRoot,
      getGitIdentity: () => ({
        repositoryRoot,
        gitCommonDirectory: resolve(repositoryRoot, commonDirectory),
        sourceSha,
        isClean: worktreeStatus.length === 0,
      }),
      assertTargetIdentity: (databaseUrl) => {
        if (databaseUrl !== syntheticTargetUrl) throw new Error("Synthetic loopback harness target mismatch.");
      },
      getTargetManifestFingerprint: getStagingMigrationTargetManifestFingerprint,
      getTargetManifest: () => STAGING_MIGRATION_TARGET_MANIFEST,
      getMigrationManifestFingerprint: migrationManifestFingerprint,
      readAuthorizationFile: () => authorizationArtifact,
      verifyReadinessBinding: ({ sourceSha: readinessSourceSha }) => {
        if (readinessSourceSha !== sourceSha) throw new Error("Synthetic harness source mismatch.");
        return { evaluationSha256: readinessEvaluationSha256, completedAtUtc: new Date(harnessNow).toISOString() };
      },
      consumeAuthorizationOnce: (authorizationId) => {
        if (consumedAuthorizations.has(authorizationId)) throw new Error("Synthetic authorization replay.");
        consumedAuthorizations.add(authorizationId);
      },
      confirmChallenge: async (challenge) => challenge,
      approvalPublicKeyPem: keyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      createClient: () => pool,
      runMigrations: async () => {
        migrationInvocationCount += 1;
        activeClient = await pool.connect();

        if (scenario === "success") {
          queryAttemptCount += 1;
          await activeClient.query("SELECT 1 AS synthetic_ok");
          return;
        }

        if (scenario === "immediate-error") {
          queryAttemptCount += 1;
          await activeClient.query("SELECT * FROM wave13a2_missing_relation");
          return;
        }

        queryAttemptCount += 1;
        const identity = await activeClient.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        backendPid = identity.rows[0]?.pid;
        if (!Number.isSafeInteger(backendPid) || backendPid! <= 0) {
          throw new Error("The disposable PostgreSQL backend identity could not be read.");
        }
        process.stdout.write(`${JSON.stringify({
          event: "karturt.wave13a2.pg18.child-started",
          scenario,
          backendPid,
        })}\n`, "utf8");

        queryAttemptCount += 1;
        await activeClient.query("SELECT pg_sleep(60)");
      },
      closeClient: async (clientPool, status) => {
        const migrationClient = activeClient;
        activeClient = undefined;
        closeStatus = status;
        await closeMigrationPoolForShutdown(clientPool, migrationClient, status);
      },
      timeoutMs: scenario === "timeout" ? MIGRATION_TIMEOUT_MS : 5_000,
      shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    });

    emitChildEvidence({
      event: "karturt.wave13a2.pg18.child",
      scenario,
      outcome: "pass",
      migrationInvocationCount,
      queryAttemptCount,
      closeStatus,
      ...(backendPid ? { backendPid } : {}),
    });
    process.exitCode = 0;
  } catch (error) {
    emitChildEvidence({
      event: "karturt.wave13a2.pg18.child",
      scenario,
      outcome: "outcome-unknown",
      migrationInvocationCount,
      queryAttemptCount,
      closeStatus,
      ...(backendPid ? { backendPid } : {}),
    });
    process.stderr.write(`${formatStagingMigrationFailure(error)}\n`, "utf8");
    process.exitCode = 1;
  }
}

function runIsolatedChild(scenario: Scenario, config: Wave13A2Pg18RuntimeConfig): Promise<ChildResult> {
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ["--import", "tsx", scriptPath, "--child", scenario], {
    cwd: process.cwd(),
    env: buildWave13A2Pg18ChildEnvironment(process.env, config),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputLimitExceeded = false;
    const append = (current: string, chunk: Buffer) => {
      const combined = current + chunk.toString("utf8");
      if (combined.length > 32_768) {
        outputLimitExceeded = true;
        child.kill("SIGKILL");
        return combined.slice(0, 32_768);
      }
      return combined;
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CHILD_HARD_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut: timedOut || outputLimitExceeded, stdout, stderr });
    });
  });
}

function parseChildEvidence(result: ChildResult, scenario: Scenario, config: Wave13A2Pg18RuntimeConfig): ChildEvidence {
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const forbiddenValues = [
    config.password,
    ADMIN_PASSWORD,
    ADMIN_USERNAME,
    config.username,
    config.databaseName,
    "postgresql://",
    "postgres://",
  ];
  for (const forbidden of forbiddenValues) {
    assert.equal(combinedOutput.includes(forbidden), false, "Child output must not contain credentials, database identity, or a connection URL.");
  }

  const evidenceLine = result.stdout.split(/\r?\n/).find((line) => {
    try {
      return (JSON.parse(line) as { event?: string }).event === "karturt.wave13a2.pg18.child";
    } catch {
      return false;
    }
  });
  assert.ok(evidenceLine, `The ${scenario} child must return a structured outcome.`);
  const evidence = JSON.parse(evidenceLine) as ChildEvidence;
  assert.equal(evidence.scenario, scenario);
  return evidence;
}

async function readDisposableBackendActivity(pool: Pool, pid: number) {
  const activity = await pool.query<{ application_name: string; state: string | null }>(
    "SELECT application_name, state FROM pg_stat_activity WHERE pid = $1",
    [pid],
  );
  return activity.rows[0];
}

async function assertBackendRemainsActiveAfterChildExit(pool: Pool, pid: number) {
  const observationStartedAt = Date.now();
  const observationDeadline = observationStartedAt + BACKEND_ACTIVE_OBSERVATION_MS;
  while (Date.now() < observationDeadline) {
    const activity = await readDisposableBackendActivity(pool, pid);
    assert.ok(activity, "The timed-out backend must remain visible after its Node child exits.");
    assert.equal(activity.application_name, DISPOSABLE_APP_NAME);
    assert.equal(activity.state, "active", "The synthetic pg_sleep backend must still be active after child exit.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const activity = await readDisposableBackendActivity(pool, pid);
  assert.ok(activity, "The timed-out backend must still be visible 3 seconds after child exit.");
  assert.equal(activity.application_name, DISPOSABLE_APP_NAME);
  assert.equal(activity.state, "active", "The synthetic pg_sleep backend must remain active 3 seconds after child exit.");
  return Date.now() - observationStartedAt;
}

async function waitForBackendToFinishNaturally(pool: Pool, pid: number) {
  const startedAt = Date.now();
  const deadline = startedAt + BACKEND_COMPLETION_WAIT_MS;
  while (Date.now() < deadline) {
    const activity = await readDisposableBackendActivity(pool, pid);
    if (!activity) return Date.now() - startedAt;
    assert.equal(activity.application_name, DISPOSABLE_APP_NAME);
    await new Promise((resolve) => setTimeout(resolve, BACKEND_COMPLETION_POLL_MS));
  }
  throw new Error("The synthetic pg_sleep backend did not finish within the bounded 70-second observation window; no cancellation was sent.");
}

async function runChildAndAssert(
  scenario: Scenario,
  config: Wave13A2Pg18RuntimeConfig,
  expectedCode: number,
): Promise<{ evidence: ChildEvidence; naturalExit: boolean }> {
  const result = await runIsolatedChild(scenario, config);
  const evidence = parseChildEvidence(result, scenario, config);
  assert.equal(result.timedOut, false, `The ${scenario} Node child must finish inside the hard process deadline.`);
  assert.equal(result.signal, null, `The ${scenario} Node child must exit naturally without a signal.`);
  assert.equal(result.code, expectedCode, `The ${scenario} Node child exit code must match its expected outcome.`);
  return { evidence, naturalExit: true };
}

async function bootstrapLeastPrivilegeDatabase(env: NodeJS.ProcessEnv, config: Wave13A2Pg18RuntimeConfig) {
  const bootstrapUser = env.PG18_BOOTSTRAP_USER ?? "";
  const bootstrapPassword = env.PG18_BOOTSTRAP_PASSWORD ?? "";
  assert.equal(bootstrapUser, ADMIN_USERNAME, "The disposable PostgreSQL bootstrap role identity changed.");
  assert.equal(bootstrapPassword, ADMIN_PASSWORD, "The disposable PostgreSQL bootstrap password must remain a synthetic fixture.");

  const bootstrap = new Pool({
    host: "127.0.0.1",
    port: config.port,
    database: "postgres",
    user: bootstrapUser,
    password: bootstrapPassword,
    application_name: "karturt-wave13a2-pg18-bootstrap",
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 0,
  });

  try {
    const server = await bootstrap.query<{ server_version_num: string }>(
      "SELECT current_setting('server_version_num') AS server_version_num",
    );
    const serverVersionNum = Number(server.rows[0]?.server_version_num);
    assert.equal(Number.isSafeInteger(serverVersionNum) && serverVersionNum >= 180_000 && serverVersionNum < 190_000, true,
      "The ephemeral database service must be PostgreSQL 18.");

    await bootstrap.query(`CREATE ROLE ${quoteIdentifier(config.username)} WITH LOGIN PASSWORD ${quoteLiteral(config.password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 4`);
    await bootstrap.query(`CREATE DATABASE ${quoteIdentifier(config.databaseName)} OWNER ${quoteIdentifier(config.username)}`);
  } finally {
    await bootstrap.end();
  }
}

async function runIntegration() {
  const config = validateWave13A2Pg18RuntimeEnvironment(process.env);
  const runId = `${process.env.GITHUB_RUN_ID}_${process.env.GITHUB_RUN_ATTEMPT}`;
  assert.equal(config.databaseName, `karturt_w13a2_${runId}`);
  await bootstrapLeastPrivilegeDatabase(process.env, config);

  const observer = new Pool(pgConnectionConfig(config));
  observer.on("error", () => undefined);
  try {
    currentStage = "least-privilege PostgreSQL 18 target identity and empty database check";
    const target = await observer.query<{
      current_database: string;
      current_user: string;
      server_version_num: string;
      user_relation_count: string;
      role_is_superuser: boolean;
      role_can_create_database: boolean;
      role_can_create_roles: boolean;
      role_can_replicate: boolean;
      role_owns_database: boolean;
      role_connection_limit: number;
    }>(`
      SELECT current_database() AS current_database,
        current_user AS current_user,
        current_setting('server_version_num') AS server_version_num,
        role.rolsuper AS role_is_superuser,
        role.rolcreatedb AS role_can_create_database,
        role.rolcreaterole AS role_can_create_roles,
        role.rolreplication AS role_can_replicate,
        (database.datdba = role.oid) AS role_owns_database,
        role.rolconnlimit AS role_connection_limit,
        (
          SELECT count(*)::text
          FROM pg_class AS relation
          JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
            AND namespace.nspname NOT LIKE 'pg_toast%'
            AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        ) AS user_relation_count
      FROM pg_roles AS role
      JOIN pg_database AS database ON database.datname = current_database()
      WHERE role.rolname = current_user
    `);
    const identity = target.rows[0];
    assert.ok(identity);
    assert.equal(identity.current_database, config.databaseName);
    assert.equal(identity.current_user, config.username);
    const serverVersionNum = Number(identity.server_version_num);
    assert.equal(serverVersionNum >= 180_000 && serverVersionNum < 190_000, true);
    assert.equal(Number(identity.user_relation_count), 0, "The per-run synthetic database must begin with no user relations.");
    assert.deepEqual({
      superuser: identity.role_is_superuser,
      canCreateDatabase: identity.role_can_create_database,
      canCreateRoles: identity.role_can_create_roles,
      canReplicate: identity.role_can_replicate,
      ownsDatabase: identity.role_owns_database,
      connectionLimit: identity.role_connection_limit,
    }, {
      superuser: false,
      canCreateDatabase: false,
      canCreateRoles: false,
      canReplicate: false,
      ownsDatabase: true,
      connectionLimit: 4,
    }, "The app-like harness role must only own its disposable database and must not have cluster privileges.");

    currentStage = "real pg.Pool child process normal query and shutdown";
    const success = await runChildAndAssert("success", config, 0);
    assert.equal(success.evidence.outcome, "pass");
    assert.equal(success.evidence.migrationInvocationCount, 1);
    assert.equal(success.evidence.queryAttemptCount, 1);
    assert.equal(success.evidence.closeStatus, "fulfilled");

    currentStage = "real pg.Pool child process immediate query error and shutdown";
    const immediateError = await runChildAndAssert("immediate-error", config, 1);
    assert.equal(immediateError.evidence.outcome, "outcome-unknown");
    assert.equal(immediateError.evidence.migrationInvocationCount, 1);
    assert.equal(immediateError.evidence.queryAttemptCount, 1);
    assert.equal(immediateError.evidence.closeStatus, "rejected");

    currentStage = "real pg.Pool child process migration timeout and fail-stop shutdown";
    const timedOut = await runChildAndAssert("timeout", config, 1);
    assert.equal(timedOut.evidence.outcome, "outcome-unknown");
    assert.equal(timedOut.evidence.migrationInvocationCount, 1, "The migration body must not be retried after timeout.");
    assert.equal(timedOut.evidence.queryAttemptCount, 2, "The timeout scenario makes one PID read and one pg_sleep call only.");
    assert.equal(timedOut.evidence.closeStatus, "timed-out");
    assert.ok(timedOut.evidence.backendPid, "The synthetic long-running PostgreSQL backend PID must be captured.");

    currentStage = "disposable PostgreSQL backend activity after timeout shutdown";
    const backendActiveAfterChildExitMs = await assertBackendRemainsActiveAfterChildExit(observer, timedOut.evidence.backendPid!);
    currentStage = "natural completion of the disposable PostgreSQL pg_sleep backend";
    const backendCompletionWaitMs = await waitForBackendToFinishNaturally(observer, timedOut.evidence.backendPid!);

    process.stdout.write(`${JSON.stringify({
      event: "karturt.wave13a2.pg18.timeout_runtime",
      outcome: "PASS",
      runId,
      postgresMajor: 18,
      driver: "pg.Pool over loopback TCP",
      migrationSafetyPath: "runStagingMigrationCommandOnce + closeMigrationPoolForShutdown",
      authorizationFlow: "ephemeral Ed25519 approval and synthetic readiness verifier; loopback target identity is injected for the disposable harness",
      scenarios: {
        normalQueryAndClose: "PASS; child natural exit 0; one invocation; one query",
        immediateQueryError: "PASS; child natural exit 1; one invocation; no retry",
        timedOutPgSleepChild: "PASS; 300ms JavaScript deadline; child naturally exited 1 within the 8s hard bound; one invocation; no retry",
        backendAfterChildExit: `OBSERVED; the synthetic pg_sleep backend remained active in pg_stat_activity for at least ${BACKEND_ACTIVE_OBSERVATION_MS}ms after child exit (${backendActiveAfterChildExitMs}ms observed)`,
        backendNaturalCompletion: `PASS; backend disappeared from pg_stat_activity after ${backendCompletionWaitMs}ms of bounded observation; no cancellation request was sent`,
      },
      migrationWrites: "none; the runtime scenarios issue synthetic SELECT statements only and do not apply migrations",
      shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
      childHardTimeoutMs: CHILD_HARD_TIMEOUT_MS,
      neonServerlessTransportParity: "NOT TESTED; local PostgreSQL is direct TCP and does not provide the Neon WebSocket proxy",
      databaseUrl: "not used; connection options are explicit and child environment is allowlisted",
      credentials: "synthetic; per-run database-owned role has NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION",
    })}\n`, "utf8");
  } finally {
    await observer.end();
  }
}

async function main() {
  const childMode = process.argv[2] === "--child";
  const scenario = process.argv[3] as Scenario | undefined;
  if (childMode) {
    if (scenario !== "success" && scenario !== "immediate-error" && scenario !== "timeout") {
      throw new Error("The isolated child scenario is invalid.");
    }
    await runChildScenario(scenario);
    return;
  }
  await runIntegration();
}

void main().catch(() => {
  process.stderr.write(`${JSON.stringify({
    event: "karturt.wave13a2.pg18.timeout_runtime",
    outcome: "FAIL",
    stage: currentStage,
    details: "The disposable PostgreSQL 18 runtime check failed; connection strings, credentials, SQL text, and driver errors are suppressed.",
  })}\n`, "utf8");
  process.exitCode = 1;
});
