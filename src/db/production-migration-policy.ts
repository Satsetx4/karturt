import type { ProductionTargetEnvironment, ProductionTargetIdentity } from "@/db/production-target";

export type ProductionMigrationAuthorization = {
  authorizedSha: string;
  authorizedTarget: string;
  authorizationRef: string;
  productionGoRef: string;
  preflightRef?: string;
  recoveryRef?: string;
};

function required(environment: ProductionTargetEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(name + " is required for the authorized Production operation.");
  return value;
}

function requireIssueReference(environment: ProductionTargetEnvironment, name: string) {
  const value = required(environment, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(name + " must be a GitHub issue comment reference for KartuRT.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    !/^\/Satsetx4\/karturt\/issues\/(107|110)$/.test(url.pathname) ||
    !/^#issuecomment-[0-9]+$/.test(url.hash)
  ) {
    throw new Error(name + " must be a GitHub issue comment reference for KartuRT.");
  }
  return url.href;
}

export function parseProductionMigrationAuthorization(
  environment: ProductionTargetEnvironment,
  mode: "preflight" | "apply",
  releaseSha: string,
  target: ProductionTargetIdentity,
): ProductionMigrationAuthorization {
  const authorizedSha = required(environment, "KARTURT_PRODUCTION_MIGRATION_AUTHORIZED_SHA").toLowerCase();
  const authorizedTarget = required(environment, "KARTURT_PRODUCTION_MIGRATION_AUTHORIZED_TARGET");
  const expectedTarget = [target.projectId, target.branchId, target.endpointId, target.database].join("/");
  if (!/^[0-9a-f]{40}$/.test(releaseSha) || authorizedSha !== releaseSha.toLowerCase()) {
    throw new Error("Production migration authorization must match the exact checked-out release SHA.");
  }
  if (authorizedTarget !== expectedTarget) {
    throw new Error("Production migration authorization must match the exact Neon project/branch/endpoint/database.");
  }

  const authorizationRef = requireIssueReference(environment, "KARTURT_PRODUCTION_MIGRATION_AUTHORIZATION_REF");
  const productionGoRef = requireIssueReference(environment, "KARTURT_PRODUCTION_GO_REF");
  if (mode === "apply") {
    return {
      authorizedSha,
      authorizedTarget,
      authorizationRef,
      productionGoRef,
      preflightRef: requireIssueReference(environment, "KARTURT_PRODUCTION_PREFLIGHT_REF"),
      recoveryRef: requireIssueReference(environment, "KARTURT_PRODUCTION_RECOVERY_REF"),
    };
  }
  return { authorizedSha, authorizedTarget, authorizationRef, productionGoRef };
}
