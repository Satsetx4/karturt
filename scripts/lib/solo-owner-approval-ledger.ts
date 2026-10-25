import { createHash } from "node:crypto";

// Pure, offline-testable consumer contract. NOT invoked by the phase-0 workflow.
// A future reviewed guarded job must provide an authenticated GitHub client,
// constrain GITHUB_TOKEN permissions and protect the append-only ledger branch.
export const SOLO_OWNER_LEDGER_BRANCH = "audit/solo-owner-approval-ledger";
export const SOLO_OWNER_LEDGER_REPOSITORY = "Satsetx4/karturt";

export type SoloOwnerTicketClaim = {
  repository: string;
  actor: string;
  triggeringActor: string;
  runAttempt: number;
  runId: string;
  ticket: string;
  candidateSha: string;
  launcherSha: string;
  approvedAtUtc: string;
};

export type CreateOnlyGitHubRequest = (
  url: string,
  request: {
    method: "PUT";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ status: number }>;

export type TicketReceipt = {
  receiptVersion: "karturt/solo-owner-approval-claim/v1";
  ticketDigest: string;
  repository: string;
  runId: string;
  candidateSha: string;
  launcherSha: string;
  approvedAtUtc: string;
};

export class SoloOwnerClaimDenied extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SoloOwnerClaimDenied";
  }
}

function assertClaim(value: SoloOwnerTicketClaim): void {
  if (value.repository !== SOLO_OWNER_LEDGER_REPOSITORY ||
      value.actor !== "Satsetx4" ||
      value.triggeringActor !== "Satsetx4" ||
      value.runAttempt !== 1 ||
      !/^[0-9]{1,18}$/.test(value.runId) ||
      !/^[a-f0-9]{32}$/.test(value.ticket) ||
      !/^[a-f0-9]{40}$/.test(value.candidateSha) ||
      !/^[a-f0-9]{40}$/.test(value.launcherSha) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.approvedAtUtc)) {
    throw new SoloOwnerClaimDenied("SOLO_APPROVAL_CLAIM_CONTEXT_INVALID");
  }
  const stamp = Date.parse(value.approvedAtUtc);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString() !== value.approvedAtUtc.replace(/Z$/, ".000Z")) {
    throw new SoloOwnerClaimDenied("SOLO_APPROVAL_CLAIM_TIMESTAMP_INVALID");
  }
}

export function ticketDigest(ticket: string): string {
  if (!/^[a-f0-9]{32}$/.test(ticket)) {
    throw new SoloOwnerClaimDenied("SOLO_APPROVAL_CLAIM_TICKET_FORMAT_INVALID");
  }
  // Path depends only on ticket, NOT on run ID or candidate source.
  // A ticket spent on any prior run cannot be recycled for a different SHA.
  return createHash("sha256").update("karturt-solo-owner-ticket/v1:" + ticket, "utf8").digest("hex");
}

// GitHub Contents API create-only PUT has no 'sha' field, so an existing path
// must be rejected. The dedicated ledger branch must already exist and be
// protected against force pushes/deletes. A success receipt only proves
// reservation by GitHub, not approval of credentials, staging, migration or F2.
export async function claimSoloOwnerTicket(
  value: SoloOwnerTicketClaim,
  createOnly: CreateOnlyGitHubRequest,
): Promise<TicketReceipt> {
  assertClaim(value);
  const digest = ticketDigest(value.ticket);
  const receipt: TicketReceipt = {
    receiptVersion: "karturt/solo-owner-approval-claim/v1",
    ticketDigest: digest,
    repository: value.repository,
    runId: value.runId,
    candidateSha: value.candidateSha,
    launcherSha: value.launcherSha,
    approvedAtUtc: value.approvedAtUtc,
  };
  const path = `audit/solo-owner/used-tickets/${digest}.json`;
  const url = `https://api.github.com/repos/${SOLO_OWNER_LEDGER_REPOSITORY}/contents/${path}`;
  const payload = {
    message: `audit: reserve solo-owner approval ${digest.slice(0, 12)}`,
    content: Buffer.from(JSON.stringify(receipt) + "\n", "utf8").toString("base64"),
    branch: SOLO_OWNER_LEDGER_BRANCH,
    // IMPORTANT: sha intentionally omitted (create-only).
  };
  let response: { status: number };
  try {
    response = await createOnly(url, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new SoloOwnerClaimDenied("SOLO_APPROVAL_LEDGER_UNAVAILABLE");
  }
  if (response.status !== 201) {
    // 409/422 may be duplicate/branch-protection; all non-201 are hard STOP.
    // Do not display provider response bodies, tokens or approval tickets.
    throw new SoloOwnerClaimDenied("SOLO_APPROVAL_LEDGER_NOT_RESERVED");
  }
  return receipt;
}
