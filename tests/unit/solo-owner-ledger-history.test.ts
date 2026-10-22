import { describe, expect, it } from "vitest";
import {
  inspectSoloOwnerLedgerSnapshots,
  SOLO_OWNER_LEDGER_INITIAL_COMMIT as genesis,
  SOLO_OWNER_LEDGER_INITIAL_PARENT as main,
  SOLO_OWNER_LEDGER_README_BLOB as readmeBlob,
} from "../../scripts/lib/solo-owner-ledger-history";

const shaA = "a".repeat(40), shaB = "b".repeat(40), shaC = "c".repeat(40);
const blobA = "1".repeat(40), blobB = "2".repeat(40), blobC = "3".repeat(40);
const README = { path: "audit/solo-owner/README.md", blobSha: readmeBlob };
const ticketA = { path: "audit/solo-owner/used-tickets/" + "a".repeat(64) + ".json", blobSha: blobA };
const ticketB = { path: "audit/solo-owner/used-tickets/" + "b".repeat(64) + ".json", blobSha: blobB };
const genesisSnapshot = () => ({ commitSha: genesis, parentSha: main, files: [README] });
const history = () => ({
  historyComplete: true,
  snapshots: [
    genesisSnapshot(),
    { commitSha: shaA, parentSha: genesis, files: [README, ticketA] },
    { commitSha: shaB, parentSha: shaA, files: [README, ticketA, ticketB] },
  ],
});
const assess = (input: unknown) => inspectSoloOwnerLedgerSnapshots(input);
describe("Solo Owner ledger monotonicity (offline, not authenticated)", () => {
  it("allows the actual inert genesis with no ticket but never authorizes capture", () => {
    const a = assess({ historyComplete: true, snapshots: [genesisSnapshot()] });
    expect(a).toMatchObject({
      status: "CONSISTENT_UNATTESTED", receiptCount: 0,
      observedHeadSha: genesis, appendOnlyProven: false,
      safeForSecretBearingCapture: false, writerScopeVerified: false,
    });
  });
  it("recognizes a contiguous synthetic append-only sequence without trusting it", () => {
    const a = assess(history());
    expect(a).toMatchObject({
      status: "CONSISTENT_UNATTESTED", receiptCount: 2, observedHeadSha: shaB,
      historySourceAuthenticated: false, externalAnchorAuthenticated: false,
      appendOnlyProven: false, safeForSecretBearingCapture: false,
    });
  });
  it.each([
    ["receipt overwritten by a normal fast-forward", (h: ReturnType<typeof history>) => {
      h.snapshots[2].files[1] = { ...ticketA, blobSha: blobC };
    }, "LEDGER_FILE_REWRITTEN"],
    ["receipt deleted by a normal fast-forward", h => {
      h.snapshots[2].files.splice(1, 1);
    }, "LEDGER_FILE_DELETED"],
    ["README modified", h => {
      h.snapshots[1].files[0] = { ...README, blobSha: blobC };
    }, "LEDGER_FILE_REWRITTEN"],
    ["missing contiguous commit", h => {
      h.snapshots[2].parentSha = genesis;
    }, "HISTORY_NOT_CONTIGUOUS"],
    ["unrelated extra file", h => {
      h.snapshots[2].files.push({ path: "src/hidden.ts", blobSha: blobC });
    }, "UNEXPECTED_LEDGER_PATH"],
    ["new file outside receipt namespace", h => {
      h.snapshots[1].files[1] = { path: "audit/random.json", blobSha: blobC };
    }, "UNEXPECTED_LEDGER_PATH"],
    ["no file was appended", h => {
      h.snapshots[2].files.splice(2, 1);
    }, "NEW_RECEIPT_STEP_INVALID"],
    ["duplicated file path", h => {
      h.snapshots[2].files.push(ticketA);
    }, "DUPLICATE_FILE_PATH"],
    ["broken external genesis", h => {
      h.snapshots[0].commitSha = shaC;
    }, "INITIAL_ANCHOR_MISMATCH"],
    ["broken genesis README blob", h => {
      h.snapshots[0].files[0] = { ...README, blobSha: blobC };
    }, "INITIAL_TREE_MISMATCH"],
    ["duplicate commit", h => {
      h.snapshots[2].commitSha = shaA;
    }, "DUPLICATE_COMMIT"],
  ] as Array<[string, (h: ReturnType<typeof history>) => void, string]>)(
    "detects %s", (_label, modify, code) => {
      const h = history(); modify(h);
      const r = assess(h);
      expect(r.status).toBe("REJECTED");
      expect(r.failureCodes).toContain(code);
      expect(r.safeForSecretBearingCapture).toBe(false);
    },
  );
  it("rejects a partial, unsourced or attacker-supplied claimed attestation", () => {
    expect(assess({ ...history(), historyComplete: false }).status).toBe("REJECTED");
    expect(assess(null).status).toBe("REJECTED");
    expect(assess({ ...history(), providerSigned: true }).status).toBe("REJECTED");
  });
  it("rejects more than 128 snapshots rather than accepting a truncated bounded history", () => {
    const h = history();
    expect(assess({ historyComplete: true, snapshots: Array(129).fill(h.snapshots[0]) }).status).toBe("REJECTED");
  });
});
