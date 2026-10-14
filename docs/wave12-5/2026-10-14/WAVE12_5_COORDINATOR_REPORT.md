# KartuRT V1 Wave 12.5 — Coordinator Report

Date: 2026-10-14 (Asia/Bangkok)
Verdict: OWNER DECISION PACKET READY
Wave boundary: documentation and decisions only. Wave 13 Neon migration remains NOT AUTHORIZED.

## Scope and result

Wave 12.5 compared reuse of the existing staging target with a new isolated target, documented recovery options and migration failure handling, classified security and governance risks, and prepared an explicit owner decision form. Three independent Codex agents worked in separate worktrees, with the Coordinator integrating their reports. The dirty primary checkout was preserved.

All three lanes completed their documents with PARTIAL dispositions because owner selections, exact-target recovery proof, and future security decisions remain outstanding:

| Lane | Result | Deliverable |
|---|---|---|
| A — target decision | PARTIAL — recommends a new independent staging project as a future candidate; owner decision and separate resource authorization required | [Agent A target decision](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_AGENT_A_TARGET_DECISION.md) |
| B — recovery engineering | PARTIAL — recovery design and migration manifest ready; exact-project snapshot and restore remain unverified | [Agent B recovery runbook](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_AGENT_B_RECOVERY_RUNBOOK.md) |
| C — security and governance | PARTIAL — classifications and owner form ready; no exception or owner selection has been approved | [Agent C security decisions](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_AGENT_C_SECURITY_DECISIONS.md) |

The exact requested owner form is [WAVE12_5_OWNER_DECISION_PACKET.md](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_OWNER_DECISION_PACKET.md). No checkbox is preselected. The recommendation below is not an owner selection or authorization.

## Immutable baselines

- Application source: Satsetx4/karturt, branch codex/wave12-3-pg18-rehearsal-20261014, SHA 3bc69c83265dce3a6a0863cbfceea188f40f6168, tree f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9.
- Documentation base: branch docs/wave12-4-staging-readiness-20261014, SHA bea05d7f4f2346645b7354c32b6cd748654aaf05, tree c6beb5ab46c8428887d152019d5aa590907b1cf2.
- New documentation branch: docs/wave12-5-recovery-decision-20261014, based on the exact documentation SHA above.
- The source and documentation baselines are separate evidence lanes. No source commit or migration file is included in this wave.

The Coordinator verified the local and remote baseline refs before starting and verified each agent worktree against its assigned exact SHA/tree. All five Wave 12.4 reports and the relevant Wave 12.1–12.3 evidence were read. The application source guard still sets stagingIsolationVerifiedEmpty=false.

## What the evidence establishes

Wave 12.4 reported one server-enforced read-only transaction with target/role assertions and 26/26 statement groups complete. Its precise result was SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE: only the default public non-system schema was found; the enumerated application object and Drizzle ledger inventories were empty; plpgsql was the default extension. This is a bounded catalog result. It does not prove row absence, complete physical emptiness, parent/source lineage, migration readiness, access grants, or recoverability.

The approved target metadata is organization satset (org-ancient-boat-57106549), Free project karturt-v1-staging (wild-art-99835126), PostgreSQL 18, region aws-ap-southeast-1; primary/default branch staging (br-hidden-cake-a1ge5xqp), database karturt_staging (42079960), owner role karturt_staging_owner, and endpoint ep-snowy-meadow-a10304d9. The branch reports init_source=parent-data with parent and source point unknown. Its endpoint is read_write and passwordless_access=true; that metadata flag alone does not establish that access is unauthenticated.

Fresh metadata-only readback in Wave 12.5 found no listed snapshot and an empty snapshot schedule. Branch metadata additionally surfaced a public.show_db_tree function tree entry. Its provenance and meaning are unresolved; it was not SQL-verified and was outside Wave 12.4’s fixed catalog query set. Treat it as a stop signal requiring separately authorized, safe classification before reuse or migration. Do not call it a confirmed SQL object or dismiss it based on the earlier bounded result.

