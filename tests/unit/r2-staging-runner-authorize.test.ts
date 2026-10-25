import { describe, expect, it, vi } from "vitest";
import {
  authorizeR2StagingDispatch,
  migrationOperation,
  runnerTarget,
} from "../../.github/scripts/r2-staging-runner-authorize.mjs";

const candidateSha = "a".repeat(40);
const ownerGoCommentId = "6389999999";
const apiBase = "https://api.github.com";
const branch = "codex/fast-track-v1-f1-integrated-20261024";

function context(overrides: Record<string, string> = {}) {
  return {
    event: "workflow_dispatch",
    ref: "refs/heads/main",
    actor: "Satsetx4",
    repository: "Satsetx4/karturt",
    candidateSha,
    operation: "migrate",
    ownerGoCommentId,
    apiBase,
    token: "test-token-never-a-real-secret",
    ...overrides,
  };
}

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fetchFor(overrides: {
  pullRequests?: unknown[];
  runs?: unknown[];
  jobs?: unknown[];
  comment?: Record<string, unknown>;
  trackerState?: string;
} = {}): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token-never-a-real-secret");

    if (url.pathname.endsWith(`/commits/${candidateSha}/pulls`)) {
      return response(overrides.pullRequests ?? [{
        number: 93,
        state: "closed",
        merged_at: "2026-10-25T00:00:00Z",
        base: { ref: "main", repo: { full_name: "Satsetx4/karturt" } },
        head: { ref: branch, sha: candidateSha, repo: { full_name: "Satsetx4/karturt" } },
      }]);
    }
    if (url.pathname.endsWith("/issues/98")) {
      return response({ state: overrides.trackerState ?? "open" });
    }
    if (url.pathname.endsWith("/actions/workflows/gate-a.yml/runs")) {
      return response({ workflow_runs: overrides.runs ?? [{
        id: 40129357313,
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
        created_at: "2026-10-25T00:00:00Z",
        head_sha: candidateSha,
        head_branch: branch,
        event: "pull_request",
        pull_requests: [{ number: 93 }],
      }] });
    }
    if (url.pathname.endsWith("/actions/runs/40129357313/attempts/1/jobs")) {
      return response({ jobs: overrides.jobs ?? [
        { name: "Gate A local verification", status: "completed", conclusion: "success" },
        { name: "Launch Safety independent PostgreSQL concurrency", status: "completed", conclusion: "success" },
      ] });
    }
    if (url.pathname.endsWith(`/issues/comments/${ownerGoCommentId}`)) {
      return response(overrides.comment ?? {
        issue_url: `${apiBase}/repos/Satsetx4/karturt/issues/98`,
        user: { login: "Satsetx4" },
        body: [
          "R2_RUNNER_GO: GO",
          `SHA: ${candidateSha}`,
          `TARGET: ${runnerTarget}`,
          `OPERATION: ${migrationOperation}`,
        ].join("\n"),
      });
    }
    return response({}, 404);
  }) as unknown as typeof fetch;
}

describe("R2 staging runner authorization", () => {
  it("binds migrate to main dispatch, merged PR #93, exact-head CI, and exact owner GO", async () => {
    const fetchImpl = fetchFor();
    const result = await authorizeR2StagingDispatch({ context: context(), fetchImpl });
    expect(result).toEqual({
      candidateSha,
      operation: "migrate",
      ciRunId: "40129357313",
      ciAttempt: "1",
      authorizationRef: `#98/${ownerGoCommentId}`,
      target: runnerTarget,
    });
    expect(JSON.stringify(result)).not.toContain("test-token-never-a-real-secret");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("allows read-only preflight without an owner GO comment", async () => {
    const fetchImpl = fetchFor();
    const result = await authorizeR2StagingDispatch({
      context: context({ operation: "preflight", ownerGoCommentId: "" }),
      fetchImpl,
    });
    expect(result.authorizationRef).toBe("");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    [{ ref: "refs/heads/codex/untrusted" }, "protected main"],
    [{ actor: "someone-else" }, "repository owner"],
    [{ candidateSha: "../secrets" }, "full lowercase commit SHA"],
    [{ operation: "fixture" }, "preflight or migrate"],
    [{ ownerGoCommentId: "" }, "issue #98 owner GO comment ID"],
  ])("rejects unsafe dispatch inputs %#", async (overrides, message) => {
    await expect(authorizeR2StagingDispatch({ context: context(overrides) })).rejects.toThrow(message);
  });

  it("rejects unmerged or wrong candidate PRs before looking up CI", async () => {
    const fetchImpl = fetchFor({ pullRequests: [{
      number: 93,
      state: "open",
      merged_at: null,
      base: { ref: "main", repo: { full_name: "Satsetx4/karturt" } },
      head: { ref: branch, sha: candidateSha, repo: { full_name: "Satsetx4/karturt" } },
    }] });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl })).rejects.toThrow(
      "merged head of PR #93",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops when master tracker #98 is closed", async () => {
    const fetchImpl = fetchFor({ trackerState: "closed" });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight", ownerGoCommentId: "" }),
      fetchImpl,
    })).rejects.toThrow("Master tracker issue #98 must remain open");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a failed disposable concurrency job even if the run conclusion is success", async () => {
    const fetchImpl = fetchFor({ jobs: [
      { name: "Gate A local verification", status: "completed", conclusion: "success" },
      { name: "Launch Safety independent PostgreSQL concurrency", status: "completed", conclusion: "skipped" },
    ] });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl })).rejects.toThrow(
      "independent disposable PostgreSQL concurrency must both pass",
    );
  });

  it.each([
    [{ user: { login: "another-user" }, issue_url: `${apiBase}/repos/Satsetx4/karturt/issues/98`, body: "" }, "not authored by the repository owner"],
    [{ user: { login: "Satsetx4" }, issue_url: `${apiBase}/repos/Satsetx4/karturt/issues/93`, body: "" }, "belong to issue #98"],
    [{ user: { login: "Satsetx4" }, issue_url: `${apiBase}/repos/Satsetx4/karturt/issues/98`, body: "R2_RUNNER_GO: GO" }, "bind GO, SHA, canonical target"],
  ])("rejects stale or non-owner GO comment evidence %#", async (comment, message) => {
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl: fetchFor({ comment }) }))
      .rejects.toThrow(message);
  });
});
