# Wave 13B.1R Agent A — Connected Transaction Contract

Date: 2026-10-14
Result: **G1 UNVERIFIED — connected runtime contract not established**
Scope: inspect exposed tool metadata and prior inert reports; no Neon SQL, database connection, endpoint wake, provider read, or tool invocation.

## Finding

The available evidence does not establish the behavior of the actual connected run_sql_transaction implementation. Its exposed description claims that multiple statements execute “as one transaction,” but the local tool registry exposes no implementation version, build, release, source revision, transport details, or runtime trace that links that description to a specific connected server. No SQL call was made to test behavior. A PostgreSQL 18 target version mentioned in earlier metadata is the database server version, not a Neon MCP connector version.

Two similarly named descriptors are currently visible in the local tool registry:

- mcp__neon__run_sql_transaction
- mcp__codex_apps__neon_run_sql_transaction

Both accept sql_statements: string[] and the same five optional target fields. Both describe multiple statements as one transaction. The first descriptor also includes project-scoped-connection guidance. The registry does not identify which descriptor was meant by the earlier generic run_sql_transaction references, which one a past execution would have selected, or whether the connected implementation matches either descriptor at runtime. Wave 13B.1 made no transaction-tool call.

The descriptor/schema is evidence of the interface presented to this task, not proof of server behavior. The registry provides no implementation identifier that could be matched to official source or release metadata. No unrelated public source revision is used to assert runtime semantics.

## Exposed interface and target fields

The currently exposed schema describes these fields:

| Field | Descriptor meaning | What remains unverified |
|---|---|---|
| project_id | Project ID; required for an unscoped connection, may be omitted for a project-scoped connection; an explicit ID must match the granted project. | That the connected runtime enforces the intended project and rejects a mismatch rather than falling back. |
| branch_id | Optional branch ID; omission selects the default branch. | That the submitted ID is bound to the same project and endpoint used by execution. |
| compute_id | Optional compute/endpoint ID; omission selects the branch read-write compute. | That the submitted ID is honored and validated against the branch. |
| database_name | Optional database name; omission selects neondb or the first available database. | That the submitted name is honored and validated against the selected branch. |
| role_name | Optional PostgreSQL role; credentials are resolved internally and not returned. Omission selects the database owner; on a role-pinned connection, omit it or pass that role. | That the submitted role is the effective login role, or that the runtime rejects a mismatch on a role-pinned connection. |

For a future reviewed D1v2 design, the fixed values recorded by the prior target metadata are:

| Argument | Fixed value |
|---|---|
| project_id | falling-bread-33359184 |
| branch_id | br-muddy-frost-azot13fb |
| compute_id | ep-silent-butterfly-azrflu40 |
| database_name | karturt_staging |
| role_name | karturt_staging_owner |

These are design values from the prior reports, not a fresh metadata readback by this lane. Supplying all five explicitly would avoid documented defaults, but the schema alone cannot prove the actual runtime binds each value. The SQL session also cannot attest to the Neon organization, project ID, branch ID, compute ID, or endpoint host. A future operator would need a fresh non-waking control-plane identity check and an independently reviewed binding between those identifiers and the connection target.

## Contract claim matrix

| Question | Evidence exposed here | G1 result |
|---|---|---|
| One backend session / session affinity | Neither descriptor states that all statements execute on one PostgreSQL backend session. “As one transaction” is the only transaction-specific claim. | **UNVERIFIED** |
| Transaction begin and statement order | The input is an array and the description says multiple statements execute as one transaction. It does not document whether execution is sequential in array order, when a transaction begins, or how an explicit transaction command inside the array is handled. | **UNVERIFIED** |
| First-error fail-fast | No descriptor states whether a statement error stops later statements, whether results are returned per statement, or whether an error is swallowed or aggregated. | **UNVERIFIED** |
| Commit and rollback | “As one transaction” does not document the commit point, rollback behavior on SQL error, timeout, client disconnect, or partial result. | **UNVERIFIED** |
| Savepoints | Neither descriptor mentions savepoint creation, error recovery, or ON_ERROR_ROLLBACK-like behavior. | **UNVERIFIED** |
| Timeout and cancellation | Neither descriptor documents timeout bounds, cancel propagation, connection teardown, or whether server work can continue after a client timeout. | **UNVERIFIED** |
| Exact target argument binding | Five optional fields and their documented default descriptions are exposed. No result echo or runtime trace binds the submitted values to the actual connection. | **UNVERIFIED at runtime** |

