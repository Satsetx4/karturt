import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const runnerTarget = "flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_staging";
export const runnerEnvironment = "karturt-r2-staging";
export const migrationOperation = "official-migrations-0000-0013";
export const preflightOperation = "authenticated-tls-role-preflight";
export const fixtureOperation = "synthetic-fixture-create";
export const runnerWorkflowName = "KartuRT R2 staging runner";

const owner = "Satsetx4";
const repository = "Satsetx4/karturt";
const expectedCandidatePullRequest = 105;
const pullRequestPageSize = 100;
const maxPullRequestPage = 100;
const disposableRecoveryJobName = "R2 disposable PostgreSQL 18 recovery";
const disposableRecoveryStepName = "Rebuild and verify synthetic state on PostgreSQL 18";
const disposableRecoveryTarget = "postgresql-18-disposable";
const disposableRecoveryOperation = "rebuild-reseed-official-migrations-0000-0013";
const requiredJobs = [
  "Gate A local verification",
  "Launch Safety independent PostgreSQL concurrency",
  disposableRecoveryJobName,
];

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function requiredCommentId(value, name) {
  const id = requiredString(value, name);
  if (!/^\d+$/.test(id)) throw new Error(`${name} must be a numeric issue #98 comment ID.`);
  return id;
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

  const dispatchSha = requiredString(context.dispatchSha, "workflow dispatch SHA");
  if (!/^[0-9a-f]{40}$/.test(dispatchSha)) {
    throw new Error("The workflow dispatch SHA must be a full lowercase commit SHA.");
  }

  const operation = requiredString(context.operation, "operation");
  if (!new Set(["preflight", "migrate", fixtureOperation]).has(operation)) {
    throw new Error("operation must be preflight, migrate, or synthetic-fixture-create.");
  }

  const ownerGoCommentId = requiredCommentId(context.ownerGoCommentId, "issue #98 owner GO comment ID");
  const currentRunId = requiredString(context.currentRunId, "GITHUB_RUN_ID");
  if (!/^\d+$/.test(currentRunId)) throw new Error("GITHUB_RUN_ID must be numeric.");
  if (context.currentRunAttempt !== "1") {
    throw new Error("R2 dispatch cannot be rerun; issue a fresh owner GO after reviewing the failed attempt.");
  }
  return { candidateSha, dispatchSha, operation, ownerGoCommentId, currentRunId };
}

function exactLines(body) {
  return new Set(String(body ?? "").split(/\r?\n/).map((line) => line.trim()));
}

function decisionLines(body) {
  return String(body ?? "").split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.startsWith("R2_RUNNER_GO:"));
}

function operationLabel(operation) {
  if (operation === "preflight") return preflightOperation;
  if (operation === "migrate") return migrationOperation;
  return fixtureOperation;
}

