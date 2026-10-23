import { describe, expect, it, vi } from "vitest";
import {
  prepareSoloOwnerTagLedgerViewerCapture,
  type SoloOwnerTagLedgerViewerDependencies,
} from "../../scripts/lib/solo-owner-tag-ledger-viewer-capture";
import {
  SOLO_OWNER_LEDGER_BOOTSTRAP_COMMIT_SHA,
  SOLO_OWNER_LEDGER_REPOSITORY,
  SOLO_OWNER_LEDGER_REPOSITORY_ID,
  SOLO_OWNER_LEDGER_RULESET_ID,
  SOLO_OWNER_LEDGER_RULESET_NAME,
  SOLO_OWNER_LEDGER_TAG_RULE_PATTERN,
  type AnnotatedTagObjectInput,
  type GitReferenceInput,
  type RulesetReadback,
  type SoloOwnerTagLedgerClaim,
  type SoloOwnerTagLedgerPolicy,
  type SoloOwnerTagLedgerTransport,
  type WriterScopeReadback,
} from "../../scripts/lib/solo-owner-tag-ledger";
import { type NeonViewerReadOnlyTransport } from "../../scripts/lib/solo-owner-neon-viewer-get";

const sourceSha = "a".repeat(40);
const launcherSha = "b".repeat(40);
const ownerTicket = "c".repeat(32);
const viewerToken = "SYNTHETIC_VIEWER_TOKEN_NEVER_USE_ANYWHERE";
const policy: SoloOwnerTagLedgerPolicy = {
  applicationRepository: "Satsetx4/karturt",
  applicationRepositoryId: "1386907262",
  ownerId: "304263836",
  ledgerRepository: SOLO_OWNER_LEDGER_REPOSITORY,
  ledgerRepositoryId: SOLO_OWNER_LEDGER_REPOSITORY_ID,
  ledgerCommitSha: SOLO_OWNER_LEDGER_BOOTSTRAP_COMMIT_SHA,
  rulesetId: SOLO_OWNER_LEDGER_RULESET_ID,
  rulesetName: SOLO_OWNER_LEDGER_RULESET_NAME,
};
const claim = (): SoloOwnerTagLedgerClaim => ({
  repository: "Satsetx4/karturt",
  repositoryId: "1386907262",
  ownerId: "304263836",
  eventName: "workflow_dispatch",
  ref: "refs/heads/main",
  refProtected: true,
  workflowRef: "Satsetx4/karturt/.github/workflows/staging-readiness-capture.yml@refs/heads/main",
  actor: "Satsetx4",
  actorId: "304263836",
  triggeringActor: "Satsetx4",
  runAttempt: 1,
  runId: "39773388950",
  eventSha: sourceSha,
  workflowSha: launcherSha,
  candidateSha: sourceSha,
  launcherSha,
  approvedCandidateSha: sourceSha,
  approvedLauncherSha: launcherSha,
  ticket: ownerTicket,
  approvedTicket: ownerTicket,
  issuedAtUtc: "2026-10-22T04:30:00Z",
  expiresAtUtc: "2026-10-22T04:45:00Z",
  nowUtc: "2026-10-22T04:35:00Z",
});

function makeDependencies(failure: "scope" | "ruleset" | "commit" | null = null) {
  const order: string[] = [];
  const refs = new Map<string, string>();
  const objects = new Map<string, AnnotatedTagObjectInput>();
  const tagObjectSha = "d".repeat(40);
  const ruleset: Record<string, unknown> = {
    id: SOLO_OWNER_LEDGER_RULESET_ID,
    name: SOLO_OWNER_LEDGER_RULESET_NAME,
    source_type: "Repository",
    source: SOLO_OWNER_LEDGER_REPOSITORY,
    target: "tag",
    enforcement: "active",
    conditions: { ref_name: { include: [SOLO_OWNER_LEDGER_TAG_RULE_PATTERN], exclude: [] } },
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "update" }],
    bypass_actors: [],
  };
  const scope: WriterScopeReadback = {
    status: 200,
    source: "github-app-installation-token-issuance",
    repositorySelection: "selected",
    complete: true,
    repositories: [{ id: SOLO_OWNER_LEDGER_REPOSITORY_ID, full_name: SOLO_OWNER_LEDGER_REPOSITORY }],
    permissions: { contents: "write", metadata: "read" },
  };
  const tagLedgerTransport: SoloOwnerTagLedgerTransport = {
    inspectWriterScope: async () => {
      order.push("scope");
      return failure === "scope" ? { ...scope, repositories: [] } : scope;
    },
    listRulesets: async () => {
      order.push("ruleset");
      const readback: RulesetReadback = {
        status: 200,
        complete: true,
        rulesets: failure === "ruleset" ? [] : [ruleset],
      };
      return readback;
    },
    getCommit: async (_repository, sha) => {
      order.push("commit");
      return failure === "commit" ? { status: 404, body: {} } : { status: 200, body: { sha } };
    },
    createAnnotatedTagObject: async (input) => {
      order.push("tag-create");
      objects.set(tagObjectSha, input);
      return {
        status: 201,
        body: { sha: tagObjectSha, tag: input.tag, message: input.message, object: { sha: input.object, type: input.type } },
      };
    },
    createReference: async (input: GitReferenceInput) => {
      order.push("ref-create");
      if (refs.has(input.ref)) return { status: 422, body: {} };
      refs.set(input.ref, input.sha);
      return { status: 201, body: { ref: input.ref, object: { sha: input.sha, type: "tag" } } };
    },
    getReference: async (_repository, ref) => {
      order.push("ref-read");
      const sha = refs.get(ref);
      return sha ? { status: 200, body: { ref, object: { sha, type: "tag" } } } : { status: 404, body: {} };
    },
    getTagObject: async (_repository, sha) => {
      order.push("tag-read");
      const input = objects.get(sha);
      return input
        ? { status: 200, body: { sha, tag: input.tag, message: input.message, object: { sha: input.object, type: input.type } } }
        : { status: 404, body: {} };
    },
  };
  const loadViewerTokenAfterReservation = vi.fn(async () => {
    order.push("secret");
    return viewerToken;
  });
  const readNeonProject = vi.fn<NeonViewerReadOnlyTransport>(async request => {
    order.push("neon-get");
    expect(request.method).toBe("GET");
    expect(request.redirect).toBe("error");
    expect(request.headers.Authorization).toBe("Bearer " + viewerToken);
    return {
      status: 200,
      body: {
        project: {
          id: "super-band-12770762",
          org_id: "org-ancient-boat-57106549",
          name: "karturt-v1-solo-provenance-20261022",
          region_id: "aws-ap-southeast-1",
          pg_version: 18,
          owner: { subscription_type: "free_v3" },
          effective_project_permission: "VIEWER",
        },
      },
    };
  });
  const dependencies: SoloOwnerTagLedgerViewerDependencies = {
    tagLedgerTransport,
    loadViewerTokenAfterReservation,
    readNeonProject,
  };
  return { order, refs, dependencies, loadViewerTokenAfterReservation, readNeonProject };
}