Neon’s published Free plan describes one manual snapshot, a six-hour or 1 GB history cap, and other project/branch/storage limits. These are product limits, not proof that a snapshot exists, a restore is available on this target, remaining quota is available, or a future operation costs zero. No exact-project snapshot or restore rehearsal is evidenced. Consult [Neon pricing](https://neon.com/pricing), [Neon history window](https://neon.com/docs/postgres/backup-restore/history-window), and [Neon instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore) for the current documented feature boundaries. Recheck exact terms and usage before any future provider operation; no paid plan or service is approved.

The disposable PostgreSQL 18.6 rehearsal at application SHA 3bc69c83265dce3a6a0863cbfceea188f40f6168, GitHub run 38503239173, passed the 14-migration chain and synthetic rollback/dump/restore cases. Wave 12.3 reported 14 ledger entries, 27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums; its coordinator also reported 502/502 local tests. This evidence belongs to the disposable rehearsal only. It does not prove this Neon target’s content, lineage, backup, restore, or readiness. Nothing was rerun in Wave 12.5.

## Decision analysis

Agent A compared two future choices:

1. Reuse the exact existing project/branch/database/endpoint. This minimizes identifier churn, but keeps unknown parent lineage, the unresolved public.show_db_tree metadata signal, and unproven recovery. It requires the owner to explicitly state that no operational or real resident data needs preservation. That is a non-preservation risk decision, not evidence of emptiness.
2. Create a new independent staging project with documented origin and no external data copying. This is the recommended future candidate because it avoids inheriting the existing branch’s unknown lineage. It requires separately authorized resource creation, current Free-plan quota/cost confirmation, new identifier readback, safe baseline inspection, and future source guard review. Keep the existing project untouched. Do not make a child branch from the unknown-lineage target, copy its data, or restore its snapshot into the proposed new target.

Owner choice remains blank. No new resource is created or authorized by this recommendation.

Recovery option 1 is disposal/rebuild only from a separately approved, provably clean baseline, with a no-copy record and exact resource boundaries. Recovery option 2 is a separately authorized pre-migration snapshot and multi-step restore rehearsal into a disposable branch, preserving the original. Snapshot, restore, compute attachment, SQL validation, cleanup, and migration each require their own permission and current cost/quota review. Neither option is verified on the target.

Security gates include controlled access before any connection; separate least-privilege app and migration identities; cross-RT negative testing before any app connectivity; a bounded written exception for synthetic-only staging if database-native RLS remains absent; refreshed handling of the five historical HIGH development advisories; and a shared preflight guard before using the six smoke scripts that invoke Next outside the wrapper. Agent C’s minimal Next CLI patch is a proposal only. No exception is approved.

## Publication preflight and evidence boundaries

The exact docs branch was reviewed against push-trigger filters before publication. The gate-a workflow’s push allowlist does not include the proposed docs branch; the Wave 12.3 rehearsal workflow only targets its named source branch. No pull request or workflow_dispatch was created. No CI success is claimed for this documentation branch.

The exact Vercel review-staging project metadata readback showed live=false, no latest deployment or domains, and no deployment records for the Wave 12.4 or proposed Wave 12.5 branch. The current project endpoint omitted Git-link details; same-day prior evidence recorded that this project was disconnected/not present in linked Git projects. This supports the docs-only push preflight but is not a provider-setting change or a new claim that Git linkage was directly returned by the current endpoint.

Publication proof is the independent remote branch/file readback after push, not this report alone. No PR, merge, default-branch change, deploy, provider setting change, source patch, or main update is in scope.

## Wave 12.5 action record

- Neon SQL, DDL/DML, migrations 0000–0013, seed, connection, compute wake, snapshot creation, and restore: NOT performed.
- Neon resource, role, credential, access, or endpoint changes: NOT performed.
- Vercel deployment or settings changes: NOT performed.
- Source, migrator, Drizzle, GitHub deploy-trigger, or provider-setting edits: NOT performed.
- Real resident data, backups, dumps, credentials, tokens, and connection strings: not read or published.
- stagingIsolationVerifiedEmpty: remains false.
- Wave 13 migration: NOT AUTHORIZED.

## Owner handoff

Complete and sign [the owner decision packet](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_OWNER_DECISION_PACKET.md) before any later staging action. Select a target and recovery design; settle non-preservation and bounded security decisions; name exact future resources, permitted operations, operator, execution window, recovery authority, and stop contacts. Any later SQL preflight, snapshot, restore, resource creation/deletion, access change, source patch, app connection, or migration needs its own specifically scoped authorization.

Independent Chat-mode audit handoff: compare the five published reports with the exact remote branch head and these baselines; verify all required decisions remain unselected; confirm that no readiness, emptiness, CI, or restore claim exceeds its evidence; and check the exact remote diff contains only the five requested sanitized Markdown files.
