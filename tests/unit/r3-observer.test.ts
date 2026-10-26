import { describe, expect, it } from "vitest";
import { assessR3ObservationSample, parseR3ObserverInputs, r3WorkerProbeHeaders } from "@/db/r3-observer";
import { getR3WorkerIdentity } from "@/lib/r3-worker-identity";

const releaseSha = "63c3a89aee70a9fdd11db499db261e3d7caa136d";

function environment(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    APP_ENV: "staging",
    DATABASE_ENV: "staging",
    KARTURT_R3_CI_RUN_ID: "40117598868",
    KARTURT_R3_CI_ATTEMPT: "1",
    KARTURT_R2_PASS_EVIDENCE_REF: "release-packet-r2-pass",
    KARTURT_R3_AUTHORIZATION_REF: "#98/9999999999",
    KARTURT_R3_SCENARIO: "R3-RACE-VERIFY",
    KARTURT_R3_RUN_ID: "r3run20261025",
    KARTURT_R3_BUSINESS_DATE: "2026-10-25",
    KARTURT_R3_APP_ORIGIN_A: "https://localhost:3443",
    KARTURT_R3_APP_ORIGIN_B: "https://localhost:3444",
    DATABASE_URL: "postgresql://karturt_stg_runtime:secret@ep-red-boat-azzqyf45.c-3.ap-southeast-1.aws.neon.tech/karturt_staging",
    ...overrides,
  };
}

describe("RELEASE FIRST R3 observer input gate", () => {
  it("accepts a full exact-head setup with two distinct local HTTPS workers", () => {
    const parsed = parseR3ObserverInputs(environment(), releaseSha);

    expect(parsed).toEqual(expect.objectContaining({
      releaseSha,
      scenario: "R3-RACE-VERIFY",
      appOriginA: "https://localhost:3443",
      appOriginB: "https://localhost:3444",
      applicationNameA: "krt-r3-r3run20261025-R3-RACE-VERIFY-a",
      applicationNameB: "krt-r3-r3run20261025-R3-RACE-VERIFY-b",
      observerApplicationName: "krt-r3-r3run20261025-R3-RACE-VERIFY-observer",
    }));
  });

  it("fails before a database connection when SHA or authorization evidence is missing", () => {
    expect(() => parseR3ObserverInputs(environment(), "short-sha"))
      .toThrow("full current Git HEAD");
    expect(() => parseR3ObserverInputs(environment({ KARTURT_R3_AUTHORIZATION_REF: "" }), releaseSha))
      .toThrow("KARTURT_R3_AUTHORIZATION_REF is required");
  });

  it("rejects reused origins, a future scenario, and a non-staging environment", () => {
    expect(() => parseR3ObserverInputs(environment({ KARTURT_R3_APP_ORIGIN_B: "https://localhost:3443" }), releaseSha))
      .toThrow("origins must be distinct");
    expect(() => parseR3ObserverInputs(environment({ KARTURT_R3_SCENARIO: "R3-RACE-WAIVER" }), releaseSha))
      .toThrow("not one of the four approved race cases");
    expect(() => parseR3ObserverInputs(environment({ DATABASE_ENV: "production" }), releaseSha))
      .toThrow("must both be staging or Preview");
  });

  it("accepts a Preview observer only for the exact Neon target and distinct Vercel deployments", () => {
    const preview = environment({
      APP_ENV: "preview",
      DATABASE_ENV: "preview",
      KARTURT_R3_CI_RUN_ID: "",
      KARTURT_R3_CI_ATTEMPT: "",
      KARTURT_R2_PASS_EVIDENCE_REF: "",
      KARTURT_PREVIEW_TARGET_ID: "misty-king-95262980/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview",
      KARTURT_PRODUCTION_TARGET_ID: "wild-glitter-41970460/br-spring-smoke-ao3apicl/ep-sparkling-rain-aospujja/karturt_production",
      VERCEL_AUTOMATION_BYPASS_SECRET: "preview-bypass-test-only",
      DATABASE_URL: "postgresql://karturt_preview_runtime:test-only@ep-calm-glade-b3rpal01.c-3.ap-southeast-1.aws.neon.tech/karturt_preview?sslmode=verify-full",
      KARTURT_R3_APP_ORIGIN_A: "https://karturt-review-staging-20261012-a-sekawan.vercel.app",
      KARTURT_R3_APP_ORIGIN_B: "https://karturt-review-staging-20261012-b-sekawan.vercel.app",
    });

    expect(parseR3ObserverInputs(preview, releaseSha)).toMatchObject({
      databaseEnvironment: "preview",
      ciRunId: undefined,
      ciAttempt: undefined,
      r2PassEvidenceRef: undefined,
      appOriginA: "https://karturt-review-staging-20261012-a-sekawan.vercel.app",
      appOriginB: "https://karturt-review-staging-20261012-b-sekawan.vercel.app",
      releaseSha,
    });
    expect(() => parseR3ObserverInputs({
      ...preview,
      KARTURT_PREVIEW_TARGET_ID: "other-project/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview",
    }, releaseSha)).toThrow("approved Preview database target");
  });
});

