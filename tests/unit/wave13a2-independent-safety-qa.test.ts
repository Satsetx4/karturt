import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runStagingMigrationCommandOnce } from "../../src/db/migration-safety";
import { PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM } from "../../src/db/migration-approval";
import { assertDatabaseTargetForEnvironment } from "../../src/lib/staging-database-target";

const currentStagingTarget =
  "postgresql://karturt_owner:synthetic-password@ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech:5432/karturt?sslmode=verify-full&channel_binding=require";
const legacyStagingTarget =
  "postgresql://karturt_staging_owner:synthetic-password@ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech:5432/karturt_staging?sslmode=require";

describe("Wave 13A.2 independent safety QA", () => {
  it("keeps the general migration command local and the staging operator separately named", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["db:migrate"]).toBe("tsx src/db/migrate-development.ts");
    expect(packageJson.scripts["db:migrate:staging:operator"]).toBe(
      "tsx src/db/migrate.ts --execute-once",
    );
  });

  it("rejects current and legacy staging endpoints outside staging and keeps staging runtime blocked", () => {
    for (const target of [currentStagingTarget, legacyStagingTarget]) {
      for (const environment of ["development", "production", "test"]) {
        expect(() => assertDatabaseTargetForEnvironment(target, environment)).toThrow();
      }
    }

    expect(() => assertDatabaseTargetForEnvironment(currentStagingTarget, "staging"))
      .toThrow("runtime readiness and verified emptiness are not established");
    expect(() => assertDatabaseTargetForEnvironment(legacyStagingTarget, "staging"))
      .toThrow("legacy staging Neon endpoint");
  });

  it("does not consume authorization or open a client while the owner key is unpinned", async () => {
    expect(PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM).toBeNull();
    const now = Date.now();
    const authorizationId = "c".repeat(64);
    const consumeAuthorizationOnce = vi.fn();
    const confirmChallenge = vi.fn(async (challenge: string) => challenge);
    const createClient = vi.fn(() => ({}));
    const runMigrations = vi.fn(async () => undefined);
    const closeClient = vi.fn(async () => undefined);

    const command = runStagingMigrationCommandOnce({
      environment: {
        APP_ENV: "staging",
        DATABASE_ENV: "staging",
        MIGRATION_DATABASE_URL:
          "postgresql://migration:synthetic-only@approved.invalid:5432/karturt_staging?sslmode=require",
      },
      argv: [
        "--execute-once",
        "--readiness-evaluation-file", resolve("external-readiness.json"),
        "--database-probe-evidence-file", resolve("external-probe.json"),
        "--authorization-file", resolve("external-authorization.json"),
      ],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      repositoryRoot: process.cwd(),
      getGitIdentity: () => ({
        repositoryRoot: process.cwd(),
        gitCommonDirectory: process.cwd(),
        sourceSha: "b".repeat(40),
        isClean: true,
      }),
      assertTargetIdentity: vi.fn(),
      getTargetManifestFingerprint: () => "a".repeat(64),
      getMigrationManifestFingerprint: () => "d".repeat(64),
      verifyReadinessBinding: () => ({
        evaluationSha256: "e".repeat(64),
        completedAtUtc: new Date(now).toISOString(),
      }),
      readAuthorizationFile: () => JSON.stringify({
        schemaVersion: 2,
        payload: {
          purpose: "karturt-v1-staging-migration/v2",
          authorizationId,
          sourceSha: "b".repeat(40),
          targetManifestFingerprint: "a".repeat(64),
          migrationManifestFingerprint: "d".repeat(64),
          readinessEvaluationSha256: "e".repeat(64),
          issuedAt: new Date(now - 60_000).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
        },
        signature: "A".repeat(64),
      }),
      consumeAuthorizationOnce,
      confirmChallenge,
      now: () => now,
      approvalPublicKeyPem: PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM,
      createClient,
      runMigrations,
      closeClient,
    });

    await expect(command).rejects.toThrow(
      "No owner approval key is pinned in this source revision; staging migration is disabled.",
    );
    expect(consumeAuthorizationOnce).not.toHaveBeenCalled();
    expect(confirmChallenge).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(runMigrations).not.toHaveBeenCalled();
    expect(closeClient).not.toHaveBeenCalled();
  });

  it("keeps the six asynchronous smoke callers behind the guarded Next command helper", () => {
    const guardedCallers = [
      "scripts/phase-6-treasurer-verification-http-smoke.ts",
      "scripts/phase-8-cash-payment-http-smoke.ts",
      "scripts/phase-9-payment-reversal-http-smoke.ts",
      "scripts/phase-10-waiver-http-smoke.ts",
      "scripts/phase-11-tariff-adjustment-http-smoke.ts",
      "scripts/phase-12-household-browser-smoke.ts",
    ];

    for (const relativePath of guardedCallers) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).toContain("spawnNextCommand");
      expect(source, relativePath).toContain("APP_ENV");
      expect(source, relativePath).toContain("DATABASE_ENV");
    }
  });
});
