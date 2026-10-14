# KartuRT V1 Wave 12.4 — Agent A Target Lineage and Metadata

**Date:** 2026-10-14 (Asia/Bangkok)<br>
**Lane:** W12.4-A01–A08 — target metadata, provenance, and lineage<br>
**Result:** **PARTIAL — exact allowlisted metadata matches; branch lineage and contents remain NOT VERIFIED.**<br>
**Database transaction/SQL calls by this lane:** 0.<br>
**Provider changes, connections, and compute wakes by this lane:** none.

## Baseline verification

- Repository: `Satsetx4/karturt`.
- Assigned worktree: `D:\!AGY\karturt-wave12-4-agent-a-20261014`.
- Application source: detached `HEAD` `3bc69c83265dce3a6a0863cbfceea188f40f6168`; tree `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9`. The remote `codex/wave12-3-pg18-rehearsal-20261014` ref independently resolves to that SHA. The checkout was clean before this report was created.
- Documentation baseline: `docs/wave12-3-migration-rehearsal-20261014` at `1b5d2facdafba0818bd205d872e006c9b6ecb257`; tree `252019635420aab8126e1ddfc9b446d333bd03ce`. Both the local remote-tracking ref and GitHub branch independently resolve to the stated SHA.
- Read all five Wave 12.3 reports, all five Wave 12.2 reports, and all five Wave 12.1 reports from the documentation baseline. Wave 12.3 reports document the PG18.6 rehearsal as exact-source disposable evidence and explicitly do not establish Neon staging lineage or contents.
- `src/lib/staging-database-target.ts` at the application SHA pins the approved project, branch, database, endpoint, and hostname. It still sets `stagingIsolationVerifiedEmpty = false`; its guard continues to reject staging access while isolation is unverified.

## Fresh metadata-only Neon readback

All provider calls were read-only metadata calls scoped to the approved org/project/branch. No connection string, credential, database table listing, schema tree, row, or SQL was requested or read.

| Resource | Fresh observation | Assessment |
|---|---|---|
| Organization | `satset`, `org-ancient-boat-57106549`, plan `free` | Exact approved organization. |
| Project | `karturt-v1-staging`, `wild-art-99835126`; `aws-ap-southeast-1`; PostgreSQL 18; `creation_source=console`; created 2026-10-13 | Exact approved project/region/version. |
| Branch | `staging`, `br-hidden-cake-a1ge5xqp`; `primary=true`, `default=true`, `current_state=ready`; `creation_source=console`; `init_source=parent-data` | Exact approved branch; provider reports parent-data initialization. Exact parent identity/state is absent from returned metadata. |
| Database | `karturt_staging`, ID `42079960`, owner `karturt_staging_owner` | Exact approved database and owner. It was not connected to or queried by this lane. |
| Role | Sole listed role `karturt_staging_owner`; authentication method `password` | Identity matches. Provider role metadata does not attest read-only privileges. No password or credential was retrieved. |
| Endpoint | Sole listed endpoint `ep-snowy-meadow-a10304d9`; approved direct hostname `ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech`; branch binding matches; region `aws-ap-southeast-1`; type `read_write`; state `idle`; `passwordless_access=true`; pooler disabled | Exact endpoint mapping; configuration is writable/passwordless. No wake or endpoint change occurred. |

The latest project/branch metadata reports a logical size of **31,686,656 bytes** and `written_data_bytes=0`; the project response reports `synthetic_storage_size=0`. These are provider counters, not evidence that there are no user objects or inherited rows. In particular, the nonzero logical size prevents describing this readback as a zero-sized target, while it does not identify what the bytes represent.

Project metadata reports `history_retention_seconds=21600` (six hours), but the project-scoped snapshot listing returned no snapshots. The operation history included branch timeline creation and routine configuration/compute availability actions. Reading the matching `create_timeline` operation returned no parent ID, parent LSN, source timestamp, or parent branch. `get_branch` and `list_branches` likewise expose no parent identifier or ancestry fields in this response. These surfaces therefore do not resolve lineage or demonstrate a recoverable snapshot.

## Lineage assessment and evidence limit

The provider identifies this branch as primary/default and reports `init_source=parent-data`, but does not identify the parent, its contents, or the branch point. `creation_source=console` only describes how the project/branch operation was initiated; it does not establish clean origin. The exact lineage is **UNKNOWN**.