function assertOwnerGoComment(comment, request) {
  if (comment.user?.login !== owner) throw new Error("The referenced R2 GO comment is not authored by the repository owner.");
  const actualLines = exactLines(comment.body);
  const decisions = decisionLines(comment.body);
  if (decisions.length !== 1 || decisions[0] !== "R2_RUNNER_GO: GO") {
    throw new Error("The referenced owner decision must contain exactly one GO line and no NO-GO line.");
  }
  const requiredLines = [
    "R2_RUNNER_GO: GO",
    `SHA: ${request.candidateSha}`,
    `TARGET: ${runnerTarget}`,
    `OPERATION: ${operationLabel(request.operation)}`,
  ];
  if (requiredLines.some((line) => !actualLines.has(line))) {
    throw new Error("The referenced R2 GO comment must bind GO, SHA, canonical target, and selected operation exactly.");
  }
  const referencedComment = (prefix) => {
    const entries = String(comment.body ?? "").split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(`${prefix}: `));
    if (entries.length !== 1) return undefined;
    const [line] = entries;
    return line?.match(new RegExp(`^${prefix}: #98/(\\d+)$`))?.[1];
  };
  if (request.operation === "preflight") {
    const isolationEvidenceCommentId = referencedComment("ISOLATION_EVIDENCE_COMMENT");
    if (!isolationEvidenceCommentId) {
      throw new Error("Preflight GO must reference exact-target isolation and recovery evidence on issue #98.");
    }
    return { isolationEvidenceCommentId };
  }
  if (request.operation === "migrate") {
    const preflightEvidenceCommentId = referencedComment("PREFLIGHT_EVIDENCE_COMMENT");
    const isolationEvidenceCommentId = referencedComment("ISOLATION_EVIDENCE_COMMENT");
    if (!preflightEvidenceCommentId || !isolationEvidenceCommentId || preflightEvidenceCommentId === isolationEvidenceCommentId) {
      throw new Error("Migration GO must reference separate authenticated preflight and isolation evidence comments on issue #98.");
    }
    return { preflightEvidenceCommentId, isolationEvidenceCommentId };
  }

  const migrationEvidenceCommentId = referencedComment("MIGRATION_EVIDENCE_COMMENT");
  const isolationEvidenceCommentId = referencedComment("ISOLATION_EVIDENCE_COMMENT");
  if (!migrationEvidenceCommentId || !isolationEvidenceCommentId || migrationEvidenceCommentId === isolationEvidenceCommentId) {
    throw new Error("Fixture GO must reference separate migration-cleanup and isolation evidence comments on issue #98.");
  }
  return { migrationEvidenceCommentId, isolationEvidenceCommentId };
}

function assertIssueComment(comment, apiBase, description) {
  if (comment.user?.login !== owner) throw new Error(`${description} must be authored by the repository owner.`);
  if (comment.issue_url !== `${apiBase}/repos/${repository}/issues/98`) {
    throw new Error(`${description} must belong to issue #98.`);
  }
}

function assertImmutableIssueComment(comment, apiBase, description, expectedId) {
  assertIssueComment(comment, apiBase, description);
  if (!/^\d+$/.test(String(comment.id)) || String(comment.id) !== String(expectedId)) {
    throw new Error(`${description} did not resolve to the referenced issue #98 comment.`);
  }
  const createdAt = Date.parse(comment.created_at);
  const updatedAt = Date.parse(comment.updated_at);
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || createdAt !== updatedAt) {
    throw new Error(`${description} must be an unedited issue comment.`);
  }
}

function assertEvidencePredatesOwnerGo(comment, apiBase, description, evidenceId, ownerGoComment) {
  assertImmutableIssueComment(comment, apiBase, description, evidenceId);
  const evidenceIdValue = BigInt(String(comment.id));
  const ownerGoIdValue = BigInt(String(ownerGoComment.id));
  const evidenceCreatedAt = Date.parse(comment.created_at);
  const ownerGoCreatedAt = Date.parse(ownerGoComment.created_at);
  if (evidenceIdValue >= ownerGoIdValue || evidenceCreatedAt > ownerGoCreatedAt) {
    throw new Error(`${description} must be created before the owner GO comment.`);
  }
}

function assertEvidenceLines(comment, apiBase, description, requiredLines) {
  assertIssueComment(comment, apiBase, description);
  const actualLines = exactLines(comment.body);
  if (requiredLines.some((line) => !actualLines.has(line))) {
    throw new Error(`${description} does not bind the exact SHA, target, and required PASS evidence.`);
  }
}

