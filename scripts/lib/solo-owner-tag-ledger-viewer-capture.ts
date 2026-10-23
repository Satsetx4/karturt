import {
  reserveSoloOwnerTicketInTagLedger,
  SoloOwnerTagLedgerDenied,
  type SoloOwnerTagLedgerClaim,
  type SoloOwnerTagLedgerPolicy,
  type SoloOwnerTagLedgerTransport,
} from "./solo-owner-tag-ledger";
import {
  checkViewerOnlyNeonProjectGet,
  type NeonViewerReadOnlyTransport,
} from "./solo-owner-neon-viewer-get";

/**
 * Offline-only composition prototype. It is not imported by a workflow,
 * application server, migration, or provider connector.
 *
 * The exact tag-ledger reservation and its scope/ruleset/readback checks must
 * complete before the caller may load a Viewer credential. Even a successful
 * injected transport and matching metadata remain unattested and never grant
 * database, migration, staging-readiness, or deployment permission.
 */
export type SoloOwnerTagLedgerViewerDependencies = {
  tagLedgerTransport: SoloOwnerTagLedgerTransport;
  loadViewerTokenAfterReservation: () => Promise<string>;
  readNeonProject: NeonViewerReadOnlyTransport;
};

export type PreparedSoloOwnerTagLedgerViewerReceipt = {
  status: "TAG_RESERVATION_AND_VIEWER_METADATA_MATCHED_UNATTESTED";
  tagRef: string;
  ticketDigest: string;
  sourceSha: string;
  launcherSha: string;
  targetProjectId: "super-band-12770762";
  effectivePermission: "VIEWER";
  freeSubscriptionType: "free_v2" | "free_v3";
  tokenLogged: false;
  ownerApprovalConsumed: true;
  providerAuthenticated: false;
  providerAttested: false;
  readyForStagingReadiness: false;
  allowedToConnectDatabase: false;
  allowedToMigrate: false;
  allowedToDeploy: false;
};

export async function prepareSoloOwnerTagLedgerViewerCapture(
  policy: SoloOwnerTagLedgerPolicy,
  claim: SoloOwnerTagLedgerClaim,
  dependencies: SoloOwnerTagLedgerViewerDependencies,
): Promise<PreparedSoloOwnerTagLedgerViewerReceipt> {
  const reservation = await reserveSoloOwnerTicketInTagLedger(
    policy,
    claim,
    dependencies.tagLedgerTransport,
  );

  let viewerToken: string;
  try {
    viewerToken = await dependencies.loadViewerTokenAfterReservation();
  } catch {
    // Provider errors can contain credentials; discard all details.
    throw new SoloOwnerTagLedgerDenied("VIEWER_SECRET_UNAVAILABLE_AFTER_TAG_RESERVATION");
  }

  const observation = await checkViewerOnlyNeonProjectGet(
    viewerToken,
    reservation.receipt.candidateSha,
    dependencies.readNeonProject,
  );
  if (observation.check !== "METADATA_MATCHES_BUT_UNATTESTED" ||
      observation.targetProjectId !== "super-band-12770762") {
    throw new SoloOwnerTagLedgerDenied("VIEWER_METADATA_CHECK_NOT_SATISFIED");
  }

  return {
    status: "TAG_RESERVATION_AND_VIEWER_METADATA_MATCHED_UNATTESTED",
    tagRef: reservation.tagRef,
    ticketDigest: reservation.receipt.ticketDigest,
    sourceSha: reservation.receipt.candidateSha,
    launcherSha: reservation.receipt.launcherSha,
    targetProjectId: observation.targetProjectId,
    effectivePermission: observation.observedPermission,
    freeSubscriptionType: observation.observedFreePlan,
    tokenLogged: false,
    ownerApprovalConsumed: true,
    providerAuthenticated: false,
    providerAttested: false,
    readyForStagingReadiness: false,
    allowedToConnectDatabase: false,
    allowedToMigrate: false,
    allowedToDeploy: false,
  };
}
