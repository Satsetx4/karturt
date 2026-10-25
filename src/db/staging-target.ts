import { officialMigrationCount, officialMigrationHeadTag, officialMigrationTags } from "@/db/migration-chain";

export const stagingDatabaseTarget = {
  projectId: "flat-cloud-57657711",
  branchId: "br-sparkling-flower-azordm9k",
  endpointId: "ep-red-boat-azzqyf45",
  database: "karturt_staging",
  directHost: "ep-red-boat-azzqyf45.c-3.ap-southeast-1.aws.neon.tech",
  runtimeRole: "karturt_stg_runtime_v2",
  migrationRole: "karturt_stg_migrator_v2",
  migrationTags: officialMigrationTags,
  migrationCount: officialMigrationCount,
  migrationHeadTag: officialMigrationHeadTag,
} as const;

export const stagingDatabaseTargetReference = `${stagingDatabaseTarget.projectId}/${stagingDatabaseTarget.branchId}/${stagingDatabaseTarget.endpointId}/${stagingDatabaseTarget.database}`;
