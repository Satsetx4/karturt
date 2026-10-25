import { stagingDatabaseTarget } from "@/db/staging-target";

export const previewDatabaseTarget = {
  database: "karturt_preview",
  runtimeRole: "karturt_preview_runtime",
  migrationRole: "karturt_preview_migrator",
} as const;

export type PreviewTargetIdentity = {
  projectId: string;
  branchId: string;
  endpointId: string;
  database: string;
};

export type PreviewConnectionPurpose = "runtime" | "migration";

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for an isolated Preview database target.`);
  return value;
}

function parseTargetIdentity(value: string, name: string): PreviewTargetIdentity {
  const parts = value.split("/");
  if (
    parts.length !== 4 ||
    !/^[a-z0-9][a-z0-9-]{2,63}$/.test(parts[0]) ||
    !/^br-[a-z0-9-]{6,60}$/.test(parts[1]) ||
    !/^ep-[a-z0-9-]{6,60}$/.test(parts[2]) ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(parts[3])
  ) {
    throw new Error(`${name} must identify one Neon project/branch/endpoint/database.`);
  }
  return { projectId: parts[0], branchId: parts[1], endpointId: parts[2], database: parts[3] };
}

export function parsePreviewTargetIdentity(environment: NodeJS.ProcessEnv = process.env) {
  const preview = parseTargetIdentity(requiredEnvironmentValue(environment, "KARTURT_PREVIEW_TARGET_ID"), "KARTURT_PREVIEW_TARGET_ID");
  const production = parseTargetIdentity(requiredEnvironmentValue(environment, "KARTURT_PRODUCTION_TARGET_ID"), "KARTURT_PRODUCTION_TARGET_ID");

  if (preview.database !== previewDatabaseTarget.database) {
    throw new Error(`Preview target database must be ${previewDatabaseTarget.database}.`);
  }
  if (preview.projectId === production.projectId || preview.endpointId === production.endpointId) {
    throw new Error("Preview and production database targets must use separate Neon projects and endpoints.");
  }
  if (
    preview.projectId === stagingDatabaseTarget.projectId ||
    preview.branchId === stagingDatabaseTarget.branchId ||
    preview.endpointId === stagingDatabaseTarget.endpointId
  ) {
    throw new Error("The disputed canonical staging target cannot be used for Preview.");
  }

  return preview;
}

export function assertPreviewConnectionTarget(
  connectionString: string,
  purpose: PreviewConnectionPurpose,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const target = parsePreviewTargetIdentity(environment);
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Preview database connection URL is invalid.");
  }

  const hostname = url.hostname.toLowerCase();
  const endpointLabel = hostname.split(".")[0];
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const role = decodeURIComponent(url.username);
  const expectedRole = purpose === "runtime" ? previewDatabaseTarget.runtimeRole : previewDatabaseTarget.migrationRole;
  const sslmode = url.searchParams.get("sslmode");
  const sslrootcert = url.searchParams.get("sslrootcert");

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    endpointLabel !== target.endpointId ||
    !hostname.endsWith(".neon.tech") ||
    endpointLabel.includes("pooler") ||
    (url.port && url.port !== "5432") ||
    database !== target.database ||
    role !== expectedRole ||
    !url.username ||
    !url.password ||
    (sslmode !== null && sslmode !== "require" && sslmode !== "verify-full") ||
    (sslrootcert !== null && sslrootcert !== "system") ||
    url.hash
  ) {
    throw new Error(`Preview ${purpose} connection does not match the isolated Neon target and role.`);
  }

  return target;
}

export type PreviewMigrationMode = "plan" | "apply";

export function parsePreviewMigrationMode(arguments_: readonly string[]): PreviewMigrationMode {
  if (arguments_.length === 1 && arguments_[0] === "--preview") return "apply";
  if (arguments_.length === 2 && arguments_[0] === "--preview" && arguments_[1] === "--plan") return "plan";
  throw new Error("Preview migration accepts only --preview or --preview --plan.");
}
