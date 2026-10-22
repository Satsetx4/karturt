import { createHash } from "node:crypto";

export const SOLO_OWNER_APPLICATION_REPOSITORY = "Satsetx4/karturt";
export const SOLO_OWNER_APPLICATION_REPOSITORY_ID = "1386907262";
export const SOLO_OWNER_OWNER_ID = "304263836";
export const SOLO_OWNER_LEDGER_TAG_PREFIX = "karturt-solo/used/v1/";
export const SOLO_OWNER_LEDGER_TAG_RULE_PATTERN = "refs/tags/karturt-solo/used/v1/*";
export const SOLO_OWNER_LEDGER_RECEIPT_VERSION = "karturt-solo-owner-receipt/v1";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const TICKET_PATTERN = /^[a-f0-9]{32}$/;
const WORKFLOW_REF = "Satsetx4/karturt/.github/workflows/staging-readiness-capture.yml@refs/heads/main";
const TICKET_DOMAIN = "karturt-solo-owner-ticket/v1:";

type JsonRecord = Record<string, unknown>;

export class SoloOwnerTagLedgerDenied extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SoloOwnerTagLedgerDenied";
  }
}

function deny(code: string): never {
  throw new SoloOwnerTagLedgerDenied(code);
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validUtc(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value.replace(/Z$/, ".000Z")) return null;
  return parsed;
}

/** Stable, domain-separated digest. The raw owner ticket is never placed in a receipt or ref. */
export function soloOwnerTicketDigest(ticket: string): string {
  if (!TICKET_PATTERN.test(ticket)) deny("TICKET_FORMAT_INVALID");
  return createHash("sha256").update(TICKET_DOMAIN + ticket, "utf8").digest("hex");
}

/** The digest, not the run ID or source SHA, chooses the single-use reference. */
export function soloOwnerTicketRef(digest: string): string {
  if (!DIGEST_PATTERN.test(digest)) deny("TICKET_DIGEST_INVALID");
  return "refs/tags/" + SOLO_OWNER_LEDGER_TAG_PREFIX + digest;
}

export type SoloOwnerTagLedgerPolicy = {
  applicationRepository: string;
  applicationRepositoryId: string;
  ownerId: string;
  ledgerRepository: string;
  ledgerRepositoryId: number;
  /** Existing commit SHA resolved from the ledger repository before any write. */
  ledgerCommitSha: string;
  rulesetId: number;
  rulesetName: string;
};

export type SoloOwnerTagLedgerClaim = {
  repository: string;
  repositoryId: string;
  ownerId: string;
  eventName: string;
  ref: string;
  refProtected: boolean;
  workflowRef: string;
  actor: string;
  actorId: string;
  triggeringActor: string;
  runAttempt: number;
  runId: string;
  eventSha: string;
  workflowSha: string;
  candidateSha: string;
  launcherSha: string;
  approvedCandidateSha: string;
  approvedLauncherSha: string;
  ticket: string;
  approvedTicket: string;
  issuedAtUtc: string;
  expiresAtUtc: string;
  nowUtc: string;
};

export type SanitizedSoloOwnerReceipt = {
  version: typeof SOLO_OWNER_LEDGER_RECEIPT_VERSION;
  ticketDigest: string;
  repository: string;
  repositoryId: string;
  ownerId: string;
  actor: string;
  actorId: string;
  triggeringActor: string;
  eventName: string;
  workflowRef: string;
  ref: string;
  runId: string;
  runAttempt: number;
  candidateSha: string;
  launcherSha: string;
  issuedAtUtc: string;
  expiresAtUtc: string;
  consumedAtUtc: string;
};

export type GitHubApiResponse = {
  status: number;
  body: unknown;
};

export type WriterScopeReadback = {
  status: number;
  source: string;
  repositorySelection: string;
  complete: boolean;
  repositories: Array<{ id: number; full_name: string }>;
  permissions: Record<string, string>;
};

export type RulesetReadback = {
  status: number;
  complete: boolean;
  rulesets: unknown;
};

