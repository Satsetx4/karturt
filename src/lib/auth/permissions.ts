import type { OfficialRole } from "@/db/schema";

export type AppRole = "resident" | OfficialRole | "system_admin";
export type Permission =
  | "billing:read:self"
  | "payment:request:self"
  | "payment:history:self"
  | "payment:cancel:self"
  | "billing:read:rt"
  | "billing:generate"
  | "fee_rate:manage"
  | "resident:read:rt"
  | "resident:manage"
  | "resident:reset_credential"
  | "official:manage"
  | "payment:verify"
  | "payment:reject"
  | "payment:record_cash"
  | "waiver:manage"
  | "audit:read"
  | "system:recover"
  | "system:manage";

export interface Principal {
  authUserId: string;
  appAccountId: string;
  role: AppRole;
  rtUnitId: string | null;
  householdId: string | null;
  personId: string | null;
}

const permissions: Record<AppRole, ReadonlySet<Permission>> = {
  resident: new Set(["billing:read:self", "payment:request:self", "payment:history:self", "payment:cancel:self"]),
  treasurer: new Set(["billing:read:rt", "resident:read:rt", "payment:verify", "payment:reject", "payment:record_cash"]),
  rt_chairman: new Set([
    "billing:read:rt",
    "billing:generate",
    "fee_rate:manage",
    "resident:read:rt",
    "resident:manage",
    "resident:reset_credential",
    "official:manage",
    "waiver:manage",
    "audit:read",
  ]),
  system_admin: new Set(["system:recover", "system:manage", "audit:read"]),
};

const rtScopedPermissions = new Set<Permission>([
  "billing:read:rt",
  "billing:generate",
  "fee_rate:manage",
  "resident:read:rt",
  "resident:manage",
  "resident:reset_credential",
  "official:manage",
  "payment:verify",
  "payment:reject",
  "payment:record_cash",
  "waiver:manage",
]);

export function canPerform(
  principal: Principal,
  permission: Permission,
  scope?: { rtUnitId?: string; householdId?: string },
) {
  if (!permissions[principal.role].has(permission)) return false;
  if (principal.role === "resident") {
    if (
      permission !== "billing:read:self" &&
      permission !== "payment:request:self" &&
      permission !== "payment:history:self" &&
      permission !== "payment:cancel:self"
    ) return false;
    if (!principal.rtUnitId || !principal.householdId) return false;
    if (!scope?.householdId || !scope.rtUnitId) return false;
    if (scope.householdId !== principal.householdId || scope.rtUnitId !== principal.rtUnitId) return false;
  }
  if (rtScopedPermissions.has(permission)) {
    if (principal.role === "system_admin" || !principal.rtUnitId) return false;
    if (!scope?.rtUnitId || scope.rtUnitId !== principal.rtUnitId) return false;
  }
  if (permission === "audit:read" && principal.role === "rt_chairman") {
    if (!principal.rtUnitId || !scope?.rtUnitId || scope.rtUnitId !== principal.rtUnitId) return false;
  }
  return true;
}

export function assertCanPerform(
  principal: Principal,
  permission: Permission,
  scope?: { rtUnitId?: string; householdId?: string },
) {
  if (!canPerform(principal, permission, scope)) {
    throw new Error("Forbidden: the active account does not have permission for this action.");
  }
}
