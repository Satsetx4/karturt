import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import {
  assertStagingMigrationAuthorization,
  parseStagingMigrationAuthorizationArtifact,
  type StagingMigrationAuthorizationExpectation,
} from "@/db/migration-approval";
import { assertCheckedInMigrationSnapshot, migrationManifestFingerprint } from "@/db/migration-manifest";

export type MigrationEnvironment = {
  APP_ENV?: string;
  DATABASE_ENV?: string;
  DATABASE_URL?: string;
  MIGRATION_DATABASE_URL?: string;
};

export type StagingMigrationInvocation = {
  authorizationFile: string;
};

export type StagingMigrationGitIdentity = {
  repositoryRoot: string;
  gitCommonDirectory: string;
  sourceSha: string;
  isClean: boolean;
};

export type StagingMigrationReviewContext = {
  sourceSha: string;
  targetManifestFingerprint: string;
  targetManifest: unknown;
  migrationManifestFingerprint: string;
};

export type MigrationSafetyDependencies = {
  environment: MigrationEnvironment;
  argv: string[];
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  repositoryRoot: string;
  getGitIdentity: () => StagingMigrationGitIdentity;
  assertTargetIdentity: (databaseUrl: string) => void;
  getTargetManifestFingerprint: () => string;
  getTargetManifest?: () => unknown;
  getMigrationManifestFingerprint?: () => string;
  readAuthorizationFile?: (path: string) => string;
  consumeAuthorizationOnce: (authorizationId: string, gitCommonDirectory: string) => void;
  confirmChallenge: (challenge: string, review: StagingMigrationReviewContext) => Promise<string>;
  createConfirmationNonce?: () => string;
  now?: () => number;
  approvalPublicKeyPem: string | null;
};

export type ApprovedMigrationContext = {
  databaseUrl: string;
  sourceSha: string;
  targetManifestFingerprint: string;
  migrationManifestFingerprint: string;
  authorizationId: string;
};

export class MigrationPreflightError extends Error {
  readonly category = "preflight";
}

export class MigrationOutcomeUnknownError extends Error {
  readonly category = "outcome-unknown";
}

export function formatStagingMigrationFailure(error: unknown) {
  if (error instanceof MigrationPreflightError || error instanceof MigrationOutcomeUnknownError) return error.message;
  return "Staging migration stopped unexpectedly. Database outcome is unverified; do not retry and request read-only reconciliation.";
}

function rejectPreflight(message: string): never {
  throw new MigrationPreflightError(message);
}

export function parseStagingMigrationInvocation(argv: string[]): StagingMigrationInvocation {
  if (argv.length !== 3 || argv[0] !== "--execute-once" || argv[1] !== "--authorization-file" || !argv[2]) {
    rejectPreflight("Use the explicit one-shot operator command with an external authorization file.");
  }
  if (!isAbsolute(argv[2])) rejectPreflight("The migration authorization file path must be absolute.");
  return { authorizationFile: resolve(argv[2]) };
}

export function assertStagingMigrationEnvironment(environment: MigrationEnvironment) {
  if (environment.APP_ENV !== "staging" || environment.DATABASE_ENV !== "staging") {
    rejectPreflight("APP_ENV and DATABASE_ENV must both explicitly equal staging for the operator migration path.");
  }
  if (environment.DATABASE_URL !== undefined) {
    rejectPreflight("DATABASE_URL is not accepted by the migration-only path; use the separate migration credential.");
  }
  if (!environment.MIGRATION_DATABASE_URL) {
    rejectPreflight("MIGRATION_DATABASE_URL is required for the separate operator migration credential.");
  }
  return environment.MIGRATION_DATABASE_URL;
}

function isInsideDirectory(directory: string, candidate: string) {
  const pathFromDirectory = relative(resolve(directory), resolve(candidate));
  return pathFromDirectory === "" || (!pathFromDirectory.startsWith(`..${sep}`) && pathFromDirectory !== ".." && !isAbsolute(pathFromDirectory));
}

function readExternalAuthorization(path: string, repositoryRoot: string) {
  if (isInsideDirectory(repositoryRoot, path)) {
    rejectPreflight("The migration authorization file must be stored outside the source worktree.");
  }
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new Error("invalid file");
    return readFileSync(path, "utf8");
  } catch {
    rejectPreflight("The migration authorization file is missing, unreadable, or not a regular external file.");
  }
}