function assertDisposableRecoveryEvidence(comment, apiBase, description, request, ciRun) {
  const lines = exactLines(comment.body);
  if ([...lines].some((line) => line.startsWith("FREE_RECOVERY:"))) {
    throw new Error(`${description} cannot use FREE_RECOVERY evidence; require PostgreSQL 18 disposable recovery proof.`);
  }
  for (const prefix of [
    "R2_ISOLATION_RESULT:",
    "SHA:",
    "TARGET:",
    "SYNTHETIC_ONLY:",
    "STAGING_DISPOSABLE_RECOVERY:",
    "RECOVERY_TARGET:",
    "RECOVERY_OPERATION:",
    "RECOVERY_RUN:",
  ]) {
    const matchingLines = [...lines].filter((line) => line.startsWith(prefix));
    if (matchingLines.length > 1) {
      throw new Error(`${description} must contain exactly one ${prefix} evidence line.`);
    }
  }
  for (const [prefix, requiredLine] of [
    ["NEON_INSTANT_RESTORE:", "NEON_INSTANT_RESTORE: NOT_RUN"],
    ["PRODUCTION_RECOVERY:", "PRODUCTION_RECOVERY: NOT_PROVEN"],
  ]) {
    const matchingLines = [...lines].filter((line) => line.startsWith(prefix));
    if (matchingLines.length !== 1 || matchingLines[0] !== requiredLine) {
      throw new Error(`${description} must state ${requiredLine} exactly.`);
    }
  }
  assertEvidenceLines(comment, apiBase, description, [
    "R2_ISOLATION_RESULT: PASS",
    `SHA: ${request.candidateSha}`,
    `TARGET: ${runnerTarget}`,
    "SYNTHETIC_ONLY: PASS",
    "STAGING_DISPOSABLE_RECOVERY: PASS",
    `RECOVERY_TARGET: ${disposableRecoveryTarget}`,
    `RECOVERY_OPERATION: ${disposableRecoveryOperation}`,
    `RECOVERY_RUN: ${ciRun.id}/${ciRun.run_attempt}`,
    "NEON_INSTANT_RESTORE: NOT_RUN",
    "PRODUCTION_RECOVERY: NOT_PROVEN",
  ]);
}

