import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeAuthorizedStagingOperation } from "../../.github/scripts/r2-staging-runner-execute.mjs";
import {
  authorizeR2StagingDispatch,
  fixtureOperation,
  migrationOperation,
  preflightOperation,
  runnerEnvironment,
  runnerTarget,
} from "../../.github/scripts/r2-staging-runner-authorize.mjs";

const candidateSha = "a".repeat(40);
const ownerGoCommentId = "6389999999";
const currentRunId = "9000000001";
const dispatchSha = "c".repeat(40);
const mergeCommitSha = "d".repeat(40);
const candidateTreeSha = "b".repeat(40);
const preflightEvidenceCommentId = "6389999996";
const migrationEvidenceCommentId = "6389999998";
const isolationEvidenceCommentId = "6389999997";
const preflightRunnerRunId = "9000000101";
const migrationRunnerRunId = "9000000102";
const preflightRunnerGoCommentId = "6389999901";
const migrationRunnerGoCommentId = "6389999902";
const gateARunId = "40147824801";
const gateAAttempt = "1";
const disposableRecoveryJobName = "R2 disposable PostgreSQL 18 recovery";
const disposableRecoveryStepName = "Rebuild and verify synthetic state on PostgreSQL 18";
const disposableRecoveryTarget = "postgresql-18-disposable";
const disposableRecoveryOperation = "rebuild-reseed-official-migrations-0000-0013";
const apiBase = "https://api.github.com";
const branch = "codex/r2-disposable-recovery-r2b-20261025";
const issueUrl = `${apiBase}/repos/Satsetx4/karturt/issues/98`;

function context(overrides: Record<string, string> = {}) {
  return {
    event: "workflow_dispatch",
    ref: "refs/heads/main",
    actor: "Satsetx4",
    repository: "Satsetx4/karturt",
    candidateSha,
    dispatchSha,
    operation: "migrate",
    ownerGoCommentId,
    currentRunId,
    currentRunAttempt: "1",
    apiBase,
    token: "test-token-never-a-real-secret",
    ...overrides,
  };
}

function authorizedExecutionEnv(operation: string): NodeJS.ProcessEnv {
  return {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR: "Satsetx4",
    GITHUB_REPOSITORY: "Satsetx4/karturt",
    GITHUB_API_URL: apiBase,
    GITHUB_TOKEN: "test-token-never-a-real-secret",
    GITHUB_RUN_ID: currentRunId,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKSPACE: "/runner/work/karturt/karturt",
    R2_CANDIDATE_SHA: candidateSha,
    R2_DISPATCH_SHA: dispatchSha,
    R2_OPERATION: operation,
    R2_OWNER_GO_COMMENT_ID: ownerGoCommentId,
    APP_ENV: "staging",
    DATABASE_ENV: "staging",
    KARTURT_RELEASE_SHA: candidateSha,
    DATABASE_MIGRATION_URL: "migration-secret-value",
    DATABASE_URL: "runtime-secret-value",
    KARTURT_R2_RESIDENT_PIN: "resident-secret-value",
    KARTURT_R2_CHAIRMAN_PASSWORD: "chairman-secret-value",
    KARTURT_R2_TREASURER_PASSWORD: "treasurer-secret-value",
    KARTURT_R2_SYSTEM_ADMIN_PASSWORD: "admin-secret-value",
    KARTURT_R2_CI_HEAD_SHA: candidateSha,
    KARTURT_R2_CI_RUN_ID: "40147824801",
    KARTURT_R2_CI_ATTEMPT: "1",
    KARTURT_R2_PREFLIGHT_AUTHORIZED_SHA: candidateSha,
    KARTURT_R2_PREFLIGHT_AUTHORIZED_TARGET: runnerTarget,
    KARTURT_R2_PREFLIGHT_AUTHORIZED_OPERATION: preflightOperation,
    KARTURT_R2_PREFLIGHT_AUTHORIZATION_REF: `#98/${ownerGoCommentId}`,
    KARTURT_R2_ISOLATION_EVIDENCE_REF: `#98/${isolationEvidenceCommentId}`,
    KARTURT_R2_MIGRATION_AUTHORIZED_SHA: candidateSha,
    KARTURT_R2_MIGRATION_AUTHORIZED_TARGET: runnerTarget,
    KARTURT_R2_MIGRATION_AUTHORIZED_OPERATION: migrationOperation,
    KARTURT_R2_MIGRATION_PREFLIGHT_EVIDENCE_REF: `#98/${preflightEvidenceCommentId}`,
    KARTURT_R2_MIGRATION_ISOLATION_EVIDENCE_REF: `#98/${isolationEvidenceCommentId}`,
    KARTURT_R2_MIGRATION_AUTHORIZATION_REF: `#98/${ownerGoCommentId}`,
    KARTURT_R2_FIXTURE_AUTHORIZED_SHA: candidateSha,
    KARTURT_R2_FIXTURE_AUTHORIZED_TARGET: runnerTarget,
    KARTURT_R2_FIXTURE_AUTHORIZED_OPERATION: fixtureOperation,
    KARTURT_R2_MIGRATION_PASS_SHA: candidateSha,
    KARTURT_R2_FIXTURE_AUTHORIZATION_REF: `#98/${ownerGoCommentId}`,
    KARTURT_R2_MIGRATION_EVIDENCE_REF: `#98/${migrationEvidenceCommentId}`,
    EXTRA_SECRET: "must-not-be-forwarded",
    PATH: "/usr/bin",
    HOME: "/runner/home",
    CI: "true",
    NODE_ENV: "test",
  };
}

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function issueComment(id: string, body: string, user = "Satsetx4") {
  const createdAt = new Date(Date.parse("2026-10-25T00:00:00Z") + Number(id) - 6389999900).toISOString();
  return { id: Number(id), issue_url: issueUrl, user: { login: user }, body, created_at: createdAt, updated_at: createdAt };
}

