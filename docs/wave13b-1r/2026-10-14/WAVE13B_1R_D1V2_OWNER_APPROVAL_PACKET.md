# Wave 13B.1R — D1v2 Owner Approval Packet

Date: 2026-10-14

State: **PREPARED FOR OWNER REVIEW — NO D1v2 APPROVAL OR EXECUTION**

## Decision requested

Review the exact frozen query companion and, only if the evidence and target are acceptable, separately authorize one bounded read-only D1v2 preflight by the psql method below. No live query, database connection, compute wake, provider change, migration, D2, or D3 is authorized by this packet.

**Recommended execution method:** one controlled `psql` process using one backend connection and one transaction. The connected Neon transaction MCP tool is not recommended for D1v2 because its actual runtime contract remains unverified.

## Exact frozen SQL artifact

The only candidate query text is [WAVE13B_1R_FIXED_SQL_REFERENCE.md](WAVE13B_1R_FIXED_SQL_REFERENCE.md), Git blob SHA-1 **e011f0e843d42d53c7c4c76ba479854644137fc9**. It contains 26 ordered SQL statements, with a SHA-256 for each statement. The ordered query manifest SHA-256 is **ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0**. The old approved Wave 13B.0 artifact is a separate 29-statement set, blob `78501ab327bdc7b7a9a06a0a0f66fe039fc8d148`; its approval does not transfer to this revision.

The candidate begins with `SET TRANSACTION READ ONLY`, then checks the exact database, login/effective role, transaction mode, and PostgreSQL 18 version before reading catalogs. It returns only fixed catalog fields and safe object names. It does not read application rows, migration-ledger rows, definitions, foreign options, mapping options, secrets, or configuration values. It contains no DML, DDL, dynamic SQL, `COPY`, or user-defined function calls.

The reference is a bounded evidence packet, not a claim of complete cluster-wide privilege coverage. Any cap, missing result, catalog visibility limit, or unresolved raw-ACL/effective-privilege mismatch yields `UNKNOWN`.

## Fixed resource identity for design review

These values come from prior non-waking control-plane readbacks and are **not a fresh execution-time verification**:

| Resource | Fixed design value |
|---|---|
| Organization | `satset` — `org-ancient-boat-57106549` |
| Project | `karturt-v1-staging-clean` — `falling-bread-33359184` |
| Branch | `staging` — `br-muddy-frost-azot13fb` |
| Compute / endpoint | `ep-silent-butterfly-azrflu40` |
| Endpoint host | `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech` |
| Database | `karturt_staging` — database ID `702718` |
| Login role | `karturt_staging_owner` |
| Server version | PostgreSQL 18 (prior metadata; the SQL guard also checks the connected server) |

Immediately before any separately approved execution, an authorized operator must make a fresh **non-waking** provider readback and verify that every identifier still maps to the same target. Connect only to the exact endpoint host, database, and role. PostgreSQL cannot attest to the Neon organization, project, branch, or compute IDs; those require the matching control-plane readback. Do not fall back to `wild-art-99835126` or any other endpoint.

The earlier metadata `init_source=parent-data`, approximate 31.7 MB logical size, zero tracked writes, `passwordless_access=true`, and idle/read-write endpoint state do not establish independent lineage, physical emptiness, unauthenticated access, or current state. A D1v2 connection may wake the compute. No current wake or cost outcome is claimed; the owner must explicitly accept the possible wake before execution.

## Proposed transaction and error handling

Proposed invocation shape (placeholder only; no connection target, password, or secret is included here):

```text
psql -X --set=ON_ERROR_STOP=on --set=ON_ERROR_ROLLBACK=off --single-transaction --file=<reviewed-sql-file> --dbname=<owner-approved-target>
```

