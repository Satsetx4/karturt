import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assertNoProjectEnvironmentFiles,
  loadProjectEnvConfig,
} from "../../src/lib/env-file-preflight";

const secretCanary = `wave9-${randomUUID()}`;

describe("project environment file preflight", () => {
  it("rejects test mode before calling the loader and never echoes synthetic secrets", () => {
    const loader = vi.fn();
    const environment = {
      NODE_ENV: "test",
      APP_ENV: "development",
      DATABASE_ENV: "development",
      KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD: "1",
      DATABASE_URL: `postgresql://synthetic:${secretCanary}@localhost:5432/karturt_dev`,
      BETTER_AUTH_SECRET: secretCanary,
    };

    let message = "";
    try {
      loadProjectEnvConfig("synthetic-project", {
        environment,
        environmentFiles: [".env.local"],
        loader,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("explicit local opt-in");
    expect(message.includes(secretCanary)).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });

  it("requires explicit matching development labels and the local opt-in", () => {
    const loader = vi.fn();
    for (const environment of [
      { NODE_ENV: "development", APP_ENV: "development", DATABASE_ENV: "production", KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD: "1" },
      { NODE_ENV: "development", APP_ENV: "development", DATABASE_ENV: "development" },
    ]) {
      expect(() => loadProjectEnvConfig("synthetic-project", {
        environment,
        environmentFiles: [".env.local"],
        loader,
      })).toThrow("explicit local opt-in");
    }
    expect(loader).not.toHaveBeenCalled();
  });

  it("blocks production and CI even when a synthetic opt-in is present", () => {
    const loader = vi.fn();
    for (const environment of [
      { NODE_ENV: "production", APP_ENV: "development", DATABASE_ENV: "development", KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD: "1" },
      { NODE_ENV: "development", APP_ENV: "development", DATABASE_ENV: "development", KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD: "1", CI: "true" },
    ]) {
      expect(() => loadProjectEnvConfig("synthetic-project", {
        environment,
        environmentFiles: [".env.local"],
        loader,
      })).toThrow("explicit local opt-in");
    }
    expect(loader).not.toHaveBeenCalled();
  });

  it("invokes the loader only after an explicit local development opt-in", () => {
    const loader = vi.fn(() => undefined);
    loadProjectEnvConfig("synthetic-project", {
      environment: {
        NODE_ENV: "development",
        APP_ENV: "development",
        DATABASE_ENV: "development",
        KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD: "1",
      },
      environmentFiles: [".env.local"],
      loader,
    });
    expect(loader).toHaveBeenCalledOnce();
    expect(loader).toHaveBeenCalledWith("synthetic-project");
  });

  it("does not call the loader when only the tracked example template exists", () => {
    const loader = vi.fn();
    loadProjectEnvConfig("synthetic-project", {
      environmentFiles: [".env.example"],
      loader,
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it("blocks build and test commands before dotenv discovery can become a load", () => {
    expect(() => assertNoProjectEnvironmentFiles("synthetic-project", "The production build", [".env.local"]))
      .toThrow("refuses to load project environment files");
    expect(() => assertNoProjectEnvironmentFiles("synthetic-project", "Tests", [".env.test.local"]))
      .toThrow("refuses to load project environment files");
    expect(() => assertNoProjectEnvironmentFiles("synthetic-project", "Tests", [".env.example"]))
      .not.toThrow();
  });
});