Neon's public branching documentation says ordinary branches carry the parent branch's schema and data, while a schema-only option is available. That general product behavior does not identify this branch's parent or selected creation mode. Combined with this target's `init_source=parent-data`, unresolved lineage must continue to block an emptiness claim. See [Neon branching workflow documentation](https://neon.com/docs/get-started-with-neon/workflow-primer).

Wave 12.2's one bounded read-only transaction reported no matching rows for its fixed relation/catalog and Drizzle-ledger filters, but its reports already classify the target as `NOT VERIFIED`: the query scope did not cover every possible object class and did not establish parent contents. That prior result is historical evidence only; Agent A ran no SQL, and it does not replace the single new Wave 12.4 transaction reserved for Agent B after coordinator GO.

**Do not infer** emptiness or safe isolation from any of: `init_source`, primary/default labels, project creation date, zero `written_data_bytes`, zero synthetic-storage counter, idle/suspended compute, a zero or small logical size, an empty snapshot list, or bounded no-row catalog results. `stagingIsolationVerifiedEmpty` must remain `false`.

## Static schema reference and Agent B query-review checklist

The exact source snapshot `drizzle/meta/0013_snapshot.json` contains 27 expected `public` tables and 7 enums. This is the repository's intended schema after all 14 migrations, not a claim about the live target or its pre-migration state. Wave 12.3's passing PostgreSQL 18.6 rehearsal on the exact source SHA reported the post-chain reference catalog as 27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums. It must not be transferred to Neon.

Expected table names from that static snapshot are: `account`, `active_due_settlements`, `app_accounts`, `audit_events`, `billing_years`, `due_adjustments`, `fee_rates`, `households`, `houses`, `monthly_dues`, `official_assignments`, `payment_allocations`, `payment_request_claims`, `payment_request_items`, `payment_requests`, `payment_reversals`, `payments`, `people`, `rateLimit`, `rt_settings`, `rt_units`, `session`, `twoFactor`, `user`, `verification`, `waiver_actions`, and `waiver_items`. Expected final enums are `account_status`, `account_type`, `billing_year_status`, `household_status`, `monthly_due_status`, `official_role`, and `payment_request_status`.

For an independently reviewed, fixed catalog-only inspection, ensure the submitted sequence enumerates the following without invoking routines or reading application rows:

- Every non-system namespace, then all non-system `pg_class` relation kinds relevant to tables, partitioned tables, views, materialized views, foreign tables, sequences, indexes, partitioned indexes, and composite relations. Include partition/relkind metadata and all extra objects, not just the 27 expected `public` tables.
- Indexes and constraints through `pg_index` and `pg_constraint`, including validity/primary/unique/foreign/check metadata. Do not read sequence values.
- User-defined types, domains, enums and labels, ranges/multiranges, and extensions with their schemas and versions.
- `pg_proc` metadata for functions, procedures, aggregates, and window routines: names/signatures, kind, language, return type, owner, security-definer and volatility flags. Never invoke them; avoid returning routine bodies unless a specifically reviewed need exists.
- Non-internal triggers and their enabled state; RLS flags from `pg_class` and policy name/command/roles from `pg_policy`. Do not execute trigger functions or policy expressions.
- Foreign data wrappers, servers, and foreign tables by names and metadata only. Never select `pg_user_mapping.umoptions` or foreign-server options because connection information may contain credentials.
- Publications and subscriptions by safe names/state metadata only. Never select `pg_subscription.subconninfo` or other connection strings.
- Presence/metadata for the Drizzle ledger without assuming its schema/table exists. If inspecting ledger rows is in scope, require a static existence/type/column guard before a fixed projection of only migration metadata; no dynamic SQL.

PostgreSQL 18 reserves schema names beginning with `pg_` for system purposes, so the draft's `NOT LIKE 'pg!_%' ESCAPE '!'` filter excludes reserved/system and temporary schemas from the persistent non-system namespace inventory. Document that boundary explicitly. The default `public` schema itself is expected even on a clean database; the classifier should allow that empty namespace while still reporting any objects inside it. The coordinator should classify any uncovered catalog family or failed query as `INSPECTION INCOMPLETE`/`NOT VERIFIED`; a list of the expected app schema alone is not a full object inventory. Aggregate row counts, if separately approved and pre-reviewed, are not a substitute for object inventory or lineage. PostgreSQL row-estimate statistics are estimates only. No user-defined routine, view, foreign object, or application row should be evaluated to produce this metadata. See [PostgreSQL schema naming rules](https://www.postgresql.org/docs/18/ddl-schemas.html).

## Lane decision

- Exact organization/project/branch/database/endpoint identity: **PASS**.
- PG version and region: **PASS — PostgreSQL 18, `aws-ap-southeast-1`**.
- Branch source/parent lineage: **NOT VERIFIED** (`init_source=parent-data`, no parent identity/source point exposed).
- Database contents and comprehensive object inventory: **NOT VERIFIED by Agent A** (no SQL or DB object-tree query in this lane).
- Role read-only privileges: **NOT VERIFIED by provider metadata**.
- Target isolation / `stagingIsolationVerifiedEmpty`: **NOT VERIFIED / remain false**.
- Agent A disposition: **PARTIAL**. This is not migration authorization or staging readiness.

## Coordinator review addendum

The namespace-filter paragraph above describes an earlier draft and is not the filter used for the executed Wave 12.4 transaction. The final 26-statement sequence excludes the explicitly named system schemas and only the exact numeric `pg_temp_N` / `pg_toast_temp_N` namespaces. It does not apply a generic `pg_` prefix exclusion. Agent B’s report records the reviewed and executed query text. This correction preserves the intended inventory of every namespace outside the explicit system/temporary exclusions.