export type AnnotatedTagObjectInput = {
  repository: string;
  tag: string;
  message: string;
  object: string;
  type: "commit";
};

export type GitReferenceInput = {
  repository: string;
  ref: string;
  sha: string;
};

export interface SoloOwnerTagLedgerTransport {
  /**
   * Must return sanitized fields from the trusted token-issuance response.
   * Never return or log the credential itself.
   */
  inspectWriterScope(): Promise<WriterScopeReadback>;
  /** Must read every applicable repository/parent ruleset, including pagination. */
  listRulesets(repository: string): Promise<RulesetReadback>;
  /** Must confirm this commit exists in the ledger repository before any write. */
  getCommit(repository: string, sha: string): Promise<GitHubApiResponse>;
  createAnnotatedTagObject(input: AnnotatedTagObjectInput): Promise<GitHubApiResponse>;
  createReference(input: GitReferenceInput): Promise<GitHubApiResponse>;
  getReference(repository: string, ref: string): Promise<GitHubApiResponse>;
  getTagObject(repository: string, sha: string): Promise<GitHubApiResponse>;
}

function validatePolicy(policy: SoloOwnerTagLedgerPolicy): void {
  if (policy.applicationRepository !== SOLO_OWNER_APPLICATION_REPOSITORY ||
      policy.applicationRepositoryId !== SOLO_OWNER_APPLICATION_REPOSITORY_ID ||
      policy.ownerId !== SOLO_OWNER_OWNER_ID) {
    deny("APPLICATION_IDENTITY_INVALID");
  }
  if (!/^[^/]+\/[A-Za-z0-9._-]+$/.test(policy.ledgerRepository) ||
      policy.ledgerRepository.split("/")[0] !== "Satsetx4" ||
      policy.ledgerRepository === policy.applicationRepository ||
      !Number.isSafeInteger(policy.ledgerRepositoryId) ||
      policy.ledgerRepositoryId <= 0 ||
      !Number.isSafeInteger(policy.rulesetId) ||
      policy.rulesetId <= 0 ||
      policy.rulesetName.length === 0) {
    deny("SEPARATE_LEDGER_POLICY_INVALID");
  }
  if (!SHA_PATTERN.test(policy.ledgerCommitSha)) {
    deny("LEDGER_TARGET_COMMIT_SHA_INVALID");
  }
}

function validateClaim(claim: SoloOwnerTagLedgerClaim, policy: SoloOwnerTagLedgerPolicy): void {
  if (claim.repository !== policy.applicationRepository ||
      claim.repositoryId !== policy.applicationRepositoryId ||
      claim.ownerId !== policy.ownerId ||
      claim.eventName !== "workflow_dispatch" ||
      claim.ref !== "refs/heads/main" ||
      claim.refProtected !== true ||
      claim.workflowRef !== WORKFLOW_REF ||
      claim.actor !== "Satsetx4" ||
      claim.actorId !== SOLO_OWNER_OWNER_ID ||
      claim.triggeringActor !== "Satsetx4" ||
      claim.runAttempt !== 1 ||
      !/^[1-9][0-9]{0,17}$/.test(claim.runId)) {
    deny("OWNER_OR_DISPATCH_CONTEXT_INVALID");
  }
  if (!SHA_PATTERN.test(claim.eventSha) ||
      !SHA_PATTERN.test(claim.workflowSha) ||
      !SHA_PATTERN.test(claim.candidateSha) ||
      !SHA_PATTERN.test(claim.launcherSha) ||
      !SHA_PATTERN.test(claim.approvedCandidateSha) ||
      !SHA_PATTERN.test(claim.approvedLauncherSha) ||
      claim.candidateSha !== claim.eventSha ||
      claim.candidateSha !== claim.approvedCandidateSha ||
      claim.launcherSha !== claim.workflowSha ||
      claim.launcherSha !== claim.approvedLauncherSha) {
    deny("SOURCE_OR_LAUNCHER_BINDING_INVALID");
  }
  if (!TICKET_PATTERN.test(claim.ticket) ||
      !TICKET_PATTERN.test(claim.approvedTicket) ||
      claim.ticket !== claim.approvedTicket) {
    deny("OWNER_TICKET_BINDING_INVALID");
  }
  const issued = validUtc(claim.issuedAtUtc);
  const expires = validUtc(claim.expiresAtUtc);
  const now = validUtc(claim.nowUtc);
  if (issued === null || expires === null || now === null ||
      now < issued || now >= expires || expires <= issued ||
      expires - issued > 15 * 60_000 || now - issued > 15 * 60_000) {
    deny("OWNER_APPROVAL_WINDOW_INVALID");
  }
}

