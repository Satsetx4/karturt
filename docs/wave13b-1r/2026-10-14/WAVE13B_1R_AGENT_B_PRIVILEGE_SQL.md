# Wave 13B.1R — Agent B Privilege and SQL Coverage Review

**Result: bounded candidate prepared; no live SQL executed; independent PostgreSQL 18 syntax/behavior validation pending.**

## Scope and predecessor evidence

Reviewed the six Wave13B.1 reports under docs/wave13b-1/2026-10-14, the previous Wave13B.0 SQL reference, and its D1 result/owner packet. The historical reference remains the approved 29-statement set and its Git blob SHA-1 is 78501ab327bdc7b7a9a06a0a0f66fe039fc8d148; its 29 SQL fences are unchanged. The predecessor outcome is UNKNOWN — NOT EXECUTED — CONTRACT/SAFETY BLOCKED. Connector behavior and privilege evidence were insufficient for a D1 result. This review did not run database SQL, invoke a Neon SQL tool, connect to Neon, or change provider state.

The new candidate is WAVE13B_1R_FIXED_SQL_REFERENCE.md: 26 fixed SQL statements with per-statement SHA-256 and an ordered manifest hash. It is a proposal for independent Agent C validation and later owner review. It does not inherit approval from the prior 29-statement set.

## Requirement-to-evidence matrix

| Requirement | Candidate evidence | Core migration-security use | Limit and fail-closed response |
| --- | --- | --- | --- |
| Exact connected database and roles | Q02 guard, Q04 identity result; explicit five-argument target tuple and provider identity in the reference | Require exact database, login role, active role, and separately verified target identity to agree | SQL identity is not pre-call binding. Mismatch, alias, or unverifiable backend is UNKNOWN |
| Read-only and PostgreSQL 18 | Q01 sets read-only; Q02 checks transaction_read_only and server_version_num; Q03/Q05/Q06 retain separate evidence | Require guard success and matching read-only/version evidence | Q01/guard do not prove the transaction wrapper began correctly or that the connector pins one session. Any disagreement is UNKNOWN |
| Role attributes | Q07 outputs superuser, inherit, create-role, create-database, login, replication, bypass-RLS, and connection limit | Compare all visible roles and the target role to an explicit approved role baseline | Password, validity, role configuration, and secret-bearing settings are omitted. Confirm role-catalog visibility |
| Membership edges and delegation | Q08 records granted role, member, grantor, ADMIN, INHERIT, SET for each edge | Compare every edge and option to the approved graph; no unexpected membership/delegation path | Catalog results cap at 500 rows plus truncation sentinel. At cap or catalog error: UNKNOWN |
| Inherited/applicable-role evidence | Q09 information_schema.applicable_roles; compare with raw Q08 edges and role attributes | Require no unexpected applicable role that expands migration authority | View is relative to connected user; it is not a cluster-wide role list or replacement for the raw graph |
| Database owner and ACL | Q10 database name, owner, raw datacl | Exact target database owner/ACL must match baseline | Does not prove access to every cluster database if visibility is restricted; missing row or cap is UNKNOWN |
| Schema owner and ACL | Q11 visible schemas, owners, raw nspacl | Require only approved schema set and exact ownership/grants | Does not calculate effective CREATE/USAGE; owner and raw ACL need explicit reconciliation |
| Relations, sequences, partitions, relation grants and MAINTAIN | Q13 non-internal relation rows with relkind, owner, raw relacl, RLS flags; Q19 cross-check | Exact object allowlist and relation owner/ACL baseline; compare sequence SELECT/UPDATE and table MAINTAIN from raw ACLs | Q19 omits MAINTAIN and is filtered. Effective booleans are not calculated. Unreconciled ACL is UNKNOWN |
| Effective/inherited privileges for the migration role | Q26 reports built-in has_*_privilege booleans for the fixed target role on databases, schemas, tables (including MAINTAIN), columns, sequences, routines, and types; reconcile with Q07–Q18 raw ownership/ACL evidence and Q08 membership options | Review effective access including owner, PUBLIC, and applicable role paths for every core object/privilege pair | Exact target role only; Q26 is capped at 500 rows plus sentinel and covers only named core classes. Any cap, error, or unexplained result is UNKNOWN |
| Column grants and grant options | Q14 non-null attacl on non-system columns; Q20 information-schema cross-check | No unapproved explicit column grant or grant option; account for table-level ACLs separately | No Q14 row means no explicit column ACL, not no effective access. Information-schema is filtered |
| Routines | Q15 owner, routine kind, security-definer/leakproof flags, raw proacl; Q21 cross-check | No unexpected routine, owner, ACL, grant option, or security-definer routine | Definitions, arguments, config, and full routine bodies are excluded. Effective privilege is not calculated |
| Types and domains | Q16 owner, type kind/category, raw typacl; Q22 usage cross-check | No unexpected user-defined type/domain owner or usage grant | Q22 is filtered and does not establish cluster-wide effective privilege |
| Default ACLs | Q17 visible global/per-schema default ACL rows, owner, object type, raw ACL | Require exact approved default-ACL set before future object creation | NULL object ACL means built-in default behavior, not no privilege. pg_default_acl applies to future objects |
| FDW and foreign-server privileges | Q18 owner and raw ACL for wrappers/servers; Q22 USAGE cross-check | No unexpected wrapper/server grant, owner, or grant option | Foreign options, connection details, and external-system permissions are excluded; visibility may block |
| Language privileges | Q18 owner and raw ACL for procedural languages | Require only approved language/object owner/ACL state | Does not inspect runtime binaries or language behavior |
| Large-object grants | Q18 large-object metadata OID, owner, raw ACL | No unexpected large-object metadata or ACL | Does not inspect content, size, references, or physical storage; result cap applies |
| Tablespace privileges | Q18 tablespace name, owner, raw ACL | Compare CREATE grants and ownership with approved baseline | Does not inspect tablespace path/configuration or provider storage policy |
| Configuration-parameter privileges | Q18 parameter name and raw paracl | Compare SET / ALTER SYSTEM grants and grant options with approved baseline | Parameter values and other configuration state are excluded; owner/default privilege representation must be reconciled |
| Extension inventory | Q12 extension names/version/schema | Require exact approved extension list and schema placement | Does not inspect extension definitions or all extension-owned objects |
| Relation-owned secondary objects | Q23 safe names/OIDs for triggers, constraints, policies, rewrite rules and parent OIDs | No unexpected secondary object under exact allowlist; map owner through parent relation/type | No expressions, definitions, policy contents, or standalone effective-ownership expansion |
| Events, publications, subscriptions, user mappings | Q24 names/OIDs and owner or grantee identity; no options | No unexpected listed object; mapped role/server and owner identity are explicit | No per-table publication membership, subscription connection data, user-mapping options, or provider-side replication state |
| Migration ledger | Q25 exact relation-presence check only | Baseline states whether ledger object must be absent/present; unexpected state stops | Does not read ledger rows, migration names, or checksums; it is not a migration-status assertion |
| Audit completeness and bounded collection | All catalog queries are ordered and capped at 501; Q25 at 2; statement order and hashes are frozen | Preserve all 25 ordered results and verify every cap/completeness marker | Capped/incomplete result is UNKNOWN; catalog engine may inspect more than 501 rows to sort/filter. Not complete cluster-wide coverage |

