# Wave 13B.1 Coordinator Report

Date: 2026-10-14
Outcome: UNKNOWN - NOT EXECUTED - CONTRACT/SAFETY BLOCKED
Scope: Neon read-only preflight and evidence audit only

## Immutable references

| Ref | Required value | Verification |
|---|---|---|
| Repository | Satsetx4/karturt | Confirmed |
| Source branch | codex/wave13a-2-pg18-evidence-20261014 | SHA 48b92abbe93fbd499448b6c885d3042cb49c2128 |
| Documentation base | docs/wave13b-0-security-approval-20261014 | SHA 8e97e0bed0f1c8f13288ad9368b1b314fdf471b6 |
| Historical main | main | SHA 96c84588ae0c13f68a17cffd997a3e583fb7da82 |

The D1 approval in the referenced owner conversation applies to this exact Wave 13B.1 scope. No renewed approval was requested. The dirty primary checkout was preserved; work was done in isolated worktrees.

## Independent lanes

| Lane | Result | Boundary |
|---|---|---|
| Agent A - target metadata | IDENTITY_PREFLIGHT_PASS | Control-plane metadata only; no SQL |
| Agent B - transaction validation | SQL_CONTRACT_BLOCKED | Exact SQL reviewed; no SQL or provider query |
| Agent C - evidence review | BLOCKED BEFORE SQL | Completeness and safety review; no SQL |

## Target identity

Agent A matched the approved target metadata: organization org-ancient-boat-57106549 (satset); project falling-bread-33359184 (karturt-v1-staging-clean); branch br-muddy-frost-azot13fb (staging); database ID 702718, karturt_staging; role karturt_staging_owner; compute/endpoint ep-silent-butterfly-azrflu40; host ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech; PostgreSQL 18; Singapore region. Endpoint metadata was read-write and idle during the review. No credentials or connection URLs were requested or retrieved. The excluded historical staging project and production were not queried or used as fallback targets.

The metadata operations listing showed five already-completed lifecycle records (create_timeline, start_compute, epc_sync, apply_config, suspend_compute); a second listing was unchanged. The review did not initiate these operations, and the endpoint remained idle during the metadata checks. This is an observation of provider metadata, not proof of physical emptiness or data lineage. Effective SQL grants remain unknown.

## SQL gate and decision

The pinned reference was checked against Git blob SHA-1 78501ab327bdc7b7a9a06a0a0f66fe039fc8d148. It contains 29 SQL fenced blocks in order: read-only transaction command, erroring identity/read-only guard, transaction mode display, then 26 catalog queries. The exact strings were not altered.

No SQL was issued. Two required gates failed:

1. The exposed run_sql_transaction contract describes multiple statements as one transaction, but does not establish backend session affinity or fail-fast/abort-on-error behavior. The approved scope requires both to be known before any SQL.
2. Independent review found that the pinned statements cannot produce the requested complete role-membership and grant inventory. The query set omits membership-edge details and several privilege classes, including PostgreSQL 18 MAINTAIN and grant-option details, as well as column-level and other object-class grants. See the Agent C report.

The coordinator therefore did not call run_sql_transaction, run_sql, a driver, or psql. There was no retry or alternate target. The D1 result is UNKNOWN, not CLEAN_CATALOG_PREFLIGHT or UNCLEAN. A changed query set or a stronger transaction contract requires a separately reviewed scope and approval.

Prior Wave 13A.2 evidence that a direct TCP client timeout left pg_sleep running does not establish Neon WebSocket cancellation, rollback, or session semantics. No such behavior was tested in this wave.

## Publication safety review

Before the docs push, the configured Vercel staging project was read back. It had no linked Git repository, no latest deployment, and zero deployments listed; no automatic deployment path for this docs branch was visible. At the documentation base, the Gate A workflow did not include this docs branch in its push-branch allowlist. No workflow was dispatched and no PR was opened. These are pre-push observations; post-push checks are recorded in the delivery result.

## Preserved source safeguards and stop boundary

The source branch was not edited. Its staging isolation guard remains false, and the pinned migration approval public key remains null. No provider configuration, endpoint setting, role, network allowlist, or plan was changed. No migration, seed, reset, rebuild, delete, or runtime enablement occurred.

Wave 13B.1 ends here. D2 and D3 were not started. The 14-migration run remains NO-GO pending separate owner decisions and evidence.

## Post-publication verification

The first push published commit 98df02e0a323ad22186d30c2e8c0b7ae8cc73ef3. Remote readback confirmed the docs branch at that SHA, with the required docs-base SHA as an ancestor and exactly the six report paths listed in this branch diff. The source branch remained at 48b92abbe93fbd499448b6c885d3042cb49c2128 and historical main remained at 96c84588ae0c13f68a17cffd997a3e583fb7da82. The docs-base branch remained at 8e97e0bed0f1c8f13288ad9368b1b314fdf471b6. The remote diff check was clean.

GitHub Actions returned zero workflow runs for this branch. This is no run, not a CI pass. Vercel readback after the push showed the review-staging project still had no Git repository link, no latest deployment, and zero deployments. The project search filtered by the karturt repository returned no linked project.

Post-push Neon control-plane readbacks, without SQL, again matched the approved organization, Free project, PostgreSQL 18, staging branch, database ID/name, role, endpoint ID/host, region, and endpoint state. The branch remained ready with init_source=parent-data; the endpoint remained idle and read-write. The operation listing contained five completed lifecycle entries (create_timeline, start_compute, epc_sync, apply_config, suspend_compute). These metadata checks do not establish grants, physical emptiness, or lineage.

No SQL, provider mutation, migration, deployment, or workflow dispatch occurred during publication verification.
