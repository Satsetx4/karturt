import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertBootstrapDatabaseTarget,
  assertDatabaseTargetForEnvironment,
} from "../../src/lib/staging-database-target";
import {
  assertNoProjectEnvironmentFiles,
  findProjectEnvironmentFiles,
  loadProjectEnvConfig,
} from "../../src/lib/env-file-preflight";
import { spawnNextCommand, type NextCommandSpawnInvoker } from "../../scripts/lib/next-command";

const temporaryDirectories: string[] = [];

function createTemporaryProject() {
  const directory = mkdtempSync(join(tmpdir(), "karturt-wave13a1-audit-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const localDevelopmentUrl = "postgresql://karturt:synthetic-password@localhost:5432/karturt_dev";
const newStagingUrl =
  "postgresql://karturt_staging_owner:synthetic-password@ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech:5432/karturt_staging?sslmode=require";
const oldStagingUrl =
  "postgresql://karturt_staging_owner:synthetic-password@ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech:5432/karturt_staging?sslmode=require";

describe("Wave 13A.1 source regression audit", () => {
  it("keeps all six asynchronous smoke callers behind the guarded Next spawn helper", () => {
    const smokeCallsites = [
      "scripts/phase-6-treasurer-verification-http-smoke.ts",
      "scripts/phase-8-cash-payment-http-smoke.ts",
      "scripts/phase-9-payment-reversal-http-smoke.ts",
      "scripts/phase-10-waiver-http-smoke.ts",
      "scripts/phase-11-tariff-adjustment-http-smoke.ts",
      "scripts/phase-12-household-browser-smoke.ts",
    ];

    for (const callsite of smokeCallsites) {
      const source = readFileSync(join(process.cwd(), callsite), "utf8");
      expect(source, callsite).toContain("spawnNextCommand");
      expect(source, callsite).toMatch(/spawnNextCommand\(["'](?:dev|start)["']/);
      expect(source, callsite).toContain("APP_ENV");
      expect(source, callsite).toContain("DATABASE_ENV");
    }
  });

  it("keeps development bootstrap on the exact local target and rejects both staging URLs", () => {
    expect(assertBootstrapDatabaseTarget(localDevelopmentUrl, "development", "development"))
      .toBe("local-development-postgres");
    expect(() => assertBootstrapDatabaseTarget(localDevelopmentUrl, "development", "staging"))
      .toThrow("matching application and database environment labels");

    for (const databaseUrl of [newStagingUrl, oldStagingUrl]) {
      expect(() => assertBootstrapDatabaseTarget(databaseUrl, "development", "development"))
        .toThrow("documented local development target");
    }
  });

  it("denies new and legacy direct or pooler endpoints under every database label", () => {
    const protectedHosts = [
      "ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech",
      "ep-silent-butterfly-azrflu40-pooler.c-3.ap-southeast-1.aws.neon.tech",
      "ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech",
      "ep-snowy-meadow-a10304d9-pooler.ap-southeast-1.aws.neon.tech",
    ];

    for (const databaseEnv of ["development", "staging", "production", "test"] as const) {
      for (const hostname of protectedHosts) {
        const databaseUrl =
          `postgresql://karturt_staging_owner:synthetic-password@${hostname}:5432/` +
          "karturt_staging?sslmode=require";
        expect(
          () => assertDatabaseTargetForEnvironment(databaseUrl, databaseEnv),
          `${databaseEnv} must reject ${hostname}`,
        ).toThrow();
      }
    }
  });

  it("keeps new staging runtime access closed after exact identity validation", () => {
    expect(() => assertDatabaseTargetForEnvironment(newStagingUrl, "staging"))
      .toThrow("runtime readiness and verified emptiness are not established");
  });

  it("detects every .env* variant as unsafe to load implicitly", () => {
    const projectDirectory = createTemporaryProject();
    const unsafeFiles = [
      ".env",
      ".env.local",
      ".env.development.local",
      ".env.test.local",
      ".env.staging",
      ".env.production",
    ];
    for (const fileName of unsafeFiles) {
      writeFileSync(join(projectDirectory, fileName), "SYNTHETIC_CANARY=not-a-secret\n", { flag: "wx" });
    }
    writeFileSync(join(projectDirectory, ".env.example"), "SYNTHETIC_TEMPLATE=value\n", { flag: "wx" });

    expect(findProjectEnvironmentFiles(projectDirectory).sort()).toEqual(unsafeFiles.sort());
    expect(() => assertNoProjectEnvironmentFiles(projectDirectory, "The production server"))
      .toThrow("refuses to load project environment files");

    const loader = vi.fn();
    expect(() => loadProjectEnvConfig(projectDirectory, {
      environment: {
        NODE_ENV: "development",
        APP_ENV: "development",
        DATABASE_ENV: "staging",
        KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD: "1",
      },
      loader,
    })).toThrow("explicit local opt-in");
    expect(loader).not.toHaveBeenCalled();
  });

  it("rejects mismatched labels before spawning and redacts supplied connection details", () => {
    const projectDirectory = createTemporaryProject();
    const spawnProcess = vi.fn<NextCommandSpawnInvoker>(() => new EventEmitter() as ChildProcess);
    const canary = `wave13a1-${randomUUID()}`;

    let errorMessage = "";
    try {
      spawnNextCommand("dev", {
        projectDirectory,
        environment: {
          NODE_ENV: "development",
          APP_ENV: "development",
          DATABASE_ENV: "staging",
          DATABASE_URL: `postgresql://synthetic:${canary}@localhost:5432/karturt_dev`,
          BETTER_AUTH_SECRET: canary,
        },
        spawnProcess,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain("APP_ENV and DATABASE_ENV must match");
    expect(errorMessage).not.toContain(canary);
    expect(errorMessage).not.toContain("postgresql://");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("blocks a project environment file before spawning even with matching labels", () => {
    const projectDirectory = createTemporaryProject();
    const canary = `wave13a1-env-${randomUUID()}`;
    writeFileSync(join(projectDirectory, ".env.local"), `SYNTHETIC_CANARY=${canary}\n`, { flag: "wx" });
    const spawnProcess = vi.fn<NextCommandSpawnInvoker>(() => new EventEmitter() as ChildProcess);

    let errorMessage = "";
    try {
      spawnNextCommand("dev", {
        projectDirectory,
        environment: {
          NODE_ENV: "development",
          APP_ENV: "development",
          DATABASE_ENV: "development",
        },
        spawnProcess,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain("explicit local opt-in");
    expect(errorMessage).not.toContain(canary);
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
