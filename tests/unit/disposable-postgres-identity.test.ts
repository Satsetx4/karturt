import { describe, expect, it } from "vitest";
import {
  disposablePostgresMarker,
  disposablePostgresNames,
  validateDisposablePostgresTarget,
  validateLaunchSafetyConcurrencyEnvironment,
} from "../../scripts/lib/disposable-postgres-identity";

const runId = "a1b2c3d4e5f6";
const identityToken = "ab".repeat(32);
const { databaseName, username } = disposablePostgresNames(runId);
const connectionString = `postgresql://${username}:one-off-password@127.0.0.1:49152/${databaseName}`;

function validEnvironment(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    DATABASE_ENV: "test",
    KARTURT_POSTGRES_RUN_ID: runId,
    KARTURT_POSTGRES_IDENTITY_TOKEN: identityToken,
    LAUNCH_SAFETY_POSTGRES_URL: connectionString,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("disposable PostgreSQL concurrency identity", () => {
  it("accepts the exact release-candidate PostgreSQL 17 service context without a PostgreSQL 18 container id", () => {
    const environment = validEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "Satsetx4/karturt",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/verify/karturt-v1-rc-wave13b1s-20261015",
      GITHUB_RUN_ID: "12345678",
      GITHUB_RUN_ATTEMPT: "2",
    });
    expect(environment.PG18_SERVICE_ID).toBeUndefined();
    expect(validateLaunchSafetyConcurrencyEnvironment(environment)).toBe("12345678_2");
  });

  it.each([
    ["wrong repository", { GITHUB_REPOSITORY: "another/repository" }],
    ["non-push event", { GITHUB_EVENT_NAME: "workflow_dispatch" }],
    ["wrong branch", { GITHUB_REF: "refs/heads/verify/karturt-v1-rc-other" }],
    ["missing run identity", { GITHUB_RUN_ID: undefined }],
    ["production mode", { APP_ENV: "production" }],
    ["general database URL", { DATABASE_URL: "must-not-be-used" }],
  ] as const)("fails closed for %s", (_label, overrides) => {
    const environment = validEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "Satsetx4/karturt",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/verify/karturt-v1-rc-wave13b1s-20261015",
      GITHUB_RUN_ID: "12345678",
      GITHUB_RUN_ATTEMPT: "1",
      ...overrides,
    });
    expect(() => validateLaunchSafetyConcurrencyEnvironment(environment)).toThrow();
  });

  it("derives a unique database, user, and marker from the current run", () => {
    expect(disposablePostgresNames(runId)).toEqual({
      databaseName: `karturt_concurrency_${runId}`,
      username: `karturt_runner_${runId}`,
    });
    expect(disposablePostgresMarker(runId, identityToken)).toBe(
      `karturt-disposable-postgres:${runId}:${identityToken}`,
    );
  });

  it("keeps the longest run-scoped fixture database identifier within PostgreSQL's limit", () => {
    const longestRunDatabase = disposablePostgresNames("a".repeat(24)).databaseName;
    expect(`${longestRunDatabase}_fixture10`.length).toBeLessThanOrEqual(63);
  });

  it("accepts a run-scoped loopback database on a dynamically assigned port", () => {
    expect(validateDisposablePostgresTarget(validEnvironment())).toMatchObject({
      databaseName,
      identityMarker: `karturt-disposable-postgres:${runId}:${identityToken}`,
      port: 49_152,
      runId,
      username,
    });
  });

  it.each([
    "refs/heads/codex/wave12-3-pg18-rehearsal-20261014",
    "refs/heads/verify/karturt-v1-rc-wave13b1s-20261015",
  ])("allows passwordless access only for the exact isolated PostgreSQL 18 branch job: %s", (branchRef) => {
    const passwordlessUrl = `postgresql://${username}@127.0.0.1:49152/${databaseName}`;
    const pg18Environment = validEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "Satsetx4/karturt",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: branchRef,
      PG18_SERVICE_ID: "b".repeat(64),
      LAUNCH_SAFETY_POSTGRES_URL: passwordlessUrl,
    });
    expect(validateDisposablePostgresTarget(pg18Environment, { allowPasswordlessPg18: true }))
      .toMatchObject({ databaseName, username, port: 49_152 });
    expect(() => validateDisposablePostgresTarget(pg18Environment))
      .toThrow("exact loopback database and user derived from this disposable run");
  });

  it("rejects passwordless access for an unapproved sibling branch", () => {
    const passwordlessUrl = `postgresql://${username}@127.0.0.1:49152/${databaseName}`;
    const unapprovedBranch = validEnvironment({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "Satsetx4/karturt",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/verify/karturt-v1-rc-other",
      PG18_SERVICE_ID: "b".repeat(64),
      LAUNCH_SAFETY_POSTGRES_URL: passwordlessUrl,
    });
    expect(() => validateDisposablePostgresTarget(unapprovedBranch, { allowPasswordlessPg18: true }))
      .toThrow("exact loopback database and user derived from this disposable run");
  });

  it("fails before opening a connection when the run identity or environment is missing", () => {
    expect(() => validateDisposablePostgresTarget(validEnvironment({ KARTURT_POSTGRES_IDENTITY_TOKEN: undefined })))
      .toThrow("run-scoped disposable PostgreSQL identity");
    expect(() => validateDisposablePostgresTarget(validEnvironment({ DATABASE_ENV: "production" })))
      .toThrow("APP_ENV=test and DATABASE_ENV=test");
  });

  it("rejects fixed, remote, mismatched, or ambiguous targets", () => {
    const invalidTargets = [
      "postgresql://karturt_concurrency_test:password@127.0.0.1:5432/karturt_concurrency_test",
      connectionString.replace("127.0.0.1", "localhost"),
      connectionString.replace(databaseName, "karturt_stage"),
      connectionString.replace(username, "karturt_concurrency_test"),
      `${connectionString}?sslmode=require`,
      connectionString.replace("postgresql://", "postgres://"),
      connectionString.replace("one-off-password@", "@"),
    ];
    for (const target of invalidTargets) {
      expect(() => validateDisposablePostgresTarget(validEnvironment({ LAUNCH_SAFETY_POSTGRES_URL: target })))
        .toThrow();
    }
  });
});
