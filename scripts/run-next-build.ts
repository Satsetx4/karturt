import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertNoProjectEnvironmentFiles } from "../src/lib/env-file-preflight";

const projectDirectory = process.cwd();
assertNoProjectEnvironmentFiles(projectDirectory, "The production build");

const nextCli = resolve(projectDirectory, "node_modules/next/dist/bin/next");
const result = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: projectDirectory,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error("The production build could not start.");
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
