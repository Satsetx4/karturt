# Wave 12.2 Agent B — Neon Metadata and Read-Only Inspection

**Date:** 2026-10-14 (Asia/Bangkok)
**Assessment:** PARTIAL — approved target metadata aligned; exactly one read-only inspection transaction completed; database emptiness NOT VERIFIED.
**Application source checkout:** detached at `d4fc471a988c070ca2118e12ddbb0b363daa6541` (tree `15bb2fc622f19d0715906479083ae87bcbb85cec`).
**Documentation baseline reviewed:** `docs/wave12-1-staging-readonly-20261013` at `4836d7858932c06f231e1960f6084e9535203bc9`.

## Scope and method

I read all five Wave 12.1 reports and reviewed the current `src/lib/staging-database-target.ts`. The guard still sets `stagingIsolationVerifiedEmpty=false` and rejects the approved staging target because provider metadata reports `init_source=parent-data`.

Provider checks in this lane used metadata-only Neon tools, with the approved organization, project, branch, database, role, and endpoint IDs passed explicitly:

- `list_organizations` filtered to `org-ancient-boat-57106549`.
- `list_projects` scoped to that organization and filtered to `wild-art-99835126`.
- `list_branches` scoped to project `wild-art-99835126` and filtered to `staging`.
- `get_postgres_database`, `get_postgres_role`, and `get_postgres_endpoint` scoped to the exact approved IDs/names.

No connection string or credential was requested. Before the coordinator's GO arrived, no SQL or connection was attempted. After GO, exactly one MCP `run_sql_transaction` call was made as described below; no separate direct client connection, manual wake, or retry was used.

## Metadata readback

| Resource | Observed metadata | Result |
|---|---|---|
| Organization | `satset`, `org-ancient-boat-57106549`, plan `free` | Matches allowlist |
| Project | `karturt-v1-staging`, `wild-art-99835126`, `aws-ap-southeast-1`, PostgreSQL 18 | Matches allowlist |
| Project compute defaults | Min/max 0.25 CU; suspend timeout 0 seconds | Matches supplied baseline; no settings changed |
| Branch | `staging`, `br-hidden-cake-a1ge5xqp`; primary/default; provider state `ready` | Matches allowlist |
| Branch lineage/content indicators | `init_source=parent-data`; logical size 31,686,656 bytes; `written_data_bytes=0` in provider metadata | Does not prove empty contents or safe lineage |
| Database | `karturt_staging`, ID `42079960`, owner `karturt_staging_owner` | Matches allowlist |
| Role | `karturt_staging_owner`; authentication method `password` | Identity matches; metadata does not attest read-only privileges |
| Endpoint | `ep-snowy-meadow-a10304d9`; hostname `ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech`; `read_write`; 0.25 CU | Matches allowlist; endpoint is writable |
| Endpoint state/access | `idle`; `passwordless_access=true`; suspend timeout 0 | No wake attempted |

## Stop decision and limits

Database content inspection remains **BLOCKED**. The metadata aligns with the approved target, but:

1. The branch has `init_source=parent-data`; its inherited lineage and contents are not established as empty.
2. The only approved endpoint is read-write and allows passwordless access.
3. The role metadata does not establish read-only privileges.
4. When the initial metadata-only report was prepared, Agent A's method proof and the coordinator's explicit GO had not yet arrived. The coordinator later granted GO for one transaction, whose result is recorded below.

Before GO, no query or database session was attempted. The one authorized transaction found no rows matching its fixed relation, aggregate, and migration-ledger queries. Database emptiness is still **NOT VERIFIED** because lineage/content are unresolved and query filters do not inventory every possible object type. This report does not authorize or evidence a migration.

## Actions not taken

No connection string or credentials were obtained. No DDL/DML, migration, seed, teardown, branch/project/role/endpoint change, or retry was performed. No manual compute start was invoked; any on-demand compute behavior internal to the one MCP transaction was not independently re-read. No source files or provider settings were changed. This lane report is intentionally uncommitted for coordinator integration.

