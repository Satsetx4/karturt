import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { assertPreviewConnectionTarget, assertR3PreviewBusinessDateTarget } from "@/db/preview-target";
import { getDb, closeDb } from "@/db/client";
import { requireDatabaseEnvironment } from "@/lib/env";
import {
  rekeyPreviewSyntheticCredentials,
  type PreviewSyntheticRekeyCredentials,
} from "@/lib/rt/preview-synthetic-credential-rekey";

function requiredSecret(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required from the local ignored environment file.`);
  return value;
}

function assertExactCleanCheckout() {
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
  if (!/^[0-9a-f]{40}$/.test(headSha) || status.trim()) {
    throw new Error("Preview rekey requires a clean checkout at one full Git commit SHA.");
  }
  if (process.env.KARTURT_PREVIEW_REKEY_SHA !== headSha) {
    throw new Error("KARTURT_PREVIEW_REKEY_SHA must equal the clean checkout SHA with exact-head CI evidence.");
  }
  return headSha;
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  if (process.argv.length !== 3 || process.argv[2] !== "--apply") {
    throw new Error("Use this one-shot utility only after a separate exact-SHA and exact-target GO: npm run auth:rekey-preview-synthetic -- --apply");
  }

  const releaseSha = assertExactCleanCheckout();
  const environment = requireDatabaseEnvironment();
  if (environment.appEnv !== "preview" || environment.databaseEnv !== "preview") {
    throw new Error("Preview rekey requires APP_ENV=preview and DATABASE_ENV=preview.");
  }
  assertR3PreviewBusinessDateTarget(process.env);
  assertPreviewConnectionTarget(environment.databaseUrl, "runtime", process.env);

  const credentials: PreviewSyntheticRekeyCredentials = {
    residentPin: requiredSecret("KARTURT_PREVIEW_REKEY_RESIDENT_PIN"),
    chairmanPassword: requiredSecret("KARTURT_PREVIEW_REKEY_CHAIRMAN_PASSWORD"),
    treasurerPassword: requiredSecret("KARTURT_PREVIEW_REKEY_TREASURER_PASSWORD"),
    systemAdminPassword: requiredSecret("KARTURT_PREVIEW_REKEY_SYSTEM_ADMIN_PASSWORD"),
  };

  const result = await rekeyPreviewSyntheticCredentials(getDb(), credentials, releaseSha, process.env);
  console.log(`Rekeyed ${result.accountsRekeyed} canonical Preview synthetic accounts and revoked ${result.sessionsRevoked} sessions at ${releaseSha}.`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown Preview rekey error.";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
