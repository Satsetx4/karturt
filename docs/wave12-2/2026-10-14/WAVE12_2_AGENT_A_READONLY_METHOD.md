# KartuRT V1 Wave 12.2 — Agent A Read-Only Method Review

**Date:** 2026-10-14 (Asia/Bangkok)
**Lane result:** **METHOD QUALIFIED FOR CONDITIONAL GO** through the Neon transaction tool only when its first statement sets the transaction read-only and an in-transaction guard aborts before catalog inspection if that condition is false. No database connection, wake, SQL call, local PostgreSQL validation, code change, commit, or push was performed by this lane.

## Baseline and Wave 12.1 evidence

- Repository: Satsetx4/karturt.
- Assigned worktree: D:\!AGY\karturt-wave12-2-agent-a, detached at application source commit d4fc471a988c070ca2118e12ddbb0b363daa6541, tree 15bb2fc622f19d0715906479083ae87bcbb85cec.
- The five Wave 12.1 reports were read from documentation ref docs/wave12-1-staging-readonly-20261013 at 4836d7858932c06f231e1960f6084e9535203bc9: Agent A source guard, Agent B Neon read-only, Agent C security QA, Coordinator report, and Owner Decision Packet.
- Wave 12.1 evidence keeps stagingIsolationVerifiedEmpty=false and says no Neon SQL, connection, or wake occurred. That guard state is unchanged in this worktree. The database contents and lineage remain unverified.

## Migration inventory

At the exact source commit, the repository contains:

- 14 SQL migration files, numbered 0000 through 0013.
- 14 Drizzle journal entries and 14 snapshots, numbered 0000 through 0013.
- 27 pgTable definitions in src/db/schema.ts; the latest snapshot 0013 also contains 27 table entries.

