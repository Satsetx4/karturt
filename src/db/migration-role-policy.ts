import { stagingDatabaseTargetReference } from "@/db/staging-target";

export type StagingMigrationAuthorization = {
  releaseSha: string;
  ciRunId: string;
  ciAttempt: string;
  authorizationRef: string;
  authorizedTarget: string;
  authorizedOperation: "official-migrations-0000-0013";
};

const authorizationReference = /^[A-Za-z0-9.#:/_-]{3,160}$/;

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for an authorized staging migration.`);
  return value;
}

export function parseStagingMigrationAuthorization(
  environment: NodeJS.ProcessEnv,
  actualHeadSha: string,
): StagingMigrationAuthorization {
  const releaseSha = actualHeadSha.toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error("Staging migration authorization requires the full checked-out release SHA.");
  }
  if (requiredEnvironmentValue(environment, "KARTURT_R2_MIGRATION_AUTHORIZED_SHA") !== releaseSha) {
    throw new Error("Staging migration authorization must match the checked-out release SHA.");
  }
  if (requiredEnvironmentValue(environment, "KARTURT_R2_CI_HEAD_SHA").toLowerCase() !== releaseSha) {
    throw new Error("Staging migration requires exact-head CI evidence for the checked-out release SHA.");
  }
  if (requiredEnvironmentValue(environment, "KARTURT_R2_MIGRATION_AUTHORIZED_TARGET") !== stagingDatabaseTargetReference) {
    throw new Error("Staging migration authorization must name the canonical staging target.");
  }
  if (requiredEnvironmentValue(environment, "KARTURT_R2_MIGRATION_AUTHORIZED_OPERATION") !== "official-migrations-0000-0013") {
    throw new Error("Staging migration authorization must explicitly allow official-migrations-0000-0013.");
  }

  const ciRunId = requiredEnvironmentValue(environment, "KARTURT_R2_CI_RUN_ID");
  const ciAttempt = requiredEnvironmentValue(environment, "KARTURT_R2_CI_ATTEMPT");
  if (!/^\d+$/.test(ciRunId) || !/^\d+$/.test(ciAttempt)) {
    throw new Error("Staging migration requires numeric exact-head CI run and attempt IDs.");
  }

  const authorizationRef = requiredEnvironmentValue(environment, "KARTURT_R2_MIGRATION_AUTHORIZATION_REF");
  if (!authorizationReference.test(authorizationRef)) {
    throw new Error("Staging migration authorization reference must be a short, non-secret reference.");
  }

  return {
    releaseSha,
    ciRunId,
    ciAttempt,
    authorizationRef,
    authorizedTarget: stagingDatabaseTargetReference,
    authorizedOperation: "official-migrations-0000-0013",
  };
}

export function hasRequiredMigrationPublicSchemaPrivileges(privileges: {
  usage: boolean;
  create: boolean;
}) {
  return privileges.usage && privileges.create;
}

export function hasNoStagingMigrationGrantOptions(grantablePrivilegeCount: number) {
  return Number.isSafeInteger(grantablePrivilegeCount) && grantablePrivilegeCount === 0;
}
