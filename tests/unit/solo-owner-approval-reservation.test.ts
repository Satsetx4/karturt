import { describe, expect, it, vi } from "vitest";
import {
  reserveApprovedSoloOwnerTicket,
  type SoloOwnerReservationEnvironment,
} from "../../scripts/lib/solo-owner-approval-reservation";
import { SoloOwnerClaimDenied, type CreateOnlyGitHubRequest } from "../../scripts/lib/solo-owner-approval-ledger";

const now = Date.parse("2026-10-22T05:50:00Z");
const a = "a".repeat(40), b = "b".repeat(40), ticket = "c".repeat(32);
function valid(): SoloOwnerReservationEnvironment {
  return {
    repository: "Satsetx4/karturt",
    repositoryId: "1386907262",
    ownerId: "304263836",
    actorId: "304263836",
    refProtected: "true",
    eventSha: b,
    workflowSha: a,
    eventName: "workflow_dispatch",
    ref: "refs/heads/main",
    workflowRef: "Satsetx4/karturt/.github/workflows/staging-readiness-capture.yml@refs/heads/main",
    actor: "Satsetx4", triggeringActor: "Satsetx4", runAttempt: "1", runId: "39730000001",
    launcherSha: a, candidateSha: b, approvedLauncherSha: a, approvedCandidateSha: b,
    dispatchTicket: ticket, approvedTicket: ticket,
    approvedAtUtc: "2026-10-22T05:45:00Z", expiresAtUtc: "2026-10-22T05:55:00Z",
  };
}
function createOnlyFake() {
  const used = new Set<string>();
  const callback = vi.fn<CreateOnlyGitHubRequest>(async (url, init) => {
    expect(init.method).toBe("PUT");
    expect(init.headers).not.toHaveProperty("Authorization");
    const data = JSON.parse(init.body) as Record<string, unknown>;
    expect(data).not.toHaveProperty("sha");
    expect(data.branch).toBe("audit/solo-owner-approval-ledger");
    if (used.has(url)) return { status: 422 };
    used.add(url);
    return { status: 201 };
  });
  return { callback, used };
}
describe("Solo Owner approved ticket reservation contract (offline only)", () => {
  it("creates at most one receipt for the exact SHA/ticket/window and refuses replay", async () => {
    const { callback, used } = createOnlyFake();
    const first = await reserveApprovedSoloOwnerTicket(valid(), now, callback);
    expect(first.candidateSha).toBe(b);
    expect(first.launcherSha).toBe(a);
    expect(used.size).toBe(1);
    await expect(reserveApprovedSoloOwnerTicket(valid(), now, callback))
      .rejects.toMatchObject({ code: "SOLO_APPROVAL_LEDGER_NOT_RESERVED" });
    expect(used.size).toBe(1);
  });
  it("admits only one concurrent reservation in the offline atomic-store model", async () => {
    const { callback, used } = createOnlyFake();
    const results = await Promise.allSettled([
      reserveApprovedSoloOwnerTicket(valid(), now, callback),
      reserveApprovedSoloOwnerTicket(valid(), now, callback),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(used.size).toBe(1);
  });
  it.each([
    ["wrong repo", { repository: "external/karturt" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["wrong repository id", { repositoryId: "0" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["wrong owner id", { ownerId: "0" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["wrong owner actor id", { actorId: "0" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["unprotected ref", { refProtected: "false" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["wrong ref", { ref: "refs/heads/feature" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["wrong event", { eventName: "pull_request" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["substituted workflow", { workflowRef: "other/workflow@main" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["wrong actor", { actor: "attacker" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["different rerun actor", { triggeringActor: "attacker" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["attempt two", { runAttempt: "2" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["invalid run id", { runId: "0" }, "SOLO_RESERVATION_DISPATCH_INVALID"],
    ["stale source", { candidateSha: "d".repeat(40) }, "SOLO_RESERVATION_SHA_MISMATCH"],
    ["dispatch source mismatch", { eventSha: "d".repeat(40) }, "SOLO_RESERVATION_SHA_MISMATCH"],
    ["malformed dispatch source", { eventSha: "bad" }, "SOLO_RESERVATION_SHA_MISMATCH"],
    ["launcher workflow SHA mismatch", { workflowSha: "d".repeat(40) }, "SOLO_RESERVATION_SHA_MISMATCH"],
    ["stale launcher", { launcherSha: "d".repeat(40) }, "SOLO_RESERVATION_SHA_MISMATCH"],
    ["unapproved source", { approvedCandidateSha: "" }, "SOLO_RESERVATION_SHA_MISMATCH"],
    ["wrong ticket", { dispatchTicket: "d".repeat(32) }, "SOLO_RESERVATION_TICKET_MISMATCH"],
    ["missing protected ticket", { approvedTicket: "" }, "SOLO_RESERVATION_TICKET_MISMATCH"],
    ["expired", { expiresAtUtc: "2026-10-22T05:49:59Z" }, "SOLO_RESERVATION_WINDOW_INVALID"],
    ["future approval", { approvedAtUtc: "2026-10-22T05:50:01Z" }, "SOLO_RESERVATION_WINDOW_INVALID"],
    ["future too far", { expiresAtUtc: "2026-10-22T06:01:00Z" }, "SOLO_RESERVATION_WINDOW_INVALID"],
    ["malformed time", { approvedAtUtc: "2026-02-30T05:45:00Z" }, "SOLO_RESERVATION_WINDOW_INVALID"],
  ] as Array<[string, Partial<SoloOwnerReservationEnvironment>, string]>)(
    "stops %s before calling GitHub", async (_label, override, code) => {
      const { callback } = createOnlyFake();
      await expect(reserveApprovedSoloOwnerTicket({ ...valid(), ...override }, now, callback))
        .rejects.toMatchObject({ code });
      expect(callback).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid local clock before any request", async () => {
    const { callback } = createOnlyFake();
    await expect(reserveApprovedSoloOwnerTicket(valid(), Number.NaN, callback))
      .rejects.toBeInstanceOf(SoloOwnerClaimDenied);
    expect(callback).not.toHaveBeenCalled();
  });
});
