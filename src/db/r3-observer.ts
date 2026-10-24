export const r3ConcurrencyScenarios = [
  "R3-RACE-REQUEST",
  "R3-RACE-VERIFY",
  "R3-RACE-CASH",
  "R3-RACE-REVERSAL",
] as const;

export type R3ConcurrencyScenario = (typeof r3ConcurrencyScenarios)[number];

export type R3ObserverInputs = {
  releaseSha: string;
  ciRunId: string;
  ciAttempt: string;
  r2PassEvidenceRef: string;
  authorizationRef: string;
  scenario: R3ConcurrencyScenario;
  runId: string;
  businessDate: string;
  appOriginA: string;
  appOriginB: string;
  applicationNameA: string;
  applicationNameB: string;
  observerApplicationName: string;
  databaseUrl: string;
};

function required(environment: NodeJS.ProcessEnv, key: string) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required; the R3 observer fails closed.`);
  return value;
}

function localHttpsOrigin(value: string, key: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a local HTTPS origin.`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    !["localhost", "127.0.0.1", "::1"].includes(host) ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${key} must be a local HTTPS origin on a unique port.`);
  }
  return parsed.origin;
}

function validBusinessDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseR3ObserverInputs(
  environment: NodeJS.ProcessEnv,
  actualHeadSha: string,
): R3ObserverInputs {
  if (environment.APP_ENV !== "staging" || environment.DATABASE_ENV !== "staging") {
    throw new Error("APP_ENV and DATABASE_ENV must both be staging; no database connection was opened.");
  }

  if (!/^[0-9a-f]{40}$/.test(actualHeadSha)) {
    throw new Error("The observer requires a full current Git HEAD; no database connection was opened.");
  }
  const releaseSha = actualHeadSha;

  const ciRunId = required(environment, "KARTURT_R3_CI_RUN_ID");
  const ciAttempt = required(environment, "KARTURT_R3_CI_ATTEMPT");
  if (!/^\d+$/.test(ciRunId) || !/^\d+$/.test(ciAttempt)) {
    throw new Error("R3 source CI run and attempt must be numeric; no database connection was opened.");
  }

  const r2PassEvidenceRef = required(environment, "KARTURT_R2_PASS_EVIDENCE_REF");
  const authorizationRef = required(environment, "KARTURT_R3_AUTHORIZATION_REF");
  if (!/^[A-Za-z0-9.#:/_-]{3,160}$/.test(r2PassEvidenceRef) || !/^[A-Za-z0-9.#:/_-]{3,160}$/.test(authorizationRef)) {
    throw new Error("R2 evidence and R3 authorization references must be short, non-secret references.");
  }

  const scenarioValue = required(environment, "KARTURT_R3_SCENARIO");
  if (!(r3ConcurrencyScenarios as readonly string[]).includes(scenarioValue)) {
    throw new Error("KARTURT_R3_SCENARIO is not one of the four approved race cases.");
  }

  const runId = required(environment, "KARTURT_R3_RUN_ID");
  if (!/^[a-z0-9]{8,20}$/.test(runId)) {
    throw new Error("KARTURT_R3_RUN_ID must be a unique lowercase run identifier.");
  }

  const businessDate = required(environment, "KARTURT_R3_BUSINESS_DATE");
  if (!validBusinessDate(businessDate)) {
    throw new Error("KARTURT_R3_BUSINESS_DATE must be a valid YYYY-MM-DD date.");
  }

  const appOriginA = localHttpsOrigin(required(environment, "KARTURT_R3_APP_ORIGIN_A"), "KARTURT_R3_APP_ORIGIN_A");
  const appOriginB = localHttpsOrigin(required(environment, "KARTURT_R3_APP_ORIGIN_B"), "KARTURT_R3_APP_ORIGIN_B");
  if (appOriginA === appOriginB) {
    throw new Error("R3 application origins must be distinct HTTPS origins on separate app processes.");
  }

  const workerPrefix = `krt-r3-${runId}-${scenarioValue}`;
  const applicationNameA = `${workerPrefix}-a`;
  const applicationNameB = `${workerPrefix}-b`;
  const observerApplicationName = `${workerPrefix}-observer`;

  const databaseUrl = required(environment, "DATABASE_URL");
  return {
    releaseSha,
    ciRunId,
    ciAttempt,
    r2PassEvidenceRef,
    authorizationRef,
    scenario: scenarioValue as R3ConcurrencyScenario,
    runId,
    businessDate,
    appOriginA,
    appOriginB,
    applicationNameA,
    applicationNameB,
    observerApplicationName,
    databaseUrl,
  };
}

export type R3ObservationSample = {
  session_count_a: number;
  session_count_b: number;
  active_a: boolean | null;
  active_b: boolean | null;
  app_sessions_lock_wait_observed: boolean | null;
  backend_session_count: number;
  runtime_role_matched: boolean | null;
  app_tls_encrypted: boolean | null;
};

export function assessR3ObservationSample(sample: R3ObservationSample) {
  const sessionsVisible = sample.session_count_a === 1 && sample.session_count_b === 1;
  const roleMatched = sessionsVisible && sample.runtime_role_matched === true;
  const appTlsEncrypted = sessionsVisible && sample.app_tls_encrypted === true;
  return {
    sessionsVisible,
    roleMatched,
    appTlsEncrypted,
    backendSessionsDistinct: sessionsVisible && sample.backend_session_count >= 2,
    overlapObserved:
      sessionsVisible &&
      sample.backend_session_count >= 2 &&
      sample.active_a === true &&
      sample.active_b === true,
    appSessionsLockWaitObserved: sample.app_sessions_lock_wait_observed === true,
  };
}
