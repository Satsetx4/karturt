# Wave 12.1 Agent B — Neon Read-Only Preflight

**Assessment:** PARTIAL — approved target metadata aligned; database inspection BLOCKED.
**Inspection date:** 2026-10-13.
**Repository checkout:** detached at application source SHA `355c5804df9767e7ce8456edde4439a4a7eaedc9`.

## Scope and method

All provider calls below were read-only metadata operations. Project-level requests explicitly passed project ID `wild-art-99835126`; branch-level requests explicitly passed branch ID `br-hidden-cake-a1ge5xqp`. No connection string was requested or displayed.

Tools used:

- `mcp__codex_apps__neon_list_organizations` with the exact approved organization ID as search.
- `mcp__codex_apps__neon_list_projects` with exact organization ID `org-ancient-boat-57106549` and project ID search `wild-art-99835126`.
- `mcp__codex_apps__neon_list_branches` with project ID `wild-art-99835126`.
- `mcp__codex_apps__neon_list_postgres_endpoints` with project ID `wild-art-99835126`.
- `mcp__codex_apps__neon_list_postgres_databases` with project ID `wild-art-99835126` and branch ID `br-hidden-cake-a1ge5xqp`.
- `mcp__codex_apps__neon_list_postgres_roles` with project ID `wild-art-99835126` and branch ID `br-hidden-cake-a1ge5xqp`.

The SQL connector schema was inspected but no SQL tool was invoked. `mcp__codex_apps__neon_run_sql` accepts an arbitrary SQL string and has no read-only transaction, role, or session enforcement parameter. The transaction variant also accepts arbitrary statements and offers no read-only guarantee. Therefore the connector cannot establish a read-only session, even if a proposed statement were SELECT-only.

## Metadata readback

| Resource | Observed metadata | Result |
|---|---|---|
| Organization | `satset`, ID `org-ancient-boat-57106549`, plan `free` | Matches approved target |
| Project | `karturt-v1-staging`, ID `wild-art-99835126`, region `aws-ap-southeast-1`, PostgreSQL 18 | Matches approved target |
| Project compute defaults | Min/max 0.25 CU; suspend timeout 0 seconds | Matches approved target; no setting was changed |
| Branch | `staging`, ID `br-hidden-cake-a1ge5xqp`; primary/default; provider state `ready` | Matches approved target |
| Database | `karturt_staging`, ID `42079960`, owner `karturt_staging_owner` | Matches approved target |
| Role metadata | `karturt_staging_owner`; authentication method `password`; provider listing does not establish read-only privileges | Identity matches; read-only privilege is unverified |
| Compute endpoint | ID `ep-snowy-meadow-a10304d9`; region `aws-ap-southeast-1`; type `read_write`; hostname `ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech`; min/max 0.25 CU; suspend timeout 0 | Matches approved target |
| Compute state/access | Provider reported endpoint `idle`; `passwordless_access=true` | No wake attempted |

## Stop decision

Database query and content/emptiness verification are **BLOCKED**:

1. The branch metadata reports `init_source=parent-data`. Its parent lineage/content is not established as empty by metadata.
2. The endpoint is read-write and passwordless access is enabled. The role metadata does not attest read-only privileges.
3. The available SQL connector executes arbitrary SQL and cannot enforce a read-only role or transaction.

Per the stop condition, I stopped before any query and did not start/wake compute. No schemas, migration ledger, application tables, or row counts were inspected. Branch logical-size metadata is not evidence that database contents are empty.

## Actions explicitly not taken

No SQL or direct database connection; no credentials or connection strings obtained; no compute wake; no DDL/DML, migration, fixtures, teardown, resource/configuration change, or retry.

## Lane verdict

- **Target metadata alignment:** PASS.
- **Database read-only inspection:** BLOCKED.
- **Database emptiness:** NOT VERIFIED.
- **Overall Neon preflight:** PARTIAL; this is not migration approval or staging readiness.
