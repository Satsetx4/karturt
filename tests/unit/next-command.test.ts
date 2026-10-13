import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runNextCommand, type NextCommandInvoker } from "../../scripts/lib/next-command";

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
});
