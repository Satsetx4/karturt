import { spawnSync } from "node:child_process";
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

function invokeNext(executable: string, args: string[], options: { cwd: string; env: ProjectEnvironment; stdio: "inherit" }) {
  return spawnSync(executable, args, { ...options, env: options.env as NodeJS.ProcessEnv });
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
