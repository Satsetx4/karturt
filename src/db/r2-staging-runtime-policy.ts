import { stagingDatabaseTarget } from "@/db/staging-target";

export type R2StagingRuntimeEvidence = {
  databaseName: string;
  effectiveRole: string;
  sessionRole: string;
  serverVersionNum: number;
  tlsActive: boolean;
  roleCanLogin: boolean;
  roleIsSuperuser: boolean;
  roleCanCreateDb: boolean;
  roleCanCreateRole: boolean;
  roleCanReplicate: boolean;
  roleBypassesRls: boolean;
  roleInherits: boolean;
  roleMembershipCount: number;
  databaseOwnedByRuntime: boolean;
  databaseCreateEffective: boolean;
  databaseTempEffective: boolean;
  publicUsageEffective: boolean;
  publicCreateEffective: boolean;
  customSchemasOwnedByRuntime: number;
  customSchemasWithCreate: number;
  publicObjectsOwnedByRuntime: number;
  publicRoutinesOwnedByRuntime: number;
  customRoutinesWithExecute: number;
  drizzleSchemaExists: boolean;
  migrationRoleExists: boolean;
  migrationRoleCanLogin: boolean;
  migrationRoleIsSuperuser: boolean;
  migrationRoleCanCreateDb: boolean;
  migrationRoleCanCreateRole: boolean;
  migrationRoleCanReplicate: boolean;
  migrationRoleBypassesRls: boolean;
  migrationRoleInherits: boolean;
  migrationRoleMembershipCount: number;
  migrationDatabaseCreateEffective: boolean;
  migrationDatabaseTempEffective: boolean;
  migrationPublicCreateEffective: boolean;
  migrationCustomSchemasWithCreate: number;
  migrationDrizzleUsageEffective: boolean;
  migrationDrizzleCreateEffective: boolean;
  drizzleUsageEffective: boolean;
  drizzleCreateEffective: boolean;
  drizzleJournalSelectEffective: boolean;
};

export function assertR2StagingRuntimeEvidence(evidence: R2StagingRuntimeEvidence) {
  const failures: string[] = [];
  if (evidence.databaseName !== stagingDatabaseTarget.database) failures.push("database");
  if (evidence.effectiveRole !== stagingDatabaseTarget.runtimeRole) failures.push("effective role");
  if (evidence.sessionRole !== stagingDatabaseTarget.runtimeRole) failures.push("session role");
  if (Math.floor(evidence.serverVersionNum / 10_000) !== 18) failures.push("PostgreSQL 18");
  if (!evidence.tlsActive) failures.push("TLS");
  if (!evidence.roleCanLogin || evidence.roleIsSuperuser || evidence.roleCanCreateDb ||
      evidence.roleCanCreateRole || evidence.roleCanReplicate || evidence.roleBypassesRls ||
      evidence.roleInherits || evidence.roleMembershipCount !== 0) failures.push("role flags or memberships");
  if (!evidence.migrationRoleExists || evidence.migrationRoleCanLogin || evidence.migrationRoleIsSuperuser ||
      evidence.migrationRoleCanCreateDb || evidence.migrationRoleCanCreateRole || evidence.migrationRoleCanReplicate ||
      evidence.migrationRoleBypassesRls || evidence.migrationRoleInherits || evidence.migrationRoleMembershipCount !== 0) {
    failures.push("migrator must exist, remain unprivileged, and be NOLOGIN after migration");
  }
  if (evidence.migrationDatabaseCreateEffective || evidence.migrationDatabaseTempEffective ||
      evidence.migrationPublicCreateEffective || evidence.migrationCustomSchemasWithCreate !== 0 ||
      evidence.migrationDrizzleUsageEffective || evidence.migrationDrizzleCreateEffective) {
    failures.push("migrator residual DDL privileges");
  }
  if (evidence.databaseOwnedByRuntime || evidence.databaseCreateEffective || evidence.databaseTempEffective) {
    failures.push("database privileges");
  }
  if (!evidence.publicUsageEffective || evidence.publicCreateEffective ||
      evidence.customSchemasOwnedByRuntime !== 0 || evidence.customSchemasWithCreate !== 0 ||
      evidence.publicObjectsOwnedByRuntime !== 0 || evidence.publicRoutinesOwnedByRuntime !== 0) {
    failures.push("DDL privileges or ownership");
  }
  if (!evidence.drizzleSchemaExists || evidence.customRoutinesWithExecute !== 0 || evidence.drizzleUsageEffective ||
      evidence.drizzleCreateEffective || evidence.drizzleJournalSelectEffective) {
    failures.push("migration schema or routine access");
  }
  if (failures.length > 0) {
    throw new Error(`R2 staging runtime preflight failed: ${failures.join(", ")}.`);
  }

  return {
    database: evidence.databaseName,
    effectiveRole: evidence.effectiveRole,
    postgresMajorVersion: 18,
    tlsActive: true,
    tlsCertificateAndHostnameVerified: true as const,
    runtimePrivilegesSafe: true as const,
  };
}