function verifyWriterScope(
  policy: SoloOwnerTagLedgerPolicy,
  scope: WriterScopeReadback,
): string {
  if (scope.status === 401 || scope.status === 403) deny("LEDGER_WRITER_UNAUTHORIZED");
  if (scope.status !== 200 || scope.complete !== true ||
      scope.source !== "github-app-installation-token-issuance" ||
      scope.repositorySelection !== "selected" ||
      !Array.isArray(scope.repositories) ||
      scope.repositories.length !== 1 ||
      scope.repositories[0]?.full_name !== policy.ledgerRepository ||
      scope.repositories[0]?.id !== policy.ledgerRepositoryId) {
    deny("LEDGER_WRITER_SCOPE_UNVERIFIED");
  }
  if (!isRecord(scope.permissions)) deny("LEDGER_WRITER_PERMISSION_TOO_BROAD_OR_UNKNOWN");
  const permissions = Object.entries(scope.permissions).sort(([a], [b]) => a.localeCompare(b));
  if (permissions.length !== 2 ||
      permissions[0]?.[0] !== "contents" || permissions[0]?.[1] !== "write" ||
      permissions[1]?.[0] !== "metadata" || permissions[1]?.[1] !== "read") {
    deny("LEDGER_WRITER_PERMISSION_TOO_BROAD_OR_UNKNOWN");
  }
  return JSON.stringify({
    source: scope.source,
    repositorySelection: scope.repositorySelection,
    repositories: scope.repositories.map((repo) => ({ id: repo.id, full_name: repo.full_name })),
    permissions,
  });
}

function verifyRuleset(policy: SoloOwnerTagLedgerPolicy, listing: RulesetReadback): string {
  if (listing.status === 401 || listing.status === 403) deny("LEDGER_RULESET_UNREADABLE");
  if (listing.status !== 200 || listing.complete !== true || !Array.isArray(listing.rulesets)) {
    deny("LEDGER_RULESET_UNVERIFIED");
  }
  const rulesets = listing.rulesets.filter((value): value is JsonRecord =>
    isRecord(value) && value.id === policy.rulesetId);
  if (rulesets.length !== 1) deny("LEDGER_TAG_RULESET_ID_MISSING_OR_AMBIGUOUS");
  const rule = rulesets[0]!;
  const conditions = rule.conditions;
  const refName = isRecord(conditions) ? conditions.ref_name : undefined;
  const includes = isRecord(refName) ? refName.include : undefined;
  const excludes = isRecord(refName) ? refName.exclude : undefined;
  // GitHub tag rulesets may include the protective non_fast_forward rule.
  // Only the two audited exact sets are permitted; unknown/duplicate/malformed
  // entries must never silently disappear from a ruleset readback.
  const rawRules = rule.rules;
  const ruleTypes = Array.isArray(rawRules) && rawRules.every(isRecord)
    ? rawRules.map((entry) => entry.type).sort()
    : [];
  const exactBasicRules = ruleTypes.length === 2 &&
    ruleTypes[0] === "deletion" && ruleTypes[1] === "update";
  const exactForcePushProtectedRules = ruleTypes.length === 3 &&
    ruleTypes[0] === "deletion" &&
    ruleTypes[1] === "non_fast_forward" &&
    ruleTypes[2] === "update";
  const bypassActors = rule.bypass_actors;
  if (rule.name !== policy.rulesetName ||
      rule.source_type !== "Repository" ||
      rule.source !== policy.ledgerRepository ||
      rule.target !== "tag" ||
      rule.enforcement !== "active" ||
      !Array.isArray(includes) ||
      includes.length !== 1 ||
      includes[0] !== SOLO_OWNER_LEDGER_TAG_RULE_PATTERN ||
      !Array.isArray(excludes) ||
      excludes.length !== 0 ||
      !Array.isArray(bypassActors) ||
      bypassActors.length !== 0 ||
      (!exactBasicRules && !exactForcePushProtectedRules)) {
    deny("LEDGER_TAG_RULESET_REQUIREMENTS_UNMET");
  }
  return JSON.stringify({
    id: rule.id,
    name: rule.name,
    source_type: rule.source_type,
    source: rule.source,
    target: rule.target,
    enforcement: rule.enforcement,
    include: includes,
    exclude: excludes,
    bypass_actors: bypassActors,
    rules: ruleTypes,
  });
}

