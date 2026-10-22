import { describe, expect, it } from "vitest";
import {
  assessSoloOwnerLedgerRulesets, SOLO_OWNER_LEDGER_REF,
} from "../../scripts/lib/solo-owner-ledger-rulesets";

const observedMainOnly = () => ([{
  id: 24900928, name: "Protect", target: "branch", enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [{ type: "deletion" }, { type: "non_fast_forward" },
    { type: "pull_request" }, { type: "required_status_checks" }],
}]);

const directBranchRule = () => ([{
  id: 42, name: "ledger-protect", target: "branch", enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: [SOLO_OWNER_LEDGER_REF], exclude: [] } },
  rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
}]);

describe("Solo Owner ledger branch ruleset risk (offline only)", () => {
  it("rejects currently observed main-only Protect ruleset for the separate ledger", () => {
    expect(assessSoloOwnerLedgerRulesets(observedMainOnly())).toMatchObject({
      branchDeletionAndForcePushProtected: false,
      appendOnlyProven: false,
      branchLimitedWriteTokenProven: false,
      safeForSecretBearingCapture: false,
    });
    expect(assessSoloOwnerLedgerRulesets(observedMainOnly()).blockers)
      .toContain("LEDGER_BRANCH_RULESET_MISSING");
  });
  it("never treats deletion/force-push protection as append-only or safe to enable secrets", () => {
    const a = assessSoloOwnerLedgerRulesets(directBranchRule());
    expect(a.branchDeletionAndForcePushProtected).toBe(true);
    expect(a.appendOnlyProven).toBe(false);
    expect(a.safeForSecretBearingCapture).toBe(false);
    expect(a.blockers).toContain("LEDGER_APPEND_ONLY_NOT_PROVEN");
    expect(a.blockers).toContain("REPOSITORY_WIDE_CONTENTS_WRITE_SCOPE_NOT_ACCEPTED");
  });
  it.each([
    ["no rulesets", [], "LEDGER_BRANCH_RULESET_MISSING"],
    ["unavailable", null, "RULESETS_UNAVAILABLE"],
    ["eval mode", [{ ...directBranchRule()[0], enforcement: "evaluate" }], "LEDGER_BRANCH_RULESET_MISSING"],
    ["wrong ref", [{ ...directBranchRule()[0], conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } } }], "LEDGER_BRANCH_RULESET_MISSING"],
    ["wildcard not explicitly proven", [{ ...directBranchRule()[0], conditions: { ref_name: { include: ["~ALL"], exclude: [] } } }], "LEDGER_BRANCH_RULESET_MISSING"],
    ["missing deletion protection", [{ ...directBranchRule()[0], rules: [{ type: "non_fast_forward" }] }], "LEDGER_FORCE_DELETE_CONTROLS_MISSING_OR_BYPASSABLE"],
    ["missing non-fast-forward", [{ ...directBranchRule()[0], rules: [{ type: "deletion" }] }], "LEDGER_FORCE_DELETE_CONTROLS_MISSING_OR_BYPASSABLE"],
    ["bypass actor present", [{ ...directBranchRule()[0], bypass_actors: [{ actor_id: 1, actor_type: "Integration", bypass_mode: "always" }] }], "LEDGER_FORCE_DELETE_CONTROLS_MISSING_OR_BYPASSABLE"],
    ["excluded paths not reviewed", [{ ...directBranchRule()[0], conditions: { ref_name: { include: [SOLO_OWNER_LEDGER_REF], exclude: ["refs/heads/audit/*"] } } }], "LEDGER_BRANCH_RULESET_MISSING"],
  ] as Array<[string, unknown, string]>)(
    "fails closed for %s", (_name, metadata, expected) => {
      const result = assessSoloOwnerLedgerRulesets(metadata);
      expect(result.blockers).toContain(expected);
      expect(result.safeForSecretBearingCapture).toBe(false);
    },
  );
});
