import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cleanupRunOwnedContainer, verifyRunOwnedContainer } from "./lib/disposable-postgres-cleanup";
import { disposablePostgresMarker, disposablePostgresNames } from "./lib/disposable-postgres-identity";

const image = "postgres:17";
const labelName = "com.satsetx4.karturt.disposable-run";
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const identityToken = randomBytes(32).toString("hex");
const password = randomBytes(32).toString("base64url");
const { databaseName, username } = disposablePostgresNames(runId);
const identityMarker = disposablePostgresMarker(runId, identityToken);
const evidencePath = join(tmpdir(), `karturt-postgres-concurrency-${runId}.json`);

type CommandResult = { status: number | null; stdout: string; stderr: string; error?: Error };
type Engine = { command: "docker" | "podman"; version: string };

function run(command: string, args: string[], inherit = false, env: NodeJS.ProcessEnv = process.env): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    stdio: inherit ? "inherit" : "pipe",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function findEngines(): Engine[] {
  const engines: Engine[] = [];
  for (const command of ["docker", "podman"] as const) {
    const args = command === "docker"
      ? ["info", "--format", "{{.ServerVersion}}"]
      : ["info", "--format", "{{.Host.Version}}"];
    const result = run(command, args);
    if (result.status === 0 && result.stdout.trim()) {
      engines.push({ command, version: result.stdout.trim() });
    }
  }
  return engines;
}

async function waitForPostgres(engine: Engine, containerId: string) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const ready = run(engine.command, [
      "exec", containerId, "pg_isready", "-U", username, "-d", databaseName,
    ]);
    if (ready.status === 0) return;
    await delay(500);
  }
  throw new Error("The run-owned disposable PostgreSQL container did not become ready within 45 seconds.");
}

function cleanup(engine: Engine, containerId: string | null, containerName: string) {
  return cleanupRunOwnedContainer({
    containerId,
    containerName,
    labelName,
    runCommand: (args) => run(engine.command, args),
    runId,
    onFailure: (message) => process.stderr.write(`${message}\n`),
  });
}

function ownsContainer(engine: Engine, containerId: string) {
  return verifyRunOwnedContainer({
    containerId,
    labelName,
    runCommand: (args) => run(engine.command, args),
    runId,
  });
}

async function main() {
  const engines = findEngines();
  if (engines.length === 0) {
    throw new Error("BLOCKED: neither Docker nor Podman has an available local engine; no PostgreSQL connection or resource was created.");
  }

  const engine = engines.find((candidate) => run(candidate.command, ["image", "inspect", image]).status === 0);
  if (!engine) {
    throw new Error(`BLOCKED: ${image} is not already present in an available local Docker/Podman image store; the runner will not pull it.`);
  }

  const name = `karturt-pg-${runId}`;
  const containerEnvironment = { ...process.env, POSTGRES_PASSWORD: password };
  const created = run(engine.command, [
    "run",
    "--detach",
    "--rm",
    "--pull=never",
    "--name",
    name,
    "--label",
    `${labelName}=${runId}`,
    "--tmpfs",
    "/var/lib/postgresql/data",
    "--env",
    `POSTGRES_DB=${databaseName}`,
    "--env",
    `POSTGRES_USER=${username}`,
    "--env",
    "POSTGRES_PASSWORD",
    "--publish",
    "127.0.0.1::5432",
    image,
  ], false, containerEnvironment);
  const containerId = created.stdout.trim().split(/\s+/).at(-1) ?? null;
  let finalExitCode = 1;

  try {
    if (created.status !== 0 || !containerId || !/^[a-f0-9]{12,64}$/i.test(containerId)) {
      throw new Error("The local container engine did not start a run-owned disposable PostgreSQL container.");
    }
    if (!ownsContainer(engine, containerId)) {
      throw new Error("The new PostgreSQL container did not carry this run's ownership label; the database was not used.");
    }

    const mappedPort = run(engine.command, ["port", containerId, "5432/tcp"]);
    const portMatch = mappedPort.stdout.match(/127\.0\.0\.1:(\d+)/);
    if (mappedPort.status !== 0 || !portMatch) {
      throw new Error("The disposable PostgreSQL port was not mapped to loopback; the database was not used.");
    }

    await waitForPostgres(engine, containerId);
    const quotedDatabase = `"${databaseName}"`;
    const quotedMarker = `'${identityMarker}'`;
    const marked = run(engine.command, [
      "exec", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", username, "-d", databaseName,
      "-c", `COMMENT ON DATABASE ${quotedDatabase} IS ${quotedMarker}`,
    ]);
    if (marked.status !== 0) {
      throw new Error("Could not mark the run-owned database with its unique identity; the concurrency suite was not started.");
    }

    const url = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${portMatch[1]}/${databaseName}`;
    const childEnvironment = {
      ...process.env,
      APP_ENV: "test",
      DATABASE_ENV: "test",
      KARTURT_POSTGRES_RUN_ID: runId,
      KARTURT_POSTGRES_IDENTITY_TOKEN: identityToken,
      LAUNCH_SAFETY_POSTGRES_URL: url,
      LAUNCH_SAFETY_POSTGRES_EVIDENCE_PATH: evidencePath,
    };
    const tsxCli = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const child = run(process.execPath, [tsxCli, "scripts/launch-safety-postgres-concurrency.ts"], true, childEnvironment);
    finalExitCode = child.status ?? 1;
    if (finalExitCode === 0) {
      process.stdout.write(`Run-owned PostgreSQL container ${name} passed the five concurrency races. Evidence: ${evidencePath}\n`);
    }
  } finally {
    if (!cleanup(engine, containerId, name)) finalExitCode = 1;
  }

  process.exitCode = finalExitCode;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Disposable PostgreSQL concurrency runner failed closed."}\n`);
  process.exitCode = 1;
});
