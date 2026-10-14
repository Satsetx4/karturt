import { generateKeyPairSync, sign } from "node:crypto";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertStagingMigrationAuthorization,
  parseStagingMigrationAuthorizationArtifact,
  serializeStagingMigrationAuthorizationPayload,
  type StagingMigrationAuthorizationPayload,
} from "../../src/db/migration-approval";
import { APPROVED_MIGRATION_BLOB_SHA256, assertCheckedInMigrationSnapshot, migrationManifestFingerprint } from "../../src/db/migration-manifest";
import {
  executeApprovedMigrationsOnce,
  formatStagingMigrationFailure,
  MigrationOutcomeUnknownError,
  MigrationPreflightError,
  parseStagingMigrationInvocation,
  runStagingMigrationCommandOnce,
  releaseMigrationPoolClientForShutdown,
  type MigrationSafetyDependencies,
  type StagingMigrationReviewContext,
} from "../../src/db/migration-safety";

const now = Date.parse("2026-10-14T05:00:00.000Z");
const sourceSha = "b".repeat(40);
const targetFingerprint = "a".repeat(64);
const migrationFingerprint = migrationManifestFingerprint();
const authorizationId = "c".repeat(64);
const authorizationPath = resolve(tmpdir(), "karturt-wave13a-operator-approval.json");
const syntheticMigrationUrl = "postgresql://migration:synthetic-only@approved.invalid:5432/karturt_staging?sslmode=require";
const keys = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey;
const wrongKeys = generateKeyPairSync("ed25519");

