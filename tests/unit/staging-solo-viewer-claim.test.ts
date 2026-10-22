import { describe, expect, it } from "vitest";
import { SOLO_STAGING_CANDIDATE as c } from "../../src/lib/staging-solo-candidate";
import { checkSoloStagingViewerClaimOffline } from "../../src/lib/staging-solo-viewer-claim";

const now = Date.parse("2026-10-22T05:30:00Z");
const sourceSha = "a".repeat(40);
function input() {
  return {
    schemaVersion: "karturt/solo-viewer-claim/v1",
    sourceSha,
    observedAtUtc: "2026-10-22T05:29:30Z",
    target: {
      organizationId: c.organizationId,
      projectId: c.projectId,
      branchId: c.branchId,
      endpointId: c.endpointId,
      databaseId: c.databaseId,
      directHostname: c.directHostname,
    },
    principal: {
      identityScope: "neon-effective-project-permission",
      projectId: c.projectId,
      effectiveProjectPermission: "VIEWER",
    },
  };
}
describe("solo staging Viewer-only claim, offline; never grants capture", () => {
  it("never authenticates a forged-looking VIEWER even when metadata matches", () => {
    expect(checkSoloStagingViewerClaimOffline(input(), now)).toEqual({
      status: "METADATA_CONSISTENT_UNAUTHENTICATED",
      errors: [],
      providerAuthenticated: false,
      viewerCredentialVerified: false,
      lineage: "UNKNOWN",
      syntheticOnly: "UNKNOWN",
      databaseCatalog: "UNKNOWN",
      canAccessProvider: false,
      canConnectDatabase: false,
      canCutOver: false,
      migrationAllowed: false,
    });
  });
  it.each(["ADMIN", "EDITOR", "OWNER", "member", "viewer", "", "UNKNOWN"])(
    "rejects elevated or unknown permission %s", (permission) => {
      const x = input();
      x.principal.effectiveProjectPermission = permission;
      expect(checkSoloStagingViewerClaimOffline(x, now)).toMatchObject({
        status: "DENY", errors: ["VIEWER_LEAST_PRIVILEGE_NOT_SHOWN"],
        viewerCredentialVerified: false, canAccessProvider: false,
      });
    },
  );
  it.each([
    ["old project", x => { Object.assign(x.target, { projectId: "wild-darkness-00489132" }); }, "VIEWER_TARGET_MISMATCH"],
    ["wrong branch", x => { Object.assign(x.target, { branchId: "br-spring-shadow-b37rykzl" }); }, "VIEWER_TARGET_MISMATCH"],
    ["old endpoint", x => { Object.assign(x.target, { endpointId: "ep-silent-haze-b3pcaa3t" }); }, "VIEWER_TARGET_MISMATCH"],
    ["changed host", x => { Object.assign(x.target, { directHostname: "fake.invalid" }); }, "VIEWER_TARGET_MISMATCH"],
    ["wrong database", x => { Object.assign(x.target, { databaseId: 669644 }); }, "VIEWER_TARGET_MISMATCH"],
    ["scope unrelated", x => { Object.assign(x.principal, { projectId: "wild-darkness-00489132" }); }, "VIEWER_PRINCIPAL_SCOPE_INVALID"],
    ["fabricated scope", x => { Object.assign(x.principal, { identityScope: "github-owner" }); }, "VIEWER_PRINCIPAL_SCOPE_INVALID"],
    ["extra trusted boolean", x => { Object.assign(x, { trusted: true }); }, "VIEWER_SNAPSHOT_SHAPE_INVALID"],
    ["extra admin grant", x => { Object.assign(x.principal, { organizationAdmin: true }); }, "VIEWER_PRINCIPAL_SHAPE_INVALID"],
    ["old timestamp", x => { x.observedAtUtc = "2026-10-22T05:25:00Z"; }, "VIEWER_SNAPSHOT_STALE_OR_INVALID"],
    ["future timestamp", x => { x.observedAtUtc = "2026-10-22T05:31:00Z"; }, "VIEWER_SNAPSHOT_STALE_OR_INVALID"],
    ["bad timestamp", x => { x.observedAtUtc = "2026-02-30T05:29:30Z"; }, "VIEWER_SNAPSHOT_STALE_OR_INVALID"],
    ["short SHA", x => { x.sourceSha = "a".repeat(39); }, "VIEWER_SOURCE_SHA_INVALID"],
    ["upper SHA", x => { x.sourceSha = "A".repeat(40); }, "VIEWER_SOURCE_SHA_INVALID"],
  ] as Array<[string, (p: ReturnType<typeof input>) => void, string]>)(
    "denies %s while leaving all execution gates closed", (_name, mutate, error) => {
      const packet = input(); mutate(packet);
      const result = checkSoloStagingViewerClaimOffline(packet, now);
      expect(result.status).toBe("DENY");
      expect(result.errors).toContain(error);
      expect(result.providerAuthenticated).toBe(false);
      expect(result.canAccessProvider).toBe(false);
      expect(result.canConnectDatabase).toBe(false);
      expect(result.canCutOver).toBe(false);
      expect(result.migrationAllowed).toBe(false);
    },
  );
  it("fails closed on absent evidence or invalid clock", () => {
    expect(checkSoloStagingViewerClaimOffline(null, now).status).toBe("DENY");
    expect(checkSoloStagingViewerClaimOffline(input(), NaN).status).toBe("DENY");
  });
});
