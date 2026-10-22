import { describe, expect, it } from "vitest";
import {
  reserveSoloOwnerTicketInTagLedger,
  SOLO_OWNER_LEDGER_TAG_RULE_PATTERN,
  type AnnotatedTagObjectInput,
  type GitHubApiResponse,
  type GitReferenceInput,
  type RulesetReadback,
  type SoloOwnerTagLedgerClaim,
  type SoloOwnerTagLedgerPolicy,
  type SoloOwnerTagLedgerTransport,
  type WriterScopeReadback,
} from "../../scripts/lib/solo-owner-tag-ledger";

const ledgerRepository = "Satsetx4/karturt-solo-owner-ledger";
const policy: SoloOwnerTagLedgerPolicy = {
  applicationRepository: "Satsetx4/karturt",
  applicationRepositoryId: "1386907262",
  ownerId: "304263836",
  ledgerRepository,
  ledgerRepositoryId: 900000001,
  rulesetId: 900000002,
  rulesetName: "Protect Solo Owner Used Ticket Tags",
};

const claim = (overrides: Partial<SoloOwnerTagLedgerClaim> = {}): SoloOwnerTagLedgerClaim => ({
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
  eventSha: "a".repeat(40),
  workflowSha: "b".repeat(40),
  candidateSha: "a".repeat(40),
  launcherSha: "b".repeat(40),
  approvedCandidateSha: "a".repeat(40),
  approvedLauncherSha: "b".repeat(40),
  ticket: "c".repeat(32),
  approvedTicket: "c".repeat(32),
  issuedAtUtc: "2026-10-22T04:30:00Z",
  expiresAtUtc: "2026-10-22T04:45:00Z",
  nowUtc: "2026-10-22T04:35:00Z",
  ...overrides,
});

function writerScope(): WriterScopeReadback {
  return {
    status: 200,
    source: "github-app-installation-token-issuance",
    repositorySelection: "selected",
    complete: true,
    repositories: [{ id: policy.ledgerRepositoryId, full_name: ledgerRepository }],
    permissions: { contents: "write", metadata: "read" },
  };
}

function tagRuleset(): Record<string, unknown> {
  return {
    id: policy.rulesetId,
    name: policy.rulesetName,
    source_type: "Repository",
    source: ledgerRepository,
    target: "tag",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: [SOLO_OWNER_LEDGER_TAG_RULE_PATTERN],
        exclude: [],
      },
    },
    rules: [{ type: "update" }, { type: "deletion" }],
    bypass_actors: [],
  };
}

function createFakeTransport() {
  const calls: string[] = [];
  const objects = new Map<string, AnnotatedTagObjectInput>();
  const refs = new Map<string, string>();
  let nextObject = 0;
  let rulesetRead = 0;
  let scopeRead = 0;
  let rulesetFactory: (read: number) => RulesetReadback = () => ({
    status: 200,
    complete: true,
    rulesets: [tagRuleset()],
  });
  let scopeFactory: (read: number) => WriterScopeReadback = () => writerScope();

  const transport: SoloOwnerTagLedgerTransport = {
    inspectWriterScope: async () => {
      calls.push("scope");
      scopeRead += 1;
      return scopeFactory(scopeRead);
    },
    listRulesets: async () => {
      calls.push("ruleset");
      rulesetRead += 1;
      return rulesetFactory(rulesetRead);
    },
    createAnnotatedTagObject: async (input) => {
      calls.push("tag-create");
      nextObject += 1;
      const sha = nextObject.toString(16).padStart(40, "0");
      objects.set(sha, input);
      return {
        status: 201,
        body: {
          sha,
          tag: input.tag,
          message: input.message,
          object: { sha: input.object, type: input.type },
        },
      };
    },
    createReference: async (input) => {
      calls.push("ref-create");
      if (refs.has(input.ref)) return { status: 422, body: { message: "collision" } };
      refs.set(input.ref, input.sha);
      return {
        status: 201,
        body: { ref: input.ref, object: { sha: input.sha, type: "tag" } },
      };
    },
    getReference: async (ref) => {
      calls.push("ref-read");
      const sha = refs.get(ref);
      return sha
        ? { status: 200, body: { ref, object: { sha, type: "tag" } } }
        : { status: 404, body: {} };
    },
    getTagObject: async (sha) => {
      calls.push("tag-read");
      const input = objects.get(sha);
      return input
        ? {
            status: 200,
            body: {
              sha,
              tag: input.tag,
              message: input.message,
              object: { sha: input.object, type: input.type },
            },
          }
        : { status: 404, body: {} };
    },
  };

  return {
    transport,
    calls,
    objects,
    refs,
    setRulesetFactory(factory: (read: number) => RulesetReadback) { rulesetFactory = factory; },
    setScopeFactory(factory: (read: number) => WriterScopeReadback) { scopeFactory = factory; },
  };
}