function createPayload(overrides: Partial<StagingMigrationAuthorizationPayload> = {}): StagingMigrationAuthorizationPayload {
  return {
    purpose: "karturt-v1-staging-migration",
    authorizationId,
    sourceSha,
    targetManifestFingerprint: targetFingerprint,
    migrationManifestFingerprint: migrationFingerprint,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function signedArtifact(payload = createPayload(), signingKey = privateKey) {
  const signature = sign(null, Buffer.from(serializeStagingMigrationAuthorizationPayload(payload), "utf8"), signingKey)
    .toString("base64");
  return JSON.stringify({ schemaVersion: 1, payload, signature });
}

function expectations(overrides: Partial<{ sourceSha: string; targetManifestFingerprint: string; migrationManifestFingerprint: string; nowMs: number }> = {}) {
  return {
    sourceSha,
    targetManifestFingerprint: targetFingerprint,
    migrationManifestFingerprint: migrationFingerprint,
    nowMs: now,
    ...overrides,
  };
}

function makeDependencies(overrides: Partial<MigrationSafetyDependencies> = {}) {
  const events: string[] = [];
  const readAuthorizationFile = vi.fn(() => signedArtifact());
  const assertTargetIdentity = vi.fn((url: string) => {
    events.push("target");
    if (url !== syntheticMigrationUrl) throw new Error("target mismatch");
  });
  const consumeAuthorizationOnce = vi.fn(() => {
    events.push("consume");
  });
  const confirmChallenge = vi.fn(async (challenge: string, review: StagingMigrationReviewContext) => {
    expect(review).toEqual({
      sourceSha,
      targetManifestFingerprint: targetFingerprint,
      targetManifest: { projectId: "synthetic-project", branchId: "synthetic-branch" },
      migrationManifestFingerprint: migrationFingerprint,
    });
    events.push("confirm");
    return challenge;
  });
  const dependencies: MigrationSafetyDependencies = {
    environment: {
      APP_ENV: "staging",
      DATABASE_ENV: "staging",
      MIGRATION_DATABASE_URL: syntheticMigrationUrl,
    },
    argv: ["--execute-once", "--authorization-file", authorizationPath],
    stdinIsTTY: true,
    stdoutIsTTY: true,
    repositoryRoot: process.cwd(),
    getGitIdentity: () => ({
      repositoryRoot: process.cwd(),
      gitCommonDirectory: resolve(process.cwd(), ".git"),
      sourceSha,
      isClean: true,
    }),
    assertTargetIdentity,
    getTargetManifestFingerprint: () => targetFingerprint,
    getTargetManifest: () => ({ projectId: "synthetic-project", branchId: "synthetic-branch" }),
    getMigrationManifestFingerprint: () => migrationFingerprint,
    readAuthorizationFile,
    consumeAuthorizationOnce,
    confirmChallenge,
    createConfirmationNonce: () => "d".repeat(16),
    now: () => now,
    approvalPublicKeyPem: publicKeyPem,
    ...overrides,
  };
  return { dependencies, events, readAuthorizationFile, assertTargetIdentity, consumeAuthorizationOnce, confirmChallenge };
}

describe("staging migration approval artifact", () => {
  it("pins exact Git blob hashes for all 14 migrations and the journal", () => {
    expect(Object.keys(APPROVED_MIGRATION_BLOB_SHA256)).toHaveLength(15);
    expect(migrationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertCheckedInMigrationSnapshot(process.cwd())).not.toThrow();
  });

  it("accepts a valid short-lived signature bound to source, target, and migrations", () => {
    const artifact = parseStagingMigrationAuthorizationArtifact(signedArtifact());
    expect(assertStagingMigrationAuthorization(artifact, expectations(), publicKeyPem).authorizationId)
      .toBe(authorizationId);
  });

  it.each([
    ["source SHA", { sourceSha: "e".repeat(40) }],
    ["target manifest", { targetManifestFingerprint: "f".repeat(64) }],
    ["migration manifest", { migrationManifestFingerprint: "1".repeat(64) }],
  ])("rejects an approval bound to a different %s", (review, wrongExpectation) => {
    const artifact = parseStagingMigrationAuthorizationArtifact(signedArtifact());
    expect(
      () => assertStagingMigrationAuthorization(artifact, expectations(wrongExpectation), publicKeyPem),
      review,
    ).toThrow();
  });

  it("rejects a missing trust anchor, invalid signature, expired ticket, and oversized artifact", () => {
    const valid = parseStagingMigrationAuthorizationArtifact(signedArtifact());
    expect(() => assertStagingMigrationAuthorization(valid, expectations(), null)).toThrow("No owner approval key is pinned");

    const wrongSignature = parseStagingMigrationAuthorizationArtifact(signedArtifact(createPayload(), wrongKeys.privateKey));
    expect(() => assertStagingMigrationAuthorization(wrongSignature, expectations(), publicKeyPem)).toThrow("signature is invalid");

    const expired = parseStagingMigrationAuthorizationArtifact(signedArtifact(createPayload({
      issuedAt: new Date(now - 20 * 60 * 1000).toISOString(),
      expiresAt: new Date(now - 5 * 60 * 1000).toISOString(),
    })));
    expect(() => assertStagingMigrationAuthorization(expired, expectations(), publicKeyPem)).toThrow("does not match");
    expect(() => parseStagingMigrationAuthorizationArtifact("x".repeat(16 * 1024 + 1))).toThrow("malformed");
  });

  it("rejects payload edits and unknown artifact fields", () => {
    const parsed = JSON.parse(signedArtifact()) as { schemaVersion: number; payload: StagingMigrationAuthorizationPayload; signature: string };
    parsed.payload.sourceSha = "e".repeat(40);
    expect(() => assertStagingMigrationAuthorization(
      parseStagingMigrationAuthorizationArtifact(JSON.stringify(parsed)), expectations(), publicKeyPem,
    )).toThrow("does not match");

    const extraField = JSON.parse(signedArtifact()) as Record<string, unknown>;
    extraField.ownerHint = "untrusted";
    expect(() => parseStagingMigrationAuthorizationArtifact(JSON.stringify(extraField))).toThrow("malformed");
  });
});

describe("staging migration command gates", () => {
  it("requires the exact one-shot command and an absolute external authorization path", () => {
    expect(parseStagingMigrationInvocation(["--execute-once", "--authorization-file", authorizationPath]))
      .toEqual({ authorizationFile: authorizationPath });
    expect(() => parseStagingMigrationInvocation([])).toThrow(MigrationPreflightError);
    expect(() => parseStagingMigrationInvocation(["--execute-once", "--authorization-file", "relative.json"]))
      .toThrow("absolute");
    expect(() => parseStagingMigrationInvocation(["--execute-once", "--authorization-file", authorizationPath, "--force"]))
      .toThrow(MigrationPreflightError);
  });

  it("blocks missing, mismatched, runtime, and non-interactive settings before reading approval or creating a client", async () => {
    const cases: Array<{ label: string; overrides: Partial<MigrationSafetyDependencies> }> = [
      { label: "missing credential", overrides: { environment: { APP_ENV: "staging", DATABASE_ENV: "staging" } } },
      { label: "runtime credential", overrides: { environment: { APP_ENV: "staging", DATABASE_ENV: "staging", DATABASE_URL: "synthetic-runtime-secret" } } },
      { label: "wrong labels", overrides: { environment: { APP_ENV: "development", DATABASE_ENV: "staging", MIGRATION_DATABASE_URL: syntheticMigrationUrl } } },
      { label: "stdin pipe", overrides: { stdinIsTTY: false } },
      { label: "stdout pipe", overrides: { stdoutIsTTY: false } },
      { label: "unexpected CLI", overrides: { argv: ["--authorization-file", authorizationPath] } },
    ];

    for (const testCase of cases) {
      const setup = makeDependencies(testCase.overrides);
      const createClient = vi.fn(() => ({}));
      await expect(runStagingMigrationCommandOnce({
        ...setup.dependencies,
        createClient,
        runMigrations: async () => undefined,
        closeClient: async () => undefined,
      }), testCase.label).rejects.toThrow(MigrationPreflightError);
      expect(createClient, testCase.label).not.toHaveBeenCalled();
      if (testCase.label === "stdin pipe" || testCase.label === "stdout pipe" || testCase.label === "unexpected CLI") {
        expect(setup.readAuthorizationFile, testCase.label).not.toHaveBeenCalled();
      }
    }
  });

  it("rejects target mismatch, missing/invalid approvals, wrong source binding, and replay before client creation", async () => {
    const targetMismatch = makeDependencies({
      assertTargetIdentity: () => { throw new Error(`bad URL ${syntheticMigrationUrl}`); },
    });
    const missingApproval = makeDependencies({
      readAuthorizationFile: () => { throw new Error("synthetic token/password leak"); },
    });
    const invalidApproval = makeDependencies({
      readAuthorizationFile: () => "{not-json",
    });
    const wrongSource = makeDependencies({
      readAuthorizationFile: () => signedArtifact(createPayload({ sourceSha: "e".repeat(40) })),
    });
    const replayConsumeAuthorizationOnce = vi.fn(() => {
      throw new Error("already consumed");
    });
    const replay = makeDependencies({
      consumeAuthorizationOnce: replayConsumeAuthorizationOnce,
    });

    for (const setup of [targetMismatch, missingApproval, invalidApproval, wrongSource, replay]) {
      const createClient = vi.fn(() => ({}));
      const command = runStagingMigrationCommandOnce({
        ...setup.dependencies,
        createClient,
        runMigrations: async () => undefined,
        closeClient: async () => undefined,
      });
      await expect(command).rejects.toThrow(MigrationPreflightError);
      expect(createClient).not.toHaveBeenCalled();
    }
    expect(targetMismatch.readAuthorizationFile).not.toHaveBeenCalled();
    expect(replayConsumeAuthorizationOnce).toHaveBeenCalledTimes(1);
  });

  it("consumes the signed approval before opening the client and never logs connection details or token material", async () => {
    const setup = makeDependencies();
    const order: string[] = [];
    setup.consumeAuthorizationOnce.mockImplementation(() => { order.push("consume"); });
    const createClient = vi.fn((url: string) => {
      order.push("client");
      expect(url).toBe(syntheticMigrationUrl);
      return {};
    });
    const runMigrations = vi.fn(async () => { order.push("migrate"); });
    const closeClient = vi.fn(async () => { order.push("close"); });
    const context = await runStagingMigrationCommandOnce({
      ...setup.dependencies,
      createClient,
      runMigrations,
      closeClient,
    });

    expect(order).toEqual(["consume", "client", "migrate", "close"]);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(closeClient).toHaveBeenCalledWith({}, "fulfilled");
    expect(context.authorizationId).toBe(authorizationId);
    expect(setup.confirmChallenge.mock.calls[0]?.[0]).not.toContain(authorizationId);
    const visibleText = JSON.stringify({ order, challenge: setup.confirmChallenge.mock.calls[0]?.[0] });
    expect(visibleText).not.toContain("synthetic-only");
    expect(visibleText).not.toContain(syntheticMigrationUrl);
    expect(visibleText).not.toContain(signedArtifact());
    expect(setup.confirmChallenge.mock.calls[0]?.[1]).toEqual({
      sourceSha,
      targetManifestFingerprint: targetFingerprint,
      targetManifest: { projectId: "synthetic-project", branchId: "synthetic-branch" },
      migrationManifestFingerprint: migrationFingerprint,
    });
  });

  it("does not retry a failure or timeout and reports uncertain partial state without raw driver details", async () => {
    const context = {
      databaseUrl: syntheticMigrationUrl,
      sourceSha,
      targetManifestFingerprint: targetFingerprint,
      migrationManifestFingerprint: migrationFingerprint,
      authorizationId,
    };
    const failedRun = vi.fn(async () => {
      throw new Error("synthetic password-token and URL must not escape");
    });
    const closeAfterFailure = vi.fn(async () => undefined);
    const failedClient = {};
    let migrationFailure: unknown;
    try {
      await executeApprovedMigrationsOnce(context, {
        createClient: () => failedClient,
        runMigrations: failedRun,
        closeClient: closeAfterFailure,
      });
    } catch (error) {
      migrationFailure = error;
    }
    expect(migrationFailure).toBeInstanceOf(MigrationOutcomeUnknownError);
    expect((migrationFailure as Error).message).not.toContain("synthetic password-token");
    expect((migrationFailure as Error).message).not.toContain(syntheticMigrationUrl);
    expect(failedRun).toHaveBeenCalledTimes(1);
    expect(closeAfterFailure).toHaveBeenCalledTimes(1);
    expect(closeAfterFailure).toHaveBeenCalledWith(failedClient, "rejected");

    const neverSettles = vi.fn(() => new Promise<void>(() => undefined));
    const closeAfterTimeout = vi.fn(async () => undefined);
    const timedOutClient = {};
    let timeoutError: unknown;
    try {
      await executeApprovedMigrationsOnce(context, {
        createClient: () => timedOutClient,
        runMigrations: neverSettles,
        closeClient: closeAfterTimeout,
        timeoutMs: 5,
      });
    } catch (error) {
      timeoutError = error;
    }
    expect(timeoutError).toBeInstanceOf(MigrationOutcomeUnknownError);
    expect((timeoutError as Error).message).toContain("deadline");
    expect((timeoutError as Error).message).not.toContain("synthetic");
    expect(neverSettles).toHaveBeenCalledTimes(1);
    expect(closeAfterTimeout).toHaveBeenCalledTimes(1);
    expect(closeAfterTimeout).toHaveBeenCalledWith(timedOutClient, "timed-out");
    const safeFailureText = formatStagingMigrationFailure(new Error(
      `driver echoed ${syntheticMigrationUrl} synthetic password and one-time token ${signedArtifact()}`,
    ));
    expect(safeFailureText).not.toContain(syntheticMigrationUrl);
    expect(safeFailureText).not.toContain("synthetic password");
    expect(safeFailureText).not.toContain(signedArtifact());
  });

  it("bounds a client shutdown that never settles and leaves the outcome unknown", async () => {
    vi.useFakeTimers();
    const context = {
      databaseUrl: syntheticMigrationUrl,
      sourceSha,
      targetManifestFingerprint: targetFingerprint,
      migrationManifestFingerprint: migrationFingerprint,
      authorizationId,
    };
    const createClient = vi.fn(() => ({}));
    const runMigrations = vi.fn(async () => undefined);
    const closeClient = vi.fn(() => new Promise<void>(() => undefined));
    const command = executeApprovedMigrationsOnce(context, {
      createClient,
      runMigrations,
      closeClient,
      timeoutMs: 1_000,
      shutdownTimeoutMs: 25,
    });
    const outcomeAssertion = expect(command).rejects.toMatchObject({
      category: "outcome-unknown",
      message: expect.stringContaining("Bounded client shutdown did not settle"),
    });

    await vi.advanceTimersByTimeAsync(25);
    await outcomeAssertion;
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(closeClient).toHaveBeenCalledTimes(1);
  });

  it("keeps a late migration success classified as timed out and never retries", async () => {
    vi.useFakeTimers();
    const context = {
      databaseUrl: syntheticMigrationUrl,
      sourceSha,
      targetManifestFingerprint: targetFingerprint,
      migrationManifestFingerprint: migrationFingerprint,
      authorizationId,
    };
    let resolveMigration!: () => void;
    const delayedMigration = new Promise<void>((resolve) => { resolveMigration = resolve; });
    const createClient = vi.fn(() => ({}));
    const runMigrations = vi.fn(() => delayedMigration);
    const closeClient = vi.fn(async () => undefined);
    const command = executeApprovedMigrationsOnce(context, {
      createClient,
      runMigrations,
      closeClient,
      timeoutMs: 10,
      shutdownTimeoutMs: 10,
    });
    const outcomeAssertion = expect(command).rejects.toMatchObject({
      category: "outcome-unknown",
      message: expect.stringContaining("exceeded its JavaScript deadline"),
    });

    await vi.advanceTimersByTimeAsync(10);
    await outcomeAssertion;
    resolveMigration();
    await Promise.resolve();
    await Promise.resolve();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(closeClient).toHaveBeenCalledTimes(1);
  });

  it("fails closed when client shutdown rejects and does not expose driver details", async () => {
    const context = {
      databaseUrl: syntheticMigrationUrl,
      sourceSha,
      targetManifestFingerprint: targetFingerprint,
      migrationManifestFingerprint: migrationFingerprint,
      authorizationId,
    };
    const createClient = vi.fn(() => ({}));
    const runMigrations = vi.fn(async () => undefined);
    const closeClient = vi.fn(async () => {
      throw new Error(`driver echoed ${syntheticMigrationUrl} synthetic-secret`);
    });

    let failure: unknown;
    try {
      await executeApprovedMigrationsOnce(context, {
        createClient,
        runMigrations,
        closeClient,
        shutdownTimeoutMs: 25,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(MigrationOutcomeUnknownError);
    expect((failure as Error).message).toContain("Client shutdown reported a failure");
    expect((failure as Error).message).not.toContain(syntheticMigrationUrl);
    expect((failure as Error).message).not.toContain("synthetic-secret");
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(closeClient).toHaveBeenCalledTimes(1);
  });

  it("uses the public PoolClient release error to discard an unverified connection", () => {
    const successfulRelease = vi.fn();
    releaseMigrationPoolClientForShutdown({ release: successfulRelease }, "fulfilled");
    expect(successfulRelease).toHaveBeenCalledTimes(1);
    expect(successfulRelease).toHaveBeenCalledWith();

    const rejectedRelease = vi.fn();
    releaseMigrationPoolClientForShutdown({ release: rejectedRelease }, "rejected");
    const rejectedReason = rejectedRelease.mock.calls[0]?.[0];
    expect(rejectedReason).toBeInstanceOf(Error);
    expect((rejectedReason as Error).message).toBe("One-shot migration ended without verified completion.");

    const timedOutRelease = vi.fn();
    releaseMigrationPoolClientForShutdown({ release: timedOutRelease }, "timed-out");
    const timeoutReason = timedOutRelease.mock.calls[0]?.[0];
    expect(timeoutReason).toBeInstanceOf(Error);
    expect((timeoutReason as Error).message).not.toContain(syntheticMigrationUrl);
    expect((timeoutReason as Error).message).not.toContain(signedArtifact());
  });

  it("consumes replay state before opening one client and rejects duplicate execution", async () => {
    const setup = makeDependencies();
    const consumed = new Set<string>();
    setup.consumeAuthorizationOnce.mockImplementation(() => {
      if (consumed.has(authorizationId)) throw new Error("authorization already consumed");
      consumed.add(authorizationId);
    });
    const createClient = vi.fn(() => ({}));
    const runMigrations = vi.fn(async () => undefined);
    const closeClient = vi.fn(async () => undefined);
    const dependencies = {
      ...setup.dependencies,
      createClient,
      runMigrations,
      closeClient,
    };

    await expect(runStagingMigrationCommandOnce(dependencies)).resolves.toMatchObject({ authorizationId });
    await expect(runStagingMigrationCommandOnce(dependencies)).rejects.toBeInstanceOf(MigrationPreflightError);

    expect(setup.consumeAuthorizationOnce).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(closeClient).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
