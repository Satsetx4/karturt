import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { resolve } from "node:path";
import {
  assertNoProjectEnvironmentFiles,
  assertProjectEnvironmentFileLoadAllowed,
  findProjectEnvironmentFiles,
  type ProjectEnvironment,
} from "../../src/lib/env-file-preflight";

export type NextCommand = "dev" | "build" | "start";

type NextCommandResult = { status: number | null; error?: Error | null };
export type NextCommandInvoker = (
  executable: string,
  args: string[],
  options: { cwd: string; env: ProjectEnvironment; stdio: "inherit" },
) => NextCommandResult;
export type NextCommandSpawnInvoker = (
  executable: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

function invokeNext(executable: string, args: string[], options: { cwd: string; env: ProjectEnvironment; stdio: "inherit" }) {
  return spawnSync(executable, args, { ...options, env: options.env as NodeJS.ProcessEnv });
}

function invokeNextAsync(executable: string, args: string[], options: SpawnOptions) {
  return spawn(executable, args, options);
}

function assertEnvironmentPolicy(command: NextCommand, projectDirectory: string, environment: ProjectEnvironment) {
  const environmentFiles = findProjectEnvironmentFiles(projectDirectory);
  if (environmentFiles.length === 0) return;

  if (command === "dev") {
    assertProjectEnvironmentFileLoadAllowed(environment);
    return;
  }

  const label = command === "build" ? "The production build" : "The production server";
  assertNoProjectEnvironmentFiles(projectDirectory, label, environmentFiles);
}

function assertMatchingEnvironmentLabels(environment: ProjectEnvironment) {
  if (!environment.APP_ENV || !environment.DATABASE_ENV) {
    throw new Error("APP_ENV and DATABASE_ENV must both be set explicitly before a smoke server can start.");
  }
  if (environment.APP_ENV !== environment.DATABASE_ENV) {
    throw new Error("Environment mismatch: APP_ENV and DATABASE_ENV must match before a smoke server can start.");
  }
}

/**
 * Start a smoke-test Next.js child only after checking whether Next itself
 * could load project environment files. The returned ChildProcess is passed
 * through unchanged so each smoke harness retains its own signal and teardown
 * behavior.
 */
export function spawnNextCommand(
  command: NextCommand,
  options: {
    projectDirectory?: string;
    args?: string[];
    environment?: ProjectEnvironment;
    stdio?: SpawnOptions["stdio"];
    windowsHide?: boolean;
    spawnProcess?: NextCommandSpawnInvoker;
  } = {},
): ChildProcess {
  const projectDirectory = options.projectDirectory ?? process.cwd();
  const environment = options.environment ?? process.env;

  assertMatchingEnvironmentLabels(environment);
  assertEnvironmentPolicy(command, projectDirectory, environment);

  const nextCli = resolve(projectDirectory, "node_modules/next/dist/bin/next");
  return (options.spawnProcess ?? invokeNextAsync)(process.execPath, [
    nextCli,
    command,
    ...(options.args ?? []),
  ], {
    cwd: projectDirectory,
    env: environment as NodeJS.ProcessEnv,
    stdio: options.stdio ?? "inherit",
    windowsHide: options.windowsHide,
  });
}

export function runNextCommand(
  command: NextCommand,
  options: {
    projectDirectory?: string;
    args?: string[];
    environment?: ProjectEnvironment;
    invoke?: NextCommandInvoker;
  } = {},
) {
  const projectDirectory = options.projectDirectory ?? process.cwd();
  const environment = options.environment ?? process.env;
  assertEnvironmentPolicy(command, projectDirectory, environment);

  const nextCli = resolve(projectDirectory, "node_modules/next/dist/bin/next");
  const result = (options.invoke ?? invokeNext)(
    process.execPath,
    [nextCli, command, ...(options.args ?? process.argv.slice(2))],
    { cwd: projectDirectory, env: environment, stdio: "inherit" },
  );

  if (result.error) {
    console.error(`The Next.js ${command} command could not start.`);
    return 1;
  }
  return result.status ?? 1;
}
