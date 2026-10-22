import { describe, expect, it, vi } from "vitest";
import { auditSoloOwnerLedgerLive, type GetReadonlyJson } from "../../scripts/lib/solo-owner-ledger-live";
import {
  SOLO_OWNER_LEDGER_INITIAL_COMMIT as genesis,
  SOLO_OWNER_LEDGER_INITIAL_PARENT as main,
  SOLO_OWNER_LEDGER_README_BLOB as readme,
} from "../../scripts/lib/solo-owner-ledger-history";

const api = "https://api.github.com/repos/Satsetx4/karturt/git/";
const ref = api + "ref/heads/audit/solo-owner-approval-ledger";
const tree = "a".repeat(40), tree2 = "b".repeat(40), commit2 = "c".repeat(40);
const file = { path: "audit/solo-owner/README.md", sha: readme, type: "blob", mode: "100644" };
const ticket = { path: "audit/solo-owner/used-tickets/" + "e".repeat(64) + ".json", sha: "d".repeat(40), type: "blob", mode: "100644" };
type Change = "none" | "valid-append" | "tamper" | "truncated" | "race" | "bad-mode" | "network";
function fake(change: Change) {
  let refs = 0;
  const requests: string[] = [];
  const get = vi.fn<GetReadonlyJson>(async url => {
    requests.push(url);
    if (change === "network") throw new Error("private-key-test-must-not-leak");
    if (url === ref) {
      refs++;
      const hash = change === "race" && refs > 1 ? "f".repeat(40) : change === "none" ? genesis : commit2;
      return { ref: "refs/heads/audit/solo-owner-approval-ledger", object: { type: "commit", sha: hash } };
    }
    if (url === api + "commits/" + genesis) return { sha: genesis, tree: { sha: tree }, parents: [{ sha: main }] };
    if (url === api + "commits/" + commit2) return { sha: commit2, tree: { sha: tree2 }, parents: [{ sha: genesis }] };
    if (url === api + "trees/" + tree + "?recursive=1") return { sha: tree, truncated: false, tree: [file] };
    if (url === api + "trees/" + tree2 + "?recursive=1") {
      return { sha: tree2, truncated: change === "truncated",
        tree: [change === "tamper" ? { ...file, sha: "f".repeat(40) } : file,
          change === "bad-mode" ? { ...ticket, mode: "100755" } : ticket] };
    }
    throw new Error("unknown");
  });
  return { get, requests };
}
describe("read-only remote audit with mocked GitHub GET", () => {
  it("checks real pinned genesis with two GitHub ref reads; never grants key access", async () => {
    const client = fake("none");
    const r = await auditSoloOwnerLedgerLive(client.get);
    expect(client.requests).toEqual([ref, api + "commits/" + genesis, api + "trees/" + tree + "?recursive=1", ref]);
    expect(r).toMatchObject({
      status: "REMOTE_HISTORY_CONSISTENT_UNATTESTED", commits: 1,
      receipts: 0, headSha: genesis, keyAccessAuthorized: false,
      writerScopeVerified: false, appendOnlyProven: false, migrationAuthorized: false,
    });
  });
  it("allows simulated append while marking it unattested", async () => {
    expect(await auditSoloOwnerLedgerLive(fake("valid-append").get)).toMatchObject({
      receipts: 1, keyAccessAuthorized: false, appendOnlyProven: false,
    });
  });
  it.each([
    ["tamper", "LEDGER_NOT_MONOTONIC"],
    ["truncated", "TREE_INCOMPLETE"],
    ["race", "REF_CHANGED_DURING_AUDIT"],
    ["bad-mode", "TREE_ENTRY_INVALID"],
    ["network", "GITHUB_GET_UNAVAILABLE"],
  ] as Array<[Change, string]>)("stops on %s", async (change, code) => {
    await expect(auditSoloOwnerLedgerLive(fake(change).get)).rejects.toMatchObject({ code });
  });
  it("strips errors from the provider that might expose a key", async () => {
    try { await auditSoloOwnerLedgerLive(fake("network").get); }
    catch (err) { expect(String(err)).not.toContain("private-key-test-must-not-leak"); }
  });
});
