import { describe, expect, it, vi } from "vitest";
import { closeMigrationPoolForShutdown } from "../../src/db/migration-safety";
import {
  buildWave13A2Pg18ChildEnvironment,
  validateWave13A2Pg18ChildEnvironment,
  validateWave13A2Pg18RuntimeEnvironment,
} from "../../scripts/lib/wave13a2-pg18-runtime";

const runId = "12345678_1";

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "Satsetx4/karturt",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/verify/karturt-wave13a2-pg18-20261014",
    GITHUB_RUN_ID: "12345678",
    GITHUB_RUN_ATTEMPT: "1",
    APP_ENV: "test",
    DATABASE_ENV: "test",
    PG18_SERVICE_ID: "a".repeat(64),
    PG18_PORT: "49152",
    PG18_TEST_DATABASE: `karturt_w13a2_${runId}`,
    PG18_TEST_USER: "karturt_w13a2_runner",
    PG18_TEST_PASSWORD: "wave13a2-disposable-test-role-only",
  };
}

describe("Wave 13A.2 PostgreSQL 18 runtime guard", () => {
  it("accepts only the exact verification push and run-owned target", () => {
    expect(validateWave13A2Pg18RuntimeEnvironment(validEnvironment())).toMatchObject({
      databaseName: `karturt_w13a2_${runId}`,
      port: 49_152,
      serviceId: "a".repeat(64),
      username: "karturt_w13a2_runner",
    });
  });

  it.each([
    ["wrong repository", (env: NodeJS.ProcessEnv) => { env.GITHUB_REPOSITORY = "Other/karturt"; }],
    ["wrong branch", (env: NodeJS.ProcessEnv) => { env.GITHUB_REF = "refs/heads/main"; }],
    ["non-push event", (env: NodeJS.ProcessEnv) => { env.GITHUB_EVENT_NAME = "pull_request"; }],
    ["wrong app environment", (env: NodeJS.ProcessEnv) => { env.APP_ENV = "production"; }],
    ["runtime database URL", (env: NodeJS.ProcessEnv) => { env.DATABASE_URL = "must-not-be-used"; }],
    ["migration database URL", (env: NodeJS.ProcessEnv) => { env.MIGRATION_DATABASE_URL = "must-not-be-used"; }],
    ["invalid service identity", (env: NodeJS.ProcessEnv) => { env.PG18_SERVICE_ID = "not-a-container"; }],
    ["wrong database scope", (env: NodeJS.ProcessEnv) => { env.PG18_TEST_DATABASE = "karturt_staging"; }],
    ["wrong database role", (env: NodeJS.ProcessEnv) => { env.PG18_TEST_USER = "postgres"; }],
  ])("fails closed for %s", (_label, mutate) => {
    const env = validEnvironment();
    mutate(env);
    expect(() => validateWave13A2Pg18RuntimeEnvironment(env)).toThrow();
  });

  it("creates a child environment allowlist that drops inherited URLs, provider credentials, tokens, and Node options", () => {
    const parent = {
      ...validEnvironment(),
      PATH: "C:\\node;C:\\Windows",
      HOME: "C:\\Users\\synthetic",
      DATABASE_URL: "postgresql://live.example.invalid/not-for-child",
      MIGRATION_DATABASE_URL: "postgresql://live.example.invalid/not-for-child",
      NEON_API_KEY: "never-forward",
      VERCEL_TOKEN: "never-forward",
      GITHUB_TOKEN: "never-forward",
      NODE_OPTIONS: "--require never-forward.js",
      PGHOST: "live.example.invalid",
    } as NodeJS.ProcessEnv;
    const config = validateWave13A2Pg18RuntimeEnvironment(validEnvironment());
    const child = buildWave13A2Pg18ChildEnvironment(parent, config);

    expect(child).toMatchObject({
      APP_ENV: "test",
      DATABASE_ENV: "test",
      PG18_HOST: "127.0.0.1",
      PG18_PORT: "49152",
      PG18_SERVICE_ID: "a".repeat(64),
      PG18_TEST_DATABASE: `karturt_w13a2_${runId}`,
      PG18_TEST_USER: "karturt_w13a2_runner",
      PATH: "C:\\node;C:\\Windows",
    });
    for (const forbidden of [
      "DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "NEON_API_KEY",
      "VERCEL_TOKEN",
      "GITHUB_TOKEN",
      "NODE_OPTIONS",
      "PGHOST",
    ]) {
      expect(child[forbidden]).toBeUndefined();
    }
    expect(() => validateWave13A2Pg18ChildEnvironment(child)).not.toThrow();
  });

  it("starts pool shutdown before discarding the checked-out client and waits for pool end", async () => {
    const events: string[] = [];
    let resolveEnd!: () => void;
    const pool = {
      end: vi.fn(() => {
        events.push("end-started");
        return new Promise<void>((resolve) => { resolveEnd = resolve; });
      }),
    };
    let receivedReleaseError: Error | boolean | undefined;
    const client = { release: vi.fn((error?: Error | boolean) => {
      receivedReleaseError = error;
      events.push("client-released");
    }) };
    let finished = false;

    const closing = closeMigrationPoolForShutdown(pool, client, "timed-out").then(() => { finished = true; });
    expect(events).toEqual(["end-started", "client-released"]);
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(receivedReleaseError).toBeInstanceOf(Error);
    if (!(receivedReleaseError instanceof Error)) throw new Error("Timed-out client release must receive a sanitized Error.");
    expect(receivedReleaseError.message).toBe("One-shot migration ended without verified completion.");
    expect(finished).toBe(false);

    resolveEnd();
    await closing;
    expect(finished).toBe(true);
  });
});
