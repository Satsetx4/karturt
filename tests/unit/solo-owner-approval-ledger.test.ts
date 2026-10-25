import { describe, expect, it, vi } from "vitest";
import {
  claimSoloOwnerTicket,
  SOLO_OWNER_LEDGER_BRANCH,
  SoloOwnerClaimDenied,
  ticketDigest,
  type CreateOnlyGitHubRequest,
  type SoloOwnerTicketClaim,
} from "../../scripts/lib/solo-owner-approval-ledger";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const ticket = "c".repeat(32);

const goodClaim = (overrides: Partial<SoloOwnerTicketClaim> = {}): SoloOwnerTicketClaim => ({
  repository: "Satsetx4/karturt",
  actor: "Satsetx4",
  triggeringActor: "Satsetx4",
  runAttempt: 1,
  runId: "39722576030",
  ticket,
  candidateSha: shaA,
  launcherSha: shaB,
  approvedAtUtc: "2026-10-22T04:30:00Z",
  ...overrides,
});

function fakeCreateOnly() {
  const records = new Map<string, string>();
  const request = vi.fn<CreateOnlyGitHubRequest>(async (url, init) => {
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "sha")).toBe(false);
    expect(body.branch).toBe(SOLO_OWNER_LEDGER_BRANCH);
    expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\/Satsetx4\/karturt\/contents\/audit\/solo-owner\/used-tickets\/[a-f0-9]{64}\.json$/);
    if (records.has(url)) return { status: 422 }; // Exact API create-only collision
    records.set(url, String(body.content));
    return { status: 201 };
  });
  return { records, request };
}

describe("Solo Owner persistent ticket reservation contract (offline)", () => {
  it("reserves a ticket by GitHub create-only PUT without any token or raw ticket in payload", async () => {
    const { records, request } = fakeCreateOnly();
    const value = goodClaim();
    const receipt = await claimSoloOwnerTicket(value, request);
    expect(receipt.ticketDigest).toBe(ticketDigest(ticket));
    expect(receipt.runId).toBe(value.runId);
    expect(receipt.candidateSha).toBe(shaA);
    expect(records.size).toBe(1);
    const requestText = JSON.stringify(request.mock.calls[0]);
    expect(requestText).not.toContain(ticket);
    const payload = JSON.parse(String(request.mock.calls[0]?.[1].body)) as { content: string; branch: string };
    const stored = JSON.parse(Buffer.from(payload.content, "base64").toString("utf8")) as Record<string, string>;
    expect(stored.ticketDigest).toBe(ticketDigest(ticket));
    expect(stored.candidateSha).toBe(shaA);
    expect(stored.launcherSha).toBe(shaB);
    expect(Object.keys(stored)).not.toContain("ticket");
    expect(payload.branch).toBe(SOLO_OWNER_LEDGER_BRANCH);
  });

  it("burns a ticket across retries, different source SHAs, and different run IDs", async () => {
    const { records, request } = fakeCreateOnly();
    await claimSoloOwnerTicket(goodClaim(), request);
    await expect(claimSoloOwnerTicket(goodClaim({ runId: "39722576031" }), request))
      .rejects.toMatchObject({ code: "SOLO_APPROVAL_LEDGER_NOT_RESERVED" });
    await expect(claimSoloOwnerTicket(goodClaim({ candidateSha: "d".repeat(40), runId: "39722576032" }), request))
      .rejects.toMatchObject({ code: "SOLO_APPROVAL_LEDGER_NOT_RESERVED" });
    expect(records.size).toBe(1);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("accepts a truly different ticket in a new create-only receipt", async () => {
    const { records, request } = fakeCreateOnly();
    await claimSoloOwnerTicket(goodClaim(), request);
    await claimSoloOwnerTicket(goodClaim({ ticket: "d".repeat(32), runId: "39722576031" }), request);
    expect(records.size).toBe(2);
  });

  it.each([
    ["wrong repository", { repository: "foreign/karturt" }],
    ["wrong owner", { actor: "outsider" }],
    ["wrong rerun actor", { triggeringActor: "outsider" }],
    ["second attempt", { runAttempt: 2 }],
    ["invalid run ID", { runId: "nonnumeric" }],
    ["short ticket", { ticket: "abcdef" }],
    ["uppercase ticket", { ticket: "C".repeat(32) }],
    ["wrong candidate SHA", { candidateSha: "n".repeat(40) }],
    ["wrong launcher SHA", { launcherSha: "" }],
    ["invalid date", { approvedAtUtc: "2026-02-30T00:00:00Z" }],
    ["non-UTC time", { approvedAtUtc: "2026-10-22T11:30:00+07:00" }],
  ] as const)("refuses %s before any ledger API call", async (_name, override) => {
    const { request } = fakeCreateOnly();
    await expect(claimSoloOwnerTicket(goodClaim(override), request)).rejects.toBeInstanceOf(SoloOwnerClaimDenied);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 409, 422, 500])("fails closed on HTTP status %s", async (status) => {
    const request = vi.fn<CreateOnlyGitHubRequest>(async () => ({ status }));
    await expect(claimSoloOwnerTicket(goodClaim(), request))
      .rejects.toMatchObject({ code: "SOLO_APPROVAL_LEDGER_NOT_RESERVED" });
  });

  it("fails closed on remote error and never reports a successful claim", async () => {
    const request = vi.fn<CreateOnlyGitHubRequest>(async () => { throw new Error("remote call failed"); });
    await expect(claimSoloOwnerTicket(goodClaim(), request))
      .rejects.toMatchObject({ code: "SOLO_APPROVAL_LEDGER_UNAVAILABLE" });
  });
});
