# Wave 12.6B Agent B — Initial Catalog State

**Disposition:** SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE; PHYSICAL EMPTINESS NOT VERIFIED.

## Target binding

One SQL transaction was executed against the exact provider-returned target:

- Project: falling-bread-33359184
- Branch: br-muddy-frost-azot13fb
- Database: karturt_staging
- Compute endpoint: ep-silent-butterfly-azrflu40
- Role: karturt_staging_owner
- Provider PostgreSQL version: 18

## Transaction and guard result

The transaction reused the previously reviewed, fixed 26-statement Wave 12.4 inventory. It was sent as one ordered call. Statement 1 was SET TRANSACTION READ ONLY. No retry, fallback, or second SQL call occurred.

- All 26 result groups were returned; no error or truncation marker was reported.
- SHOW transaction_read_only returned on.
- The server-side exact database and role assertion returned wave124_guard=1.
- Identity read-back matched database karturt_staging and role karturt_staging_owner with transaction_read_only=on.

## Bounded inventory outcome

| Inventory | Result |
|---|---|
| Non-system namespaces | public only |
| Extension inventory | plpgsql 1.0 in pg_catalog only |
| Relations, constraints, indexes, sequences | No non-system rows |
| Types, domains, enum labels, ranges, routine metadata | No non-system rows |
| Triggers, event triggers, policies | No non-system rows |
| Foreign-data wrappers, servers, tables, user mappings | No rows |
| Publications, table/schema mappings, current-database subscriptions | No rows |
| drizzle.__drizzle_migrations | Not present in the queried catalog scope |

No user table rows were selected. No routine was invoked, and no routine body, credential, connection URI, foreign option, subscription connection detail, or application record was read. The fixed query set does not inventory every PostgreSQL catalog family, privileges, all object definitions, or data contents.

This supports **SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE** only. It does not prove physical emptiness, no-copy lineage, synthetic-only data, or migration readiness. Provider metadata init_source=parent-data and written_data_bytes=0 do not change that limit. The database was not modified.

The successful GitHub Actions rehearsal 38503239173 remains separate: it ran the migration chain on disposable PostgreSQL 18.6, not on this Neon project. No migration was applied here.

**Agent B disposition:** bounded initial catalog inspection succeeded. Keep stagingIsolationVerifiedEmpty=false and require a separate owner decision before any Wave 13 action.
