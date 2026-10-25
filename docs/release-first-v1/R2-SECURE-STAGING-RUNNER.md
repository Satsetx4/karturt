# RELEASE FIRST V1 — R2 secure staging runner

**Status: source candidate only.** This design does not create credentials, enable either role, read environment secrets, connect to Neon, run SQL, or authorize a migration. The workflow is not dispatchable until it is reviewed and reaches the repository's default `main` branch. Its existence on a candidate branch does not authorize a merge or database writes.

## Chosen path

Use one GitHub-hosted Actions workflow and one branch-restricted GitHub Environment, `karturt-r2-staging`. The repository is public, so GitHub Free supports environment secrets and selected deployment branches. The workflow is `workflow_dispatch` only, checks that dispatch comes from `main` and `Satsetx4`, and checks out only a full candidate SHA. It grants `GITHUB_TOKEN` read access only in the separate authorization job; the database job has `contents: read` only and uses an ephemeral GitHub-hosted runner. The exact-SHA issue GO comment is the human write authorization; a required environment reviewer can be added if a second human is available, with an approval prompt on every run.

The authorization job checks out the policy source at the workflow event's exact `github.sha` and verifies that checkout; it does not race a mutable `main` ref. The runner pins Node 24-compatible `actions/checkout` and `actions/setup-node` releases to full commit SHAs and disables setup-node's package cache. The authorizer requires the candidate to be the merged head of PR #93, and checks the latest exact-SHA PR Gate A run and both required jobs: `Gate A local verification` and `Launch Safety independent PostgreSQL concurrency`. The latter is disposable PostgreSQL concurrency evidence, not live staging PG18 evidence. A `migrate` dispatch also requires a comment ID from issue #98 whose owner-authored lines bind `GO`, the exact candidate SHA, the canonical target, and `official-migrations-0000-0013`. A `preflight` dispatch is read-only and does not require that GO comment.

The workflow maps `DATABASE_MIGRATION_URL` and `DATABASE_URL` into only the final execution step, after validation and environment approval. Dependency installation and source validation run without those values. The workflow is main-only, serializes attempts for the same SHA and operation, pins actions to full commit SHAs, and does not persist checkout credentials. Its error reporting is designed to omit connection strings and PostgreSQL error messages.

## Workflow setup in GitHub

After the runner source has been reviewed and merged through the authorized PR path, the repository owner configures:

1. `Satsetx4/karturt` → **Settings** → **Environments** → **New environment**: `karturt-r2-staging`.
2. Set deployment branches to **Selected branches and tags**, with only `main` selected.
3. If a second human reviewer is available, add that person as a **Required reviewer**; each workflow run will then wait for their approval before continuing.
4. Add two uniquely named environment secrets, each containing a separate direct-endpoint PostgreSQL URL:
   - `KARTURT_R2_STAGING_DATABASE_MIGRATION_URL` → role `karturt_stg_migrator`.
   - `KARTURT_R2_STAGING_DATABASE_URL` → role `karturt_stg_runtime`.

The workflow maps these environment secrets to the application's `DATABASE_MIGRATION_URL` and `DATABASE_URL` variables only in the final step. The repository connection does not expose current environment or secret configuration, so the owner must confirm both names are environment-scoped and that no same-named organization or repository secret can be used as a fallback.

Do not add these as repository-wide secrets, `Vercel` variables, workflow text, artifacts, or issue comments. The owner keeps the actual passwords in a private password manager and enters the URLs directly in the GitHub Environment UI. Do not populate either secret while the matching role is `NOLOGIN`, while target isolation or recovery remains `UNKNOWN`, or before fresh exact-SHA authorization for any write.

The current database readback showed both application roles as `NOLOGIN`. A password reset alone does not change that attribute. If the owner later authorizes credential provisioning, enable `LOGIN` only on these existing SQL-created roles, verify each remains free of admin flags and memberships, and use the Console **Roles → Reset password** action separately for each role. Do not create or recreate these roles through Neon Console/API/CLI: Neon grants roles created through those surfaces membership in `neon_superuser`. Keep the target-bound role/ACL change and readback in issue #98 without password values.

## CLI modes and write boundary

