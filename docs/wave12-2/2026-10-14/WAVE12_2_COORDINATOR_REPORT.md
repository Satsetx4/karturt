# KartuRT V1 Wave 12.2 — Coordinator Report

**Date:** 2026-10-14 (Asia/Bangkok)
**Overall result:** **READ-ONLY PREFLIGHT PARTIAL**
**Migration decision:** **BLOCKED / NOT READY**
**Database content classification:** **NOT VERIFIED**
**Source patch:** None required or made
**Deployment / merge:** None

## Scope and baseline

This wave reviewed the exact KartuRT source revision and the five Wave 12.1 reports, performed one server-enforced read-only transaction against the specifically approved Neon staging target, ran focused local security and offline migration checks, and prepared this documentation-only evidence set.

- Repository: Satsetx4/karturt.
- Application source baseline: branch codex/wave12-1-staging-target-20261013 at d4fc471a988c070ca2118e12ddbb0b363daa6541, tree 15bb2fc622f19d0715906479083ae87bcbb85cec.
- Documentation baseline: docs/wave12-1-staging-readonly-20261013 at 4836d7858932c06f231e1960f6084e9535203bc9.
- Publication branch: docs/wave12-2-db-inspection-20261014, based on the documentation baseline above.
- Primary checkout was dirty and was not modified. Each lane used its own isolated worktree; the Coordinator used a fourth worktree.
- All five Wave 12.1 reports were read. Wave 12.1 left stagingIsolationVerifiedEmpty=false and had not connected to or queried Neon.

The only Neon target in scope was the previously approved karturt_staging database in project wild-art-99835126, branch br-hidden-cake-a1ge5xqp, with role karturt_staging_owner. Other Neon projects and organizations were out of scope.

## Lane results

| Lane | Result | Evidence |
|---|---|---|
| Agent A — method | **PASS, conditional method qualification** | Confirmed the transaction tool batches ordered statements in one transaction and has no readOnly option. Required first statement SET TRANSACTION READ ONLY, followed by a server-side guard before catalog queries. Local PostgreSQL validation was not available. |
| Agent B — provider | **PARTIAL** | Fresh allowlisted metadata matched. Exactly one explicitly scoped transaction completed; the read-only setting and identity guard passed. Catalog results were empty for the fixed filters, but database contents and emptiness remain NOT VERIFIED. |
| Agent C — security QA | **PARTIAL** | 209 focused local tests passed; offline Drizzle journal check and isolated generation passed. PGlite is not PostgreSQL 18. Backup/restore and several live-provider controls remain unverified. |

## Neon metadata and one authorized transaction

Fresh metadata reads confirmed the approved Free-plan organization and staging project, PostgreSQL 18, the exact primary/default staging branch, the exact database and owner, and one endpoint mapped to that branch. The endpoint was idle, read_write, configured at 0.25 CU, and had passwordless access enabled. The role metadata did not establish read-only role privileges. No credential or connection string was requested.

After method review and explicit Coordinator GO, Agent B made exactly one run_sql_transaction call with explicit project, branch, and database arguments. The seven ordered statements began with SET TRANSACTION READ ONLY, then checked SHOW transaction_read_only, asserted the mode and database/role identity, and ran only the approved fixed identity and catalog/statistics/ledger queries. The returned evidence was:

- SHOW transaction_read_only returned on.
- The server-side guard returned 1.
- Database and role matched karturt_staging and karturt_staging_owner; server reported PostgreSQL 18.6 (c021049).
- The fixed non-system relation listing, aggregate result, and Drizzle migration-ledger lookup returned no rows.
- No row-level or personal data was selected. There was no retry, second SQL tool, direct client, or manual wake.

The observed query results do not prove that the database is empty. The branch reports init_source=parent-data; inherited lineage is unresolved. The query filters cover selected relation types, not every possible database object, and PostgreSQL row estimates are not proof of zero rows. Metadata values such as written_data_bytes=0 also do not prove emptiness. The safe classification is NOT VERIFIED, and stagingIsolationVerifiedEmpty remains false.

## Source, schema, and security evidence

No source patch was necessary. The exact source baseline still fails closed for this target because isolation/emptiness has not been verified.

The repository inventory at the source SHA contains 14 ordered SQL migrations (0000–0013), 14 journal entries, 14 snapshots, and 27 table definitions. Agent C passed 209 focused tests across authorization, household, environment, command-wrapper, and PGlite integration/constraint coverage. npm run db:check:offline passed; isolated offline Drizzle generation reported no schema changes. One attempted Drizzle CLI option combination exited 1 because the locked CLI rejects combining --config with other generate flags; the successful isolated generation used the project-compatible offline setup. The full suite, typecheck, lint, production build, PostgreSQL 18 rehearsal, and independent PostgreSQL concurrency job were not run.

Static source review found application-layer principal, permission, RT, household, and cross-RT protections covered by the focused tests. The checked-in schema/migrations did not contain database-native RLS enablement or policies. That does not attest the live database. Historical evidence records five HIGH development-only dependency advisories; this wave did not refresh advisory data. No verified Neon backup/restore drill was found.

The 14 migration files are future-only inventory. Some include non-idempotent DDL, the 0003 legacy-value conversion, the 0010 active-settlement backfill, and later state-dependent preflights. They were not executed. A future interrupted or partially applied migration must stop for state reconciliation and an explicitly approved recovery plan; do not replay blindly or edit the migration ledger.

## Automation and Vercel trigger review

The exact source workflow .github/workflows/gate-a.yml has an explicit push.branches allowlist that excludes docs/wave12-2-db-inspection-20261014. Its pull_request trigger is unfiltered, but this wave created no PR and did not dispatch a workflow.

On 2026-10-14, Vercel get_project for exact project ID prj_Mv4rABJvDNAvSD78SVt5WbjFakEq returned karturt-review-staging-20261012, latestDeployment=null, domains=[], and live=false. A fresh get_git_deployment_context for team team_tAhOeJANcBil7FonGHlzKwCs listed linked Git projects; this exact staging project ID/name was absent. This supports that the target staging project was not Git-linked at this readback. No Vercel settings were changed and no deployment was created. The push therefore has no matching Gate A push trigger and no linked Vercel Git project was present in the current provider inventory. No CI result is claimed.

## Actions and boundaries

- One server-enforced read-only Neon transaction only; no further connection or query.
- No migration, DDL/DML, seed, teardown, project/branch/role/endpoint/compute change, or credential retrieval.
- No source edit or source branch push.
- No Vercel deployment, settings change, PR, merge, main/default-branch update, paid feature, or plan upgrade.
- Only the five sanitized Markdown reports in this directory are intended for publication.

## Owner decision

This wave does not authorize or recommend migration. Keep migration blocked until the owner separately approves a concrete next phase after it supplies verified lineage/content classification, a tested backup/restore path, and a successful PostgreSQL 18 rehearsal of the exact migration chain on a demonstrably isolated disposable target. The attached Owner Approval Packet records the outstanding gates and future decision boundary.
