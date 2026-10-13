# W12-A01–A07 — Staging Database Initialization Readiness (offline only)

Tanggal pemeriksaan: 13 Oktober 2026 (Asia/Bangkok)

**Verdict Agent A: PARTIAL.** Baseline, schema/migration metadata, offline generation, and focused in-memory checks pass. PostgreSQL 18 runtime compatibility is not proven. The source target guard still names the previous staging resource and keeps staging isolation disabled, so the current user-provided staging resource cannot be used by application database commands without a separately approved source/target decision. This report does not authorize a Neon connection or migration.

## Scope and boundaries

- Inspected only the assigned local worktree and supplied prior Wave 11 output report.
- No provider access; no Neon connection, wake, query, content inspection, SQL, migration, fixture, role/credential change, GitHub operation, or Vercel operation.
- Did not read `.env` files or inspect secret-bearing process values. Secret environment names used by subprocesses were set to empty for local checks. No package install, registry access, or network operation.
- No source/config edits, commits, or pushes.
- Current resource identity below comes from the task’s user-provided metadata; Agent A did not independently re-verify provider metadata.

## A01 — Baseline and Wave 11 source recovery: PASS

- Worktree: `D:\!AGY\karturt-wave11-a`
- `git status --short --branch`: clean, detached (`## HEAD (no branch)`).
- `git rev-parse HEAD`: `355c5804df9767e7ce8456edde4439a4a7eaedc9`.
- `git rev-parse HEAD^{tree}`: `df520d59d675e46f43c4b224798fe4b237e36360`.
- Local ref/log identify this source as `codex/wave10-integration-20261013`; parent is `408db58fef142e3c7d342a81575b7ca77270312`.
- The repo contains W10-A/B/C reports but no W11 source report, W11 branch ref, or newer code SHA in the inspected local refs. The supplied W11 output report was read as historical data; its statement that provisioning had not yet occurred does not establish current provider state.
- The expected W10 SHA/tree exactly match the assigned tree. No newer local source candidate was found; work proceeded from this verified baseline.

## A02 — PostgreSQL 18 and SQL compatibility: PARTIAL

Static review found PostgreSQL constructs already represented by the locked schema/migrations: UUID defaults (`gen_random_uuid()`), enums and enum replacement, `timestamptz`, JSONB operations, PL/pgSQL functions/triggers, expression/partial indexes, check constraints, and composite foreign keys. No `CREATE EXTENSION` or `CREATE INDEX CONCURRENTLY` statement was found. No obvious PostgreSQL-18-specific incompatibility was identified by static review.

This is not a PostgreSQL 18 runtime result. The successful PGlite checks below are useful local syntax/constraint evidence but do not attest PostgreSQL 18 behavior or concurrency. No real PostgreSQL server test was run.

## A03 — Locked driver/dependencies and migration inventory: PASS (local metadata)

Lockfile-resolved versions:

| Package | Locked version | Role |
|---|---:|---|
| `drizzle-orm` | 0.45.3 | ORM and Neon Serverless adapter |
| `drizzle-kit` | 0.31.11 | Offline journal/schema tooling |
| `@neondatabase/serverless` | 1.1.0 | Runtime `Pool` driver |
| `pg` | 8.23.1 | Local PostgreSQL tooling dependency |
| `@electric-sql/pglite` | 0.5.8 | In-memory test engine |

- 14 SQL migration files, numbered `0000`–`0013`; 14 ordered journal entries with matching tags; all entries have breakpoints enabled and increasing `when` values.
- 14 snapshots (`0000`–`0013`); latest snapshot has 27 tables. `src/db/schema.ts` has 27 `pgTable` declarations.
- Migrations include multi-RT composite foreign keys and scoped uniqueness/check constraints; they also include enum/constraint/index drops and other non-idempotent DDL. Preserve order; do not manually replay individual files or retry an uncertain partial external run.
- `drizzle-kit check` and isolated `generate` both accepted the journal/snapshot set and current schema.

## A04 — Driver and migrator behavior: PARTIAL

Source and the locked Drizzle implementation show the app uses `@neondatabase/serverless` `Pool` through `drizzle-orm/neon-serverless`, with a lazy pool (`max: 5`). `src/db/migrate.ts` first loads project env and calls `requireDatabaseEnvironment()`, then calls `getDb()` and `migrate()`.

In locked Drizzle 0.45.3, `PgDialect.migrate` creates the migrations schema/table and reads the latest record before opening a transaction. It then applies pending journal SQL in journal order and inserts each record inside one transaction. Selection is timestamp-based (`created_at` vs journal `when`); the migrator stores a SHA-256 but does not compare existing recorded hashes or introspect the target schema for drift. The offline checks do not exercise this remote transaction path.

## A05 — Current source target and environment guard: PARTIAL / STOP

