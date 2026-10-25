import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const runnerTarget = "flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_staging";
export const migrationOperation = "official-migrations-0000-0013";

const owner = "Satsetx4";
const repository = "Satsetx4/karturt";
const expectedCandidatePullRequest = 93;
const requiredJobs = [
  "Gate A local verification",
  "Launch Safety independent PostgreSQL concurrency",
];

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export function parseDispatchRequest(context) {
  if (context.event !== "workflow_dispatch" || context.ref !== "refs/heads/main") {
    throw new Error("R2 staging dispatch is allowed only from workflow_dispatch on protected main.");
  }
  if (context.actor !== owner || context.repository !== repository) {
    throw new Error("R2 staging dispatch is restricted to the repository owner on this repository.");
  }

  const candidateSha = requiredString(context.candidateSha, "candidate_sha");
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    throw new Error("candidate_sha must be a full lowercase commit SHA.");
  }

  const operation = requiredString(context.operation, "operation");
  if (operation !== "preflight" && operation !== "migrate") {
    throw new Error("operation must be preflight or migrate.");
  }

  const ownerGoCommentId = context.ownerGoCommentId?.trim() ?? "";
  if (operation === "migrate" && !/^\d+$/.test(ownerGoCommentId)) {
    throw new Error("migrate requires the issue #98 owner GO comment ID.");
  }

  return { candidateSha, operation, ownerGoCommentId };
}

function assertOwnerGoComment(comment, request) {
  if (comment.user?.login !== owner) throw new Error("The referenced R2 GO comment is not authored by the repository owner.");
  const requiredLines = [
    "R2_RUNNER_GO: GO",
    `SHA: ${request.candidateSha}`,
    `TARGET: ${runnerTarget}`,
    `OPERATION: ${migrationOperation}`,
  ];
  const actualLines = new Set(String(comment.body ?? "").split(/\r?\n/).map((line) => line.trim()));
  if (requiredLines.some((line) => !actualLines.has(line))) {
    throw new Error("The referenced R2 GO comment must bind GO, SHA, canonical target, and migration operation exactly.");
  }
}

export async function authorizeR2StagingDispatch({ context, fetchImpl = fetch }) {
  const request = parseDispatchRequest(context);
  const token = requiredString(context.token, "GITHUB_TOKEN");
  const apiBase = requiredString(context.apiBase, "GITHUB_API_URL").replace(/\/$/, "");

  async function readJson(path) {
    const response = await fetchImpl(`${apiBase}/repos/${repository}/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub authorization readback failed (HTTP ${response.status}).`);
    return response.json();
  }

  const pullRequests = await readJson(`commits/${request.candidateSha}/pulls?per_page=100`);
  const candidatePr = pullRequests.find((pr) =>
    pr.number === expectedCandidatePullRequest &&
    pr.state === "closed" &&
    Boolean(pr.merged_at) &&
    pr.base?.ref === "main" &&
    pr.base?.repo?.full_name === repository &&
    pr.head?.sha === request.candidateSha &&
    pr.head?.repo?.full_name === repository
  );
  if (!candidatePr) {
    throw new Error("candidate_sha must be the merged head of PR #93 into main.");
  }

  const tracker = await readJson("issues/98");
  if (tracker.state !== "open") {
    throw new Error("Master tracker issue #98 must remain open for R2 staging dispatch.");
  }

  const workflowRuns = await readJson(
    `actions/workflows/gate-a.yml/runs?head_sha=${request.candidateSha}&per_page=100`,
  );
  const exactRuns = (workflowRuns.workflow_runs ?? [])
    .filter((run) =>
      run.head_sha === request.candidateSha &&
      run.head_branch === candidatePr.head.ref &&
      run.event === "pull_request" &&
      (run.pull_requests ?? []).some((pullRequest) => pullRequest.number === expectedCandidatePullRequest)
    )
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
  const ciRun = exactRuns[0];
  if (!ciRun || ciRun.status !== "completed" || ciRun.conclusion !== "success") {
    throw new Error("The latest PR #93 Gate A run for candidate_sha must be completed and successful.");
  }
  if (!Number.isSafeInteger(ciRun.id) || !Number.isSafeInteger(ciRun.run_attempt) || ciRun.run_attempt < 1) {
    throw new Error("The exact-head Gate A run is missing a valid run ID or attempt.");
  }

  const jobsResponse = await readJson(
    `actions/runs/${ciRun.id}/attempts/${ciRun.run_attempt}/jobs?per_page=100`,
  );
  const jobs = new Map((jobsResponse.jobs ?? []).map((job) => [job.name, job]));
  if (requiredJobs.some((name) => {
    const job = jobs.get(name);
    return !job || job.status !== "completed" || job.conclusion !== "success";
  })) {
    throw new Error("Gate A and independent disposable PostgreSQL concurrency must both pass on candidate_sha.");
  }

  let authorizationRef = "";
  if (request.operation === "migrate") {
    const comment = await readJson(`issues/comments/${request.ownerGoCommentId}`);
    if (comment.issue_url !== `${apiBase}/repos/${repository}/issues/98`) {
      throw new Error("The referenced owner GO comment must belong to issue #98.");
    }
    assertOwnerGoComment(comment, request);
    authorizationRef = `#98/${request.ownerGoCommentId}`;
  }

  return {
    candidateSha: request.candidateSha,
    operation: request.operation,
    ciRunId: String(ciRun.id),
    ciAttempt: String(ciRun.run_attempt),
    authorizationRef,
    target: runnerTarget,
  };
}

async function main() {
  const context = {
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    actor: process.env.GITHUB_ACTOR,
    repository: process.env.GITHUB_REPOSITORY,
    candidateSha: process.env.R2_CANDIDATE_SHA,
    operation: process.env.R2_OPERATION,
    ownerGoCommentId: process.env.R2_OWNER_GO_COMMENT_ID,
    token: process.env.GITHUB_TOKEN,
    apiBase: process.env.GITHUB_API_URL,
  };
  const result = await authorizeR2StagingDispatch({ context });
  const outputPath = requiredString(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT");
  await appendFile(outputPath, [
    `candidate_sha=${result.candidateSha}`,
    `operation=${result.operation}`,
    `ci_run_id=${result.ciRunId}`,
    `ci_attempt=${result.ciAttempt}`,
    `authorization_ref=${result.authorizationRef}`,
    `target=${result.target}`,
  ].join("\n") + "\n");
  process.stdout.write("R2 staging dispatch authorization passed; no database secrets were read.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R2 staging dispatch authorization failed."}\n`);
    process.exitCode = 1;
  });
}