function requireRecord(value: unknown, code: string): JsonRecord {
  if (!isRecord(value)) deny(code);
  return value;
}

function validateLedgerCommitLookup(response: GitHubApiResponse, expectedSha: string): void {
  if (response.status === 401 || response.status === 403) deny("LEDGER_TARGET_COMMIT_UNAUTHORIZED");
  if (response.status !== 200) deny("LEDGER_TARGET_COMMIT_UNAVAILABLE");
  const body = requireRecord(response.body, "LEDGER_TARGET_COMMIT_RESPONSE_INVALID");
  if (typeof body.sha !== "string" || !SHA_PATTERN.test(body.sha) || body.sha !== expectedSha) {
    deny("LEDGER_TARGET_COMMIT_MISMATCH");
  }
}

function isAmbiguousWriteStatus(status: number): boolean {
  return !Number.isInteger(status) ||
    status < 200 ||
    status > 599 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 200 && status < 300) ||
    (status >= 300 && status < 400) ||
    status >= 500;
}

function validateTagObject(
  response: GitHubApiResponse,
  expectedSha: string,
  tagName: string,
  message: string,
  targetSha: string,
): void {
  if (response.status === 401 || response.status === 403) deny("LEDGER_WRITER_UNAUTHORIZED");
  if (response.status !== 201) deny("TAG_OBJECT_CREATE_REJECTED");
  const body = requireRecord(response.body, "TAG_OBJECT_RESPONSE_INVALID");
  const object = requireRecord(body.object, "TAG_OBJECT_RESPONSE_INVALID");
  if (typeof body.sha !== "string" ||
      !SHA_PATTERN.test(body.sha) ||
      body.sha !== expectedSha ||
      body.tag !== tagName ||
      body.message !== message ||
      object.sha !== targetSha ||
      object.type !== "commit") {
    deny("TAG_OBJECT_RESPONSE_MISMATCH");
  }
}

function validateReferenceResponse(
  response: GitHubApiResponse,
  ref: string,
  tagObjectSha: string,
): void {
  if (response.status === 401 || response.status === 403) deny("LEDGER_WRITER_UNAUTHORIZED");
  if (response.status === 409 || response.status === 422) deny("TICKET_ALREADY_CONSUMED_OR_REF_CONFLICT");
  if (response.status !== 201) {
    if (isAmbiguousWriteStatus(response.status)) deny("REF_CREATE_INDETERMINATE");
    deny("REF_CREATE_REJECTED");
  }
  const body = requireRecord(response.body, "REF_CREATE_RESPONSE_INVALID");
  const object = requireRecord(body.object, "REF_CREATE_RESPONSE_INVALID");
  if (body.ref !== ref || object.type !== "tag" || object.sha !== tagObjectSha) {
    deny("REF_CREATE_RESPONSE_MISMATCH");
  }
}