For a staging environment, `npm run db:migrate` and `npm run db:migrate -- --plan` print the frozen target, checked-out SHA, and journal head without opening a database connection. `--preflight` opens actual `node-postgres` connections using both role-specific URLs and validates effective identities, PostgreSQL 18, active TLS with certificate-chain and direct-hostname verification, role attributes/grants, denied `TEMP`, and the pre-migration catalog. It performs no DDL or DML. Before that preflight can pass, the owner must establish an owner-owned, empty `drizzle` schema, direct migrator `USAGE` and `CREATE` on that schema, direct migrator `CREATE` on `public`, and direct migrator database `CREATE`; no grant options, role membership, database `TEMP`, or admin role attributes are allowed. Those owner changes are not performed by this workflow and require their own exact target and scope approval. `--apply` is the only staging mode that can call Drizzle migrations; it requires the exact SHA, target, operation, run/attempt, and the issue #98 authorization reference.

The journal is checked against all 14 frozen tags `0000`–`0013`. The existing bootstrap remains a separate `synthetic-fixture-create` operation. It is transaction-scoped and accepts a retry only when the complete fixed synthetic fixture is already present and relational checks match; a partial or unrelated fixture fails closed. The full R2 fixture path is still blocked until the initial RT/year/account/tariff prerequisites have a reviewed, exact-head-CI-verified bootstrap implementation.

Migration recovery is not an automatic rollback. Drizzle runs the pending migration statements and their journal inserts in one PostgreSQL transaction, and the source migration files contain no explicit transaction breaks or nontransactional index operations. PostgreSQL should roll back that transaction if one of those statements fails. Drizzle creates its schema and journal table before opening that transaction, and the runner also commits default-privilege and failure-cleanup ACL changes separately. A failed attempt can therefore leave the empty journal table and those ACL changes behind. The strict empty-catalog preflight then stops rather than automatically replaying. Post-migration privilege checks happen after the migration transaction commits, so a failure there cannot undo the schema. The source migrations include destructive schema refactors and do not define down migrations. After any failed attempt, preserve the database and logs, do not retry or reset it, and require owner-only catalog and migration-journal readback plus a separately approved recovery decision. The current migration process also cannot set its own role back to `NOLOGIN` or revoke owner-controlled database/schema grants. A successful migration event is not R2 PASS; keep R2 blocked until the owner completes and verifies those cleanup steps and runtime privileges.

## Current evidence boundary

As of 2026-10-25, the frozen R1 candidate SHA `41c6c9151a55cb2630dcd96ffd12449b184621d9` remains on draft PR #93 and its exact-head run `40129357313` attempt 1 passed Gate A and disposable PostgreSQL concurrency. This evidence remains tied to that SHA; code added by this runner is a new candidate and needs its own CI and fresh owner GO before database writes.

Read-only provider metadata identified the canonical Free-plan PostgreSQL 18 Singapore target and direct endpoint. The target branch metadata says `init_source=parent-data`, while parent lineage and synthetic-only provenance remain `UNKNOWN`; the branch has no confirmed snapshots or backup schedule. The database table listing was empty, but that alone does not establish isolation or recoverability. GitHub Environment settings are not readable through the current repository connection and remain `UNVERIFIED` until the owner checks them in the UI. The current default-branch ruleset requires a pull request and Gate A but no approving review; the owner must review this source before merging it into the trusted runner path. The actual Node PostgreSQL authenticated TLS check remains `UNVERIFIED` until both credentials are securely provisioned and a `preflight` completes.

## Owner GO comment format

For a future migration run, add these four lines as a public, non-secret comment on issue #98 only after the exact candidate, scope, target, isolation, grants, TLS plan, and recovery basis have been reviewed. Enter the full new candidate SHA and use the approved comment ID when dispatching:

```text
R2_RUNNER_GO: GO
SHA: <full-candidate-sha>
TARGET: flat-cloud-57657711/br-sparkling-flower-azordm9k/ep-red-boat-azzqyf45/karturt_staging
OPERATION: official-migrations-0000-0013
```

Do not put credentials, connection strings, resident information, or raw catalog output in that comment. The original GO for the frozen SHA does not authorize a new SHA.

## Sources

- [GitHub environments and environment secrets](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [Neon role management](https://neon.com/docs/manage/roles)
- [R2 synthetic fixture and integrity worksheet](./R2-SYNTHETIC-FIXTURE-AND-INTEGRITY-WORKSHEET.md)
