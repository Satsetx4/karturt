import { describe, expect, it, vi } from "vitest";
import {
  checkViewerOnlyNeonProjectGet,
  NeonViewerProbeRejected,
  type NeonViewerReadOnlyTransport,
} from "../../scripts/lib/solo-owner-neon-viewer-get";

const sourceSha = "a".repeat(40);
const token = "viewer-only-offline-test-token-do-not-use";
const project = () => ({
  id: "super-band-12770762",
  org_id: "org-ancient-boat-57106549",
  name: "karturt-v1-solo-provenance-20261022",
  region_id: "aws-ap-southeast-1",
  pg_version: 18,
  effective_project_permission: "VIEWER",
});
function makeTransport(overrides: Record<string, unknown> = {}, status = 200) {
  const call = vi.fn<NeonViewerReadOnlyTransport>(async (request) => {
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://console.neon.tech/api/v2/projects/super-band-12770762");
    expect(request.redirect).toBe("error");
    expect(request.headers.Accept).toBe("application/json");
    expect(request.headers.Authorization).toBe("Bearer " + token);
    return { status, body: { project: { ...project(), ...overrides } } };
  });
  return call;
}
describe("Neon Viewer GET metadata preflight — offline only", () => {
  it("restricts request to exact project GET and never grants access from a fake response", async () => {
    const transport = makeTransport();
    const result = await checkViewerOnlyNeonProjectGet(token, sourceSha, transport);
    expect(result).toEqual({
      targetProjectId: "super-band-12770762",
      sourceSha,
      observedPermission: "VIEWER",
      check: "METADATA_MATCHES_BUT_UNATTESTED",
      principalTokenPersisted: false,
      providerAttested: false,
      rootLineageProven: false,
      syntheticOnlyProven: false,
      databaseCatalogChecked: false,
      canConnectDatabase: false,
      canMigrate: false,
      canDeploy: false,
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["ADMIN", "EDITOR", "OWNER", "member", "viewer", "", null])(
    "denies elevated or unknown effective permission %s", async (permission) => {
      const transport = makeTransport({ effective_project_permission: permission });
      await expect(checkViewerOnlyNeonProjectGet(token, sourceSha, transport))
        .rejects.toMatchObject({ code: "VIEWER_API_EFFECTIVE_PERMISSION_DENIED" });
    },
  );
  it.each([
    ["old project", { id: "wild-darkness-00489132" }],
    ["wrong organization", { org_id: "org-other" }],
    ["wrong name", { name: "unrelated" }],
    ["wrong region", { region_id: "aws-us-east-2" }],
    ["wrong PostgreSQL major", { pg_version: 17 }],
  ] as Array<[string, Record<string, unknown>]>)(
    "rejects %s despite VIEWER claim", async (_name, overrides) => {
      await expect(checkViewerOnlyNeonProjectGet(token, sourceSha, makeTransport(overrides)))
        .rejects.toMatchObject({ code: "VIEWER_API_TARGET_MISMATCH" });
    },
  );
  it.each([401, 403, 404, 429, 500])("fails closed on HTTP status %d", async status => {
    await expect(checkViewerOnlyNeonProjectGet(token, sourceSha, makeTransport({}, status)))
      .rejects.toMatchObject({ code: "VIEWER_API_PROJECT_RESPONSE_INVALID" });
  });
  it("fails closed on network error without leaking the exception or token", async () => {
    const transport = vi.fn<NeonViewerReadOnlyTransport>(async () => { throw new Error(token); });
    await expect(checkViewerOnlyNeonProjectGet(token, sourceSha, transport))
      .rejects.toMatchObject({ code: "VIEWER_API_GET_UNAVAILABLE" });
    try { await checkViewerOnlyNeonProjectGet(token, sourceSha, transport); }
    catch (err) { expect(String(err)).not.toContain(token); }
  });
  it("does not make any GET for malformed source SHA or absent API key", async () => {
    const transport = makeTransport();
    await expect(checkViewerOnlyNeonProjectGet("", sourceSha, transport))
      .rejects.toBeInstanceOf(NeonViewerProbeRejected);
    await expect(checkViewerOnlyNeonProjectGet(token, "b".repeat(39), transport))
      .rejects.toMatchObject({ code: "VIEWER_SOURCE_SHA_INVALID" });
    expect(transport).not.toHaveBeenCalled();
  });
});
