# Demo-to-Production CP1: isolated Preview connection

This note describes the source path prepared by CP1. It does not prove that a Neon resource, Vercel Preview, database migration, or user-flow test is live.

## Target contract

- Vercel Preview must set `APP_ENV=preview` and `DATABASE_ENV=preview`.
- `KARTURT_PREVIEW_TARGET_ID` and `KARTURT_PRODUCTION_TARGET_ID` are non-secret `project-id/branch-id/endpoint-id/database-name` references. The Preview project must be separate from production and from the disputed former staging target.
- Preview database name and roles are fixed by the application: `karturt_preview`, `karturt_preview_runtime`, and `karturt_preview_migrator`.
- `DATABASE_URL` uses the runtime role. `DATABASE_MIGRATION_URL` uses the migration role. Both must point to the same declared direct Neon endpoint and database. Configure only the runtime URL in Vercel Preview. Keep the migration URL in a private, temporary `.env.local` file for an authorized one-off migration or in a protected short-lived migrator; never expose migration credentials to the Vercel application runtime, logs, or Git.
- The pool always validates the TLS certificate and hostname. It rejects loopback, the old staging endpoint, pooler hosts, mismatched endpoint IDs, custom CA paths, and non-verified SSL modes.
- A Preview migration requires PostgreSQL 18, exact role/session identity, non-elevated roles with no inherited memberships, an empty synthetic database or a journal matching the official Drizzle prefix, and the unchanged migrations `0000`–`0013`. Neither role may inherit database `TEMPORARY`; `PUBLIC` must not retain that grant either. The migration role gets only the schema/database creation needed by Drizzle, while runtime grants are limited to table DML and sequence usage; schema creation and function execution stay denied for runtime.

## Commands

`npm run db:migrate:preview:plan` checks target variables, direct URL identity, and the checked-in Drizzle chain without opening a database connection.

`npm run db:migrate:preview` applies the official chain only after the Preview endpoint and both roles pass the checks above. Do not run it until the owner has separately approved that exact non-production target.

The regular migration path and the existing SHA-bound staging preflight remain separate.

## CP2 owner handoff

1. Confirm a Neon Free PostgreSQL 18 synthetic target is available without upgrading the plan. It must use a separate project from production and must not be a copy of citizen data.
2. Verify the project, branch, endpoint, database, and role flags in Neon. Use the fixed database and role names above; neither role nor `PUBLIC` may have database `TEMPORARY`, and the runtime role must not have `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`, or schema `CREATE`. The migration role must be non-superuser and limited to the database/schema creation Drizzle needs.
3. Configure Preview labels, target IDs, the runtime URL, auth secret, and HTTPS origin in the Vercel Preview environment. Keep the separate migration URL outside the Vercel application runtime, in a private temporary `.env.local` file or a protected short-lived migrator. Never copy connection values into Git, issue comments, or chat.
4. Review the selected free-plan target and authorize the official migration and Preview deployment as separate operations. Stop if the target, isolation, role privileges, TLS verification, or cost is uncertain.

No provider resource, secret, environment, or database was changed as part of CP1 source work.
