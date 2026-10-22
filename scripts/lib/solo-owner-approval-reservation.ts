import { claimSoloOwnerTicket, SoloOwnerClaimDenied, type CreateOnlyGitHubRequest, type TicketReceipt } from "./solo-owner-approval-ledger";

/**
 * Intended for a future reviewed, owner-authorized protected job.
 * THIS MODULE IS NOT CONNECTED TO THE EXISTING PHASE-0 WORKFLOW.
 * It only reserves an owner ticket on a protected GitHub audit branch,
 * not provider approval, database access, migration, F2, or deployment.
 */
export type SoloOwnerReservationEnvironment = {
  repository: string;
  repositoryId: string;
  ownerId: string;
  actorId: string;
  refProtected: string;
  eventSha: string;
  workflowSha: string;
  eventName: string;
  ref: string;
  workflowRef: string;
  actor: string;
  triggeringActor: string;
  runAttempt: string;
  runId: string;
  launcherSha: string;
  candidateSha: string;
  dispatchTicket: string;
  approvedCandidateSha: string;
  approvedLauncherSha: string;
  approvedTicket: string;
  approvedAtUtc: string;
  expiresAtUtc: string;
};

function exactUtc(raw: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw)) return null;
  const value = Date.parse(raw);
  if (!Number.isFinite(value) || new Date(value).toISOString() !== raw.replace(/Z$/, ".000Z")) return null;
  return value;
}
function deny(code: string): never {
  throw new SoloOwnerClaimDenied(code);
}
const shaPattern = /^[a-f0-9]{40}$/;
const ticketPattern = /^[a-f0-9]{32}$/;

export async function reserveApprovedSoloOwnerTicket(
  e: SoloOwnerReservationEnvironment,
  nowMs: number,
  createOnly: CreateOnlyGitHubRequest,
): Promise<TicketReceipt> {
  if (e.repository !== "Satsetx4/karturt" ||
      e.repositoryId !== "1386907262" || e.ownerId !== "304263836" ||
      e.actorId !== "304263836" || e.refProtected !== "true" ||
      e.eventName !== "workflow_dispatch" ||
      e.ref !== "refs/heads/main" ||
      e.workflowRef !== "Satsetx4/karturt/.github/workflows/staging-readiness-capture.yml@refs/heads/main" ||
      e.actor !== "Satsetx4" || e.triggeringActor !== "Satsetx4" ||
      e.runAttempt !== "1" || !/^[1-9][0-9]{0,17}$/.test(e.runId)) {
    deny("SOLO_RESERVATION_DISPATCH_INVALID");
  }
  if (!shaPattern.test(e.launcherSha) ||
      !shaPattern.test(e.workflowSha) || !shaPattern.test(e.eventSha) ||
      e.launcherSha !== e.workflowSha ||
      !shaPattern.test(e.candidateSha) ||
      e.candidateSha !== e.eventSha ||
      !shaPattern.test(e.approvedCandidateSha) ||
      !shaPattern.test(e.approvedLauncherSha) ||
      e.candidateSha !== e.approvedCandidateSha ||
      e.launcherSha !== e.approvedLauncherSha) {
    deny("SOLO_RESERVATION_SHA_MISMATCH");
  }
  if (!ticketPattern.test(e.dispatchTicket) ||
      !ticketPattern.test(e.approvedTicket) ||
      e.dispatchTicket !== e.approvedTicket) {
    deny("SOLO_RESERVATION_TICKET_MISMATCH");
  }
  const approvedAt = exactUtc(e.approvedAtUtc);
  const expiresAt = exactUtc(e.expiresAtUtc);
  if (!Number.isFinite(nowMs) || approvedAt === null || expiresAt === null ||
      nowMs < approvedAt || nowMs >= expiresAt ||
      expiresAt <= approvedAt || expiresAt - approvedAt > 15 * 60_000 ||
      nowMs - approvedAt > 15 * 60_000) {
    deny("SOLO_RESERVATION_WINDOW_INVALID");
  }
  return claimSoloOwnerTicket({
    repository: e.repository,
    actor: e.actor,
    triggeringActor: e.triggeringActor,
    runAttempt: 1,
    runId: e.runId,
    ticket: e.dispatchTicket,
    candidateSha: e.candidateSha,
    launcherSha: e.launcherSha,
    approvedAtUtc: e.approvedAtUtc,
  }, createOnly);
}