describe("R3 observer sample assessment", () => {
  it("passes only a snapshot showing both active sessions, lock contention, same runtime identity, and TLS", () => {
    expect(assessR3ObservationSample({
      session_count_a: 1,
      session_count_b: 1,
      active_a: true,
      active_b: true,
      app_sessions_lock_wait_observed: true,
      backend_session_count: 2,
      runtime_role_matched: true,
      app_tls_encrypted: true,
    })).toEqual({
      sessionsVisible: true,
      roleMatched: true,
      appTlsEncrypted: true,
      backendSessionsDistinct: true,
      overlapObserved: true,
      appSessionsLockWaitObserved: true,
    });
  });

  it("does not infer overlap from two idle sessions or distinct PIDs alone", () => {
    expect(assessR3ObservationSample({
      session_count_a: 1,
      session_count_b: 1,
      active_a: false,
      active_b: false,
      app_sessions_lock_wait_observed: false,
      backend_session_count: 2,
      runtime_role_matched: true,
      app_tls_encrypted: true,
    })).toMatchObject({
      backendSessionsDistinct: true,
      overlapObserved: false,
      appSessionsLockWaitObserved: false,
    });
  });

  it("sends Vercel protection bypass only on protected Preview worker probes", () => {
    expect(r3WorkerProbeHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: "preview-bypass-test-only" }, "preview", "r3run20261025"))
      .toEqual({
        "x-karturt-r3-run-id": "r3run20261025",
        "x-vercel-protection-bypass": "preview-bypass-test-only",
      });
    expect(r3WorkerProbeHeaders({}, "staging", "r3run20261025"))
      .toEqual({ "x-karturt-r3-run-id": "r3run20261025" });
    expect(() => r3WorkerProbeHeaders({}, "preview", "r3run20261025"))
      .toThrow("VERCEL_AUTOMATION_BYPASS_SECRET is required");
    expect(() => r3WorkerProbeHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: "bad\r\nheader" }, "preview", "r3run20261025"))
      .toThrow("VERCEL_AUTOMATION_BYPASS_SECRET is required");
  });
});

describe("R3 health worker identity", () => {
  const stagingWorkerEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    APP_ENV: "staging",
    DATABASE_ENV: "staging",
    KARTURT_R3_RUN_ID: "r3run20261025",
    KARTURT_R3_SCENARIO: "R3-RACE-VERIFY",
    KARTURT_R3_WORKER_TAG: "a",
  };

  it("returns a process identity only for the matching staging run", () => {
    expect(getR3WorkerIdentity("r3run20261025", stagingWorkerEnvironment, releaseSha, 12345)).toEqual({
      releaseSha,
      runId: "r3run20261025",
      scenario: "R3-RACE-VERIFY",
      workerTag: "a",
      workerInstanceId: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(getR3WorkerIdentity("other-run", stagingWorkerEnvironment, releaseSha, 12345)).toBeNull();
    expect(getR3WorkerIdentity("r3run20261025", stagingWorkerEnvironment, undefined, 12345)).toBeNull();
    expect(getR3WorkerIdentity("r3run20261025", { ...stagingWorkerEnvironment, APP_ENV: "production" }, releaseSha, 12345)).toBeNull();
  });

  it("does not use the worker tag to claim two processes are distinct", () => {
    const identityA = getR3WorkerIdentity("r3run20261025", {
      ...stagingWorkerEnvironment,
      KARTURT_R3_WORKER_TAG: "a",
    }, releaseSha, 12345);
    const identityB = getR3WorkerIdentity("r3run20261025", {
      ...stagingWorkerEnvironment,
      KARTURT_R3_WORKER_TAG: "b",
    }, releaseSha, 12345);

    expect(identityA?.workerInstanceId).toBe(identityB?.workerInstanceId);
    expect(getR3WorkerIdentity("r3run20261025", stagingWorkerEnvironment, releaseSha, 12346)?.workerInstanceId)
      .not.toBe(identityA?.workerInstanceId);
  });

  it("returns a worker identity on the exact approved Preview target", () => {
    const previewEnvironment: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      APP_ENV: "preview",
      DATABASE_ENV: "preview",
      KARTURT_PREVIEW_TARGET_ID: "misty-king-95262980/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview",
      KARTURT_PRODUCTION_TARGET_ID: "wild-glitter-41970460/br-spring-smoke-ao3apicl/ep-sparkling-rain-aospujja/karturt_production",
      KARTURT_R3_RUN_ID: "cp3preview261026",
      KARTURT_R3_SCENARIO: "R3-RACE-REQUEST",
      KARTURT_R3_WORKER_TAG: "b",
    };

    expect(getR3WorkerIdentity("cp3preview261026", previewEnvironment, releaseSha, 12345)).toEqual({
      releaseSha,
      runId: "cp3preview261026",
      scenario: "R3-RACE-REQUEST",
      workerTag: "b",
      workerInstanceId: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(() => getR3WorkerIdentity("cp3preview261026", {
      ...previewEnvironment,
      KARTURT_PREVIEW_TARGET_ID: "other-project/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview",
    }, releaseSha, 12345)).toThrow("approved Preview database target");
  });
});
