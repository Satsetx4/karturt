import { readdirSync } from "node:fs";
import { loadEnvConfig } from "@next/env";

const LOCAL_ENV_FILE_LOAD_OPT_IN = "KARTUR_ALLOW_LOCAL_ENV_FILE_LOAD";

export type ProjectEnvLoader = (projectDirectory: string) => unknown;
export type ProjectEnvironment = Record<string, string | undefined>;

function isProjectEnvironmentFile(fileName: string) {
  return fileName.startsWith(".env") && fileName !== ".env.example";
}

export function findProjectEnvironmentFiles(projectDirectory: string) {
  return readdirSync(projectDirectory).filter(isProjectEnvironmentFile);
}

export function assertNoProjectEnvironmentFiles(
  projectDirectory: string,
  commandName: string,
  environmentFiles = findProjectEnvironmentFiles(projectDirectory),
) {
  if (environmentFiles.some(isProjectEnvironmentFile)) {
    throw new Error(`${commandName} refuses to load project environment files; provide approved values through the process environment.`);
  }
}

export function assertProjectEnvironmentFileLoadAllowed(environment: ProjectEnvironment = process.env) {
  if (
    (environment.NODE_ENV !== undefined && environment.NODE_ENV !== "development") ||
    (environment.CI !== undefined && environment.CI !== "") ||
    environment.APP_ENV !== "development" ||
    environment.DATABASE_ENV !== "development" ||
    environment[LOCAL_ENV_FILE_LOAD_OPT_IN] !== "1"
  ) {
    throw new Error(
      "Project environment files require an explicit local opt-in and matching development labels in the parent process.",
    );
  }
}

export function loadProjectEnvConfig(
  projectDirectory: string,
  options: {
    environment?: ProjectEnvironment;
    environmentFiles?: string[];
    loader?: ProjectEnvLoader;
  } = {},
) {
  const environmentFiles = (options.environmentFiles ?? findProjectEnvironmentFiles(projectDirectory))
    .filter(isProjectEnvironmentFile);
  if (environmentFiles.length === 0) return undefined;

  assertProjectEnvironmentFileLoadAllowed(options.environment ?? process.env);
  return (options.loader ?? loadEnvConfig)(projectDirectory);
}
