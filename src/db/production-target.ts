import { stagingDatabaseTarget } from "@/db/staging-target";

export const productionDatabaseTarget = {
  database: "karturt_production",
  runtimeRole: "karturt_production_runtime",
  migrationRole: "karturt_production_migrator",
} as const;

export type ProductionTargetIdentity = {
  projectId: string;
  branchId: string;
  endpointId: string;
  database: string;
};

export type ProductionConnectionPurpose = "runtime" | "migration";
export type ProductionTargetEnvironment = Readonly<Record<string, string | undefined>>;

function requiredValue(environment: ProductionTargetEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(name + " is required for a target-bound Production database connection.");
  return value;
}

function parseTargetIdentity(value: string, name: string): ProductionTargetIdentity {
  const parts = value.split("/");
  if (
    parts.length !== 4 ||
    !/^[a-z0-9][a-z0-9-]{2,63}$/.test(parts[0]) ||
    !/^br-[a-z0-9-]{6,60}$/.test(parts[1]) ||
    !/^ep-[a-z0-9-]{6,60}$/.test(parts[2]) ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(parts[3])
  ) {
    throw new Error(name + " must identify one Neon project/branch/endpoint/database.");
  }
  return { projectId: parts[0], branchId: parts[1], endpointId: parts[2], database: parts[3] };
}

export function parseProductionTargetIdentity(environment: ProductionTargetEnvironment = process.env) {
  const production = parseTargetIdentity(
    requiredValue(environment, "KARTURT_PRODUCTION_TARGET_ID"),
    "KARTURT_PRODUCTION_TARGET_ID",
  );
  const preview = parseTargetIdentity(
    requiredValue(environment, "KARTURT_PREVIEW_TARGET_ID"),
    "KARTURT_PREVIEW_TARGET_ID",
  );

  if (production.database !== productionDatabaseTarget.database) {
    throw new Error("Production target database must be " + productionDatabaseTarget.database + ".");
  }
  if (
    production.projectId === preview.projectId ||
    production.branchId === preview.branchId ||
    production.endpointId === preview.endpointId
  ) {
    throw new Error("Preview and Production targets must use separate Neon projects, branches, and endpoints.");
  }
  if (
    production.projectId === stagingDatabaseTarget.projectId ||
    production.branchId === stagingDatabaseTarget.branchId ||
    production.endpointId === stagingDatabaseTarget.endpointId
  ) {
    throw new Error("The disputed canonical staging target cannot be used for Production.");
  }

  return production;
}

export function assertProductionConnectionTarget(
  connectionString: string,
  purpose: ProductionConnectionPurpose,
  environment: ProductionTargetEnvironment = process.env,
) {
  const target = parseProductionTargetIdentity(environment);
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Production database connection URL is invalid.");
  }

  const hostname = url.hostname.toLowerCase();
  const endpointLabel = hostname.split(".")[0];
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const role = decodeURIComponent(url.username);
  const expectedRole = purpose === "runtime" ? productionDatabaseTarget.runtimeRole : productionDatabaseTarget.migrationRole;
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
    sslmode !== "verify-full" ||
    sslrootcert !== "system" ||
    url.hash
  ) {
    throw new Error("Production " + purpose + " connection does not match the isolated Neon target, role, and verify-full TLS policy.");
  }

  return target;
}