export async function authorizeStagingMigration(dependencies: MigrationSafetyDependencies): Promise<ApprovedMigrationContext> {
  const invocation = parseStagingMigrationInvocation(dependencies.argv);
  if (!dependencies.stdinIsTTY || !dependencies.stdoutIsTTY) {
    rejectPreflight("The staging migration path requires an interactive terminal.");
  }

  const databaseUrl = assertStagingMigrationEnvironment(dependencies.environment);
  try {
    dependencies.assertTargetIdentity(databaseUrl);
  } catch {
    rejectPreflight("MIGRATION_DATABASE_URL was rejected by the staging target identity guard.");
  }

  let gitIdentity: StagingMigrationGitIdentity;
  try {
    gitIdentity = dependencies.getGitIdentity();
  } catch {
    rejectPreflight("The migration source identity could not be verified.");
  }
  if (resolve(gitIdentity!.repositoryRoot).toLowerCase() !== resolve(dependencies.repositoryRoot).toLowerCase()) {
    rejectPreflight("The current working directory is not the root of the migration source checkout.");
  }
  if (!gitIdentity!.isClean) rejectPreflight("The migration source worktree must be clean before an approved run.");
  if (!/^[a-f0-9]{40}$/.test(gitIdentity!.sourceSha)) rejectPreflight("The current migration source SHA is invalid.");

  try {
    assertCheckedInMigrationSnapshot(gitIdentity!.repositoryRoot);
  } catch {
    rejectPreflight("The immutable migration snapshot check failed.");
  }

  let targetManifestFingerprint: string;
  try {
    targetManifestFingerprint = dependencies.getTargetManifestFingerprint().toLowerCase();
  } catch {
    rejectPreflight("The reviewed staging target manifest could not be verified.");
  }
  if (!/^[a-f0-9]{64}$/.test(targetManifestFingerprint)) {
    rejectPreflight("The reviewed staging target manifest fingerprint is invalid.");
  }
  let currentMigrationManifestFingerprint: string;
  try {
    currentMigrationManifestFingerprint = (dependencies.getMigrationManifestFingerprint ?? migrationManifestFingerprint)();
  } catch {
    rejectPreflight("The migration manifest fingerprint could not be computed.");
  }
  if (!/^[a-f0-9]{64}$/.test(currentMigrationManifestFingerprint!)) {
    rejectPreflight("The migration manifest fingerprint is invalid.");
  }

  let artifact;
  try {
    const serialized = dependencies.readAuthorizationFile
      ? dependencies.readAuthorizationFile(invocation.authorizationFile)
      : readExternalAuthorization(invocation.authorizationFile, dependencies.repositoryRoot);
    artifact = parseStagingMigrationAuthorizationArtifact(serialized);
  } catch (error) {
    if (error instanceof MigrationPreflightError) throw error;
    rejectPreflight("The migration authorization file is missing or malformed.");
  }

  const expectation: StagingMigrationAuthorizationExpectation = {
    sourceSha: gitIdentity!.sourceSha,
    targetManifestFingerprint,
    migrationManifestFingerprint: currentMigrationManifestFingerprint,
    nowMs: (dependencies.now ?? Date.now)(),
  };
  let verifiedAuthorization: ReturnType<typeof assertStagingMigrationAuthorization>;
  try {
    verifiedAuthorization = assertStagingMigrationAuthorization(artifact!, expectation, dependencies.approvalPublicKeyPem);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    rejectPreflight(message === "No owner approval key is pinned in this source revision; staging migration is disabled."
      ? message
      : "The migration authorization is invalid, expired, untrusted, or does not match the reviewed source and target.");
  }

  const confirmationNonce = (dependencies.createConfirmationNonce ?? (() => randomBytes(8).toString("hex")))();
  if (!/^[a-f0-9]{16}$/.test(confirmationNonce)) rejectPreflight("The interactive confirmation challenge could not be created safely.");
  const challenge = [
    "STAGING-MIGRATION",
    gitIdentity!.sourceSha.slice(0, 12),
    targetManifestFingerprint.slice(0, 12),
    confirmationNonce,
  ].join(" ");
  const typedChallenge = await dependencies.confirmChallenge(challenge, {
    sourceSha: gitIdentity!.sourceSha,
    targetManifestFingerprint,
    targetManifest: dependencies.getTargetManifest?.() ?? null,
    migrationManifestFingerprint: currentMigrationManifestFingerprint!,
  });
  if (typedChallenge !== challenge) rejectPreflight("The interactive migration confirmation did not match this one-shot request.");

  try {
    dependencies.consumeAuthorizationOnce(verifiedAuthorization!.authorizationId, gitIdentity!.gitCommonDirectory);
  } catch {
    rejectPreflight("This migration authorization has already been used or could not be consumed safely.");
  }

  return {
    databaseUrl,
    sourceSha: gitIdentity!.sourceSha,
    targetManifestFingerprint,
    migrationManifestFingerprint: currentMigrationManifestFingerprint,
    authorizationId: verifiedAuthorization!.authorizationId,
  };
}

export type MigrationExecutionDependencies<Client> = {
  createClient: (databaseUrl: string) => Client;
  runMigrations: (client: Client) => Promise<void>;
  closeClient: (client: Client) => Promise<void>;
  timeoutMs?: number;
};

export async function executeApprovedMigrationsOnce<Client>(
  context: ApprovedMigrationContext,
  dependencies: MigrationExecutionDependencies<Client>,
) {
  const client = dependencies.createClient(context.databaseUrl);
  const timeoutMs = dependencies.timeoutMs ?? 15 * 60 * 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutReached = false;
  const migrationPromise = Promise.resolve().then(() => dependencies.runMigrations(client));
  migrationPromise.catch(() => undefined);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timeoutReached = true;
      reject(new Error("migration timed out"));
    }, timeoutMs);
  });

  let completed = false;
  try {
    await Promise.race([migrationPromise, timeoutPromise]);
    completed = true;
  } catch {
    completed = false;
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await dependencies.closeClient(client);
    } catch {
      completed = false;
    }
  }

  if (!completed) {
    throw new MigrationOutcomeUnknownError(
      timeoutReached
        ? "The migration timed out; its database outcome may be partial. Do not retry; request read-only reconciliation."
        : "The migration failed; its database outcome may be partial. Do not retry; request read-only reconciliation.",
    );
  }
}

export type StagingMigrationCommandDependencies<Client> = MigrationSafetyDependencies &
  MigrationExecutionDependencies<Client>;

export async function runStagingMigrationCommandOnce<Client>(
  dependencies: StagingMigrationCommandDependencies<Client>,
) {
  const context = await authorizeStagingMigration(dependencies);
  await executeApprovedMigrationsOnce(context, dependencies);
  return context;
}