Read-only inventory commands completed successfully (exit 0): enumerating drizzle/*.sql; counting entries in drizzle/meta/_journal.json; counting drizzle/meta/*_snapshot.json; counting pgTable calls in src/db/schema.ts; and counting tables in drizzle/meta/0013_snapshot.json. No migration was run.

## Driver and connector capability

- package-lock.json resolves @neondatabase/serverless to 1.1.0. src/db/client.ts imports its Pool and uses a shared pool with max 5 through Drizzle's neon-serverless adapter. The app pool is not a suitable inspection transaction handle unless a single client is explicitly checked out and used for every statement.
- package-lock.json resolves pg to 8.23.1 as a devOptional dependency. No dependencies are installed in this worktree, so neither local driver implementation nor a local transaction run was tested.
- The Neon connector schema exposes run_sql for one arbitrary SQL statement and run_sql_transaction for an ordered array described as one transaction. Neither tool exposes a readOnly parameter. The single-statement tool cannot establish a verified multi-query read-only transaction.
- A caller-supplied first statement SET TRANSACTION READ ONLY is a viable server-enforced mechanism inside the transaction tool's transaction: PostgreSQL applies the access mode to the active transaction before any later query, and the tool contract places the submitted statements in that transaction. The server, rather than client-side SQL filtering, then rejects writes for that transaction. This is a caller-enforced preamble; it is not a default protection supplied by the connector.
- To fail closed within the non-interactive statement array, the first caller statement must be SET TRANSACTION READ ONLY; the next statement must assert current_setting('transaction_read_only') = 'on' and raise a SQL error otherwise; only then may the array include the target identity and fixed catalog-only SELECTs. SHOW transaction_read_only should also be included as returned evidence. A failed guard must abort the transaction, and no fallback to run_sql or another connection is allowed. This sequence is not validated against PostgreSQL in this worktree.
- Neon’s official driver documentation describes HTTP queries and WebSocket Client/Pool connections, and documents transaction batching; node-postgres documents that all transaction statements must use the same client. See [Neon serverless driver](https://neon.com/blog/serverless-driver-ga) and [node-postgres transactions](https://node-postgres.com/features/transactions).

## Conditional execution requirements for Agent B

Before the single authorized transaction, Coordinator must re-read the allowlisted Neon metadata. Agent B must pass the exact project ID, branch ID, and database name explicitly. The tool schema does not expose endpoint_id or role_name; it therefore cannot request those identities as arguments. Confirm from fresh metadata that the connector’s selected endpoint is the sole approved endpoint for that branch, and use the in-transaction identity guard to require current_database() = karturt_staging and current_user = karturt_staging_owner. If the selected endpoint cannot be established from fresh metadata, or either identity check fails, stop before catalog queries. Do not use an implicit branch or database default.

The fixed inspection allowlist should read only current database/user/server version, non-system schema names, relation names/kinds and Drizzle ledger-table presence. Any aggregate row counts must use only approved aggregate queries and expose no row values. Catalog estimates such as pg_stat_user_tables.n_live_tup are estimates and cannot prove emptiness. If the exact Drizzle ledger or table counts cannot be queried safely in the same guarded transaction, report that evidence as NOT VERIFIED rather than infer emptiness. Do not inspect row-level or personal data.

## Local validation and boundary

Local PostgreSQL validation was **NOT RUN**. The worktree has no installed node_modules, psql is not available, and no PostgreSQL service is present (availability checks exited 0). No disposable local PostgreSQL target was identified. No .env file or credential value was accessed.

This report is an uncommitted documentation artifact only. No source files were edited; stagingIsolationVerifiedEmpty remains false. The lane qualifies the transaction method conditionally; it does not authorize or perform the Neon inspection, establish target metadata freshness, verify database contents, or approve migration.

## Transaction semantics and fail-closed guard

The transaction API's wrapper begins a PostgreSQL transaction and maps the caller's ordered statements into the driver's one-transaction call; the coordinator independently inspected that upstream mapping. Therefore SET TRANSACTION READ ONLY is a valid first caller statement inside that transaction. PostgreSQL 18 defines the mode on the current transaction and rejects ordinary table DML and DDL in read-only mode. The next statement must be a server-side assertion that fails if current_setting('transaction_read_only') is not on; that SQL error leaves the transaction aborted, so later catalog queries cannot succeed. A SHOW result inspected only after the whole batch returns would be too late to serve as the guard. [PostgreSQL 18 SET TRANSACTION](https://www.postgresql.org/docs/18/sql-set-transaction.html)

Read-only transaction mode does not prevent every possible on-disk side effect. The inspection must therefore remain a fixed allowlist of safe pg_catalog queries and aggregates, with no user-defined functions, views, or row-level data. If the tool's transaction implementation cannot guarantee ordered statements on one transaction, or cannot abort on a failed guard, the method is BLOCKED and Agent B must not connect.

## Proposed fixed SQL sequence (not executed)

Use the following ordered list only inside the transaction wrapper. The first item is transaction setup; every inspection item after it is a fixed read-only query. The guard intentionally errors on a wrong mode, database, or role so later statements cannot succeed in an aborted transaction.

    SET TRANSACTION READ ONLY

    SELECT CASE
      WHEN current_setting('transaction_read_only') = 'on'
       AND current_database() = 'karturt_staging'
       AND current_user = 'karturt_staging_owner'
      THEN 1
      ELSE current_setting('transaction_read_only')::integer
    END AS prequery_guard

    SHOW transaction_read_only

    SELECT current_database() AS database_name,
           current_user AS role_name,
           current_setting('server_version_num') AS server_version_num

    SELECT n.nspname AS schema_name
    FROM pg_catalog.pg_namespace AS n
    WHERE n.nspname <> 'information_schema'
      AND left(n.nspname, 3) <> 'pg_'
    ORDER BY n.nspname

    SELECT n.nspname AS schema_name,
           c.relname AS object_name,
           c.relkind AS object_kind,
           c.relpersistence AS persistence,
           c.relispartition AS is_partition
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema'
      AND left(n.nspname, 3) <> 'pg_'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ORDER BY n.nspname, c.relname

    SELECT to_regclass('drizzle.__drizzle_migrations')::text AS drizzle_migration_ledger

    SELECT schemaname AS schema_name,
           relname AS object_name,
           n_live_tup AS estimated_live_rows,
           n_dead_tup AS estimated_dead_rows
    FROM pg_catalog.pg_stat_user_tables
    ORDER BY schemaname, relname

The ledger-presence query does not expose personal data. Because this SQL API accepts a non-interactive statement array, it cannot pause at that result and conditionally submit a ledger-content query while reusing the same transaction. Do not add a dynamic SQL statement or assume the optional ledger exists. If exact ledger rows are required and the presence/content cannot be safely handled in the same transaction, report the migration ledger as NOT VERIFIED. PostgreSQL statistics are estimates, not proof of zero rows. Any unexpected user relation is enough to prevent an EMPTY VERIFIED verdict until safely classified.

For exact aggregate counts on the source-defined tables, the same transaction may include a catalog guard requiring all 27 expected public relations to exist as ordinary or partitioned tables, followed by this static SELECT-only count query. If the guard fails, the transaction aborts and counts are NOT VERIFIED; do not substitute dynamic SQL or estimates. If the object inventory shows additional non-system relations, flag them as unexpected and do not classify the database empty.

    SELECT CASE
      WHEN expected_count = 27 AND all_expected_relations_are_tables THEN 1
      ELSE current_setting('transaction_read_only')::integer
    END AS expected_tables_guard
    FROM (
      SELECT count(*) AS expected_count,
             coalesce(bool_and(c.relkind IN ('r', 'p')), false) AS all_expected_relations_are_tables
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY (ARRAY[
          'active_due_settlements', 'app_accounts', 'audit_events', 'account',
          'rateLimit', 'session', 'twoFactor', 'user', 'verification',
          'billing_years', 'due_adjustments', 'fee_rates', 'households', 'houses',
          'monthly_dues', 'official_assignments', 'payment_allocations',
          'payment_request_claims', 'payment_request_items', 'payment_requests',
          'payment_reversals', 'payments', 'people', 'rt_settings', 'rt_units',
          'waiver_actions', 'waiver_items'
        ])
    ) AS expected_tables

    SELECT 'active_due_settlements' AS table_name, count(*) AS row_count FROM public.active_due_settlements
    UNION ALL SELECT 'app_accounts', count(*) FROM public.app_accounts
    UNION ALL SELECT 'audit_events', count(*) FROM public.audit_events
    UNION ALL SELECT 'account', count(*) FROM public.account
    UNION ALL SELECT 'rateLimit', count(*) FROM public."rateLimit"
    UNION ALL SELECT 'session', count(*) FROM public.session
    UNION ALL SELECT 'twoFactor', count(*) FROM public."twoFactor"
    UNION ALL SELECT 'user', count(*) FROM public."user"
    UNION ALL SELECT 'verification', count(*) FROM public.verification
    UNION ALL SELECT 'billing_years', count(*) FROM public.billing_years
    UNION ALL SELECT 'due_adjustments', count(*) FROM public.due_adjustments
    UNION ALL SELECT 'fee_rates', count(*) FROM public.fee_rates
    UNION ALL SELECT 'households', count(*) FROM public.households
    UNION ALL SELECT 'houses', count(*) FROM public.houses
    UNION ALL SELECT 'monthly_dues', count(*) FROM public.monthly_dues
    UNION ALL SELECT 'official_assignments', count(*) FROM public.official_assignments
    UNION ALL SELECT 'payment_allocations', count(*) FROM public.payment_allocations
    UNION ALL SELECT 'payment_request_claims', count(*) FROM public.payment_request_claims
    UNION ALL SELECT 'payment_request_items', count(*) FROM public.payment_request_items
    UNION ALL SELECT 'payment_requests', count(*) FROM public.payment_requests
    UNION ALL SELECT 'payment_reversals', count(*) FROM public.payment_reversals
    UNION ALL SELECT 'payments', count(*) FROM public.payments
    UNION ALL SELECT 'people', count(*) FROM public.people
    UNION ALL SELECT 'rt_settings', count(*) FROM public.rt_settings
    UNION ALL SELECT 'rt_units', count(*) FROM public.rt_units
    UNION ALL SELECT 'waiver_actions', count(*) FROM public.waiver_actions
    UNION ALL SELECT 'waiver_items', count(*) FROM public.waiver_items

For the migration ledger, first add a fixed pg_catalog guard requiring drizzle.__drizzle_migrations to exist as a regular or partitioned table; only after that guard succeeds, query exactly id, hash, and created_at ordered by created_at. If the guard fails or the expected columns are absent, the transaction aborts and ledger contents are NOT VERIFIED. These are aggregate/metadata outputs only; no application rows or personal fields are selected.

    SELECT CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'drizzle'
          AND c.relname = '__drizzle_migrations'
          AND c.relkind IN ('r', 'p')
      ) THEN 1
      ELSE current_setting('transaction_read_only')::integer
    END AS drizzle_ledger_guard

    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at
