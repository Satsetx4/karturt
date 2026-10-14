import { closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { isAbsolute, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { Pool } from "@neondatabase/serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { drizzle } from "drizzle-orm/neon-serverless";
import {
  assertStagingMigrationTarget,
  getStagingMigrationTargetManifestFingerprint,
  STAGING_MIGRATION_TARGET_MANIFEST,
} from "@/lib/staging-database-target";
import { PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM } from "@/db/migration-approval";
import {
  runStagingMigrationCommandOnce,
  formatStagingMigrationFailure,
  type StagingMigrationGitIdentity,
} from "@/db/migration-safety";

function gitText(repositoryRoot: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function getGitIdentity(repositoryRoot: string): StagingMigrationGitIdentity {
  try {
    const actualRepositoryRoot = gitText(repositoryRoot, ["rev-parse", "--show-toplevel"]);
    if (resolve(actualRepositoryRoot).toLowerCase() !== resolve(repositoryRoot).toLowerCase()) {
      throw new Error("wrong working directory");
    }
    const sourceSha = gitText(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
    const status = gitText(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const gitCommonDirectory = gitText(repositoryRoot, ["rev-parse", "--git-common-dir"]);
    return {
      repositoryRoot: actualRepositoryRoot,
      gitCommonDirectory: isAbsolute(gitCommonDirectory)
        ? gitCommonDirectory
        : resolve(actualRepositoryRoot, gitCommonDirectory),
      sourceSha,
      isClean: status === "",
    };
  } catch {
    throw new Error("Unable to inspect the migration source checkout.");
  }
}

function consumeAuthorizationOnce(authorizationId: string, gitCommonDirectory: string) {
  if (!/^[a-f0-9]{64}$/.test(authorizationId)) throw new Error("Invalid authorization id.");
  const replayDirectory = resolve(gitCommonDirectory, "karturt-v1-staging-migration", "consumed");
  const marker = resolve(replayDirectory, `${authorizationId}.used`);
  mkdirSync(replayDirectory, { recursive: true });
  let descriptor: number;
  try {
    descriptor = openSync(marker, "wx", 0o600);
  } catch {
    throw new Error("Authorization was already consumed.");
  }
  try {
    writeFileSync(descriptor, `${authorizationId}\n`, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

async function confirmInteractiveChallenge(
  challenge: string,
  review: { sourceSha: string; targetManifestFingerprint: string; targetManifest: unknown; migrationManifestFingerprint: string },
) {
  console.info(`Source SHA: ${review.sourceSha}`);
  console.info(`Target manifest fingerprint: ${review.targetManifestFingerprint}`);
  console.info(`Target manifest: ${JSON.stringify(review.targetManifest)}`);
  console.info(`Migration manifest fingerprint: ${review.migrationManifestFingerprint}`);
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return await prompt.question(`Review the external approval, source SHA, target manifest, and migration snapshot. Type this one-time challenge to continue:\n${challenge}\n> `);
  } finally {
    prompt.close();
  }
}

function createMigrationPool(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    min: 0,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10 * 60 * 1000,
    query_timeout: 11 * 60 * 1000,
    lock_timeout: 30 * 1000,
    idle_in_transaction_session_timeout: 60 * 1000,
    application_name: "karturt-staging-migration-operator",
  });
  // Do not surface driver errors that could contain connection details.
  pool.on("error", () => undefined);
  return pool;
}

async function main() {
  const repositoryRoot = process.cwd();
  await runStagingMigrationCommandOnce({
    environment: {
      APP_ENV: process.env.APP_ENV,
      DATABASE_ENV: process.env.DATABASE_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
    },
    argv: process.argv.slice(2),
    stdinIsTTY: stdin.isTTY === true,
    stdoutIsTTY: stdout.isTTY === true,
    repositoryRoot,
    getGitIdentity: () => getGitIdentity(repositoryRoot),
    assertTargetIdentity: assertStagingMigrationTarget,
    getTargetManifestFingerprint: getStagingMigrationTargetManifestFingerprint,
    getTargetManifest: () => STAGING_MIGRATION_TARGET_MANIFEST,
    consumeAuthorizationOnce,
    confirmChallenge: confirmInteractiveChallenge,
    approvalPublicKeyPem: PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM,
    createClient: createMigrationPool,
    runMigrations: async (pool) => {
      const migrationDb = drizzle({ client: pool });
      await migrate(migrationDb, { migrationsFolder: resolve(repositoryRoot, "drizzle") });
    },
    closeClient: (pool) => pool.end(),
  });
  console.info("The one-shot migration command returned successfully. Separate read-only post-migration acceptance is still required.");
}

main().catch((error: unknown) => {
  console.error(formatStagingMigrationFailure(error));
  process.exitCode = 1;
});