function validateReferenceReadback(response: GitHubApiResponse, ref: string, tagObjectSha: string): void {
  if (response.status !== 200) deny("TRUSTED_REF_READBACK_FAILED");
  const body = requireRecord(response.body, "TRUSTED_REF_READBACK_INVALID");
  const object = requireRecord(body.object, "TRUSTED_REF_READBACK_INVALID");
  if (body.ref !== ref || object.type !== "tag" || object.sha !== tagObjectSha) {
    deny("TRUSTED_REF_READBACK_MISMATCH");
  }
}

function validateTagReadback(
  response: GitHubApiResponse,
  tagObjectSha: string,
  tagName: string,
  message: string,
  ledgerCommitSha: string,
): void {
  if (response.status !== 200) deny("TRUSTED_TAG_OBJECT_READBACK_FAILED");
  const body = requireRecord(response.body, "TRUSTED_TAG_OBJECT_READBACK_INVALID");
  const object = requireRecord(body.object, "TRUSTED_TAG_OBJECT_READBACK_INVALID");
  if (body.sha !== tagObjectSha ||
      body.tag !== tagName ||
      body.message !== message ||
      object.sha !== ledgerCommitSha ||
      object.type !== "commit") {
    deny("TRUSTED_TAG_OBJECT_READBACK_MISMATCH");
  }
}

export type SoloOwnerTagReservationResult = {
  status: "CREATE_AND_READBACK_MATCHED_UNATTESTED";
  tagRef: string;
  tagObjectSha: string;
  receipt: SanitizedSoloOwnerReceipt;
  rulesetMetadataMatched: true;
  writerScopeDescriptorMatched: true;
  atomicityProven: false;
  replayProof: false;
  liveRulesetBehaviorVerified: false;
  runtimeEnableAllowed: false;
};

/**
 * Offline prototype only. It needs an injected transport and does not load
 * credentials, make network requests, run in a workflow, or authorize secrets.
 */
