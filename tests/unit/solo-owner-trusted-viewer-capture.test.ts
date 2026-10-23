import { describe, expect, it, vi } from "vitest";
import { prepareSoloViewerCapture } from "../../scripts/lib/solo-owner-trusted-viewer-capture";
import { type SoloOwnerReservationEnvironment } from "../../scripts/lib/solo-owner-approval-reservation";
import { type CreateOnlyGitHubRequest } from "../../scripts/lib/solo-owner-approval-ledger";
import { type NeonViewerReadOnlyTransport } from "../../scripts/lib/solo-owner-neon-viewer-get";

const sourceSha = "a".repeat(40);
const launcherSha = "b".repeat(40);
const ticket = "c".repeat(32);
const viewerKey = "SYNTHETIC_VIEWER_TOKEN_NEVER_USE_ANYWHERE";
const now = Date.parse("2026-10-22T07:00:00Z");
const context = (): SoloOwnerReservationEnvironment => ({
  repository: "Satsetx4/karturt",
  repositoryId: "1386907262",
  ownerId: "304263836",
  actorId: "304263836",
  refProtected: "true",
  eventSha: sourceSha,
  workflowSha: launcherSha,
  eventName: "workflow_dispatch",
  ref: "refs/heads/main",
  workflowRef: "Satsetx4/karturt/.github/workflows/staging-readiness-capture.yml@refs/heads/main",
  actor: "Satsetx4",
  triggeringActor: "Satsetx4",
  runAttempt: "1",
  runId: "39736898394",
  launcherSha,
  candidateSha: sourceSha,
  approvedLauncherSha: launcherSha,
  approvedCandidateSha: sourceSha,
  dispatchTicket: ticket,
  approvedTicket: ticket,
  approvedAtUtc: "2026-10-22T06:55:00Z",
  expiresAtUtc: "2026-10-22T07:05:00Z",
});

const validProject = () => ({
  project: {
    id: "super-band-12770762",
    org_id: "org-ancient-boat-57106549",
    name: "karturt-v1-solo-provenance-20261022",
    region_id: "aws-ap-southeast-1",
    pg_version: 18,
    owner: { subscription_type: "free_v3" },
    effective_project_permission: "VIEWER",
  },
});

function makeDependencies() {
  const order: string[] = [];
  const reserved = new Set<string>();
  const createOnlyLedgerRecord = vi.fn<CreateOnlyGitHubRequest>(async (url, init) => {
    order.push("ledger");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).not.toHaveProperty("sha");
    if (reserved.has(url)) return { status: 422 };
    reserved.add(url);
    return { status: 201 };
  });
  const loadViewerTokenAfterReservation = vi.fn(async () => {
    order.push("secret");
    return viewerKey;
  });
  const readExactNeonProject = vi.fn<NeonViewerReadOnlyTransport>(async req => {
    order.push("neon-get");
    expect(req.method).toBe("GET");
    expect(req.redirect).toBe("error");
    expect(req.url).toBe("https://console.neon.tech/api/v2/projects/super-band-12770762");
    expect(req.headers.Authorization).toBe("Bearer " + viewerKey);
    return { status: 200, body: validProject() };
  });
  return { order, reserved, createOnlyLedgerRecord, loadViewerTokenAfterReservation, readExactNeonProject };
}
describe("trusted Viewer capture composition — offline only", () => {
  it("reserves first, accesses token second, performs GET third; remains UNATTESTED", async () => {
    const dep = makeDependencies();
    const out = await prepareSoloViewerCapture(context(), now, dep);
    expect(dep.order).toEqual(["ledger", "secret", "neon-get"]);
    expect(out).toMatchObject({
      status: "OFFLINE_CONTRACT_UNATTESTED",
      ownerApprovalConsumed: true,
      viewerMetadataMatch: true,
      providerAuthenticated: false,
      readyForStagingReadiness: false,
      allowedToConnectDatabase: false,
      allowedToMigrate: false,
      allowedToDeploy: false,
    });
    expect(JSON.stringify(out)).not.toContain(viewerKey);
    expect(JSON.stringify(out)).not.toContain(ticket);
    expect(dep.reserved.size).toBe(1);
  });
  it("never asks for token/provider when approval is expired", async () => {
    const dep = makeDependencies();
    await expect(prepareSoloViewerCapture(context(), now + 6 * 60_000, dep))
      .rejects.toMatchObject({ code: "SOLO_RESERVATION_WINDOW_INVALID" });
    expect(dep.order).toEqual([]);
  });
  it("never asks for token/provider when ledger is unavailable", async () => {
    const dep = makeDependencies();
    dep.createOnlyLedgerRecord.mockImplementation(async () => { dep.order.push("ledger"); throw new Error(viewerKey); });
    await expect(prepareSoloViewerCapture(context(), now, dep))
      .rejects.toMatchObject({ code: "SOLO_APPROVAL_LEDGER_UNAVAILABLE" });
    expect(dep.order).toEqual(["ledger"]);
  });
  it("never accesses token/provider on an already spent ticket", async () => {
    const dep = makeDependencies();
    await prepareSoloViewerCapture(context(), now, dep);
    dep.order.length = 0;
    await expect(prepareSoloViewerCapture(context(), now, dep))
      .rejects.toMatchObject({ code: "SOLO_APPROVAL_LEDGER_NOT_RESERVED" });
    expect(dep.order).toEqual(["ledger"]);
    expect(dep.reserved.size).toBe(1);
  });
  it("stops after consuming ticket when token cannot be loaded; cannot retry", async () => {
    const dep = makeDependencies();
    dep.loadViewerTokenAfterReservation.mockImplementationOnce(async () => {
      dep.order.push("secret"); throw new Error(viewerKey);
    });
    await expect(prepareSoloViewerCapture(context(), now, dep))
      .rejects.toMatchObject({ code: "VIEWER_SECRET_UNAVAILABLE_AFTER_RESERVATION" });
    expect(dep.order).toEqual(["ledger", "secret"]);
    dep.order.length = 0;
    await expect(prepareSoloViewerCapture(context(), now, dep))
      .rejects.toMatchObject({ code: "SOLO_APPROVAL_LEDGER_NOT_RESERVED" });
    expect(dep.order).toEqual(["ledger"]);
  });
  it("stops after consuming ticket if response has ADMIN permission", async () => {
    const dep = makeDependencies();
    dep.readExactNeonProject.mockImplementationOnce(async () => {
      dep.order.push("neon-get");
      return { status: 200, body: { project: { ...validProject().project, effective_project_permission: "ADMIN" } } };
    });
    await expect(prepareSoloViewerCapture(context(), now, dep))
      .rejects.toMatchObject({ code: "VIEWER_API_EFFECTIVE_PERMISSION_DENIED" });
    expect(dep.order).toEqual(["ledger", "secret", "neon-get"]);
    dep.order.length = 0;
    await expect(prepareSoloViewerCapture(context(), now, dep))
      .rejects.toMatchObject({ code: "SOLO_APPROVAL_LEDGER_NOT_RESERVED" });
    expect(dep.order).toEqual(["ledger"]);
  });
});