function goBody(operation: string, extraLines: string[] = []) {
  const evidenceLines = operation === "preflight" || operation === preflightOperation
    ? [`ISOLATION_EVIDENCE_COMMENT: #98/${isolationEvidenceCommentId}`]
    : operation === "migrate" || operation === migrationOperation
      ? [
        `PREFLIGHT_EVIDENCE_COMMENT: #98/${preflightEvidenceCommentId}`,
        `ISOLATION_EVIDENCE_COMMENT: #98/${isolationEvidenceCommentId}`,
      ]
      : [
        `MIGRATION_EVIDENCE_COMMENT: #98/${migrationEvidenceCommentId}`,
        `ISOLATION_EVIDENCE_COMMENT: #98/${isolationEvidenceCommentId}`,
      ];
  return [
    "R2_RUNNER_GO: GO",
    `SHA: ${candidateSha}`,
    `TARGET: ${runnerTarget}`,
    `OPERATION: ${operation}`,
    ...evidenceLines,
    ...extraLines,
  ].join("\n");
}

function recoveryEvidenceBody(overrides: {
  sha?: string;
  target?: string;
  recoveryResult?: string;
  recoveryTarget?: string;
  recoveryOperation?: string;
  recoveryRun?: string;
  neonRestore?: string;
  productionRecovery?: string;
  extraLines?: string[];
} = {}) {
  return [
    "R2_ISOLATION_RESULT: PASS",
    `SHA: ${overrides.sha ?? candidateSha}`,
    `TARGET: ${overrides.target ?? runnerTarget}`,
    "SYNTHETIC_ONLY: PASS",
    overrides.recoveryResult ?? "STAGING_DISPOSABLE_RECOVERY: PASS",
    `RECOVERY_TARGET: ${overrides.recoveryTarget ?? disposableRecoveryTarget}`,
    `RECOVERY_OPERATION: ${overrides.recoveryOperation ?? disposableRecoveryOperation}`,
    `RECOVERY_RUN: ${overrides.recoveryRun ?? `${gateARunId}/${gateAAttempt}`}`,
    overrides.neonRestore ?? "NEON_INSTANT_RESTORE: NOT_RUN",
    overrides.productionRecovery ?? "PRODUCTION_RECOVERY: NOT_PROVEN",
    ...(overrides.extraLines ?? []),
  ].join("\n");
}

function disposableRecoveryJob(overrides: {
  status?: string;
  conclusion?: string;
  stepName?: string;
  stepStatus?: string;
  stepConclusion?: string;
  steps?: unknown[];
} = {}) {
  return {
    name: disposableRecoveryJobName,
    status: overrides.status ?? "completed",
    conclusion: overrides.conclusion ?? "success",
    steps: overrides.steps ?? [{
      name: overrides.stepName ?? disposableRecoveryStepName,
      status: overrides.stepStatus ?? "completed",
      conclusion: overrides.stepConclusion ?? "success",
    }],
  };
}

function gateJobs(recoveryJob: Record<string, unknown> | null = disposableRecoveryJob()) {
  return [
    { name: "Gate A local verification", status: "completed", conclusion: "success" },
    { name: "Launch Safety independent PostgreSQL concurrency", status: "completed", conclusion: "success" },
    ...(recoveryJob ? [recoveryJob] : []),
  ];
}

function stagingOperationRun(runId: string, operation: string, goCommentId: string) {
  const stepName = operation === "preflight"
    ? "Verify both PostgreSQL roles with authenticated TLS"
    : operation === "migrate"
      ? "Apply only the frozen migration chain as the migrator role"
      : "Create the approved synthetic fixture through the runtime role";
  return {
    run: {
      id: Number(runId),
      path: ".github/workflows/r2-staging-runner.yml@main",
      name: "KartuRT R2 staging runner",
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: dispatchSha,
      actor: { login: "Satsetx4" },
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
      display_title: `R2 ${operation} | ${candidateSha} | GO comment ${goCommentId}`,
    },
    jobs: [{
      name: "Protected staging operation",
      status: "completed",
      conclusion: "success",
      steps: [{ name: stepName, status: "completed", conclusion: "success" }],
    }],
  };
}