## Core minimum versus extended evidence

### Core minimum for a future migration-security preflight

Before a future migration is considered, the owner must define an exact migration-specific baseline and allowlist. At minimum:

1. Exact project, branch, compute, database, and role binding agrees before execution and inside the SQL guard.
2. The actual execution method demonstrably uses one backend session, one read-only transaction, ordered stop-on-first-error execution, rollback on every error/uncertainty, and explicit commit only after every result is complete.
3. PostgreSQL 18 and exact role identity are verified. Q07/Q08/Q09 establish relevant role attributes, membership graph, ADMIN/INHERIT/SET options, and connected user's applicable-role evidence.
4. Database/schema/relation/column/routine/type/default ACL and other named grantable-object ACLs are compared with a frozen allowlist and owner-approved privilege baseline. Reconciliation includes direct ACL entries, grant options, ownership, PUBLIC, role membership, hard-wired defaults, and inherited privileges.
5. The public schema and user-visible object inventories are compared with an exact allowlist. Expected extensions and ledger-object state are explicit.
6. All 26 statements complete with stable result shapes below caps. No result is inferred from a missing row, filtered information-schema view, or tool-description claim.

This minimum is **not satisfied yet**. The candidate has not been validated on PostgreSQL 18; actual connector transaction semantics remain unverified; and there is no approved effective-privilege baseline. No future query is authorized.

### Extended coverage in the candidate

The candidate adds role-edge options, raw ACLs and ownership for major grantable classes, explicit column ACLs, PG18 MAINTAIN evidence, applicable-role evidence, Q26 built-in effective privilege checks for core object classes, extensions, relation flags, default ACLs, and bounded safe-name inventory for selected secondary object classes. It excludes application rows, migration-ledger rows, definitions, SQL expressions, connection strings, secret-bearing options/configuration values, dynamic SQL, helper functions, DML, and DDL.

