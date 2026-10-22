/**
 * #68 / #69: repository ruleset risk assessment for the proposed Solo Owner
 * ticket audit branch. Read-only / pure function, NOT a GitHub API mutator.
 * Branch protection prevents deletion/force-push but by itself does NOT
 * prevent a fast-forward update or overwrite of a receipt.
 */
export const SOLO_OWNER_LEDGER_REF = "refs/heads/audit/solo-owner-approval-ledger";
// Pin the observed live GitHub ruleset rather than accepting any look-alike.
export const SOLO_OWNER_LEDGER_RULESET_ID = 25623088;
export const SOLO_OWNER_LEDGER_RULESET_NAME = "Protect Solo Owner Ledger";

type RecordLike = Record<string, unknown>;
const isRecord = (v: unknown): v is RecordLike =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function appliesToLedger(rule: RecordLike): boolean {
  if (!isRecord(rule.conditions) || !isRecord(rule.conditions.ref_name)) return false;
  const include = rule.conditions.ref_name.include;
  const exclude = rule.conditions.ref_name.exclude;
  // Fail closed on wildcard matching or exclusions that need pattern expansion.
  if (!Array.isArray(include) || !include.includes(SOLO_OWNER_LEDGER_REF) ||
      !Array.isArray(exclude) || exclude.length !== 0) return false;
  return true;
}
export type LedgerRulesetAssessment = {
  scope: "ruleset-metadata-only";
  branchDeletionAndForcePushProtected: boolean;
  appendOnlyProven: false;
  branchLimitedWriteTokenProven: false;
  safeForSecretBearingCapture: false;
  blockers: string[];
};

export function assessSoloOwnerLedgerRulesets(input: unknown): LedgerRulesetAssessment {
  const blockers: string[] = [];
  if (!Array.isArray(input)) {
    blockers.push("RULESETS_UNAVAILABLE");
  } else {
    const matches = input.filter((v): v is RecordLike => isRecord(v) &&
      v.id === SOLO_OWNER_LEDGER_RULESET_ID &&
      v.name === SOLO_OWNER_LEDGER_RULESET_NAME &&
      v.target === "branch" && v.enforcement === "active" && appliesToLedger(v));
    if (matches.length === 0) blockers.push("LEDGER_BRANCH_RULESET_MISSING");
    else {
      const safe = matches.some(rule => {
        const types = Array.isArray(rule.rules)
          ? rule.rules.filter(isRecord).map(x => x.type)
          : [];
        const bypasses = rule.bypass_actors;
        return Array.isArray(bypasses) && bypasses.length === 0 &&
          types.includes("deletion") && types.includes("non_fast_forward");
      });
      if (!safe) blockers.push("LEDGER_FORCE_DELETE_CONTROLS_MISSING_OR_BYPASSABLE");
    }
  }
  const branchDeletionAndForcePushProtected = blockers.length === 0;
  // Even perfect ruleset metadata is NOT proof of branch-limited write
  // credentials, create-only path immutability, or trusted execution.
  blockers.push("LEDGER_APPEND_ONLY_NOT_PROVEN");
  blockers.push("REPOSITORY_WIDE_CONTENTS_WRITE_SCOPE_NOT_ACCEPTED");
  blockers.push("TRUSTED_WORKFLOW_NOT_ACTIVE");
  return {
    scope: "ruleset-metadata-only",
    branchDeletionAndForcePushProtected,
    appendOnlyProven: false,
    branchLimitedWriteTokenProven: false,
    safeForSecretBearingCapture: false,
    blockers,
  };
}