function fetchFor(overrides: {
  pullRequests?: unknown[];
  pullRequestPages?: Record<number, unknown[]>;
  runs?: unknown[];
  jobs?: unknown[];
  comment?: Record<string, unknown>;
  comments?: unknown[];
  evidenceComments?: Record<string, Record<string, unknown>>;
  trackerState?: string;
  environment?: Record<string, unknown>;
  branchPolicies?: unknown[];
  stagingRuns?: unknown[];
  runnerRuns?: Record<string, Record<string, unknown>>;
  runnerJobs?: Record<string, unknown>;
  gateJobsByRun?: Record<string, unknown[]>;
  mergeComparison?: Record<string, unknown>;
  candidateMergeComparison?: Record<string, unknown>;
  candidateTree?: string;
  mergeTree?: string;
} = {}): typeof fetch {
  const defaultGoComment = overrides.comment ?? issueComment(ownerGoCommentId, goBody(migrationOperation));
  const defaultRunnerRuns: Record<string, Record<string, unknown>> = {
    [preflightRunnerRunId]: stagingOperationRun(preflightRunnerRunId, "preflight", preflightRunnerGoCommentId).run,
    [migrationRunnerRunId]: stagingOperationRun(migrationRunnerRunId, "migrate", migrationRunnerGoCommentId).run,
  };
  const defaultRunnerJobs: Record<string, unknown> = {
    [preflightRunnerRunId]: stagingOperationRun(preflightRunnerRunId, "preflight", preflightRunnerGoCommentId).jobs,
    [migrationRunnerRunId]: stagingOperationRun(migrationRunnerRunId, "migrate", migrationRunnerGoCommentId).jobs,
  };
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token-never-a-real-secret");
    expect(url.pathname).not.toContain("/secrets");

    if (url.pathname.endsWith("/pulls")) {
      expect(url.searchParams.get("state")).toBe("all");
      expect(url.searchParams.get("sort")).toBe("created");
      expect(url.searchParams.get("direction")).toBe("asc");
      expect(url.searchParams.get("per_page")).toBe("100");
      const page = Number(url.searchParams.get("page"));
      const allPullRequests = overrides.pullRequests ?? [{
        number: 101,
        state: "closed",
        merged_at: "2026-10-25T00:00:00Z",
        base: { ref: "main", repo: { full_name: "Satsetx4/karturt" } },
        head: { ref: branch, sha: candidateSha, repo: { full_name: "Satsetx4/karturt" } },
        merge_commit_sha: mergeCommitSha,
      }];
      const pagePullRequests = overrides.pullRequestPages
        ? overrides.pullRequestPages[page] ?? []
        : allPullRequests.slice((page - 1) * 100, page * 100);
      return response(pagePullRequests);
    }
    if (url.pathname.endsWith(`/commits/${candidateSha}`)) {
      return response({ commit: { tree: { sha: overrides.candidateTree ?? candidateTreeSha } } });
    }
    if (url.pathname.endsWith(`/commits/${mergeCommitSha}`)) {
      return response({ commit: { tree: { sha: overrides.mergeTree ?? candidateTreeSha } } });
    }
    if (url.pathname.endsWith(`/compare/${candidateSha}...${mergeCommitSha}`)) {
      return response(overrides.candidateMergeComparison ?? {
        status: "identical",
        base_commit: { sha: candidateSha },
        merge_base_commit: { sha: candidateSha },
      });
    }
    if (url.pathname.endsWith(`/compare/${mergeCommitSha}...${dispatchSha}`)) {
      return response(overrides.mergeComparison ?? {
        status: "ahead",
        base_commit: { sha: mergeCommitSha },
        merge_base_commit: { sha: mergeCommitSha },
      });
    }
    if (url.pathname.endsWith("/issues/98/comments")) {
      return response(overrides.comments ?? [defaultGoComment]);
    }
    if (url.pathname.endsWith("/actions/workflows/r2-staging-runner.yml/runs")) {
      return response({ workflow_runs: overrides.stagingRuns ?? [] });
    }
    const runnerJobMatch = url.pathname.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/);
    if (runnerJobMatch && [preflightRunnerRunId, migrationRunnerRunId].includes(runnerJobMatch[1])) {
      return response({ jobs: overrides.runnerJobs?.[runnerJobMatch[1]] ?? defaultRunnerJobs[runnerJobMatch[1]] ?? [] });
    }
    const runnerMatch = url.pathname.match(/\/actions\/runs\/(\d+)$/);
    if (runnerMatch) {
      const run = overrides.runnerRuns?.[runnerMatch[1]] ?? defaultRunnerRuns[runnerMatch[1]];
      return response(run ?? {}, run ? 200 : 404);
    }
    if (url.pathname.endsWith("/issues/98")) {
      return response({ state: overrides.trackerState ?? "open" });
    }
    if (url.pathname.endsWith("/actions/workflows/gate-a.yml/runs")) {
      return response({ workflow_runs: overrides.runs ?? [{
        id: Number(gateARunId),
        run_attempt: Number(gateAAttempt),
        status: "completed",
        conclusion: "success",
        created_at: "2026-10-25T00:00:00Z",
        head_sha: candidateSha,
        head_branch: branch,
        event: "pull_request",
        pull_requests: [{ number: 101 }],
      }] });
    }
    const gateJobMatch = url.pathname.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/);
    if (gateJobMatch && (gateJobMatch[1] === gateARunId || overrides.gateJobsByRun?.[gateJobMatch[1]])) {
      return response({ jobs: overrides.gateJobsByRun?.[gateJobMatch[1]] ?? overrides.jobs ?? gateJobs() });
    }
    if (url.pathname.endsWith(`/environments/${runnerEnvironment}/deployment-branch-policies`)) {
      return response({ branch_policies: overrides.branchPolicies ?? [{ name: "main" }] });
    }
    if (url.pathname.endsWith(`/environments/${runnerEnvironment}`)) {
      return response(overrides.environment ?? {
        name: runnerEnvironment,
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        protection_rules: [{
          type: "required_reviewers",
          prevent_self_review: false,
          reviewers: [{ type: "User", reviewer: { login: "Satsetx4" } }],
        }],
      });
    }
    if (url.pathname.endsWith(`/issues/comments/${ownerGoCommentId}`)) {
      return response(defaultGoComment);
    }
    if (url.pathname.endsWith(`/issues/comments/${migrationEvidenceCommentId}`)) {
      return response(overrides.evidenceComments?.[migrationEvidenceCommentId] ?? issueComment(
        migrationEvidenceCommentId,
        [
          "R2_MIGRATION_RESULT: PASS",
          `SHA: ${candidateSha}`,
          `TARGET: ${runnerTarget}`,
          "EVIDENCE_OPERATION: migrate",
          `RUN: ${migrationRunnerRunId}/1`,
          "MIGRATION_JOURNAL: 0000-0013",
          "MIGRATOR_NOLOGIN: PASS",
          "RUNTIME_DML_ONLY: PASS",
        ].join("\n"),
      ));
    }
    if (url.pathname.endsWith(`/issues/comments/${preflightEvidenceCommentId}`)) {
      return response(overrides.evidenceComments?.[preflightEvidenceCommentId] ?? issueComment(
        preflightEvidenceCommentId,
        [
          "R2_PREFLIGHT_RESULT: PASS",
          `SHA: ${candidateSha}`,
          `TARGET: ${runnerTarget}`,
          "EVIDENCE_OPERATION: preflight",
          `RUN: ${preflightRunnerRunId}/1`,
          "POSTGRES_MAJOR: 18",
          "MIGRATOR_ROLE: PASS",
          "MIGRATOR_TLS: PASS",
          "RUNTIME_ROLE: PASS",
          "RUNTIME_TLS: PASS",
          "EMPTY_CATALOG: PASS",
          "FREE_PLAN: PASS",
        ].join("\n"),
      ));
    }
    if (url.pathname.endsWith(`/issues/comments/${isolationEvidenceCommentId}`)) {
      return response(overrides.evidenceComments?.[isolationEvidenceCommentId] ?? issueComment(
        isolationEvidenceCommentId,
        recoveryEvidenceBody(),
      ));
    }
    return response({}, 404);
  }) as unknown as typeof fetch;
}

