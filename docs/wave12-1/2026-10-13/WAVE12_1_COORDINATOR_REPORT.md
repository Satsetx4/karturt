# KartuRT V1 Wave 12.1 — Coordinator Report

**Date:** 2026-10-13 (Asia/Bangkok)
**Overall verdict:** **READ-ONLY PREFLIGHT PARTIAL. Migration BLOCKED. Staging NOT READY. Release NO-GO.**

## Scope and boundaries

Wave 12.1 aligned the source guard to the approved Neon staging target, ran local source checks, read target metadata, reviewed publication triggers, and prepared sanitized evidence. The owner authorized these steps and a conditional push to new non-default branches if deployment triggers were safe. No SQL, database connection, compute wake, DDL/DML, migration, fixture/teardown, Neon resource change, Vercel write/deployment, PR, merge, or default-branch mutation occurred.

## Source patch and local evidence

- Verified Wave10 application baseline: `355c5804df9767e7ce8456edde4439a4a7eaedc9`, tree `df520d59d675e46f43c4b224798fe4b237e36360`. This is the application source baseline; the Wave12 documentation commit is separate.
- Source-only patch: `d4fc471a988c070ca2118e12ddbb0b363daa6541`, tree `15bb2fc622f19d0715906479083ae87bcbb85cec` on `codex/wave12-1-staging-target-20261013`.
- The patch changes only `src/lib/staging-database-target.ts` and `tests/unit/environment.test.ts`. The guard records the metadata-confirmed project/branch/database/endpoint identity, rejects stale or mismatched targets, rejects the new direct and pooler endpoints under non-staging environment labels, and keeps `stagingIsolationVerifiedEmpty=false`. An exact staging URL still stops at the parent-data isolation check before a client is created.
- Agent A reported the following successful local commands in its isolated worktree: focused Vitest (2 files, 18 tests), lint (0 errors, 2 pre-existing warnings), typecheck, offline Drizzle check, guarded production build with no `DATABASE_URL`, and commit diff check. No database was contacted by these checks.
- Coordinator independently reviewed the exact two-file commit and scanned 451 unique Git objects in the branch history for common high-confidence credential formats; none were found. The repository history has no environment or private-key files in this branch range. This is a bounded pattern scan, not a guarantee against every possible secret format.

## Publication review and result

- `.github/workflows/gate-a.yml` has an explicit push-branch allowlist that excludes both proposed branches. Its pull-request trigger is unfiltered, so no PR was created. No Actions run is expected from these direct pushes; this is not a CI pass.
- Read-only checks of the one authorized Vercel staging project found zero deployments and its Settings > Git page explicitly says the project is not connected to a Git repository. No other Vercel project was inspected. This confirms only that these branch pushes cannot trigger Git-integration auto-deployment for that exact project in the observed configuration.
- The source branch was pushed without force to GitHub and independently read back at exact tip `d4fc471a988c070ca2118e12ddbb0b363daa6541`. It is 52 commits ahead of `origin/main`: the verified local Wave10 baseline already had 51 commits not present on `origin/main`, followed by this source patch. The source branch therefore publishes that local Wave10 ancestry as well as the two-file patch.
- The five sanitized reports in this directory are prepared for the new documentation branch `docs/wave12-1-staging-readonly-20261013`, based on documentation commit `8678fb388ae64ab7f4f48b11372ebc1775f375ba`. No PR, merge, or deployment is part of this publication.

## Neon metadata versus database contents

Read-only metadata matched the approved target: organization `org-ancient-boat-57106549` on Free plan; project `wild-art-99835126` in `aws-ap-southeast-1` on PostgreSQL 18; branch `br-hidden-cake-a1ge5xqp`; database `karturt_staging` ID `42079960`; endpoint `ep-snowy-meadow-a10304d9` and its region-specific hostname. The endpoint is `read_write`, `idle`, and reports `passwordless_access=true`; the branch reports `init_source=parent-data`. These metadata facts do not prove empty contents or read-only credentials.

The available SQL connector accepts arbitrary SQL and cannot guarantee a read-only role, transaction, or session. The stop condition therefore applied before any query or compute wake. Schemas, migration ledger, application tables, and row counts remain uninspected; database contents and emptiness are **NOT VERIFIED**. The source guard keeps isolation false and does not enable staging access.

## Lane outcomes

| Lane | Result | Evidence boundary |
|---|---|---|
| A — source guard and local checks | **PASS** | Exact identity guard patch and local test/tool exits; no database connection. |
| B — Neon metadata and inspection | **PARTIAL** | Target metadata aligned; database inspection blocked before query/wake. |
| C — security, QA, and publication review | **PARTIAL** | Exact patch reviewed; trigger preflight passed; runtime tenant suites and DB-native isolation remain unproven. |

## Remaining blockers

- Parent lineage/content and database emptiness remain unknown; passwordless access is enabled and the endpoint is read-write.
- No safe read-only database execution path was available. No migration or staging runtime result exists.
- Five prior HIGH development-only dependency advisories remain unrefreshed. PostgreSQL 18 migration/runtime compatibility, independent PostgreSQL concurrency, backup/restore, and device/deployment behavior are unproven.
- Static review found no RLS enablement/policies in the sampled schema paths. Application tenant controls do not prove a database-native tenant boundary.
- Direct Next CLI invocation can bypass the repository's environment-file wrapper; this was not changed in Wave 12.1.

**Final classification:** `READ-ONLY PREFLIGHT PARTIAL` / `MIGRATION BLOCKED` / `STAGING NOT READY` / `RELEASE NO-GO`.