## Lane verdict

- **Approved target metadata alignment:** PASS.
- **Server-enforced read-only session:** PASS for the one inspected transaction; `SHOW transaction_read_only` returned `on`, the guard returned `1`, and database/role identity matched.
- **Neon database inspection:** PARTIAL — one authorized transaction completed; the fixed relation, aggregate, and migration-ledger queries returned no rows.
- **Database emptiness/content:** NOT VERIFIED.
- **Migration readiness:** BLOCKED; migration remains unauthorized.
- **Overall provider assessment:** PARTIAL.


## Follow-up metadata reread (2026-10-14)

A fresh project-scoped `list_postgres_endpoints` read returned exactly **one endpoint** for project `wild-art-99835126`. That endpoint is `ep-snowy-meadow-a10304d9`, bound to branch `br-hidden-cake-a1ge5xqp`, with hostname `ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech`. The endpoint remains `read_write`, `idle`, and `passwordless_access=true`.

Fresh branch metadata again returned `br-hidden-cake-a1ge5xqp` as `primary=true` and `default=true`, with `init_source=parent-data`. A fresh database listing for that branch returned exactly one database, `karturt_staging` (ID `42079960`), owned by `karturt_staging_owner`. The role listing returned exactly one role, `karturt_staging_owner`, with authentication method `password`; its read-only privileges remain unverified.

**Endpoint resolution assessment:** the metadata mapping is unambiguous at this readback: the target project has one endpoint, and it is bound to the target branch. The SQL tool schema does not accept an `endpoint_id`, so this establishes only an unambiguous provider metadata mapping, not connector enforcement or transaction safety. At the time of this metadata reread, no SQL, connection, or wake had been attempted. The coordinator later granted GO for exactly one read-only transaction, documented below.

## Authorized read-only transaction inspection (2026-10-14)

After Agent A's method review and the coordinator's explicit GO, I made exactly one call to `mcp__neon__run_sql_transaction`, passing explicit `project_id=wild-art-99835126`, `branch_id=br-hidden-cake-a1ge5xqp`, and `database_name=karturt_staging`. No `run_sql` or other SQL connector was used. The tool schema describes its input as multiple SQL statements executed as one transaction. The SQL tool has no `endpoint_id` argument; the immediately preceding metadata readback returned exactly one project endpoint, bound to this branch.

The call used the coordinator's exact seven statements, as separate array elements, in this order: `SET TRANSACTION READ ONLY`; `SHOW transaction_read_only`; the target/read-only guard; the database/role/version identity query; the fixed non-system relation listing; the fixed per-schema aggregate query; and the fixed Drizzle migration-ledger lookup. The tool returned seven ordered result groups:

| Step | Result |
|---|---|
| `SET TRANSACTION READ ONLY` | Completed; empty result set |
| `SHOW transaction_read_only` | `on` |
| Guard for read-only state and exact database/role | `inspection_guard=1` |
| Identity/version | Database `karturt_staging`; role `karturt_staging_owner`; PostgreSQL `18.6 (c021049)`; transaction read-only `on` |
| Fixed non-system relation listing | No rows matched the query filters |
| Fixed per-schema relation aggregate | No rows matched the query filters |
| Fixed `__drizzle_migrations` lookup | No rows matched the query filters |

No row-level data was selected. The fixed catalog queries found no matching non-system tables, partitioned tables, views, materialized views, sequences, or foreign tables, and did not locate a Drizzle migration ledger. The aggregate query emitted no schema/object-kind rows; this is not a zero-row estimate. The query filters did not inventory every possible non-system object type, and PostgreSQL catalog estimates do not prove physical emptiness.

**Inspection classification:** `NOT VERIFIED`. The single read-only transaction completed against the expected database and role, with PostgreSQL reporting read-only mode. The observed absence of matching relations and a migration ledger is useful catalog evidence, but `init_source=parent-data` leaves lineage and inherited content unresolved; database emptiness and migration readiness are not established. No migration is authorized.
