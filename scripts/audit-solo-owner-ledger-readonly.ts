import { auditSoloOwnerLedgerLive, LedgerReadOnlyDenied } from "./lib/solo-owner-ledger-live";
async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== "Satsetx4/karturt") {
    throw new LedgerReadOnlyDenied("RUNNER_CONTEXT_INVALID");
  }
  const key = process.env.GITHUB_TOKEN;
  if (!key) throw new LedgerReadOnlyDenied("READ_ONLY_GITHUB_TOKEN_MISSING");
  const result = await auditSoloOwnerLedgerLive(async url => {
    if (!/^https:\/\/api\.github\.com\/repos\/Satsetx4\/karturt\/git\/(?:ref\/heads\/audit\/solo-owner-approval-ledger|commits\/[a-f0-9]{40}|trees\/[a-f0-9]{40}\?recursive=1)$/.test(url)) {
      throw new LedgerReadOnlyDenied("URL_NOT_ALLOWED");
    }
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + key },
      redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (response.status !== 200) throw new LedgerReadOnlyDenied("GET_FAILED");
    return response.json() as Promise<unknown>;
  });
  process.stdout.write("LEDGER_" + result.status + " commits=" + result.commits +
    " receipts=" + result.receipts + " head=" + result.headSha + "\n");
  process.stdout.write("LEDGER_SECRET_ACCESS_NOT_AUTHORIZED\n");
}
main().catch(error => {
  const code = error instanceof LedgerReadOnlyDenied ? error.code : "AUDIT_FAILED_CLOSED";
  process.stderr.write("LEDGER_AUDIT_STOP:" + code + "\n");
  process.exitCode = 1;
});
