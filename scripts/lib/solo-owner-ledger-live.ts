import { inspectSoloOwnerLedgerSnapshots, SOLO_OWNER_LEDGER_INITIAL_COMMIT } from "./solo-owner-ledger-history";

const API = "https://api.github.com/repos/Satsetx4/karturt/git/";
const REF = "refs/heads/audit/solo-owner-approval-ledger";
const REF_URL = API + "ref/heads/audit/solo-owner-approval-ledger";
const SHA = /^[a-f0-9]{40}$/;
type Dict = Record<string, unknown>;
const obj = (v: unknown): v is Dict => v !== null && typeof v === "object" && !Array.isArray(v);
export type GetReadonlyJson = (url: string) => Promise<unknown>;
export class LedgerReadOnlyDenied extends Error {
  constructor(public readonly code: string) { super(code); this.name = "LedgerReadOnlyDenied"; }
}
const stop = (code: string): never => { throw new LedgerReadOnlyDenied(code); };
const sha = (v: unknown): string => typeof v === "string" && SHA.test(v) ? v : stop("SHA_INVALID");
const get = async (fn: GetReadonlyJson, u: string) => {
  try { return await fn(u); } catch { return stop("GITHUB_GET_UNAVAILABLE"); }
};
async function headSha(fn: GetReadonlyJson): Promise<string> {
  const v = await get(fn, REF_URL);
  if (!obj(v) || v.ref !== REF || !obj(v.object) || v.object.type !== "commit") stop("REF_INVALID");
  return sha(v.object.sha);
}
export async function auditSoloOwnerLedgerLive(fn: GetReadonlyJson) {
  const head = await headSha(fn);
  const snapshots: Array<{ commitSha: string; parentSha: string; files: Array<{ path: string; blobSha: string }> }> = [];
  let current = head;
  let genesisFound = false;
  for (let i = 0; i < 128; i++) {
    const c = await get(fn, API + "commits/" + current);
    if (!obj(c) || c.sha !== current || !obj(c.tree) || !Array.isArray(c.parents) ||
        c.parents.length !== 1 || !obj(c.parents[0])) stop("COMMIT_INVALID");
    const treeSha = sha(c.tree.sha), parentSha = sha(c.parents[0].sha);
    const t = await get(fn, API + "trees/" + treeSha + "?recursive=1");
    if (!obj(t) || t.sha !== treeSha || t.truncated !== false || !Array.isArray(t.tree) ||
        t.tree.length < 1 || t.tree.length > 400) stop("TREE_INCOMPLETE");
    const files: Array<{ path: string; blobSha: string }> = [];
    for (const item of t.tree) {
      if (!obj(item) || typeof item.path !== "string") stop("TREE_ENTRY_INVALID");
      if (item.type === "tree") {
        if (item.mode !== "040000") stop("TREE_ENTRY_INVALID");
      } else if (item.type === "blob" && item.mode === "100644") {
        files.push({ path: item.path, blobSha: sha(item.sha) });
      } else stop("TREE_ENTRY_INVALID");
    }
    snapshots.push({ commitSha: current, parentSha, files });
    if (current === SOLO_OWNER_LEDGER_INITIAL_COMMIT) { genesisFound = true; break; }
    current = parentSha;
  }
  if (!genesisFound) stop("GENESIS_MISSING_OR_HISTORY_TOO_LONG");
  const review = inspectSoloOwnerLedgerSnapshots({ historyComplete: true, snapshots: snapshots.reverse() });
  if (review.status !== "CONSISTENT_UNATTESTED" || review.observedHeadSha !== head) {
    stop("LEDGER_NOT_MONOTONIC");
  }
  if (await headSha(fn) !== head) stop("REF_CHANGED_DURING_AUDIT");
  // GitHub readback alone is not independently anchored or writer-authenticated.
  return {
    status: "REMOTE_HISTORY_CONSISTENT_UNATTESTED" as const,
    headSha: head, commits: snapshots.length, receipts: review.receiptCount,
    appendOnlyProven: false as const, writerScopeVerified: false as const,
    keyAccessAuthorized: false as const, f2Authorized: false as const,
    migrationAuthorized: false as const, deployAuthorized: false as const,
  };
}
