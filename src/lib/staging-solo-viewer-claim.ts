import { SOLO_STAGING_CANDIDATE as target } from "./staging-solo-candidate";

/**
 * A pure, no-network preview of whether an external *claim* about project
 * permissions even matches the intended staging target. It never authenticates
 * a Neon principal, grants credentials, permits SQL or marks Gate V1 PASS.
 *
 * The connected operator account was observed as ADMIN, not Viewer. A string
 * in JSON cannot prove that an API token actually has read-only rights.
 */
type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: JsonObject, expected: string[]): boolean {
  const a = Object.keys(value).sort();
  const b = expected.slice().sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
function utcSeconds(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return null;
  }
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === value.replace(/Z$/, ".000Z")
    ? stamp : null;
}

export type ViewerClaimPreflight = {
  status: "DENY" | "METADATA_CONSISTENT_UNAUTHENTICATED";
  errors: string[];
  providerAuthenticated: false;
  viewerCredentialVerified: false;
  lineage: "UNKNOWN";
  syntheticOnly: "UNKNOWN";
  databaseCatalog: "UNKNOWN";
  canAccessProvider: false;
  canConnectDatabase: false;
  canCutOver: false;
  migrationAllowed: false;
};

export function checkSoloStagingViewerClaimOffline(value: unknown, nowMs: number): ViewerClaimPreflight {
  const errors: string[] = [];
  const fail = (code: string) => { if (!errors.includes(code)) errors.push(code); };
  if (!Number.isFinite(nowMs) || !isObject(value) ||
      !exactKeys(value, ["schemaVersion", "sourceSha", "observedAtUtc", "principal", "target"])) {
    fail("VIEWER_SNAPSHOT_SHAPE_INVALID");
  } else {
    if (value.schemaVersion !== "karturt/solo-viewer-claim/v1") fail("VIEWER_SNAPSHOT_VERSION_INVALID");
    if (typeof value.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceSha)) {
      fail("VIEWER_SOURCE_SHA_INVALID");
    }
    const observedAt = utcSeconds(value.observedAtUtc);
    if (observedAt === null || nowMs - observedAt < 0 || nowMs - observedAt > 120_000) {
      fail("VIEWER_SNAPSHOT_STALE_OR_INVALID");
    }
    if (!isObject(value.target) || !exactKeys(value.target, [
      "organizationId", "projectId", "branchId", "endpointId", "databaseId", "directHostname",
    ])) fail("VIEWER_TARGET_SHAPE_INVALID");
    else if (
      value.target.organizationId !== target.organizationId ||
      value.target.projectId !== target.projectId ||
      value.target.branchId !== target.branchId ||
      value.target.endpointId !== target.endpointId ||
      value.target.databaseId !== target.databaseId ||
      value.target.directHostname !== target.directHostname
    ) fail("VIEWER_TARGET_MISMATCH");

    if (!isObject(value.principal) || !exactKeys(value.principal, [
      "effectiveProjectPermission", "projectId", "identityScope",
    ])) fail("VIEWER_PRINCIPAL_SHAPE_INVALID");
    else {
      if (value.principal.projectId !== target.projectId ||
          value.principal.identityScope !== "neon-effective-project-permission") {
        fail("VIEWER_PRINCIPAL_SCOPE_INVALID");
      }
      // Requiring the literal VIEWER rejects ADMIN/EDITOR and unknown. Even a
      // string VIEWER can be forged: it is NOT independent permission proof.
      if (value.principal.effectiveProjectPermission !== "VIEWER") {
        fail("VIEWER_LEAST_PRIVILEGE_NOT_SHOWN");
      }
    }
  }
  return {
    status: errors.length ? "DENY" : "METADATA_CONSISTENT_UNAUTHENTICATED",
    errors,
    providerAuthenticated: false,
    viewerCredentialVerified: false,
    lineage: "UNKNOWN",
    syntheticOnly: "UNKNOWN",
    databaseCatalog: "UNKNOWN",
    canAccessProvider: false,
    canConnectDatabase: false,
    canCutOver: false,
    migrationAllowed: false,
  };
}
