/**
 * #72 Wave B: Offline regression for ledger history monotonicity.
 *
 * Consuming a ticket via create-only GitHub PUT isn't sufficient protection:
 * a normal fast-forward can modify or remove an earlier receipt even when
 * deletion and non-fast-forward rules are enforced on the branch.
 *
 * This validator detects suspicious CHANGES IN SUPPLIED SNAPSHOTS ONLY.
 * The snapshots are *not authenticated* here; a GitHub API history fetch with
 * a pinned external anchor and independently scoped writer must be reviewed
 * before this result could become trusted capture evidence.
 */
export const SOLO_OWNER_LEDGER_INITIAL_COMMIT =
  "d1476924969a4625b7902b9939c457881efaa0d7";
export const SOLO_OWNER_LEDGER_INITIAL_PARENT =
  "96c84588ae0c13f68a17cffd997a3e583fb7da82";
export const SOLO_OWNER_LEDGER_README_BLOB =
  "8ddc1e86a9fa41f966106959ca827047afa49b4a";

const README = "audit/solo-owner/README.md";
const RECEIPT = /^audit\/solo-owner\/used-tickets\/[a-f0-9]{64}\.json$/;
const HEX40 = /^[a-f0-9]{40}$/;
type Json = Record<string, unknown>;
const record = (x: unknown): x is Json => x !== null && typeof x === "object" && !Array.isArray(x);
const exactKeys = (x: Json, keys: readonly string[]) => {
  const a = Object.keys(x).sort(), b = [...keys].sort();
  return a.length === b.length && a.every((s, i) => s === b[i]);
};

export type SoloLedgerSnapshotResult = {
  status: "REJECTED" | "CONSISTENT_UNATTESTED";
  failureCodes: string[];
  receiptCount: number;
  observedHeadSha: string | null;
  historySourceAuthenticated: false;
  externalAnchorAuthenticated: false;
  writerScopeVerified: false;
  appendOnlyProven: false;
  safeForSecretBearingCapture: false;
};

export function inspectSoloOwnerLedgerSnapshots(input: unknown): SoloLedgerSnapshotResult {
  const failures: string[] = [];
  const fail = (code: string) => { if (!failures.includes(code)) failures.push(code); };
  let receiptCount = 0;
  let observedHeadSha: string | null = null;
  // A bounded set prevents accepting a partial, unbounded or empty fake proof.
  if (!record(input) || !exactKeys(input, ["historyComplete", "snapshots"]) ||
      input.historyComplete !== true || !Array.isArray(input.snapshots) ||
      input.snapshots.length < 1 || input.snapshots.length > 128) {
    fail("HISTORY_SHAPE_OR_COMPLETENESS_INVALID");
  } else {
    let previous: Map<string, string> | null = null;
    let previousCommit: string | null = null;
    const seenCommits = new Set<string>();
    for (let i = 0; i < input.snapshots.length; i++) {
      const item: unknown = input.snapshots[i];
      if (!record(item) || !exactKeys(item, ["commitSha", "parentSha", "files"]) ||
          typeof item.commitSha !== "string" || !HEX40.test(item.commitSha) ||
          typeof item.parentSha !== "string" || !HEX40.test(item.parentSha) ||
          !Array.isArray(item.files) || item.files.length < 1 || item.files.length > 129) {
        fail("SNAPSHOT_SHAPE_INVALID"); break;
      }
      if (seenCommits.has(item.commitSha)) fail("DUPLICATE_COMMIT");
      seenCommits.add(item.commitSha);
      if (i === 0) {
        if (item.commitSha !== SOLO_OWNER_LEDGER_INITIAL_COMMIT ||
            item.parentSha !== SOLO_OWNER_LEDGER_INITIAL_PARENT) fail("INITIAL_ANCHOR_MISMATCH");
      } else if (item.parentSha !== previousCommit) {
        fail("HISTORY_NOT_CONTIGUOUS");
      }
      const current = new Map<string, string>();
      for (const raw of item.files) {
        if (!record(raw) || !exactKeys(raw, ["path", "blobSha"]) ||
            typeof raw.path !== "string" || typeof raw.blobSha !== "string" ||
            !HEX40.test(raw.blobSha)) {
          fail("FILE_SHAPE_INVALID"); continue;
        }
        if (current.has(raw.path)) fail("DUPLICATE_FILE_PATH");
        current.set(raw.path, raw.blobSha);
        if (raw.path !== README && !RECEIPT.test(raw.path)) fail("UNEXPECTED_LEDGER_PATH");
      }
      if (i === 0) {
        if (current.size !== 1 || current.get(README) !== SOLO_OWNER_LEDGER_README_BLOB) {
          fail("INITIAL_TREE_MISMATCH");
        }
      } else if (previous !== null) {
        for (const [path, blob] of previous) {
          if (!current.has(path)) fail("LEDGER_FILE_DELETED");
          else if (current.get(path) !== blob) fail("LEDGER_FILE_REWRITTEN");
        }
        const additions = [...current.keys()].filter(path => !previous.has(path));
        if (additions.length !== 1 || !RECEIPT.test(additions[0] ?? "")) {
          fail("NEW_RECEIPT_STEP_INVALID");
        } else {
          receiptCount++;
        }
      }
      previous = current;
      previousCommit = item.commitSha;
      observedHeadSha = item.commitSha;
    }
  }
  return {
    status: failures.length ? "REJECTED" : "CONSISTENT_UNATTESTED",
    failureCodes: failures,
    receiptCount,
    observedHeadSha,
    // No local snapshots, even ones obtained from an API call, can establish
    // provider identity, rule configuration, independent anchoring, or writer scope.
    historySourceAuthenticated: false,
    externalAnchorAuthenticated: false,
    writerScopeVerified: false,
    appendOnlyProven: false,
    safeForSecretBearingCapture: false,
  };
}
