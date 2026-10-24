export function hasRequiredMigrationPublicSchemaPrivileges(privileges: {
  usage: boolean;
  create: boolean;
}) {
  return privileges.usage && privileges.create;
}

export function hasNoStagingMigrationGrantOptions(grantablePrivilegeCount: number) {
  return Number.isSafeInteger(grantablePrivilegeCount) && grantablePrivilegeCount === 0;
}
