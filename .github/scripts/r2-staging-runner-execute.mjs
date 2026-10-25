import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  assertLatestR2StagingOwnerDecision,
  authorizeR2StagingDispatch,
} from "./r2-staging-runner-authorize.mjs";

const operationConfig = {
  preflight: {
    args: ["run", "db:migrate", "--", "--preflight"],
    required: ["DATABASE_MIGRATION_URL", "DATABASE_URL"],
    forwarded: [
      "APP_ENV", "DATABASE_ENV", "KARTURT_RELEASE_SHA", "DATABASE_MIGRATION_URL", "DATABASE_URL",
      "KARTURT_R2_CI_HEAD_SHA", "KARTURT_R2_CI_RUN_ID", "KARTURT_R2_CI_ATTEMPT",
      "KARTURT_R2_PREFLIGHT_AUTHORIZED_SHA", "KARTURT_R2_PREFLIGHT_AUTHORIZED_TARGET",
      "KARTURT_R2_PREFLIGHT_AUTHORIZED_OPERATION", "KARTURT_R2_PREFLIGHT_AUTHORIZATION_REF",
      "KARTURT_R2_ISOLATION_EVIDENCE_REF",
    ],
  },
  migrate: {
    args: ["run", "db:migrate", "--", "--apply"],
    required: ["DATABASE_MIGRATION_URL"],
    forwarded: [
      "APP_ENV", "DATABASE_ENV", "KARTURT_RELEASE_SHA", "DATABASE_MIGRATION_URL",
      "KARTURT_R2_MIGRATION_AUTHORIZED_SHA", "KARTURT_R2_MIGRATION_AUTHORIZED_TARGET",
      "KARTURT_R2_MIGRATION_AUTHORIZED_OPERATION", "KARTURT_R2_CI_HEAD_SHA",
      "KARTURT_R2_CI_RUN_ID", "KARTURT_R2_CI_ATTEMPT",
      "KARTURT_R2_MIGRATION_PREFLIGHT_EVIDENCE_REF", "KARTURT_R2_MIGRATION_ISOLATION_EVIDENCE_REF",
      "KARTURT_R2_MIGRATION_AUTHORIZATION_REF",
    ],
  },
  "synthetic-fixture-create": {
    args: ["run", "db:bootstrap-r2-staging", "--", "--apply"],
    required: [
      "DATABASE_URL", "KARTURT_R2_RESIDENT_PIN", "KARTURT_R2_CHAIRMAN_PASSWORD",
      "KARTURT_R2_TREASURER_PASSWORD", "KARTURT_R2_SYSTEM_ADMIN_PASSWORD",
    ],
    forwarded: [
      "APP_ENV", "DATABASE_ENV", "KARTURT_RELEASE_SHA", "DATABASE_URL",
      "KARTURT_R2_RESIDENT_PIN", "KARTURT_R2_CHAIRMAN_PASSWORD",
      "KARTURT_R2_TREASURER_PASSWORD", "KARTURT_R2_SYSTEM_ADMIN_PASSWORD",
      "KARTURT_R2_FIXTURE_AUTHORIZED_SHA", "KARTURT_R2_FIXTURE_AUTHORIZED_TARGET",
      "KARTURT_R2_FIXTURE_AUTHORIZED_OPERATION", "KARTURT_R2_MIGRATION_PASS_SHA",
      "KARTURT_R2_FIXTURE_AUTHORIZATION_REF", "KARTURT_R2_MIGRATION_EVIDENCE_REF",
      "KARTURT_R2_ISOLATION_EVIDENCE_REF", "KARTURT_R2_CI_HEAD_SHA",
      "KARTURT_R2_CI_RUN_ID", "KARTURT_R2_CI_ATTEMPT",
    ],
  },
};

const inheritedRuntimeKeys = ["PATH", "HOME", "CI", "RUNNER_TEMP", "TMPDIR", "TEMP", "TMP"];

export async function executeAuthorizedStagingOperation({
  env = process.env,
  fetchImpl = fetch,
  spawnImpl = spawnSync,
} = {}) {
  const operation = env.R2_OPERATION;
  const config = operationConfig[operation];
  if (!config) throw new Error("R2 staging operation is not supported.");

  const authorizationContext = {
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    actor: env.GITHUB_ACTOR,
    repository: env.GITHUB_REPOSITORY,
    candidateSha: env.R2_CANDIDATE_SHA,
    dispatchSha: env.R2_DISPATCH_SHA,
    operation,
    ownerGoCommentId: env.R2_OWNER_GO_COMMENT_ID,
    currentRunId: env.GITHUB_RUN_ID,
    currentRunAttempt: env.GITHUB_RUN_ATTEMPT,
    apiBase: env.GITHUB_API_URL,
    token: env.GITHUB_TOKEN,
  };

  await authorizeR2StagingDispatch({
    context: authorizationContext,
    fetchImpl,
  });

  if (config.required.some((key) => typeof env[key] !== "string" || !env[key].trim())) {
    throw new Error("A required protected Environment input is missing; no database command was started.");
  }

  const childEnv = {};
  for (const key of inheritedRuntimeKeys) {
    if (typeof env[key] === "string") childEnv[key] = env[key];
  }
  for (const key of config.forwarded) {
    if (typeof env[key] === "string") childEnv[key] = env[key];
  }

  await assertLatestR2StagingOwnerDecision({ context: authorizationContext, fetchImpl });

  const result = spawnImpl("npm", config.args, {
    cwd: env.GITHUB_WORKSPACE,
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw new Error("The authorized database command could not be started.");
  return Number.isInteger(result.status) ? result.status : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  executeAuthorizedStagingOperation().then((status) => {
    process.exitCode = status;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R2 staging authorization failed."}\n`);
    process.exitCode = 1;
  });
}