export async function reserveSoloOwnerTicketInTagLedger(
  policy: SoloOwnerTagLedgerPolicy,
  claim: SoloOwnerTagLedgerClaim,
  transport: SoloOwnerTagLedgerTransport,
): Promise<SoloOwnerTagReservationResult> {
  validatePolicy(policy);
  validateClaim(claim, policy);

  const digest = soloOwnerTicketDigest(claim.ticket);
  const ref = soloOwnerTicketRef(digest);
  const tagName = ref.slice("refs/tags/".length);
  const receipt: SanitizedSoloOwnerReceipt = {
    version: SOLO_OWNER_LEDGER_RECEIPT_VERSION,
    ticketDigest: digest,
    repository: claim.repository,
    repositoryId: claim.repositoryId,
    ownerId: claim.ownerId,
    actor: claim.actor,
    actorId: claim.actorId,
    triggeringActor: claim.triggeringActor,
    eventName: claim.eventName,
    workflowRef: claim.workflowRef,
    ref: claim.ref,
    runId: claim.runId,
    runAttempt: claim.runAttempt,
    candidateSha: claim.candidateSha,
    launcherSha: claim.launcherSha,
    issuedAtUtc: claim.issuedAtUtc,
    expiresAtUtc: claim.expiresAtUtc,
    consumedAtUtc: claim.nowUtc,
  };
  const message = JSON.stringify(receipt);

  let scopeBefore: WriterScopeReadback;
  try {
    scopeBefore = await transport.inspectWriterScope();
  } catch {
    deny("LEDGER_WRITER_SCOPE_UNAVAILABLE");
  }
  const scopeFingerprintBefore = verifyWriterScope(policy, scopeBefore);

  let rulesBefore: RulesetReadback;
  try {
    rulesBefore = await transport.listRulesets(policy.ledgerRepository);
  } catch {
    deny("LEDGER_RULESET_UNAVAILABLE");
  }
  const rulesFingerprintBefore = verifyRuleset(policy, rulesBefore);

  let ledgerCommitResponse: GitHubApiResponse;
  try {
    ledgerCommitResponse = await transport.getCommit(policy.ledgerRepository, policy.ledgerCommitSha);
  } catch {
    deny("LEDGER_TARGET_COMMIT_UNAVAILABLE");
  }
  validateLedgerCommitLookup(ledgerCommitResponse, policy.ledgerCommitSha);

  let tagObjectResponse: GitHubApiResponse;
  try {
    tagObjectResponse = await transport.createAnnotatedTagObject({
      repository: policy.ledgerRepository,
      tag: tagName,
      message,
      object: policy.ledgerCommitSha,
      type: "commit",
    });
  } catch {
    deny("TAG_OBJECT_CREATE_INDETERMINATE");
  }
  if (tagObjectResponse.status === 401 || tagObjectResponse.status === 403) {
    deny("LEDGER_WRITER_UNAUTHORIZED");
  }
  if (tagObjectResponse.status !== 201) {
    if (isAmbiguousWriteStatus(tagObjectResponse.status)) {
      deny("TAG_OBJECT_CREATE_INDETERMINATE");
    }
    deny("TAG_OBJECT_CREATE_REJECTED");
  }
  const tagObjectBody = requireRecord(tagObjectResponse.body, "TAG_OBJECT_RESPONSE_INVALID");
  const tagObjectSha = typeof tagObjectBody.sha === "string" ? tagObjectBody.sha : "";
  validateTagObject(tagObjectResponse, tagObjectSha, tagName, message, policy.ledgerCommitSha);

  let refCreateResponse: GitHubApiResponse;
  try {
    refCreateResponse = await transport.createReference({
      repository: policy.ledgerRepository,
      ref,
      sha: tagObjectSha,
    });
  } catch {
    // The server may have created the ref before the connection was lost.
    // Do not retry. No success is reported for an ambiguous outcome.
    deny("REF_CREATE_INDETERMINATE");
  }
  validateReferenceResponse(refCreateResponse, ref, tagObjectSha);

  let refReadback: GitHubApiResponse;
  try {
    refReadback = await transport.getReference(policy.ledgerRepository, ref);
  } catch {
    deny("TRUSTED_REF_READBACK_FAILED");
  }
  validateReferenceReadback(refReadback, ref, tagObjectSha);

  let tagReadback: GitHubApiResponse;
  try {
    tagReadback = await transport.getTagObject(policy.ledgerRepository, tagObjectSha);
  } catch {
    deny("TRUSTED_TAG_OBJECT_READBACK_FAILED");
  }
  validateTagReadback(tagReadback, tagObjectSha, tagName, message, policy.ledgerCommitSha);

  let scopeAfter: WriterScopeReadback;
  try {
    scopeAfter = await transport.inspectWriterScope();
  } catch {
    deny("LEDGER_WRITER_SCOPE_CHANGED");
  }
  let scopeFingerprintAfter: string;
  try {
    scopeFingerprintAfter = verifyWriterScope(policy, scopeAfter);
  } catch {
    deny("LEDGER_WRITER_SCOPE_CHANGED");
  }
  if (scopeFingerprintAfter !== scopeFingerprintBefore) {
    deny("LEDGER_WRITER_SCOPE_CHANGED");
  }

  let rulesAfter: RulesetReadback;
  try {
    rulesAfter = await transport.listRulesets(policy.ledgerRepository);
  } catch {
    deny("LEDGER_TAG_RULESET_CHANGED_AFTER_RESERVATION");
  }
  let rulesFingerprintAfter: string;
  try {
    rulesFingerprintAfter = verifyRuleset(policy, rulesAfter);
  } catch {
    deny("LEDGER_TAG_RULESET_CHANGED_AFTER_RESERVATION");
  }
  if (rulesFingerprintAfter !== rulesFingerprintBefore) {
    deny("LEDGER_TAG_RULESET_CHANGED_AFTER_RESERVATION");
  }

  return {
    status: "CREATE_AND_READBACK_MATCHED_UNATTESTED",
    tagRef: ref,
    tagObjectSha,
    receipt,
    rulesetMetadataMatched: true,
    writerScopeDescriptorMatched: true,
    atomicityProven: false,
    replayProof: false,
    liveRulesetBehaviorVerified: false,
    runtimeEnableAllowed: false,
  };
}
