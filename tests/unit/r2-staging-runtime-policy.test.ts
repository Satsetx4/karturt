import { describe, expect, it } from "vitest";
import { assertR2StagingRuntimeEvidence, type R2StagingRuntimeEvidence } from "@/db/r2-staging-runtime-policy";
import { stagingDatabaseTarget } from "@/db/staging-target";

function safeRuntimeEvidence(overrides: Partial<R2StagingRuntimeEvidence> = {}): R2StagingRuntimeEvidence {
  return {
    databaseName: stagingDatabaseTarget.database,
    effectiveRole: stagingDatabaseTarget.runtimeRole,
    sessionRole: stagingDatabaseTarget.runtimeRole,
    serverVersionNum: 180000,
    tlsActive: true,
    roleCanLogin: true,
    roleIsSuperuser: false,
    roleCanCreateDb: false,
    roleCanCreateRole: false,
    roleCanReplicate: false,
    roleBypassesRls: false,
    roleInherits: false,
    roleMembershipCount: 0,
    databaseOwnedByRuntime: false,
    databaseCreateEffective: false,
    databaseTempEffective: false,
    publicUsageEffective: true,
    publicCreateEffective: false,
    customSchemasOwnedByRuntime: 0,
    customSchemasWithCreate: 0,
    publicObjectsOwnedByRuntime: 0,
    publicRoutinesOwnedByRuntime: 0,
    customRoutinesWithExecute: 0,
    drizzleSchemaExists: true,
    migrationRoleExists: true,
    migrationRoleCanLogin: false,
    migrationRoleIsSuperuser: false,
    migrationRoleCanCreateDb: false,
    migrationRoleCanCreateRole: false,
    migrationRoleCanReplicate: false,
    migrationRoleBypassesRls: false,
    migrationRoleInherits: false,
    migrationRoleMembershipCount: 0,
    migrationDatabaseCreateEffective: false,
    migrationDatabaseTempEffective: false,
    migrationPublicCreateEffective: false,
    migrationCustomSchemasWithCreate: 0,
    migrationDrizzleUsageEffective: false,
    migrationDrizzleCreateEffective: false,
    drizzleUsageEffective: false,
    drizzleCreateEffective: false,
    drizzleJournalSelectEffective: false,
    ...overrides,
  };
}

describe("R2 staging runtime connection policy", () => {
  it("accepts only the canonical PostgreSQL 18 runtime identity with verified TLS and DML-only privileges", () => {
    expect(assertR2StagingRuntimeEvidence(safeRuntimeEvidence())).toEqual({
      database: stagingDatabaseTarget.database,
      effectiveRole: stagingDatabaseTarget.runtimeRole,
      postgresMajorVersion: 18,
      tlsActive: true,
      tlsCertificateAndHostnameVerified: true,
      runtimePrivilegesSafe: true,
    });
  });

  it.each([
    ["databaseName", "wrong_database", "database"],
    ["effectiveRole", "postgres", "effective role"],
    ["sessionRole", "postgres", "session role"],
    ["serverVersionNum", 170000, "PostgreSQL 18"],
    ["tlsActive", false, "TLS"],
    ["roleCanCreateRole", true, "role flags or memberships"],
    ["roleMembershipCount", 1, "role flags or memberships"],
    ["databaseTempEffective", true, "database privileges"],
    ["publicCreateEffective", true, "DDL privileges or ownership"],
    ["publicObjectsOwnedByRuntime", 1, "DDL privileges or ownership"],
    ["customRoutinesWithExecute", 1, "migration schema or routine access"],
    ["drizzleJournalSelectEffective", true, "migration schema or routine access"],
    ["migrationRoleCanLogin", true, "migrator must exist"],
    ["migrationRoleCanCreateRole", true, "migrator must exist"],
    ["migrationPublicCreateEffective", true, "migrator residual DDL privileges"],
    ["migrationDatabaseTempEffective", true, "migrator residual DDL privileges"],
    ["migrationCustomSchemasWithCreate", 1, "migrator residual DDL privileges"],
  ] as const)("fails closed when %s is unsafe", (key, value, failure) => {
    const evidence = { ...safeRuntimeEvidence(), [key]: value } as R2StagingRuntimeEvidence;
    expect(() => assertR2StagingRuntimeEvidence(evidence)).toThrow(failure);
  });
});
