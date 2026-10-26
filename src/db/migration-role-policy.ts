import { stagingDatabaseTargetReference } from "@/db/staging-target";

export type StagingMigrationAuthorization = {
  releaseSha: string;
  ciRunId: string;
  ciAttempt: string;
  preflightEvidenceRef: string;
  isolationEvidenceRef: string;
  authorizationRef: string;
  authorizedTarget: string;
  authorizedOperation: "official-migrations-0000-0014";
};

export type StagingPreflightAuthorization = {
  releaseSha: string;
  ciRunId: string;
  ciAttempt: string;
  authorizationRef: string;
  isolationEvidenceRef: string;
  authorizedTarget: string;
  authorizedOperation: "authenticated-tls-role-preflight";
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
  if (requiredEnvironmentValue(environment, "KARTURT_R2_MIGRATION_AUTHORIZED_OPERATION") !== "official-migrations-0000-0014") {
    throw new Error("Staging migration authorization must explicitly allow official-migrations-0000-0014.");
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
  const preflightEvidenceRef = requiredEnvironmentValue(environment, "KARTURT_R2_MIGRATION_PREFLIGHT_EVIDENCE_REF");
  if (!/^#98\/\d+$/.test(preflightEvidenceRef)) {
    throw new Error("Staging migration requires a non-secret issue #98 preflight evidence reference.");
  }
  const isolationEvidenceRef = requiredEnvironmentValue(environment, "KARTURT_R2_MIGRATION_ISOLATION_EVIDENCE_REF");
  if (!/^#98\/\d+$/.test(isolationEvidenceRef)) {
    throw new Error("Staging migration requires a non-secret issue #98 isolation evidence reference.");
  }

  return {
    releaseSha,
    ciRunId,
    ciAttempt,
    preflightEvidenceRef,
    isolationEvidenceRef,
    authorizationRef,
    authorizedTarget: stagingDatabaseTargetReference,
    authorizedOperation: "official-migrations-0000-0014",
  };
}

export function parseStagingPreflightAuthorization(
  environment: NodeJS.ProcessEnv,
  actualHeadSha: string,
): StagingPreflightAuthorization {
  const releaseSha = actualHeadSha.toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(releaseSha) ||
      requiredEnvironmentValue(environment, "KARTURT_R2_PREFLIGHT_AUTHORIZED_SHA") !== releaseSha) {
    throw new Error("Staging preflight authorization must match the full checked-out release SHA.");
  }
  if (requiredEnvironmentValue(environment, "KARTURT_R2_PREFLIGHT_AUTHORIZED_TARGET") !== stagingDatabaseTargetReference) {
    throw new Error("Staging preflight authorization must name the canonical staging target.");
  }
  if (requiredEnvironmentValue(environment, "KARTURT_R2_PREFLIGHT_AUTHORIZED_OPERATION") !== "authenticated-tls-role-preflight") {
    throw new Error("Staging preflight authorization must explicitly allow authenticated-tls-role-preflight.");
  }
  if (requiredEnvironmentValue(environment, "KARTURT_R2_CI_HEAD_SHA").toLowerCase() !== releaseSha) {
    throw new Error("Staging preflight requires exact-head CI evidence for the checked-out release SHA.");
  }
  const ciRunId = requiredEnvironmentValue(environment, "KARTURT_R2_CI_RUN_ID");
  const ciAttempt = requiredEnvironmentValue(environment, "KARTURT_R2_CI_ATTEMPT");
  if (!/^\d+$/.test(ciRunId) || !/^\d+$/.test(ciAttempt)) {
    throw new Error("Staging preflight requires numeric exact-head CI run and attempt IDs.");
  }
  const authorizationRef = requiredEnvironmentValue(environment, "KARTURT_R2_PREFLIGHT_AUTHORIZATION_REF");
  const isolationEvidenceRef = requiredEnvironmentValue(environment, "KARTURT_R2_ISOLATION_EVIDENCE_REF");
  if (!/^#98\/\d+$/.test(authorizationRef) || !/^#98\/\d+$/.test(isolationEvidenceRef)) {
    throw new Error("Staging preflight requires non-secret issue #98 authorization and isolation evidence references.");
  }

  return {
    releaseSha,
    ciRunId,
    ciAttempt,
    authorizationRef,
    isolationEvidenceRef,
    authorizedTarget: stagingDatabaseTargetReference,
    authorizedOperation: "authenticated-tls-role-preflight",
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
