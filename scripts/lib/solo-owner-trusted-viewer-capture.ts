import {
  reserveApprovedSoloOwnerTicket,
  type SoloOwnerReservationEnvironment,
} from "./solo-owner-approval-reservation";
import {
  type CreateOnlyGitHubRequest,
  SoloOwnerClaimDenied,
} from "./solo-owner-approval-ledger";
import {
  checkViewerOnlyNeonProjectGet,
  type NeonViewerReadOnlyTransport,
} from "./solo-owner-neon-viewer-get";

/**
 * FUTURE ONLY: this module is deliberately NOT imported by GitHub Actions,
 * server code, migrations, or the Neon API connector.
 *
 * Ordering invariant: consume an exact owner-approved, single-use ticket
 * BEFORE even reading the Viewer credential, then allow precisely one GET
 * for the expected project via an injected, separately reviewed transport.
 *
 * There is NO live trust/attestation here: fake transports in unit tests can
 * produce the same metadata. The future caller still requires protected
 * main, ledger branch protection, short-lived scoped identity, external
 * evidence verification, and separate database/migration authorization.
 */
export type ViewerCaptureDependencies = {
  createOnlyLedgerRecord: CreateOnlyGitHubRequest;
  loadViewerTokenAfterReservation: () => Promise<string>;
  readExactNeonProject: NeonViewerReadOnlyTransport;
};

export type PreparedViewerCaptureReceipt = {
  status: "OFFLINE_CONTRACT_UNATTESTED";
  ticketDigest: string;
  sourceSha: string;
  launcherSha: string;
  targetProjectId: "super-band-12770762";
  viewerMetadataMatch: true;
  tokenLogged: false;
  ownerApprovalConsumed: true;
  providerAuthenticated: false;
  readyForStagingReadiness: false;
  allowedToConnectDatabase: false;
  allowedToMigrate: false;
  allowedToDeploy: false;
};

export async function prepareSoloViewerCapture(
  approval: SoloOwnerReservationEnvironment,
  nowMs: number,
  dependencies: ViewerCaptureDependencies,
): Promise<PreparedViewerCaptureReceipt> {
  // Do not access secrets, even via loadViewerToken, until the trusted
  // repository has successfully reserved this ticket exactly once.
  const ticket = await reserveApprovedSoloOwnerTicket(
    approval, nowMs, dependencies.createOnlyLedgerRecord,
  );
  let viewerToken: string;
  try {
    viewerToken = await dependencies.loadViewerTokenAfterReservation();
  } catch {
    // Credential errors can leak secrets; suppress all caller error bodies.
    throw new SoloOwnerClaimDenied("VIEWER_SECRET_UNAVAILABLE_AFTER_RESERVATION");
  }

  // The Viewer helper validates exact GET, target identity and effective
  // permission but deliberately never claims that a mock or an untrusted
  // network response is signed provider evidence.
  const observation = await checkViewerOnlyNeonProjectGet(
    viewerToken, approval.candidateSha, dependencies.readExactNeonProject,
  );
  if (observation.check !== "METADATA_MATCHES_BUT_UNATTESTED" ||
      observation.targetProjectId !== "super-band-12770762") {
    throw new SoloOwnerClaimDenied("VIEWER_METADATA_CHECK_NOT_SATISFIED");
  }
  // No raw ticket, Viewer token or provider payload in receipts.
  return {
    status: "OFFLINE_CONTRACT_UNATTESTED",
    ticketDigest: ticket.ticketDigest,
    sourceSha: ticket.candidateSha,
    launcherSha: ticket.launcherSha,
    targetProjectId: observation.targetProjectId,
    viewerMetadataMatch: true,
    tokenLogged: false,
    ownerApprovalConsumed: true,
    providerAuthenticated: false,
    readyForStagingReadiness: false,
    allowedToConnectDatabase: false,
    allowedToMigrate: false,
    allowedToDeploy: false,
  };
}
