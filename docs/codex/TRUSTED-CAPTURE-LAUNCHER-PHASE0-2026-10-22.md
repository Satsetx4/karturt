# KartuRT V1 — trusted capture launcher phase 0 (fail-closed)

Date: 2026-10-22 (Asia/Jakarta)  
Scope: emergency 24h release-readiness issue #66; baseline PR #65.  
Status: **NO LIVE CAPTURE** — this branch is an inert workflow proposal for independent review.

## Why this exists

Current `main` lacks a reviewed manual-dispatch entrypoint for protected staging capture. PR #65 has local Gate V1 evaluation, guards and tests, but it cannot produce independently authenticated lineage, synthetic-only or TLS/catalog proof. The protected GitHub Environment `karturt-staging-readiness` is documented as fail-closed due to missing distinct reviewer/credentials and `main`-only restriction. This phase creates only an auditable GitHub Actions entrypoint without authorizing any protected database operation.

## Controls implemented

- `workflow_dispatch` only, typed input `candidate_source_sha` as a 40-character lowercase Git commit SHA.
- No-secret public commit GET validates SHA existence. A SHA existing in GitHub **does not mean** it is reviewed or approved.
- Exact repository, `refs/heads/main`, event and workflow path/ref required. Dispatch from a candidate branch is rejected.
- No-secret preflight writes only the exact SHA to a job output. Uses no staging credentials, passfile, CA, Neon API key or libpq.
- Second job requires existing protected Environment `karturt-staging-readiness`; a *separate* independent approver must be configured and protection rules must not be bypassed. The environment must supply reviewed `KARTURT_CAPTURE_APPROVED_SOURCE_SHA` for an exact comparison.
- The second job ALWAYS exits with `CAPTURE_STOP: LIVE_CAPTURE_NOT_IMPLEMENTED_OR_AUTHORIZED` (or earlier closed guard), even if approval succeeds. It does **not** check out candidate source or read provider/DB secrets. This is intentional, not a production-ready capture runner.
- Concurrency group prevents overlapping dispatch runs. No automatic jobs on `push` or `pull_request`.
- No merge, staging migration, production deployment, F2, credentials access, provider mutation or staging connection.

## Review and offline test expectations

Review the workflow YAML using the branch commit full SHA, run a static YAML parse and check all guard failure paths before considering landing it on `main`. After independent environment setup, a manual dispatch from `main` may exercise only the inert preflight and protective stop *under separately authorized test procedures*. Do not dispatch merely because the file exists.

Negative tests: wrong ref, wrong workflow identity, short/uppercase/non-hex SHA, missing source commit, unreachable API, no independent reviewer, absent/mismatched protected SHA; all must fail-closed. Verify no secrets are referenced or logged and the protected job never reaches libpq/psql.

## What's STILL missing (must not claim PASS)

1. A genuinely independent Environment reviewer and reviewed main launcher adoption (PR creation is not main adoption).
2. Scoped Neon Viewer identity, protected config (pin source/CA/psql PG18) and publisher hash verification.
3. Authenticated provider lineage and original-creation evidence, or a separately reviewed alternative contract. Project `wild-darkness-00489132` is selected in current Gate V1 manifest, but `broad-star-40451875` is a protected legacy candidate; issue #63 still contains older initial-target text.
4. Synthetic-only proof and trusted runner/artifact attestations. GitHub attestation validates provenance of bytes, not truth of raw JSON claims.
5. The reviewed capture implementation: provider queries, temporary Windows ACL checks, sanitization, exact candidate checkout, fail-closed TLS/direct endpoint and bounded read-only catalog probe.
6. Fresh Gate V1 PASS, signed *separate* migration authorization and independent security review. F2 remains BLOCKED pending separate owner permission, and historical attempt-2 remains FAILED.
7. Independent PostgreSQL concurrency and full QA PASS at the **same reviewed release source SHA**. A previous SHA's green CI does not carry over.

## Owner actions that cannot be automated safely

- Add/configure a *distinct trusted reviewer* with rights to approve the protected Environment. The workflow initiator cannot self-approve.
- Arrange Neon Viewer-only capture credential directly in the protected Environment; never post secret/password/private key into GitHub issue/chat.
- Approve any revised staging evidence schema and the actual trusted live-capture runner; authorize required protected operations separately. F2 requires its own explicit approval.
- Make a final explicit GO/NO-GO release decision after reviewing SHA-bound evidence.

## Handoff

Critical path: [issue #66](https://github.com/Satsetx4/karturt/issues/66). This document is deliberately a **phase-0** bridge, not evidence for readiness. If gate evidence is unavailable within the deadline, maintain NO-GO for production and deliver a tested release candidate rather than bypass controls.

## 2026-10-22 blocker review: effective Neon API permissions

External docs reviewed on 2026-10-22 establish two distinct permission facts that an implementation must not confuse:

1. Neon effective user permissions may be additive between org and project roles; the **Viewer** role is metadata-read-only and cannot access connection strings. A project-level Viewer grant does not cancel a broader org Editor/Admin grant. Source: https://neon.com/blog/neon-now-has-per-project-permissions
2. Neon's **organization-wide** API keys are Admin-equivalent. Its **project-scoped organization API keys are NOT automatically Viewer-only**; published API-key guidance describes member-/Editor-level access to the project. Source: https://api-docs.neon.tech/reference/authentication and https://neon.com/docs/manage/orgs-api

Therefore, **do not replace the required Viewer principal with an organization/project-scoped organization API key** just because its name includes a project. A distinct principal with only effective Viewer rights (and an independently validated, correspondingly limited credential) is required; if unavailable, stop at `VIEWER_CREDENTIAL_UNAVAILABLE` before any provider capture or DB client creation. API-control-plane Viewer metadata access is not a substitute for the separately authorized read-only PostgreSQL catalog session.

Repository policy: independent Environment reviewer is distinct from workflow dispatcher; Prevent self-review ON, bypass disabled, only reviewed `main` allowed. GitHub public-repo Free plans support required reviewers according to https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments . The current reviewer/credential configuration has NOT been verified live from this conversation; preserve BLOCKED.

**Owner action issue:** https://github.com/Satsetx4/karturt/issues/68 . Keep phase-0 launcher inert until independent review, authenticated original lineage evidence or a separately reviewed alternative (including new audited creation if separately authorized), and exact-SHA approvals are all available. No F2, staging connection, migration, merge or deployment is authorized by this document.