describe("tag-ledger Viewer capture composition — offline only", () => {
  it("finishes all tag, scope, and ruleset readbacks before Viewer access; stays unattested", async () => {
    const fake = makeDependencies();
    const result = await prepareSoloOwnerTagLedgerViewerCapture(policy, claim(), fake.dependencies);

    expect(fake.order).toEqual([
      "scope", "ruleset", "commit", "tag-create", "ref-create", "ref-read", "tag-read", "scope", "ruleset",
      "secret", "neon-get",
    ]);
    expect(result).toMatchObject({
      status: "TAG_RESERVATION_AND_VIEWER_METADATA_MATCHED_UNATTESTED",
      sourceSha,
      launcherSha,
      targetProjectId: "super-band-12770762",
      effectivePermission: "VIEWER",
      freeSubscriptionType: "free_v3",
      ownerApprovalConsumed: true,
      tokenLogged: false,
      providerAuthenticated: false,
      providerAttested: false,
      readyForStagingReadiness: false,
      allowedToConnectDatabase: false,
      allowedToMigrate: false,
      allowedToDeploy: false,
    });
    expect(JSON.stringify(result)).not.toContain(viewerToken);
    expect(JSON.stringify(result)).not.toContain(ownerTicket);
    expect(fake.refs.size).toBe(1);
  });

  it.each([
    ["writer scope", "scope", "LEDGER_WRITER_SCOPE_UNVERIFIED", ["scope"]],
    ["tag ruleset", "ruleset", "LEDGER_TAG_RULESET_ID_MISSING_OR_AMBIGUOUS", ["scope", "ruleset"]],
    ["bootstrap commit", "commit", "LEDGER_TARGET_COMMIT_UNAVAILABLE", ["scope", "ruleset", "commit"]],
  ] as Array<[string, "scope" | "ruleset" | "commit", string, string[]]>) (
    "never accesses Viewer credentials or Neon when %s reservation checks fail",
    async (_label, failure, code, expectedOrder) => {
      const fake = makeDependencies(failure);
      await expect(prepareSoloOwnerTagLedgerViewerCapture(policy, claim(), fake.dependencies))
        .rejects.toMatchObject({ code });
      expect(fake.order).toEqual(expectedOrder);
      expect(fake.loadViewerTokenAfterReservation).not.toHaveBeenCalled();
      expect(fake.readNeonProject).not.toHaveBeenCalled();
    },
  );

  it("does not ask for the token again after the single-use tag ref is already present", async () => {
    const fake = makeDependencies();
    await prepareSoloOwnerTagLedgerViewerCapture(policy, claim(), fake.dependencies);
    fake.order.length = 0;
    fake.loadViewerTokenAfterReservation.mockClear();
    fake.readNeonProject.mockClear();

    await expect(prepareSoloOwnerTagLedgerViewerCapture(policy, claim(), fake.dependencies))
      .rejects.toMatchObject({ code: "TICKET_ALREADY_CONSUMED_OR_REF_CONFLICT" });
    expect(fake.order).toEqual(["scope", "ruleset", "commit", "tag-create", "ref-create"]);
    expect(fake.loadViewerTokenAfterReservation).not.toHaveBeenCalled();
    expect(fake.readNeonProject).not.toHaveBeenCalled();
  });

  it("sanitizes Viewer token loader errors after consuming the one-time reservation", async () => {
    const fake = makeDependencies();
    const syntheticProviderError = "synthetic-provider-error-must-not-escape";
    fake.loadViewerTokenAfterReservation.mockImplementationOnce(async () => {
      fake.order.push("secret");
      throw new Error(syntheticProviderError);
    });

    let error: unknown;
    try {
      await prepareSoloOwnerTagLedgerViewerCapture(policy, claim(), fake.dependencies);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "VIEWER_SECRET_UNAVAILABLE_AFTER_TAG_RESERVATION" });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(syntheticProviderError);
    expect(fake.loadViewerTokenAfterReservation).toHaveBeenCalledTimes(1);
    expect(fake.readNeonProject).not.toHaveBeenCalled();
    expect(fake.refs.size).toBe(1);
    expect(fake.order).toEqual([
      "scope", "ruleset", "commit", "tag-create", "ref-create", "ref-read", "tag-read", "scope", "ruleset", "secret",
    ]);
  });
});