The source guard in `src/lib/staging-database-target.ts` still allowlists the former target: project `ancient-smoke-51787007`, branch `br-dry-block-b3fsqjo3`, database ID `604003` / `karturt_stage`, endpoint `ep-raspy-meadow-b3ppifq6`. It explicitly sets `stagingIsolationVerifiedEmpty = false`; therefore even that old target remains blocked. Bootstrap access is limited to URL-free PGlite tests or the exact local development PostgreSQL target.

The task’s current resource metadata says the new target is project `karturt-v1-staging` (`wild-art-99835126`), branch `staging` (`br-hidden-cake-a1ge5xqp`), database `karturt_staging`. That identity is not in the current application guard. Agent A did not read credentials or verify the provider. Current code will reject a connection attempt to the new endpoint; keep it closed until the owner separately authorizes a target-guard change and migration stage.

`drizzle.config.ts` imports `loadProjectEnvConfig` and `requireDatabaseEnvironment`; it can load project environment files under its guarded policy and requires `DATABASE_URL`. `drizzle.offline.config.ts` imports only `defineConfig` and supplies schema/out/dialect, with no env or DB credential imports. The offline check and generation paths below therefore did not connect or access `.env`.

## A06 — Offline checks and focused tests: PASS (offline scope only)

| Command | Exit | Result |
|---|---:|---|
| `npm run db:check:offline` | 0 | Printed `Everything's fine`; offline config selected, no DB credentials/config import. |
| `node_modules/.bin/drizzle-kit generate --schema src/db/schema.ts --out ..\karturt-wave12-drizzle-a-ec5b2bd3a6054e8a8f43b55dba252cee --dialect postgresql` | 0 | Printed `27 tables` and `No schema changes, nothing to migrate`. Output was a copy of the 14 SQLs, 14 snapshots, and journal at the sibling path shown; SHA-256 comparison confirmed all 29 files remained byte-identical to source. |
| `npm test -- --maxWorkers=1 tests/constraints/database-constraints.test.ts` | 0 | 1 file, 15 tests passed. The helper applies local SQL files in lexicographic order to in-memory PGlite; no network/database URL. |
| `npm test -- --maxWorkers=1 tests/unit/environment.test.ts` | 0 | 1 file, 11 tests passed. Child process had the five tested environment variables set empty; cases use synthetic strings and only exercise validators. No connection was made. |
| `git diff --check` | 0 | No whitespace errors. |
| Final `git status --short --branch` | 0 | Clean at the same commit/tree above. |

Vitest printed a non-blocking Vite warning about future `configLoader: 'native'` support for the extensionless import and CommonJS-loaded ESM config. Both test commands passed.

### Isolated generation command handling

The package script `npm run db:generate:offline -- --out <path>` exited 1 because Drizzle Kit 0.31.11 rejects `--config` combined with other CLI options. A direct CLI attempt with a C: output path emitted `ENOENT`: Drizzle Kit joined the cross-drive Windows path to the repo root; the wrapper surfaced process exit 0 despite the error text. Neither attempt modified the worktree or the copied source migrations. The successful direct CLI command above used explicit schema/dialect and a relative sibling output on D:, without loading any Drizzle config. It is the generation evidence used here.

## A07 — Evidence limits and handoff: PARTIAL

- No true PostgreSQL 18 execution or independent real-PostgreSQL concurrency test was run (`NOT RUN`). PGlite is not a PostgreSQL concurrency substitute.
- No current Neon target metadata or database contents were re-read; no claim is made about provider emptiness, migration status, or runtime compatibility.
- No full lint/typecheck/build was run because this agent made no code change; coordinator may run any exact-final-SHA checks required for consolidation.
- The provided baseline reports five HIGH development-only dependency advisories; Agent A did not run an online audit or independently refresh that finding.
- Neither MFA nor usage/Rp0 audit was used as an Agent A blocker; no provider/billing inspection was made.

## Changed paths and state

- Repo source/config changes: **none**.
- Worktree remains clean at commit `355c5804df9767e7ce8456edde4439a4a7eaedc9`, tree `df520d59d675e46f43c4b224798fe4b237e36360`.
- Isolated generated comparison copy: `D:\!AGY\karturt-wave12-drizzle-a-ec5b2bd3a6054e8a8f43b55dba252cee` (kept outside the worktree; not a migration target).
- No commit, push, provider, CI, deployment, or external mutation.

**A conclusion: PARTIAL / READY ONLY FOR FURTHER OWNER DECISION. Not staging-ready and not authorization to run migrations.**
## Addendum — generated-output accounting

`drizzle.offline.config.ts` defaults `out` to `./drizzle`. Because Drizzle Kit 0.31.11 rejects `--out` together with `--config`, the package generation script could not safely target an isolated directory. The successful direct CLI invocation avoided loading that config and used an explicit external output path.

The initial C: seed copy at `C:\Users\USER\Documents\Codex\2026-10-13\referenced-chatgpt-conversation-this-is-an-10\work\wave12\agent-a-drizzle-output-548ee66d582648b7873ad5e998fa57f5` remains unchanged; failed attempts did not generate into it. The validated output copy is the D: sibling directory listed above.