async function denied(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: "SoloOwnerTagLedgerDenied",
    code,
  });
}

describe("Solo Owner separate tag-ledger protocol (offline injected transport)", () => {
  it("creates an annotated object, exact candidate ref, trusted readback, and remains explicitly untrusted", async () => {
    const fake = createFakeTransport();
    const result = await reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport);

    expect(result.status).toBe("CREATE_AND_READBACK_MATCHED_UNATTESTED");
    expect(result.atomicityProven).toBe(false);
    expect(result.replayProof).toBe(false);
    expect(result.liveRulesetBehaviorVerified).toBe(false);
    expect(result.runtimeEnableAllowed).toBe(false);
    expect(fake.calls).toEqual([
      "scope", "ruleset", "tag-create", "ref-create", "ref-read", "tag-read", "scope", "ruleset",
    ]);
    expect(result.tagRef).toMatch(/^refs\/tags\/karturt-solo\/used\/v1\/[a-f0-9]{64}$/);
    expect(fake.refs.get(result.tagRef)).toBe(result.tagObjectSha);
    expect(result.receipt.ticketDigest).toHaveLength(64);
    expect(JSON.stringify(result.receipt)).not.toContain(claim().ticket);
    const storedMessage = [...fake.objects.values()][0]?.message ?? "";
    expect(storedMessage).not.toContain(claim().ticket);
    expect(storedMessage).toContain(result.receipt.ticketDigest);
  });

  it("rejects sequential duplicate use even when run ID and source SHA change", async () => {
    const fake = createFakeTransport();
    await reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport);
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim({
      runId: "39773388951",
      eventSha: "d".repeat(40),
      candidateSha: "d".repeat(40),
      approvedCandidateSha: "d".repeat(40),
    }), fake.transport), "TICKET_ALREADY_CONSUMED_OR_REF_CONFLICT");
    expect(fake.refs.size).toBe(1);
  });

  it("mock concurrent create-ref arbitration has one winner, without claiming live atomicity", async () => {
    const fake = createFakeTransport();
    const outcomes = await Promise.allSettled([
      reserveSoloOwnerTicketInTagLedger(policy, claim({ runId: "39773388952" }), fake.transport),
      reserveSoloOwnerTicketInTagLedger(policy, claim({ runId: "39773388953" }), fake.transport),
    ]);
    const winners = outcomes.filter((entry) => entry.status === "fulfilled");
    const losers = outcomes.filter((entry) => entry.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({
      status: "rejected",
      reason: { code: "TICKET_ALREADY_CONSUMED_OR_REF_CONFLICT" },
    });
    expect(fake.refs.size).toBe(1);
    // This is only an in-memory fake; it is not evidence of GitHub atomicity.
  });

  it.each([
    ["forged repository owner", { repository: "attacker/karturt" }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["forged repository ID", { repositoryId: "1" }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["forged owner ID", { ownerId: "1" }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["forged actor", { actor: "attacker" }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["forged actor ID", { actorId: "1" }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["forged triggering actor", { triggeringActor: "attacker" }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["wrong event", { eventName: "push" }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["wrong ref", { ref: "refs/heads/feature" }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["unprotected ref", { refProtected: false }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["wrong workflow ref", { workflowRef: "attacker.yml" }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["rerun", { runAttempt: 2 }, "OWNER_OR_DISPATCH_CONTEXT_INVALID"],
    ["source SHA detached from event", { candidateSha: "d".repeat(40) }, "SOURCE_OR_LAUNCHER_BINDING_INVALID"],
    ["forged event SHA", { eventSha: "d".repeat(40) }, "SOURCE_OR_LAUNCHER_BINDING_INVALID"],
    ["source SHA detached from approval", { approvedCandidateSha: "d".repeat(40) }, "SOURCE_OR_LAUNCHER_BINDING_INVALID"],
    ["launcher SHA detached from workflow", { launcherSha: "d".repeat(40) }, "SOURCE_OR_LAUNCHER_BINDING_INVALID"],
    ["forged workflow SHA", { workflowSha: "d".repeat(40) }, "SOURCE_OR_LAUNCHER_BINDING_INVALID"],
    ["launcher SHA detached from approval", { approvedLauncherSha: "d".repeat(40) }, "SOURCE_OR_LAUNCHER_BINDING_INVALID"],
    ["ticket mismatch", { approvedTicket: "d".repeat(32) }, "OWNER_TICKET_BINDING_INVALID"],
    ["expired approval", { nowUtc: "2026-10-22T04:45:00Z" }, "OWNER_APPROVAL_WINDOW_INVALID"],
    ["future approval", { issuedAtUtc: "2026-10-22T04:36:00Z" }, "OWNER_APPROVAL_WINDOW_INVALID"],
    ["approval window too long", { expiresAtUtc: "2026-10-22T04:46:00Z" }, "OWNER_APPROVAL_WINDOW_INVALID"],
    ["invalid UTC value", { nowUtc: "2026-10-22T04:35:00+00:00" }, "OWNER_APPROVAL_WINDOW_INVALID"],
  ] as Array<[string, Partial<SoloOwnerTagLedgerClaim>, string]>)(
    "denies %s before any transport call",
    async (_label, changes, code) => {
      const fake = createFakeTransport();
      await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(changes), fake.transport), code);
      expect(fake.calls).toEqual([]);
    },
  );

  it("rejects a ledger that is not separate from the application repository", async () => {
    const fake = createFakeTransport();
    await denied(reserveSoloOwnerTicketInTagLedger({
      ...policy,
      ledgerRepository: "Satsetx4/karturt",
    }, claim(), fake.transport), "SEPARATE_LEDGER_POLICY_INVALID");
    expect(fake.calls).toEqual([]);
  });

  it("fails closed when token scope is broad, unknown, or unauthorized", async () => {
    const broad = createFakeTransport();
    broad.setScopeFactory(() => ({
      ...writerScope(),
      repositories: [
        { id: policy.ledgerRepositoryId, full_name: ledgerRepository },
        { id: 1386907262, full_name: "Satsetx4/karturt" },
      ],
    }));
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), broad.transport), "LEDGER_WRITER_SCOPE_UNVERIFIED");
    expect(broad.calls).toEqual(["scope"]);

    const unauthorized = createFakeTransport();
    unauthorized.setScopeFactory(() => ({
      ...writerScope(),
      status: 403,
    }));
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), unauthorized.transport), "LEDGER_WRITER_UNAUTHORIZED");
    expect(unauthorized.calls).toEqual(["scope"]);
  });

  it("rejects any writer permission beyond ledger Contents write and metadata read", async () => {
    const fake = createFakeTransport();
    fake.setScopeFactory(() => ({
      ...writerScope(),
      permissions: { contents: "write", metadata: "read", issues: "write" },
    }));
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "LEDGER_WRITER_PERMISSION_TOO_BROAD_OR_UNKNOWN");
    expect(fake.calls).toEqual(["scope"]);
  });

  it.each([
    ["branch-target ruleset", (rule: Record<string, unknown>) => ({ ...rule, target: "branch" })],
    ["inactive ruleset", (rule: Record<string, unknown>) => ({ ...rule, enforcement: "disabled" })],
    ["wrong include pattern", (rule: Record<string, unknown>) => ({
      ...rule,
      conditions: { ref_name: { include: ["refs/tags/*"], exclude: [] } },
    })],
    ["excluded target", (rule: Record<string, unknown>) => ({
      ...rule,
      conditions: { ref_name: { include: [SOLO_OWNER_LEDGER_TAG_RULE_PATTERN], exclude: ["refs/tags/karturt-solo/*"] } },
    })],
    ["missing update protection", (rule: Record<string, unknown>) => ({
      ...rule,
      rules: [{ type: "deletion" }],
    })],
    ["missing deletion protection", (rule: Record<string, unknown>) => ({
      ...rule,
      rules: [{ type: "update" }],
    })],
    ["creation restriction blocks intended writer", (rule: Record<string, unknown>) => ({
      ...rule,
      rules: [{ type: "creation" }, { type: "deletion" }, { type: "update" }],
    })],
    ["bypass actor", (rule: Record<string, unknown>) => ({
      ...rule,
      bypass_actors: [{ actor_id: 1, actor_type: "User", bypass_mode: "always" }],
    })],
    ["missing bypass metadata", (rule: Record<string, unknown>) => {
      const { bypass_actors: _ignored, ...rest } = rule;
      return rest;
    }],
    ["wrong source repository", (rule: Record<string, unknown>) => ({ ...rule, source: "Satsetx4/karturt" })],
  ] as Array<[string, (rule: Record<string, unknown>) => Record<string, unknown>]>)(
    "rejects %s",
    async (_label, alter) => {
      const fake = createFakeTransport();
      fake.setRulesetFactory(() => ({
        status: 200,
        complete: true,
        rulesets: [alter(tagRuleset())],
      }));
      await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "LEDGER_TAG_RULESET_REQUIREMENTS_UNMET");
      expect(fake.calls).toEqual(["scope", "ruleset"]);
    },
  );

  it("requires a complete ruleset read and rejects an outage", async () => {
    const incomplete = createFakeTransport();
    incomplete.setRulesetFactory(() => ({
      status: 200,
      complete: false,
      rulesets: [tagRuleset()],
    }));
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), incomplete.transport), "LEDGER_RULESET_UNVERIFIED");
    expect(incomplete.calls).toEqual(["scope", "ruleset"]);

    const outage = createFakeTransport();
    outage.setRulesetFactory(() => {
      throw new Error("synthetic outage");
    });
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), outage.transport), "LEDGER_RULESET_UNAVAILABLE");
    expect(outage.calls).toEqual(["scope", "ruleset"]);
  });

  it("rejects malformed or forged annotated-tag objects before creating a ref", async () => {
    const fake = createFakeTransport();
    fake.transport.createAnnotatedTagObject = async () => ({
      status: 201,
      body: {
        sha: "not-a-sha",
        tag: "forged",
        message: "{}",
        object: { sha: "f".repeat(40), type: "commit" },
      },
    });
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "TAG_OBJECT_RESPONSE_MISMATCH");
    expect(fake.calls).toEqual(["scope", "ruleset", "tag-create"]);
    expect(fake.refs.size).toBe(0);
  });

  it("stops on duplicate ref responses without retrying or reading a guessed winner", async () => {
    for (const status of [409, 422]) {
      const fake = createFakeTransport();
      fake.transport.createReference = async (_input: GitReferenceInput) => {
        fake.calls.push("ref-create");
        return { status, body: {} };
      };
      await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "TICKET_ALREADY_CONSUMED_OR_REF_CONFLICT");
      expect(fake.calls).toEqual(["scope", "ruleset", "tag-create", "ref-create"]);
      expect(fake.objects.size).toBe(1); // An unreferenced object may remain.
    }
  });

  it("maps an unauthorized ref writer to a hard stop", async () => {
    const fake = createFakeTransport();
    fake.transport.createReference = async () => {
      fake.calls.push("ref-create");
      return { status: 403, body: {} };
    };
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "LEDGER_WRITER_UNAUTHORIZED");
    expect(fake.calls).toEqual(["scope", "ruleset", "tag-create", "ref-create"]);
  });

  it("treats a lost or ambiguous create-ref response as indeterminate and never retries", async () => {
    const fake = createFakeTransport();
    fake.transport.createReference = async () => {
      fake.calls.push("ref-create");
      throw new Error("synthetic connection loss after request send");
    };
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "REF_CREATE_INDETERMINATE");
    expect(fake.calls).toEqual(["scope", "ruleset", "tag-create", "ref-create"]);
    expect(fake.refs.size).toBe(0);
  });

  it("does not accept a non-201 create-ref status as success", async () => {
    const fake = createFakeTransport();
    fake.transport.createReference = async () => {
      fake.calls.push("ref-create");
      return { status: 202, body: {} };
    };
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "REF_CREATE_REJECTED");
    expect(fake.calls).toEqual(["scope", "ruleset", "tag-create", "ref-create"]);
  });

  it("fails closed when the created ref readback points to a different object", async () => {
    const fake = createFakeTransport();
    fake.transport.createReference = async (input: GitReferenceInput) => {
      fake.calls.push("ref-create");
      fake.refs.set(input.ref, "f".repeat(40));
      return { status: 201, body: { ref: input.ref, object: { sha: input.sha, type: "tag" } } };
    };
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "TRUSTED_REF_READBACK_MISMATCH");
    expect(fake.refs.size).toBe(1);
  });

  it("fails closed when readback is forged or incomplete", async () => {
    const fake = createFakeTransport();
    fake.transport.getTagObject = async () => {
      fake.calls.push("tag-read");
      return { status: 200, body: { sha: "f".repeat(40), tag: "forged", message: "{}", object: { sha: "f".repeat(40), type: "commit" } } };
    };
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "TRUSTED_TAG_OBJECT_READBACK_MISMATCH");
  });

  it("fails closed if ruleset metadata changes after the ref has been created", async () => {
    const fake = createFakeTransport();
    fake.setRulesetFactory((read) => ({
      status: 200,
      complete: true,
      rulesets: [read === 1 ? tagRuleset() : {
        ...tagRuleset(),
        rules: [{ type: "deletion" }],
      }],
    }));
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "LEDGER_TAG_RULESET_CHANGED_AFTER_RESERVATION");
    expect(fake.refs.size).toBe(1); // A fail-closed denial can still consume a ticket.
    expect(fake.calls.slice(-2)).toEqual(["scope", "ruleset"]);
  });

  it("fails closed if writer scope changes after the ref has been created", async () => {
    const fake = createFakeTransport();
    fake.setScopeFactory((read) => read === 1 ? writerScope() : {
      ...writerScope(),
      repositories: [...writerScope().repositories, { id: 1386907262, full_name: "Satsetx4/karturt" }],
    });
    await denied(reserveSoloOwnerTicketInTagLedger(policy, claim(), fake.transport), "LEDGER_WRITER_SCOPE_CHANGED");
    expect(fake.refs.size).toBe(1);
  });
});