The pinned historical reference starts with SET TRANSACTION READ ONLY, then an identity/read-only guard, then the transaction-mode readback and catalog statements. It explicitly says the connector descriptor does not guarantee one server session, session affinity, stop-on-error, or endpoint idleness, and requires those semantics before D1. Because the wrapper's transaction-start behavior is undocumented, compatibility between a wrapper-managed transaction and that first SET TRANSACTION also remains unverified.

The Wave 13B.1 reports agree that no SQL or transaction-tool call occurred and that D1 ended UNKNOWN — NOT EXECUTED — CONTRACT/SAFETY BLOCKED. Earlier direct-TCP pg_sleep timeout evidence does not establish MCP transport cancellation or Neon WebSocket behavior; this lane did not repeat it.

## Narrow alternative for separate owner review

If the connected MCP contract remains unavailable, a separately authorized future D1v2 could use one controlled psql process and one connection to the exact endpoint host, database, and role. This is a proposal only; this wave did not connect or use it.

A reviewed invocation could use psql -X --set=ON_ERROR_STOP=on --set=ON_ERROR_ROLLBACK=off --single-transaction --file=<reviewed-sql-file> --dbname=<non-secret-connection-target>. The target must be prepared through the owner's approved secret path; do not put passwords or connection strings in this report, shell history, or logs. -X prevents startup files from changing client behavior. The SQL file must contain the exact owner-approved frozen statements, must not issue BEGIN, COMMIT, ROLLBACK, backslash-connect, or other psql meta-commands, and must not be substituted or edited between review and execution.

PostgreSQL 18's official psql documentation says --single-transaction sends BEGIN before the requested -c/-f work and COMMIT after it; with ON_ERROR_STOP, a command error sends ROLLBACK. ON_ERROR_STOP stops script processing after an error and returns status 3 for a script error. ON_ERROR_ROLLBACK defaults to off; setting it explicitly avoids savepoint-based continuation. See [PostgreSQL 18 psql documentation](https://www.postgresql.org/docs/18/app-psql.html).

Prerequisites and limits for that alternative:

1. The owner separately approves the exact revised SQL, the psql method, and the possibility of a compute wake. The existing D1 approval for the prior 29 statements does not transfer.
2. Immediately before execution, an authorized operator performs a fresh non-waking metadata readback and verifies the organization/project/branch/compute/database/role-to-host mapping. Connect directly to the exact endpoint host; project and branch IDs are checked against control-plane metadata because PostgreSQL cannot attest to those Neon IDs.
3. The approved SQL itself checks database, effective role, PostgreSQL version, and read-only transaction state before catalog reads. Any failed guard must stop the script and roll back.
4. Capture only the reviewed, bounded, redacted output and the psql exit status. A script SQL error should produce status 3 and rollback under the documented options. A lost connection, local timeout, interruption, or missing completion result is UNKNOWN; do not retry automatically or infer that server work was canceled.
5. Review the exact client version and invocation before use. This method supplies a documented client-side transaction/error policy, but it does not prove current endpoint lineage, physical emptiness, or privilege completeness.

This option is not authorization to run psql, connect to either Neon project, wake compute, or execute SQL. Any later D1v2 remains a separate owner gate; D2 and D3 are outside this work.

## Evidence inspected

- Exposed task tool registry metadata for mcp__neon__run_sql_transaction and mcp__codex_apps__neon_run_sql_transaction, inspected without invoking either tool. The descriptors include no server version or build metadata.
- All six prior Wave 13B.1 reports under docs/wave13b-1/2026-10-14/, including the transaction blocker, D1 outcome, target metadata, and D2 packet.
- Historical inert SQL reference docs/wave13b-0/2026-10-14/WAVE13B_0_READ_ONLY_PREFLIGHT_SQL_REFERENCE.md. Its blob hash is 78501ab327bdc7b7a9a06a0a0f66fe039fc8d148; it contains 29 SQL fenced blocks. The file was not modified.
- [PostgreSQL 18 psql documentation](https://www.postgresql.org/docs/18/app-psql.html), used only to describe the proposed client alternative.

No connector code, application code, SQL, provider setting, credential, or prior report was changed by this lane.