async function assertSuccessfulRunnerEvidence(readJson, apiBase, comment, request, description, operation, requiredLines) {
  assertEvidenceLines(comment, apiBase, description, [
    ...requiredLines,
    `EVIDENCE_OPERATION: ${operation}`,
  ]);
  const runReference = [...exactLines(comment.body)].find((line) => line.startsWith("RUN: "));
  const match = runReference?.match(/^RUN: (\d+)\/(\d+)$/);
  if (!match || match[2] !== "1") {
    throw new Error(`${description} must reference a first-attempt staging runner run ID and attempt.`);
  }
  const [, runId, attempt] = match;
  const run = await readJson(`actions/runs/${runId}`);
  const expectedPrefix = `R2 ${operation} | ${request.candidateSha} | GO comment `;
  const goCommentId = typeof run.display_title === "string" && run.display_title.startsWith(expectedPrefix)
    ? run.display_title.slice(expectedPrefix.length)
    : "";
  if (!/^\d+$/.test(goCommentId) ||
      String(run.id) !== runId ||
      run.path !== ".github/workflows/r2-staging-runner.yml@main" ||
      run.name !== runnerWorkflowName ||
      run.head_sha !== request.dispatchSha ||
      run.event !== "workflow_dispatch" ||
      run.head_branch !== "main" ||
      run.actor?.login !== owner ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      String(run.run_attempt) !== attempt ||
      run.display_title !== `${expectedPrefix}${goCommentId}`) {
    throw new Error(`${description} must link to a completed successful main workflow_dispatch run by the repository owner.`);
  }

  const stepName = operation === "preflight"
    ? "Verify both PostgreSQL roles with authenticated TLS"
    : operation === "migrate"
      ? "Apply only the frozen migration chain as the migrator role"
      : "Create the approved synthetic fixture through the runtime role";
  const jobsResponse = await readJson(`actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
  const operationJob = (jobsResponse.jobs ?? []).find((job) => job.name === "Protected staging operation");
  const operationStep = operationJob?.steps?.find((step) => step.name === stepName);
  if (operationJob?.status !== "completed" || operationJob.conclusion !== "success" ||
      operationStep?.status !== "completed" || operationStep.conclusion !== "success") {
    throw new Error(`${description} must link to a successful protected staging operation step.`);
  }
}

async function assertProtectedEnvironment(readJson) {
  const environment = await readJson(`environments/${runnerEnvironment}`);
  if (environment.name !== runnerEnvironment ||
      environment.deployment_branch_policy?.protected_branches !== false ||
      environment.deployment_branch_policy?.custom_branch_policies !== true) {
    throw new Error("The R2 Environment must exist and allow only the configured custom branch policy.");
  }
  if (environment.can_admins_bypass !== false) {
    throw new Error("The R2 Environment must disable administrator bypass.");
  }

  const reviewerRule = (environment.protection_rules ?? []).find((rule) => rule.type === "required_reviewers");
  const reviewers = reviewerRule?.reviewers ?? [];
  const ownerIsOnlyReviewer = reviewers.length === 1 &&
    reviewers[0].type === "User" && reviewers[0].reviewer?.login === owner;
  if (!ownerIsOnlyReviewer) {
    throw new Error("The R2 Environment must list the repository owner as its only required reviewer.");
  }
  if (reviewerRule.prevent_self_review !== false) {
    throw new Error("The R2 Environment must allow that owner to review each run.");
  }

  const policiesResponse = await readJson(`environments/${runnerEnvironment}/deployment-branch-policies?per_page=100`);
  const policies = policiesResponse.branch_policies ?? [];
  if (policies.length !== 1 || policies[0]?.name !== "main") {
    throw new Error("The R2 Environment must allow deployments from main only.");
  }
}

async function assertLatestOwnerDecision(readJson, apiBase, request) {
  const comments = await readJson("issues/98/comments?per_page=100");
  if (!Array.isArray(comments) || comments.length >= 100) {
    throw new Error("Issue #98 owner GO history could not be checked within one page; refusing dispatch.");
  }
  const relevant = comments
    .filter((comment) => {
      if (comment.user?.login !== owner) return false;
      const lines = exactLines(comment.body);
      return lines.has(`SHA: ${request.candidateSha}`) &&
        lines.has(`TARGET: ${runnerTarget}`) &&
        lines.has(`OPERATION: ${operationLabel(request.operation)}`) &&
        decisionLines(comment.body).length > 0;
    })
    .sort((left, right) => Number(left.id) - Number(right.id));
  const latest = relevant.at(-1);
  const latestDecisions = latest ? decisionLines(latest.body) : [];
  if (!latest || String(latest.id) !== request.ownerGoCommentId ||
      latestDecisions.length !== 1 || latestDecisions[0] !== "R2_RUNNER_GO: GO") {
    throw new Error("The referenced owner GO is missing, stale, or superseded by a later matching owner decision.");
  }
  assertImmutableIssueComment(latest, apiBase, "The latest R2 owner decision", request.ownerGoCommentId);
}

function createGitHubReader(context, fetchImpl) {
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

  return { apiBase, readJson };
}

export async function assertLatestR2StagingOwnerDecision({ context, fetchImpl = fetch }) {
  const request = parseDispatchRequest(context);
  const { apiBase, readJson } = createGitHubReader(context, fetchImpl);
  await assertLatestOwnerDecision(readJson, apiBase, request);
}

async function assertOwnerGoUnused(readJson, request) {
  const response = await readJson("actions/workflows/r2-staging-runner.yml/runs?branch=main&event=workflow_dispatch&per_page=100");
  const runs = response.workflow_runs;
  if (!Array.isArray(runs) || runs.length >= 100) {
    throw new Error("R2 dispatch history could not be checked within one page; refusing to reuse authorization.");
  }
  const expectedTitle = `R2 ${request.operation} | ${request.candidateSha} | GO comment ${request.ownerGoCommentId}`;
  if (runs.some((run) => String(run.id) !== request.currentRunId && run.display_title === expectedTitle)) {
    throw new Error("This exact owner GO has already been used; a retry requires a fresh owner decision.");
  }
}

export async function authorizeR2StagingDispatch({ context, fetchImpl = fetch }) {
  const request = parseDispatchRequest(context);
  const { apiBase, readJson } = createGitHubReader(context, fetchImpl);

  const pullRequests = [];
  let repositoryPullRequestListComplete = false;
  for (let page = 1; page < maxPullRequestPage; page += 1) {
    const pagePullRequests = await readJson(
      `pulls?state=all&sort=created&direction=asc&per_page=${pullRequestPageSize}&page=${page}`,
    );
    if (!Array.isArray(pagePullRequests) || pagePullRequests.length > pullRequestPageSize) {
      throw new Error("GitHub returned an invalid repository pull request page; refusing to prove a unique PR #105 match.");
    }
    pullRequests.push(...pagePullRequests);
    if (pagePullRequests.length < pullRequestPageSize) {
      repositoryPullRequestListComplete = true;
      break;
    }
  }
  if (!repositoryPullRequestListComplete) {
    throw new Error(`GitHub repository pull request pagination did not reach a short page before page ${maxPullRequestPage}.`);
  }
  const candidateAssociations = pullRequests.filter((pr) =>
    pr.base?.ref === "main" &&
    pr.base?.repo?.full_name === repository &&
    pr.head?.sha === request.candidateSha &&
    pr.head?.repo?.full_name === repository &&
    typeof pr.head?.ref === "string" &&
    pr.head.ref.length > 0
  );
  const candidatePr = candidateAssociations.find((pr) =>
    pr.number === expectedCandidatePullRequest &&
    pr.state === "closed" &&
    Boolean(pr.merged_at)
  );
  if (!candidatePr) {
    throw new Error("candidate_sha must be the merged head of PR #105 into main.");
  }
  const matchingAssociations = pullRequests.filter((pr) =>
    pr.head?.sha === request.candidateSha &&
    pr.head?.ref === candidatePr.head.ref
  );
  if (matchingAssociations.length !== 1 || matchingAssociations[0]?.number !== expectedCandidatePullRequest) {
    throw new Error("candidate_sha and its head branch must have a unique authoritative association with merged PR #105.");
  }

  if (typeof candidatePr.merge_commit_sha !== "string" || !/^[0-9a-f]{40}$/.test(candidatePr.merge_commit_sha)) {
    throw new Error("Merged PR #105 must expose its immutable merge result SHA.");
  }
  const candidateCommit = await readJson(`commits/${request.candidateSha}`);
  const mergeCommit = await readJson(`commits/${candidatePr.merge_commit_sha}`);
  const candidateTreeSha = candidateCommit.commit?.tree?.sha;
  const mergeTreeSha = mergeCommit.commit?.tree?.sha;
  if (typeof candidateTreeSha !== "string" || !/^[0-9a-f]{40}$/.test(candidateTreeSha) ||
      typeof mergeTreeSha !== "string" || !/^[0-9a-f]{40}$/.test(mergeTreeSha)) {
    throw new Error("GitHub must expose the candidate and merged-result trees to bind tested source content.");
  }
  const candidateMergeComparison = await readJson(`compare/${request.candidateSha}...${candidatePr.merge_commit_sha}`);
  const candidateIsAncestorOfMerge =
    candidateMergeComparison.base_commit?.sha === request.candidateSha &&
    candidateMergeComparison.merge_base_commit?.sha === request.candidateSha &&
    ["ahead", "identical"].includes(candidateMergeComparison.status);
  if (!candidateIsAncestorOfMerge && candidateTreeSha !== mergeTreeSha) {
    throw new Error("The tested candidate commit must be contained in the merged result or have an identical source tree.");
  }
  const mainAncestry = await readJson(`compare/${candidatePr.merge_commit_sha}...${request.dispatchSha}`);
  if (mainAncestry.base_commit?.sha !== candidatePr.merge_commit_sha ||
      mainAncestry.merge_base_commit?.sha !== candidatePr.merge_commit_sha ||
      !["ahead", "identical"].includes(mainAncestry.status)) {
    throw new Error("The approved PR #105 merge result must be an ancestor of the protected-main dispatch SHA.");
  }

  const tracker = await readJson("issues/98");
  if (tracker.state !== "open") {
    throw new Error("Master tracker issue #98 must remain open for R2 staging dispatch.");
  }

  const workflowRuns = await readJson(
    `actions/workflows/gate-a.yml/runs?head_sha=${request.candidateSha}&per_page=100`,
  );
  // The exhaustive repository PR enumeration above binds this SHA and head
  // branch uniquely to PR #105. GitHub may omit workflow_runs[].pull_requests after merge.
  const candidateRuns = (workflowRuns.workflow_runs ?? []).filter((run) =>
    run.head_sha === request.candidateSha &&
    run.head_branch === candidatePr.head.ref &&
    run.event === "pull_request"
  );
  for (const run of candidateRuns) {
    const pullRequestLinks = run.pull_requests;
    if (pullRequestLinks == null) continue;
    if (!Array.isArray(pullRequestLinks)) {
      throw new Error("A candidate Gate A run has invalid pull request links; refusing to authorize.");
    }
    if (pullRequestLinks.length > 0 &&
        !pullRequestLinks.some((pullRequest) => pullRequest?.number === expectedCandidatePullRequest)) {
      throw new Error("Every non-empty candidate Gate A pull request link list must include PR #105.");
    }
  }
  const exactRuns = candidateRuns
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
  const ciRun = exactRuns[0];
  if (!ciRun || ciRun.status !== "completed" || ciRun.conclusion !== "success") {
    throw new Error("The latest PR #105 Gate A run for candidate_sha must be completed and successful.");
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
    throw new Error("Gate A and independent disposable PostgreSQL concurrency must both pass on candidate_sha; the PG18 disposable recovery job must also pass.");
  }
  const recoveryJob = jobs.get(disposableRecoveryJobName);
  const recoveryStep = recoveryJob?.steps?.find((step) => step.name === disposableRecoveryStepName);
  if (recoveryJob?.status !== "completed" || recoveryJob.conclusion !== "success" ||
      recoveryStep?.status !== "completed" || recoveryStep.conclusion !== "success") {
    throw new Error("The exact-head PostgreSQL 18 disposable recovery job and proof step must both be completed and successful.");
  }

  await assertProtectedEnvironment(readJson);
  const ownerGoComment = await readJson(`issues/comments/${request.ownerGoCommentId}`);
  assertImmutableIssueComment(ownerGoComment, apiBase, "The referenced R2 GO comment", request.ownerGoCommentId);
  const evidenceRefs = assertOwnerGoComment(ownerGoComment, request);
  await assertOwnerGoUnused(readJson, request);

  let preflightEvidenceRef = "";
  let migrationEvidenceRef = "";
  let isolationEvidenceRef = "";
  if (request.operation === "preflight") {
    const isolationComment = await readJson(`issues/comments/${evidenceRefs.isolationEvidenceCommentId}`);
    assertEvidencePredatesOwnerGo(isolationComment, apiBase, "Isolation and recovery evidence", evidenceRefs.isolationEvidenceCommentId, ownerGoComment);
    assertDisposableRecoveryEvidence(isolationComment, apiBase, "Isolation and recovery evidence", request, ciRun);
    isolationEvidenceRef = `#98/${evidenceRefs.isolationEvidenceCommentId}`;
  } else if (request.operation === "migrate") {
    const preflightComment = await readJson(`issues/comments/${evidenceRefs.preflightEvidenceCommentId}`);
    assertEvidencePredatesOwnerGo(preflightComment, apiBase, "Authenticated preflight evidence", evidenceRefs.preflightEvidenceCommentId, ownerGoComment);
    await assertSuccessfulRunnerEvidence(readJson, apiBase, preflightComment, request, "Authenticated preflight evidence", "preflight", [
      "R2_PREFLIGHT_RESULT: PASS",
      `SHA: ${request.candidateSha}`,
      `TARGET: ${runnerTarget}`,
      "POSTGRES_MAJOR: 18",
      "MIGRATOR_ROLE: PASS",
      "MIGRATOR_TLS: PASS",
      "RUNTIME_ROLE: PASS",
      "RUNTIME_TLS: PASS",
      "EMPTY_CATALOG: PASS",
      "FREE_PLAN: PASS",
    ]);
    const isolationComment = await readJson(`issues/comments/${evidenceRefs.isolationEvidenceCommentId}`);
    assertEvidencePredatesOwnerGo(isolationComment, apiBase, "Isolation and recovery evidence", evidenceRefs.isolationEvidenceCommentId, ownerGoComment);
    assertDisposableRecoveryEvidence(isolationComment, apiBase, "Isolation and recovery evidence", request, ciRun);
    preflightEvidenceRef = `#98/${evidenceRefs.preflightEvidenceCommentId}`;
    isolationEvidenceRef = `#98/${evidenceRefs.isolationEvidenceCommentId}`;
  } else if (request.operation === fixtureOperation) {
    const migrationComment = await readJson(`issues/comments/${evidenceRefs.migrationEvidenceCommentId}`);
    assertEvidencePredatesOwnerGo(migrationComment, apiBase, "Migration cleanup evidence", evidenceRefs.migrationEvidenceCommentId, ownerGoComment);
    await assertSuccessfulRunnerEvidence(readJson, apiBase, migrationComment, request, "Migration cleanup evidence", "migrate", [
      "R2_MIGRATION_RESULT: PASS",
      `SHA: ${request.candidateSha}`,
      `TARGET: ${runnerTarget}`,
      "MIGRATION_JOURNAL: 0000-0013",
      "MIGRATOR_NOLOGIN: PASS",
      "RUNTIME_DML_ONLY: PASS",
    ]);
    const isolationComment = await readJson(`issues/comments/${evidenceRefs.isolationEvidenceCommentId}`);
    assertEvidencePredatesOwnerGo(isolationComment, apiBase, "Isolation and recovery evidence", evidenceRefs.isolationEvidenceCommentId, ownerGoComment);
    assertDisposableRecoveryEvidence(isolationComment, apiBase, "Isolation and recovery evidence", request, ciRun);
    migrationEvidenceRef = `#98/${evidenceRefs.migrationEvidenceCommentId}`;
    isolationEvidenceRef = `#98/${evidenceRefs.isolationEvidenceCommentId}`;
  }

  await assertLatestOwnerDecision(readJson, apiBase, request);

  return {
    candidateSha: request.candidateSha,
    operation: request.operation,
    ciRunId: String(ciRun.id),
    ciAttempt: String(ciRun.run_attempt),
    authorizationRef: `#98/${request.ownerGoCommentId}`,
    preflightEvidenceRef,
    migrationEvidenceRef,
    isolationEvidenceRef,
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
    dispatchSha: process.env.R2_DISPATCH_SHA,
    operation: process.env.R2_OPERATION,
    ownerGoCommentId: process.env.R2_OWNER_GO_COMMENT_ID,
    currentRunId: process.env.GITHUB_RUN_ID,
    currentRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
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
    `preflight_evidence_ref=${result.preflightEvidenceRef}`,
    `migration_evidence_ref=${result.migrationEvidenceRef}`,
    `isolation_evidence_ref=${result.isolationEvidenceRef}`,
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
