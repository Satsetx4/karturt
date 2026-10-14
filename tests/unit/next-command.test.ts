import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runNextCommand, spawnNextCommand, type NextCommandInvoker, type NextCommandSpawnInvoker } from "../../scripts/lib/next-command";

const projectDirectories: string[] = [];

function createProjectWithEnvFile(secretCanary: string) {
  const projectDirectory = mkdtempSync(join(tmpdir(), "karturt-next-env-preflight-"));
  projectDirectories.push(projectDirectory);
  writeFileSync(
    join(projectDirectory, ".env.local"),
    `DATABASE_URL=postgresql://synthetic:${secretCanary}@localhost:5432/karturt_dev\nBETTER_AUTH_SECRET=${secretCanary}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return projectDirectory;
}

afterEach(() => {
  for (const projectDirectory of projectDirectories.splice(0)) {
    rmSync(projectDirectory, { recursive: true, force: true });
  }
});

describe("repository-owned Next.js commands", () => {
  it.each(["build", "start"] as const)("blocks %s before Next can load a project env file", (command) => {
    const secretCanary = `w10-${randomUUID()}`;
    const projectDirectory = createProjectWithEnvFile(secretCanary);
    const invoke = vi.fn<NextCommandInvoker>(() => ({ status: 0 }));

    let message = "";
    try {
      runNextCommand(command, { projectDirectory, environment: {}, invoke });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("refuses to load project environment files");
    expect(message).not.toContain(secretCanary);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("blocks dev before Next starts unless the parent process explicitly opts into local development files", () => {
    const secretCanary = `w10-${randomUUID()}`;
    const projectDirectory = createProjectWithEnvFile(secretCanary);
    const invoke = vi.fn<NextCommandInvoker>(() => ({ status: 0 }));

    let message = "";
    try {
      runNextCommand("dev", {
        projectDirectory,
        environment: { APP_ENV: "development", DATABASE_ENV: "development" },
        invoke,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("explicit local opt-in");
    expect(message).not.toContain(secretCanary);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("starts dev only with matching process labels and an explicit local file opt-in", () => {
    const secretCanary = `w10-${randomUUID()}`;
    const projectDirectory = createProjectWithEnvFile(secretCanary);
    const environment = {
      NODE_ENV: "development",
      APP_ENV: "development",
      DATABASE_ENV: "development",
      KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD: "1",
    };
    const invoke = vi.fn<NextCommandInvoker>(() => ({ status: 0 }));

    expect(runNextCommand("dev", { projectDirectory, environment, args: ["--port", "3210"], invoke })).toBe(0);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[1]).toEqual([
      join(projectDirectory, "node_modules/next/dist/bin/next"),
      "dev",
      "--port",
      "3210",
    ]);
  });

  it("forwards the Next exit code through the wrapper", () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), "karturt-next-command-"));
    projectDirectories.push(projectDirectory);
    const invoke = vi.fn<NextCommandInvoker>(() => ({ status: 17 }));

    expect(runNextCommand("build", { projectDirectory, environment: {}, invoke })).toBe(17);
  });

  it("refuses mismatched smoke environment labels before the first child spawn", () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), "karturt-next-smoke-env-mismatch-"));
    projectDirectories.push(projectDirectory);
    const child = new EventEmitter() as ChildProcess;
    const spawnProcess = vi.fn<NextCommandSpawnInvoker>(() => child);

    expect(() => spawnNextCommand("dev", {
      projectDirectory,
      args: ["--port", "3210"],
      environment: {
        NODE_ENV: "development",
        APP_ENV: "development",
        DATABASE_ENV: "staging",
        DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5432/karturt_dev",
      },
      spawnProcess,
    })).toThrow("APP_ENV and DATABASE_ENV must match");

    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("refuses a project env file before a smoke start can load it", () => {
    const secretCanary = `async-smoke-${randomUUID()}`;
    const projectDirectory = createProjectWithEnvFile(secretCanary);
    const child = new EventEmitter() as ChildProcess;
    const spawnProcess = vi.fn<NextCommandSpawnInvoker>(() => child);

    let message = "";
    try {
      spawnNextCommand("start", {
        projectDirectory,
        args: ["--port", "3210"],
        environment: {
          NODE_ENV: "production",
          APP_ENV: "test",
          DATABASE_ENV: "test",
          DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5432/karturt_dev",
        },
        spawnProcess,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("refuses to load project environment files");
    expect(message).not.toContain(secretCanary);
    expect(message).not.toContain("postgresql://");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("preserves the safe Next child arguments and returns the original lifecycle handle", () => {
    const projectDirectory = createProjectWithEnvFile(`safe-smoke-${randomUUID()}`);
    const child = new EventEmitter() as ChildProcess;
    const spawnProcess = vi.fn<NextCommandSpawnInvoker>(() => child);
    const environment = {
      NODE_ENV: "development",
      APP_ENV: "development",
      DATABASE_ENV: "development",
      KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD: "1",
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5432/karturt_dev",
    };

    const result = spawnNextCommand("dev", {
      projectDirectory,
      args: ["--hostname", "127.0.0.1", "--port", "3210"],
      environment,
      stdio: "ignore",
      windowsHide: true,
      spawnProcess,
    });

    expect(result).toBe(child);
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      [join(projectDirectory, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3210"],
      { cwd: projectDirectory, env: environment, stdio: "ignore", windowsHide: true },
    );

    const onExit = vi.fn();
    result.once("exit", onExit);
    child.emit("exit", 17, null);
    expect(onExit).toHaveBeenCalledWith(17, null);
  });
});
