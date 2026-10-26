import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import { createDatabasePoolConfig, isVerifiedNodeTlsSocket } from "@/db/pool";
import { previewDatabaseTarget, r3PreviewBusinessDateTarget } from "@/db/preview-target";
import { stagingDatabaseTarget } from "@/db/staging-target";
import {
  assessR3ObservationSample,
  parseR3ObserverInputs,
  type R3ObservationSample,
} from "@/db/r3-observer";

type R3ObservationQueryRow = Omit<R3ObservationSample, "app_tls_encrypted"> & {
  app_pg_stat_ssl_active: boolean | null;
};

const pollIntervalMilliseconds = 25;
const observationTimeoutMilliseconds = 90_000;

function readGitEvidence() {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  const unexpectedChanges = status.filter((entry) => {
    const path = entry.slice(3).replace(/\\/g, "/");
    return !(entry.startsWith("?? ") && (path === ".vc" || path.startsWith(".vc/")));
  });
  if (unexpectedChanges.length > 0) {
    throw new Error("Tracked source must be clean and .vc/ is the only permitted untracked workspace item.");
  }
  return sha;
}

async function verifyAppWorker(
  origin: string,
  expectedTag: "a" | "b",
  runId: string,
  releaseSha: string,
) {
  const response = await fetch(new URL("/api/health", origin), {
    headers: { "x-karturt-r3-run-id": runId },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json() as {
    status?: unknown;
    databaseTlsVerified?: unknown;
    r3Worker?: {
      releaseSha?: unknown;
      runId?: unknown;
      scenario?: unknown;
      workerTag?: unknown;
      workerInstanceId?: unknown;
    };
  };
  if (
    !response.ok ||
    new URL(response.url).origin !== origin ||
    body.status !== "ok" ||
    body.databaseTlsVerified !== true ||
    body.r3Worker?.releaseSha !== releaseSha ||
    body.r3Worker.runId !== runId ||
    body.r3Worker.scenario !== process.env.KARTURT_R3_SCENARIO ||
    body.r3Worker.workerTag !== expectedTag ||
    typeof body.r3Worker.workerInstanceId !== "string" ||
    !/^[0-9a-f]{16}$/.test(body.r3Worker.workerInstanceId)
  ) {
    throw new Error("An app origin did not prove its expected same-SHA worker identity.");
  }
  return {
    workerInstanceId: body.r3Worker.workerInstanceId,
    databaseTlsVerified: body.databaseTlsVerified,
  };
}

async function readOnlyQuery<T extends object>(client: PoolClient, query: string, values: unknown[] = []) {
  await client.query("BEGIN READ ONLY");
  try {
    const result = await client.query<T>(query, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main() {
  const inputs = parseR3ObserverInputs(process.env, readGitEvidence());
  const poolConfig = createDatabasePoolConfig(inputs.databaseUrl, inputs.databaseEnvironment, "runtime", 1);
  const expectedTarget = inputs.databaseEnvironment === "preview"
    ? {
      ...r3PreviewBusinessDateTarget,
      runtimeRole: previewDatabaseTarget.runtimeRole,
      directHost: poolConfig.host,
    }
    : stagingDatabaseTarget;
  const pool = new Pool({
    ...poolConfig,
    application_name: inputs.observerApplicationName,
    statement_timeout: 5_000,
    connectionTimeoutMillis: 10_000,
  });

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const observerTlsVerified = isVerifiedNodeTlsSocket(client.connection.stream);
    const identity = await readOnlyQuery<{
      database_name: string;
      current_role: string;
      session_role: string;
      server_version_num: number;
      tls_active: boolean;
    }>(client, `
      SELECT
        current_database() AS database_name,
        current_user AS current_role,
        session_user AS session_role,
        current_setting('server_version_num')::int AS server_version_num,
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_stat_ssl
          WHERE pid = pg_catalog.pg_backend_pid() AND ssl
        ) AS tls_active
    `);
    const identityRow = identity.rows[0];
    const postgresMajor = identityRow ? Math.floor(identityRow.server_version_num / 10_000) : 0;
    const identityMatches = Boolean(
      identityRow &&
      identityRow.database_name === expectedTarget.database &&
      identityRow.current_role === expectedTarget.runtimeRole &&
      identityRow.session_role === expectedTarget.runtimeRole &&
      postgresMajor === 18 &&
      observerTlsVerified,
    );
    if (!identityMatches) {
      process.stdout.write(`${JSON.stringify({
        event: "karturt.release_first.r3_pg18_concurrency_observation",
        verdict: "UNVERIFIED",
        reason: "Target, PostgreSQL version, direct runtime identity, or verified TLS did not match.",
        releaseSha: inputs.releaseSha,
        externalGateReferences: {
          sourceCi: { runId: inputs.ciRunId ?? null, attempt: inputs.ciAttempt ?? null, verification: "NOT_PERFORMED" },
          r2: { ref: inputs.r2PassEvidenceRef ?? null, verification: "NOT_PERFORMED" },
          authorization: { ref: inputs.authorizationRef, verification: "NOT_PERFORMED" },
        },
        scenario: inputs.scenario,
        runId: inputs.runId,
        expectedConfiguredTarget: {
          projectId: expectedTarget.projectId,
          branchId: expectedTarget.branchId,
          endpointId: expectedTarget.endpointId,
          database: expectedTarget.database,
        },
        operationCorrelation: "NOT_PROVEN_BY_OBSERVER",
      }, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }

    const baseline = await readOnlyQuery<{ session_count: number }>(client, `
      SELECT count(*)::int AS session_count
      FROM pg_catalog.pg_stat_activity
      WHERE application_name = ANY($1::text[])
    `, [[inputs.applicationNameA, inputs.applicationNameB]]);
    if ((baseline.rows[0]?.session_count ?? 0) !== 0) {
      throw new Error("A run-specific app pool tag already existed before worker verification; observation stopped.");
    }

    const [workerA, workerB] = await Promise.all([
      verifyAppWorker(inputs.appOriginA, "a", inputs.runId, inputs.releaseSha),
      verifyAppWorker(inputs.appOriginB, "b", inputs.runId, inputs.releaseSha),
    ]);
    if (workerA.workerInstanceId === workerB.workerInstanceId) {
      throw new Error("Both R3 origins resolved to the same application worker instance.");
    }
    const applicationTlsVerified = workerA.databaseTlsVerified && workerB.databaseTlsVerified;

    const sampleQuery = `
      SELECT
        count(*) FILTER (WHERE activity.application_name = $1)::int AS session_count_a,
        count(*) FILTER (WHERE activity.application_name = $2)::int AS session_count_b,
        bool_or(activity.application_name = $1 AND activity.state = 'active') AS active_a,
        bool_or(activity.application_name = $2 AND activity.state = 'active') AS active_b,
        bool_or(
          activity.wait_event_type = 'Lock' AND (
            (activity.application_name = $1 AND EXISTS (
              SELECT 1 FROM pg_catalog.pg_stat_activity AS blocker
              WHERE blocker.pid = ANY(pg_catalog.pg_blocking_pids(activity.pid))
                AND blocker.application_name = $2
            )) OR
            (activity.application_name = $2 AND EXISTS (
              SELECT 1 FROM pg_catalog.pg_stat_activity AS blocker
              WHERE blocker.pid = ANY(pg_catalog.pg_blocking_pids(activity.pid))
                AND blocker.application_name = $1
            ))
          )
        ) AS app_sessions_lock_wait_observed,
        count(DISTINCT activity.pid)::int AS backend_session_count,
        bool_and(
          activity.usename = $3 AND activity.datname = current_database()
        ) AS runtime_role_matched,
        bool_and(ssl.ssl IS TRUE) AS app_pg_stat_ssl_active
      FROM pg_catalog.pg_stat_activity AS activity
      LEFT JOIN pg_catalog.pg_stat_ssl AS ssl USING (pid)
      WHERE activity.pid <> pg_catalog.pg_backend_pid()
        AND activity.application_name = ANY($4::text[])
    `;

    const startedAt = Date.now();
    let sampleCount = 0;
    const proof = {
      sessionsVisible: false,
      roleMatched: false,
      appTlsEncrypted: false,
      appPgStatSslReportsTls: false,
      backendSessionsDistinct: false,
      overlapObserved: false,
      appSessionsLockWaitObserved: false,
      completeSampleObserved: false,
    };

    while (Date.now() - startedAt <= observationTimeoutMilliseconds) {
      const result = await readOnlyQuery<R3ObservationQueryRow>(client, sampleQuery, [
        inputs.applicationNameA,
        inputs.applicationNameB,
        expectedTarget.runtimeRole,
        [inputs.applicationNameA, inputs.applicationNameB],
      ]);
      sampleCount += 1;
      const sample = result.rows[0];
      if (sample) {
        const current = assessR3ObservationSample({
          ...sample,
          app_tls_encrypted: applicationTlsVerified,
        });
        proof.sessionsVisible ||= current.sessionsVisible;
        proof.roleMatched ||= current.roleMatched;
        proof.appTlsEncrypted ||= current.appTlsEncrypted;
        proof.appPgStatSslReportsTls ||= sample.app_pg_stat_ssl_active === true;
        proof.backendSessionsDistinct ||= current.backendSessionsDistinct;
        proof.overlapObserved ||= current.overlapObserved;
        proof.appSessionsLockWaitObserved ||= current.appSessionsLockWaitObserved;
        proof.completeSampleObserved ||= current.sessionsVisible && current.roleMatched &&
          current.appTlsEncrypted && current.backendSessionsDistinct && current.overlapObserved &&
          current.appSessionsLockWaitObserved;
        if (proof.completeSampleObserved) break;
      }
      await delay(pollIntervalMilliseconds);
    }

    const structuralObservation = proof.completeSampleObserved ? "OBSERVED" : "NOT_OBSERVED";
    const observerTlsPolicyVerified = typeof poolConfig.ssl === "object" && poolConfig.ssl !== null &&
      poolConfig.ssl.rejectUnauthorized === true &&
      poolConfig.ssl.servername === poolConfig.host && observerTlsVerified;
    process.stdout.write(`${JSON.stringify({
      event: "karturt.release_first.r3_pg18_concurrency_observation",
      verdict: "UNVERIFIED",
      structuralObservation,
      releaseSha: inputs.releaseSha,
      externalGateReferences: {
        sourceCi: { runId: inputs.ciRunId ?? null, attempt: inputs.ciAttempt ?? null, verification: "NOT_PERFORMED" },
        r2: { ref: inputs.r2PassEvidenceRef ?? null, verification: "NOT_PERFORMED" },
        authorization: { ref: inputs.authorizationRef, verification: "NOT_PERFORMED" },
      },
      scenario: inputs.scenario,
      runId: inputs.runId,
      businessDate: inputs.businessDate,
      r2PassEvidenceRef: inputs.r2PassEvidenceRef ?? null,
      authorizationRef: inputs.authorizationRef,
      observedAt: new Date().toISOString(),
      expectedConfiguredTarget: {
        projectId: expectedTarget.projectId,
        branchId: expectedTarget.branchId,
        endpointId: expectedTarget.endpointId,
        database: expectedTarget.database,
      },
      liveConnection: {
        database: identityRow?.database_name,
        currentRole: identityRow?.current_role,
        sessionRole: identityRow?.session_role,
        postgresMajor,
        tlsEncrypted: observerTlsVerified,
        tlsCertificateAndHostnameVerification: observerTlsPolicyVerified,
        pgStatSslReportsTls: identityRow?.tls_active === true,
      },
      appOrigins: [inputs.appOriginA, inputs.appOriginB],
      applicationWorkerDistinct: workerA.workerInstanceId !== workerB.workerInstanceId,
      configuredApplicationPoolNamesDistinct: inputs.applicationNameA !== inputs.applicationNameB,
      backendSessionsDistinct: proof.backendSessionsDistinct,
      overlapObservedAtSomeSample: proof.overlapObserved,
      appSessionsLockWaitObservedAtSomeSample: proof.appSessionsLockWaitObserved,
      completeObservationSampleObserved: proof.completeSampleObserved,
      runtimeRoleMatched: proof.roleMatched,
      appSessionsTlsEncrypted: proof.appTlsEncrypted,
      appSessionsPgStatSslReportsTls: proof.appPgStatSslReportsTls,
      operationCorrelation: "NOT_PROVEN_BY_OBSERVER",
      scenarioOutcome: "MUST_BE_VERIFIED_SEPARATELY_AGAINST_THE_FROZEN_FIXTURE_LEDGER",
      readOnlyTransactions: true,
      sampleCount,
      rawRowsEmitted: false,
      pidsEmitted: false,
      queryTextEmitted: false,
    }, null, 2)}\n`);
    process.exitCode = 2;
  } finally {
    client?.release();
    await pool.end();
  }
}

void main().catch(() => {
  process.stderr.write("R3 observer failed closed; connection details and query output were suppressed.\n");
  process.exitCode = 1;
});
