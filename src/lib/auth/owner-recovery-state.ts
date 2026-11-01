export function ownerRecoveryPendingIdentifier(authUserId: string) {
  return `system-admin-owner-recovery:${authUserId}`;
}

export const OWNER_RECOVERY_PENDING_EXPIRY = new Date("9999-12-31T23:59:59.999Z");
