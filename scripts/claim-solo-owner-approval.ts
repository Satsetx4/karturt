import {
  reserveApprovedSoloOwnerTicket,
  type SoloOwnerReservationEnvironment,
} from "./lib/solo-owner-approval-reservation";
import { SoloOwnerClaimDenied, type CreateOnlyGitHubRequest } from "./lib/solo-owner-approval-ledger";

/**
 * Future reviewed protected-job component. No workflow currently invokes it.
 * CAUTION: the default Actions GITHUB_TOKEN with contents:write is scoped
 * repository-wide, NOT to a single branch. This CLI MUST NOT be wired into
 * a secret-bearing workflow until a reviewed restricted writer, immutable
 * receipt policy and audited branch protections are actually proven.
 *
 * No database, Neon, staging metadata API, migration, F2 or deployment calls.
 */
async function main() {
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new SoloOwnerClaimDenied("SOLO_RESERVATION_NOT_GITHUB_ACTIONS");
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new SoloOwnerClaimDenied("SOLO_RESERVATION_TOKEN_UNAVAILABLE");
  const e = process.env;
  const context: SoloOwnerReservationEnvironment = {
    repository: e.GITHUB_REPOSITORY ?? "",
    eventName: e.GITHUB_EVENT_NAME ?? "",
    ref: e.GITHUB_REF ?? "",
    workflowRef: e.GITHUB_WORKFLOW_REF ?? "",
    actor: e.GITHUB_ACTOR ?? "",
    triggeringActor: e.GITHUB_TRIGGERING_ACTOR ?? "",
    runAttempt: e.GITHUB_RUN_ATTEMPT ?? "",
    runId: e.GITHUB_RUN_ID ?? "",
    launcherSha: e.GITHUB_SHA ?? "",
    candidateSha: e.CANDIDATE_SHA ?? "",
    dispatchTicket: e.DISPATCH_APPROVAL_TICKET ?? "",
    approvedCandidateSha: e.EXPECTED_APPROVED_SHA ?? "",
    approvedLauncherSha: e.EXPECTED_LAUNCHER_SHA ?? "",
    approvedTicket: e.EXPECTED_APPROVAL_TICKET ?? "",
    approvedAtUtc: e.EXPECTED_APPROVAL_AT ?? "",
    expiresAtUtc: e.EXPECTED_APPROVAL_EXPIRES ?? "",
  };
  const api: CreateOnlyGitHubRequest = async (url, request) => {
    // Both path and branch are fixed by the imported ledger helper.
    const result = await fetch(url, {
      method: "PUT",
      headers: {
        ...request.headers,
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: request.body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    // Never read, throw or log a GitHub response body; it might contain secrets.
    return { status: result.status };
  };
  const receipt = await reserveApprovedSoloOwnerTicket(context, Date.now(), api);
  // Stable success marker only; never output token, raw ticket or JSON input.
  process.stdout.write("SOLO_APPROVAL_LEDGER_RESERVED:" + receipt.runId + "\n");
}
main().catch(error => {
  const code = error instanceof SoloOwnerClaimDenied ? error.code : "SOLO_RESERVATION_FAILED_CLOSED";
  process.stderr.write("CAPTURE_STOP:" + code + "\n");
  process.exitCode = 1;
});