describe("R2 staging runner authorization", () => {
  it("installs candidate dependencies without running package lifecycle scripts", () => {
    const workflow = readFileSync(new URL("../../.github/workflows/r2-staging-runner.yml", import.meta.url), "utf8");
    const installCommands = workflow.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^run:\s*npm ci(?:\s|$)/.test(line));
    expect(installCommands).toEqual(["run: npm ci --ignore-scripts"]);
    expect(workflow).toMatch(/name: Check out the exact authorized candidate[\s\S]*?path: candidate/);
    expect(workflow).toMatch(/name: Check out trusted authorization policy after candidate setup[\s\S]*?path: \.r2-policy/);
    expect(workflow).toMatch(/name: Install reviewed candidate dependencies without database credentials\s+working-directory: candidate\s+run: npm ci --ignore-scripts/);
  });

  it("binds migrate to main dispatch, merged PR #101, exact-head CI, PG18 disposable recovery, protected environment, and exact owner GO", async () => {
    const fetchImpl = fetchFor();
    const result = await authorizeR2StagingDispatch({ context: context(), fetchImpl });
    expect(result).toEqual({
      candidateSha,
      operation: "migrate",
      ciRunId: gateARunId,
      ciAttempt: gateAAttempt,
      authorizationRef: `#98/${ownerGoCommentId}`,
      preflightEvidenceRef: `#98/${preflightEvidenceCommentId}`,
      migrationEvidenceRef: "",
      isolationEvidenceRef: `#98/${isolationEvidenceCommentId}`,
      target: runnerTarget,
    });
    expect(JSON.stringify(result)).not.toContain("test-token-never-a-real-secret");
    expect(fetchImpl).toHaveBeenCalledTimes(17);
  });

  it.each([
    ["omitted", undefined],
    ["empty", []],
  ] as const)("accepts exact-head Gate A CI with %s pull request links for the unique merged PR #101 association", async (_linkState, pullRequestLinks) => {
    const gateRun = {
      id: Number(gateARunId),
      run_attempt: Number(gateAAttempt),
      status: "completed",
      conclusion: "success",
      created_at: "2026-10-25T00:00:00Z",
      head_sha: candidateSha,
      head_branch: branch,
      event: "pull_request",
    } as Record<string, unknown>;
    if (pullRequestLinks !== undefined) gateRun.pull_requests = pullRequestLinks;
    const result = await authorizeR2StagingDispatch({
      context: context(),
      fetchImpl: fetchFor({
        runs: [gateRun],
      }),
    });

    expect(result.ciRunId).toBe(gateARunId);
    expect(result.ciAttempt).toBe(gateAAttempt);
  });

  it.each([
    ["different base", { base: { ref: "release", repo: { full_name: "Satsetx4/karturt" } } }],
    ["fork head repository", { head: { ref: branch, sha: candidateSha, repo: { full_name: "another-owner/karturt" } } }],
  ] as const)("rejects omitted Gate A PR links when another PR shares the candidate SHA and branch via a %s", async (_associationType, associationOverride) => {
    const matchingAssociation = {
      state: "closed",
      merged_at: "2026-10-25T00:00:00Z",
      base: { ref: "main", repo: { full_name: "Satsetx4/karturt" } },
      head: { ref: branch, sha: candidateSha, repo: { full_name: "Satsetx4/karturt" } },
      merge_commit_sha: mergeCommitSha,
    };
    const fetchImpl = fetchFor({
      pullRequests: [
        { number: 101, ...matchingAssociation },
        { number: 102, ...matchingAssociation, ...associationOverride },
      ],
      runs: [{
        id: Number(gateARunId),
        run_attempt: Number(gateAAttempt),
        status: "completed",
        conclusion: "success",
        created_at: "2026-10-25T00:00:00Z",
        head_sha: candidateSha,
        head_branch: branch,
        event: "pull_request",
      }],
    });

    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("unique authoritative association with merged PR #101");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("paginates the repository pull request list before accepting a unique PR #101 association", async () => {
    const matchingAssociation = {
      state: "closed",
      merged_at: "2026-10-25T00:00:00Z",
      base: { ref: "main", repo: { full_name: "Satsetx4/karturt" } },
      head: { ref: branch, sha: candidateSha, repo: { full_name: "Satsetx4/karturt" } },
      merge_commit_sha: mergeCommitSha,
    };
    const unrelatedPullRequests = Array.from({ length: 99 }, (_, index) => ({
      number: 200 + index,
      base: { ref: "main", repo: { full_name: "Satsetx4/karturt" } },
      head: { ref: `unrelated-${index}`, sha: "e".repeat(40), repo: { full_name: "Satsetx4/karturt" } },
    }));
    const fetchImpl = fetchFor({
      pullRequests: [
        { number: 101, ...matchingAssociation },
        ...unrelatedPullRequests,
        { number: 500, head: { ref: "unrelated-final", sha: "f".repeat(40), repo: { full_name: "Satsetx4/karturt" } } },
      ],
      runs: [{
        id: Number(gateARunId),
        run_attempt: Number(gateAAttempt),
        status: "completed",
        conclusion: "success",
        created_at: "2026-10-25T00:00:00Z",
        head_sha: candidateSha,
        head_branch: branch,
        event: "pull_request",
      }],
    });

    const result = await authorizeR2StagingDispatch({ context: context(), fetchImpl });

    expect(result.ciRunId).toBe(gateARunId);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/pulls?state=all&sort=created&direction=asc&per_page=100&page=2"),
      expect.anything(),
    );
  });

  it("rejects an ambiguous candidate PR association found on a later repository page", async () => {
    const matchingAssociation = {
      state: "closed",
      merged_at: "2026-10-25T00:00:00Z",
      base: { ref: "main", repo: { full_name: "Satsetx4/karturt" } },
      head: { ref: branch, sha: candidateSha, repo: { full_name: "Satsetx4/karturt" } },
      merge_commit_sha: mergeCommitSha,
    };
    const unrelatedPullRequests = Array.from({ length: 99 }, (_, index) => ({
      number: 200 + index,
      base: { ref: "main", repo: { full_name: "Satsetx4/karturt" } },
      head: { ref: `unrelated-${index}`, sha: "e".repeat(40), repo: { full_name: "Satsetx4/karturt" } },
    }));
    const fetchImpl = fetchFor({
      pullRequests: [
        { number: 101, ...matchingAssociation },
        ...unrelatedPullRequests,
        {
          number: 500,
          ...matchingAssociation,
          base: { ref: "release", repo: { full_name: "Satsetx4/karturt" } },
        },
      ],
    });

    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("unique authoritative association with merged PR #101");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/pulls?state=all&sort=created&direction=asc&per_page=100&page=2"),
      expect.anything(),
    );
  });

  it("fails closed when repository pull request pagination reaches page 99 without a short page", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }));
    const pullRequestPages: Record<number, unknown[]> = {};
    for (let page = 1; page < 100; page += 1) pullRequestPages[page] = fullPage;
    const fetchImpl = fetchFor({ pullRequestPages });

    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("pagination did not reach a short page before page 100");
    expect(fetchImpl).toHaveBeenCalledTimes(99);
  });

  it("rejects candidate Gate A runs whose non-empty PR link list excludes PR #101", async () => {
    const linkedRun = {
      id: Number(gateARunId),
      run_attempt: Number(gateAAttempt),
      status: "completed",
      conclusion: "success",
      created_at: "2026-10-25T00:00:00Z",
      head_sha: candidateSha,
      head_branch: branch,
      event: "pull_request",
      pull_requests: [{ number: 102 }],
    };
    const correctlyLinkedRun = {
      ...linkedRun,
      id: Number(gateARunId) + 1,
      created_at: "2026-10-24T23:59:00Z",
      pull_requests: [{ number: 101 }],
    };
    const fetchImpl = fetchFor({ runs: [correctlyLinkedRun, linkedRun] });

    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("Every non-empty candidate Gate A pull request link list must include PR #101");
  });

  it.each([
    ["preflight", preflightOperation, "DATABASE_MIGRATION_URL", "DATABASE_URL", ""],
    ["migrate", migrationOperation, "DATABASE_MIGRATION_URL", "", ""],
    [fixtureOperation, fixtureOperation, "", "DATABASE_URL", "KARTURT_R2_RESIDENT_PIN"],
  ])("rechecks %s immediately before spawning with only that operation's child environment", async (operation, goOperation, migratorKey, runtimeKey, fixtureKey) => {
    const env = authorizedExecutionEnv(operation);
    const events: string[] = [];
    let capturedSpawn: { command: string; args: string[]; options: { cwd: string; env: NodeJS.ProcessEnv } } | undefined;
    const spawnMock = vi.fn((command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
      events.push("spawn");
      capturedSpawn = { command, args, options };
      return { status: 0, error: undefined, pid: 42, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), signal: null };
    });
    const spawnImpl = spawnMock as unknown as typeof import("node:child_process").spawnSync;
    const baseFetch = fetchFor({ comment: issueComment(ownerGoCommentId, goBody(goOperation)) });
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/issues/98/comments")) events.push("latest-owner-decision");
      return baseFetch(input, init);
    }) as unknown as typeof fetch;

    await expect(executeAuthorizedStagingOperation({ env, fetchImpl, spawnImpl })).resolves.toBe(0);
    expect(events.slice(-2)).toEqual(["latest-owner-decision", "spawn"]);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(capturedSpawn?.command).toBe("npm");
    expect(capturedSpawn?.args).toEqual(operation === "preflight"
      ? ["run", "db:migrate", "--", "--preflight"]
      : operation === "migrate"
        ? ["run", "db:migrate", "--", "--apply"]
        : ["run", "db:bootstrap-r2-staging", "--", "--apply"]);
    expect(capturedSpawn?.options.cwd).toBe(resolve("/runner/work/karturt/karturt", "candidate"));
    const childOptions = capturedSpawn?.options as { cwd: string; env: NodeJS.ProcessEnv };
    expect(childOptions.env.GITHUB_TOKEN).toBeUndefined();
    expect(childOptions.env.EXTRA_SECRET).toBeUndefined();
    expect(childOptions.env.DATABASE_MIGRATION_URL).toBe(migratorKey ? "migration-secret-value" : undefined);
    expect(childOptions.env.DATABASE_URL).toBe(runtimeKey ? "runtime-secret-value" : undefined);
    const fixtureSecrets = {
      KARTURT_R2_RESIDENT_PIN: "resident-secret-value",
      KARTURT_R2_CHAIRMAN_PASSWORD: "chairman-secret-value",
      KARTURT_R2_TREASURER_PASSWORD: "treasurer-secret-value",
      KARTURT_R2_SYSTEM_ADMIN_PASSWORD: "admin-secret-value",
    };
    for (const [key, value] of Object.entries(fixtureSecrets)) {
      expect(childOptions.env[key]).toBe(fixtureKey ? value : undefined);
    }
  });

  it("does not spawn a database command when the post-Environment owner decision is contradictory", async () => {
    const env: NodeJS.ProcessEnv = {
      ...authorizedExecutionEnv("migrate"),
    };
    const conflictingGo = issueComment(ownerGoCommentId, `${goBody(migrationOperation)}\nR2_RUNNER_GO: NO-GO`);
    const spawnMock = vi.fn(() => ({
      status: 0, error: undefined, pid: 42, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), signal: null,
    }));
    const spawnImpl = spawnMock as unknown as typeof import("node:child_process").spawnSync;

    await expect(executeAuthorizedStagingOperation({
      env,
      fetchImpl: fetchFor({ comment: conflictingGo }),
      spawnImpl,
    })).rejects.toThrow("exactly one GO line and no NO-GO line");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("does not spawn when a NO-GO is posted during prerequisite evidence checks", async () => {
    const env = authorizedExecutionEnv("migrate");
    const go = issueComment(ownerGoCommentId, goBody(migrationOperation));
    const noGo = issueComment("6391000000", goBody(migrationOperation).replace("R2_RUNNER_GO: GO", "R2_RUNNER_GO: NO-GO"));
    const baseFetch = fetchFor({ comment: go });
    let latestDecisionReads = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/issues/98/comments")) {
        latestDecisionReads += 1;
        if (latestDecisionReads === 2) return response([go, noGo]);
      }
      return baseFetch(input, init);
    }) as unknown as typeof fetch;
    const spawnMock = vi.fn(() => ({
      status: 0, error: undefined, pid: 42, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), signal: null,
    }));

    await expect(executeAuthorizedStagingOperation({
      env,
      fetchImpl,
      spawnImpl: spawnMock as unknown as typeof import("node:child_process").spawnSync,
    })).rejects.toThrow("missing, stale, or superseded");
    expect(latestDecisionReads).toBe(2);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("requires an operation-specific owner GO even for read-only preflight", async () => {
    const fetchImpl = fetchFor();
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight", ownerGoCommentId: "" }),
      fetchImpl,
    })).rejects.toThrow("owner GO comment ID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts read-only preflight only with its exact owner GO", async () => {
    const fetchImpl = fetchFor({ comment: issueComment(ownerGoCommentId, goBody(preflightOperation)) });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight" }),
      fetchImpl,
    })).resolves.toMatchObject({ operation: "preflight", authorizationRef: `#98/${ownerGoCommentId}` });
  });

  it("accepts the separately authorized synthetic fixture operation with verified evidence refs", async () => {
    const comment = issueComment(ownerGoCommentId, goBody(fixtureOperation));
    const fetchImpl = fetchFor({ comment });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: fixtureOperation }),
      fetchImpl,
    })).resolves.toMatchObject({
      operation: fixtureOperation,
      migrationEvidenceRef: `#98/${migrationEvidenceCommentId}`,
      isolationEvidenceRef: `#98/${isolationEvidenceCommentId}`,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(17);
  });

  it("rejects fixture GO when migration-cleanup evidence is missing or mismatched", async () => {
    const comment = issueComment(ownerGoCommentId, goBody(fixtureOperation));
    const fetchImpl = fetchFor({
      comment,
      evidenceComments: {
        [migrationEvidenceCommentId]: issueComment(migrationEvidenceCommentId, `R2_MIGRATION_RESULT: PASS\nSHA: ${"b".repeat(40)}`),
      },
    });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: fixtureOperation }),
      fetchImpl,
    })).rejects.toThrow("Migration cleanup evidence does not bind the exact SHA, target");
  });

  it.each([
    [{ ref: "refs/heads/codex/untrusted" }, "protected main"],
    [{ actor: "someone-else" }, "repository owner"],
    [{ candidateSha: "../secrets" }, "full lowercase commit SHA"],
    [{ operation: "fixture" }, "preflight, migrate, or synthetic-fixture-create"],
    [{ ownerGoCommentId: "" }, "issue #98 owner GO comment ID"],
  ])("rejects unsafe dispatch inputs %#", async (overrides, message) => {
    await expect(authorizeR2StagingDispatch({ context: context(overrides) })).rejects.toThrow(message);
  });

  it("rejects unmerged or wrong candidate PRs before looking up CI", async () => {
    const fetchImpl = fetchFor({ pullRequests: [{
      number: 101,
      state: "open",
      merged_at: null,
      base: { ref: "main", repo: { full_name: "Satsetx4/karturt" } },
      head: { ref: branch, sha: candidateSha, repo: { full_name: "Satsetx4/karturt" } },
    }] });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl })).rejects.toThrow(
      "merged head of PR #101",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("requires the merged PR result to be present in the protected-main dispatch commit", async () => {
    const fetchImpl = fetchFor({ mergeComparison: {
      status: "diverged",
      base_commit: { sha: mergeCommitSha },
      merge_base_commit: { sha: "e".repeat(40) },
    } });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("must be an ancestor of the protected-main dispatch SHA");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("requires the tested candidate source tree to match or be contained in the PR merge result", async () => {
    const fetchImpl = fetchFor({
      candidateTree: "b".repeat(40),
      mergeTree: "e".repeat(40),
      candidateMergeComparison: {
        status: "diverged",
        base_commit: { sha: candidateSha },
        merge_base_commit: { sha: "f".repeat(40) },
      },
    });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("tested candidate commit must be contained in the merged result");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("stops when master tracker #98 is closed", async () => {
    const fetchImpl = fetchFor({ trackerState: "closed" });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("Master tracker issue #98 must remain open");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
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
    [{ deployment_branch_policy: { protected_branches: true, custom_branch_policies: false }, protection_rules: [] }, [{ name: "main" }], "custom branch policy"],
    [{ name: runnerEnvironment, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }, protection_rules: [] }, [{ name: "main" }], "list the repository owner as its only required reviewer"],
    [{ name: runnerEnvironment, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }, protection_rules: [{
      type: "required_reviewers",
      prevent_self_review: true,
      reviewers: [{ type: "User", reviewer: { login: "Satsetx4" } }],
    }] }, [{ name: "main" }], "allow that owner to review each run"],
    [{ name: runnerEnvironment, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }, protection_rules: [{
      type: "required_reviewers",
      prevent_self_review: false,
      reviewers: [
        { type: "User", reviewer: { login: "Satsetx4" } },
        { type: "User", reviewer: { login: "another-reviewer" } },
      ],
    }] }, [{ name: "main" }], "list the repository owner as its only required reviewer"],
    [undefined, [{ name: "main" }, { name: "release" }], "allow deployments from main only"],
  ])("rejects unsafe or missing Environment protection %#", async (environment, branchPolicies, message) => {
    const fetchImpl = fetchFor({ environment, branchPolicies });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl })).rejects.toThrow(message);
  });

  it("rejects a later owner NO-GO for the same SHA, target, and operation", async () => {
    const go = issueComment(ownerGoCommentId, goBody(migrationOperation));
    const noGo = issueComment("6390000000", goBody(migrationOperation).replace("R2_RUNNER_GO: GO", "R2_RUNNER_GO: NO-GO"));
    const fetchImpl = fetchFor({ comments: [go, noGo] });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl })).rejects.toThrow("missing, stale, or superseded");
  });

  it("rejects an owner GO comment that was edited", async () => {
    const comment = {
      ...issueComment(ownerGoCommentId, goBody(migrationOperation)),
      updated_at: new Date(Date.parse("2026-10-25T00:00:01Z")).toISOString(),
    };
    const fetchImpl = fetchFor({ comment });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("referenced R2 GO comment must be an unedited issue comment");
  });

  it("rejects legacy FREE_RECOVERY text without the staging-specific disposable proof", async () => {
    const fetchImpl = fetchFor({
      comment: issueComment(ownerGoCommentId, goBody(preflightOperation)),
      evidenceComments: {
        [isolationEvidenceCommentId]: issueComment(isolationEvidenceCommentId, [
          "R2_ISOLATION_RESULT: PASS",
          `SHA: ${candidateSha}`,
          `TARGET: ${runnerTarget}`,
          "SYNTHETIC_ONLY: PASS",
          "FREE_RECOVERY: PASS",
        ].join("\n")),
      },
    });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight" }),
      fetchImpl,
    })).rejects.toThrow("cannot use FREE_RECOVERY evidence");
  });

  it.each([
    [recoveryEvidenceBody({ recoveryResult: "STAGING_DISPOSABLE_RECOVERY: MISSING" }), "required PASS evidence"],
    [recoveryEvidenceBody({ sha: "f".repeat(40) }), "required PASS evidence"],
    [recoveryEvidenceBody({ target: "another/neon/target" }), "required PASS evidence"],
    [recoveryEvidenceBody({ recoveryTarget: "postgresql-17-disposable" }), "required PASS evidence"],
    [recoveryEvidenceBody({ recoveryOperation: "restore-production-backup" }), "required PASS evidence"],
    [recoveryEvidenceBody({ recoveryRun: "40147824800/1" }), "required PASS evidence"],
    [recoveryEvidenceBody({ recoveryRun: `${gateARunId}/2` }), "required PASS evidence"],
  ])("rejects recovery evidence with missing or mismatched bindings %#", async (body, message) => {
    const fetchImpl = fetchFor({
      comment: issueComment(ownerGoCommentId, goBody(preflightOperation)),
      evidenceComments: { [isolationEvidenceCommentId]: issueComment(isolationEvidenceCommentId, body) },
    });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight" }),
      fetchImpl,
    })).rejects.toThrow(message);
  });

  it.each([
    "R2_ISOLATION_RESULT: FAIL",
    `SHA: ${"f".repeat(40)}`,
    "TARGET: another/neon/target",
    "SYNTHETIC_ONLY: FAIL",
    "STAGING_DISPOSABLE_RECOVERY: FAIL",
    "RECOVERY_TARGET: postgresql-17-disposable",
    "RECOVERY_OPERATION: restore-production-backup",
    "RECOVERY_RUN: 40147824800/1",
  ])("rejects contradictory duplicate recovery binding %s", async (conflictingLine) => {
    const fetchImpl = fetchFor({
      comment: issueComment(ownerGoCommentId, goBody(preflightOperation)),
      evidenceComments: {
        [isolationEvidenceCommentId]: issueComment(
          isolationEvidenceCommentId,
          `${recoveryEvidenceBody()}\n${conflictingLine}`,
        ),
      },
    });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight" }),
      fetchImpl,
    })).rejects.toThrow("must contain exactly one");
  });

  it.each([
    [recoveryEvidenceBody().replace("\nNEON_INSTANT_RESTORE: NOT_RUN", ""), "NEON_INSTANT_RESTORE: NOT_RUN"],
    [recoveryEvidenceBody({ neonRestore: "NEON_INSTANT_RESTORE: PASS" }), "NEON_INSTANT_RESTORE: NOT_RUN"],
    [recoveryEvidenceBody().replace("\nPRODUCTION_RECOVERY: NOT_PROVEN", ""), "PRODUCTION_RECOVERY: NOT_PROVEN"],
    [recoveryEvidenceBody({ productionRecovery: "PRODUCTION_RECOVERY: PASS" }), "PRODUCTION_RECOVERY: NOT_PROVEN"],
  ])("requires exact no-Neon-restore and no-production-recovery labels %#", async (body, message) => {
    const fetchImpl = fetchFor({
      comment: issueComment(ownerGoCommentId, goBody(preflightOperation)),
      evidenceComments: { [isolationEvidenceCommentId]: issueComment(isolationEvidenceCommentId, body) },
    });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight" }),
      fetchImpl,
    })).rejects.toThrow(`must state ${message} exactly`);
  });

  it("rejects recovery PASS text when the exact-head Gate A run has no recovery proof job", async () => {
    const fetchImpl = fetchFor({ jobs: gateJobs(null) });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight" }),
      fetchImpl,
    })).rejects.toThrow("PG18 disposable recovery job must also pass");
  });

  it.each([
    [disposableRecoveryJob({ conclusion: "failure" }), "PG18 disposable recovery job must also pass"],
    [disposableRecoveryJob({ conclusion: "skipped" }), "PG18 disposable recovery job must also pass"],
    [disposableRecoveryJob({ steps: [] }), "proof step must both be completed and successful"],
    [disposableRecoveryJob({ stepConclusion: "failure" }), "proof step must both be completed and successful"],
    [disposableRecoveryJob({ stepConclusion: "skipped" }), "proof step must both be completed and successful"],
  ])("rejects missing, failed, or skipped disposable recovery job/step %#", async (recoveryJob, message) => {
    const fetchImpl = fetchFor({ jobs: gateJobs(recoveryJob) });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl })).rejects.toThrow(message);
  });

  it("rejects recovery evidence linked to an earlier run when a newer exact-head PR #101 run is selected", async () => {
    const latestRunId = "40147824802";
    const latestRun = {
      id: Number(latestRunId),
      run_attempt: 2,
      status: "completed",
      conclusion: "success",
      created_at: "2026-10-25T00:00:01Z",
      head_sha: candidateSha,
      head_branch: branch,
      event: "pull_request",
      pull_requests: [{ number: 101 }],
    };
    const fetchImpl = fetchFor({
      runs: [
        {
          ...latestRun,
          id: Number(gateARunId),
          run_attempt: Number(gateAAttempt),
          created_at: "2026-10-25T00:00:00Z",
        },
        latestRun,
      ],
      gateJobsByRun: { [latestRunId]: gateJobs() },
      comment: issueComment(ownerGoCommentId, goBody(preflightOperation)),
    });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight" }),
      fetchImpl,
    })).rejects.toThrow("required PASS evidence");
  });

  it("requires prerequisite evidence to predate the owner GO and remain unedited", async () => {
    const isolation = issueComment(isolationEvidenceCommentId, recoveryEvidenceBody());
    const afterGo = new Date(Date.parse(issueComment(ownerGoCommentId, "").created_at) + 1000).toISOString();
    const fetchImpl = fetchFor({
      comment: issueComment(ownerGoCommentId, goBody(preflightOperation)),
      evidenceComments: {
        [isolationEvidenceCommentId]: { ...isolation, created_at: afterGo, updated_at: afterGo },
      },
    });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight" }),
      fetchImpl,
    })).rejects.toThrow("Isolation and recovery evidence must be created before the owner GO comment");

    const editedIsolation = {
      ...isolation,
      updated_at: new Date(Date.parse(isolation.updated_at) + 1000).toISOString(),
    };
    const editedFetch = fetchFor({
      comment: issueComment(ownerGoCommentId, goBody(preflightOperation)),
      evidenceComments: { [isolationEvidenceCommentId]: editedIsolation },
    });
    await expect(authorizeR2StagingDispatch({
      context: context({ operation: "preflight" }),
      fetchImpl: editedFetch,
    })).rejects.toThrow("Isolation and recovery evidence must be an unedited issue comment");
  });

  it("rejects reuse of an owner GO already attached to an earlier staging run", async () => {
    const priorRun = {
      id: 8999999999,
      display_title: `R2 migrate | ${candidateSha} | GO comment ${ownerGoCommentId}`,
    };
    const fetchImpl = fetchFor({ stagingRuns: [priorRun] });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("already been used");
  });

  it("rejects reruns so every retry needs a fresh owner GO", async () => {
    await expect(authorizeR2StagingDispatch({
      context: context({ currentRunAttempt: "2" }),
    })).rejects.toThrow("cannot be rerun");
  });

  it("rejects successful-looking prior evidence when its linked run used a different main policy SHA", async () => {
    const expected = stagingOperationRun(preflightRunnerRunId, "preflight", preflightRunnerGoCommentId).run;
    const fetchImpl = fetchFor({ runnerRuns: {
      [preflightRunnerRunId]: { ...expected, head_sha: "e".repeat(40) },
    } });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("completed successful main workflow_dispatch run");
  });

  it("rejects a single owner comment containing both GO and NO-GO", async () => {
    const comment = issueComment(ownerGoCommentId, `${goBody(migrationOperation)}\nR2_RUNNER_GO: NO-GO`);
    const fetchImpl = fetchFor({ comment });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("exactly one GO line and no NO-GO line");
  });

  it("rejects successful-looking prior evidence when its workflow path is not the documented main path", async () => {
    const expected = stagingOperationRun(preflightRunnerRunId, "preflight", preflightRunnerGoCommentId).run;
    const fetchImpl = fetchFor({ runnerRuns: {
      [preflightRunnerRunId]: { ...expected, path: ".github/workflows/r2-staging-runner.yml@refs/heads/main" },
    } });
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl }))
      .rejects.toThrow("completed successful main workflow_dispatch run");
  });

  it.each([
    [issueComment(ownerGoCommentId, "", "another-user"), "authored by the repository owner"],
    [{ ...issueComment(ownerGoCommentId, ""), issue_url: `${apiBase}/repos/Satsetx4/karturt/issues/93` }, "belong to issue #98"],
    [issueComment(ownerGoCommentId, "R2_RUNNER_GO: GO"), "bind GO, SHA, canonical target"],
  ])("rejects stale or non-owner GO comment evidence %#", async (comment, message) => {
    await expect(authorizeR2StagingDispatch({ context: context(), fetchImpl: fetchFor({ comment }) }))
      .rejects.toThrow(message);
  });
});