For psql, prepare a SQL-only file by extracting the 26 fenced SQL bodies exactly and in order from the approved Markdown companion. Verify every statement fingerprint and the ordered manifest before opening a connection; do not run the Markdown file itself. The SQL-only file must contain no `BEGIN`, `COMMIT`, `ROLLBACK`, `\connect`, or other psql meta-command. `-X` disables startup files. `--single-transaction` supplies one transaction around the file; `ON_ERROR_STOP` stops processing after a SQL error; `ON_ERROR_ROLLBACK=off` prevents savepoint-based continuation. PostgreSQL 18 psql documentation states that an error in this mode rolls back the transaction and a script error returns status 3: [psql documentation](https://www.postgresql.org/docs/18/app-psql.html).

This documented client-side method passed the bounded synthetic PostgreSQL 18.6 transaction probes in [Agent C's independent report](WAVE13B_1R_AGENT_C_INDEPENDENT_VALIDATION.md), including first-error stop, rollback, and successful commit readback. That test does not establish the Neon target or connected MCP contract. A lost connection, timeout, interruption, or missing final status remains `UNKNOWN`; it does not prove server-side cancellation. Do not retry automatically. Use an owner-approved secret path, and do not place credentials in shell history, report text, or captured logs.

## Result classification

| Classification | Required interpretation |
|---|---|
| `CLEAN_CATALOG_PREFLIGHT` | Every statement completed on the exact approved target, all results are complete and below caps, the owner-approved object/role/privilege baseline matches, no unexpected object or grant exists, and all effective-access questions are reconciled. This is a bounded catalog result only; it does not prove physical emptiness, lineage, network isolation, or cluster-wide privilege completeness. |
| `UNCLEAN` | Complete evidence shows an unexpected role, grant, object, owner, extension, ledger-object state, or other mismatch against the separately approved baseline. Stop; no repair is authorized. |
| `UNKNOWN` | Any target mismatch or uncertainty, failed guard, wrong version, transaction/error ambiguity, SQL error, missing/truncated result, cap reached, privilege visibility gap, or unresolved ACL/effective-access question. Stop and report the exact gap. |

Never convert missing evidence into a clean result. Do not continue after an error or issue ad hoc follow-up SQL under this approval.

## Mandatory stop cases

Stop before connecting if fresh target metadata differs, cannot be read without waking compute, or does not bind the endpoint host to the fixed project/branch/compute/database/role. Stop if the owner does not accept a possible compute wake. During execution, stop on any guard failure, non-PostgreSQL-18 version, role or database mismatch, write-capable transaction state, SQL error, timeout/cancellation uncertainty, truncated or missing output, cap reached, catalog permission error, unexpected grant/object/owner, or unresolved difference between raw ACLs and effective-privilege evidence. Do not split statements, add queries, switch methods/targets, or retry.

## Boundaries that remain closed

This packet does not authorize either Neon SQL tool, direct database connection, compute wake, query, role/grant/network/endpoint/branch/project mutation, credential retrieval, key generation/pinning/signing, migrations 0000–0013, staging runtime guard changes, Vercel environment/deployment, paid resources, merge, D2, or D3. The source safeguards must remain `stagingIsolationVerifiedEmpty=false` and `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null`.

## Owner decision record — pending

No approval is recorded in this document. For a future D1v2 only, the owner must explicitly approve all of the following after reviewing the final pushed artifact and fresh target readback:

- [ ] The exact 26-statement companion artifact and its SHA-1 / manifest SHA-256 above.
- [ ] The fixed resource tuple, after fresh non-waking identity verification.
- [ ] The psql transaction/error-handling method and its documented limitations.
- [ ] The possibility that a single connection may wake the Free compute.
- [ ] The bounded `CLEAN_CATALOG_PREFLIGHT` / `UNCLEAN` / `UNKNOWN` decision rules and stop cases.
- [ ] One D1v2 execution only; no extra SQL or automatic retry.

Owner decision: **PENDING — NOT APPROVED**

Approval reference / date: **PENDING**

Any future D1v2 execution, and any later D2 or D3, requires its own explicit owner gate.