## Material interpretation limits

- pg_auth_members records membership edges with grantor and independent ADMIN, INHERIT, and SET options. Reconcile its edge list with applicable_roles. Neither source alone proves every effective privilege.
- PostgreSQL privilege checks combine direct grants, grants to applicable roles, PUBLIC, object ownership, and built-in defaults. An ACL string records direct ACL entries and grant-option state; it is not an effective-access matrix. Q26 calls only PostgreSQL built-in has_*_privilege functions for the fixed target role and enumerated core classes; it is not a user-defined helper. It does not calculate effective booleans for every object class, every role, or every cluster object. Reconcile Q26 with raw ACLs, ownership, and separate ADMIN/INHERIT/SET edge facts. Any unexplained grant path is UNKNOWN.
- PostgreSQL 18 adds MAINTAIN to table privileges. The information-schema table_privileges list documents SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER, not MAINTAIN. Use raw pg_class.relacl for MAINTAIN and reconcile it explicitly.
- usage_privileges covers USAGE for collations, domains, FDWs, servers, and sequences. Sequence SELECT and UPDATE are PostgreSQL extensions and are not shown there; use the raw relation ACL. Q19–Q22 are visibility-filtered cross-checks, not the ACL source of truth.
- A NULL object ACL denotes PostgreSQL's hard-wired default for that object; it does not mean there are no privileges. pg_default_acl applies when future objects are created and does not retroactively rewrite current ACLs.
- This candidate is bounded, not a complete PostgreSQL cluster-wide privilege universe. Q26 gives inherited/effective evidence for its core classes and the fixed migration role, but not for every object class or role. Current-database catalogs do not expose all object state in all databases; provider restrictions and visibility may hide data. The candidate omits role/database setting values, some object classes with implicit ownership but no ordinary GRANT privilege, extension-owned object details, per-publication table membership, subscription contents, and server-side policy. Do not call a clean bounded packet cluster-wide clean, empty, isolated, or lineage-proven.
- Read-only transaction state cannot prove that a client timeout cancelled server work. Connector cancellation and WebSocket parity remain outside this SQL reference.

## Disposition and stop boundary

Outcome remains **UNKNOWN — NOT EXECUTED — CONNECTOR CONTRACT AND PRIVILEGE RECONCILIATION UNVERIFIED**. Agent C must review SQL syntax, guards, empty and unexpected catalogs, synthetic privilege combinations, result completeness, and abort/rollback behavior on a genuinely disposable PostgreSQL 18 instance. Connector review must independently establish actual current implementation semantics.

If required evidence cannot be established, keep the result UNKNOWN and present a narrow alternative execution method for separate owner review. No Neon SQL, database connection, compute wake, provider mutation, migration, key operation, runtime guard change, Vercel action, merge, or D1v2/D2/D3 work is authorized here. The prior D1 approval applies only to its original 29-statement set.

## PostgreSQL 18 documentation sources

- [GRANT and privilege behavior](https://www.postgresql.org/docs/18/sql-grant.html)
- [Built-in privilege-check functions](https://www.postgresql.org/docs/18/functions-info.html)
- [Role attributes](https://www.postgresql.org/docs/18/role-attributes.html)
- [Role membership edges](https://www.postgresql.org/docs/18/catalog-pg-auth-members.html)
- [Applicable roles](https://www.postgresql.org/docs/18/infoschema-applicable-roles.html)
- [Database ACL catalog](https://www.postgresql.org/docs/18/catalog-pg-database.html)
- [Schema ACL catalog](https://www.postgresql.org/docs/18/catalog-pg-namespace.html)
- [Relation ACL and relation kinds](https://www.postgresql.org/docs/18/catalog-pg-class.html)
- [Column ACLs](https://www.postgresql.org/docs/18/catalog-pg-attribute.html)
- [Routine ACLs](https://www.postgresql.org/docs/18/catalog-pg-proc.html)
- [Type ACLs](https://www.postgresql.org/docs/18/catalog-pg-type.html)
- [Default ACL behavior](https://www.postgresql.org/docs/18/catalog-pg-default-acl.html)
- [Configuration-parameter ACLs](https://www.postgresql.org/docs/18/catalog-pg-parameter-acl.html)
- [Information-schema table privileges](https://www.postgresql.org/docs/18/infoschema-table-privileges.html)
- [Information-schema usage privileges](https://www.postgresql.org/docs/18/infoschema-usage-privileges.html)
- [Read-only transaction control](https://www.postgresql.org/docs/18/sql-set-transaction.html)