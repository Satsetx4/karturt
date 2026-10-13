# KartuRT V1 Wave 12.2 — Owner Approval Packet

**Date:** 2026-10-14 (Asia/Bangkok)
**Decision requested now:** Review the evidence and keep migration **BLOCKED**.
**Current state:** One read-only transaction completed; database emptiness **NOT VERIFIED**. No migration was run. The approved target was project wild-art-99835126, branch br-hidden-cake-a1ge5xqp, database karturt_staging (ID 42079960), role karturt_staging_owner, endpoint ep-snowy-meadow-a10304d9.

## What this wave established

The approved Neon staging project, branch, database, and role matched fresh provider metadata. The approved project's only endpoint mapped to the approved branch. One transaction began with SET TRANSACTION READ ONLY; PostgreSQL reported transaction_read_only=on, and a guard confirmed the expected database and role before catalog queries. The fixed catalog, aggregate, and Drizzle-ledger queries returned no rows.

The inspection found no matching non-system relations in its selected catalog filters and no Drizzle ledger. It did not establish that the database is empty. The branch has init_source=parent-data, which leaves inherited contents and lineage unresolved; the filters do not cover every possible database object. The owner guard remains stagingIsolationVerifiedEmpty=false.

The endpoint is configured read_write, has passwordless access enabled, and the role's read-only privileges were not established. The successful read-only transaction proves the mode for that one transaction only. No database changes were made.

## Decision

**Do not approve a staging migration based on this packet.** Migration readiness is **BLOCKED / NOT READY**. No additional permission is requested or implied by the prior one-time read-only authorization.

## Gates for any future migration request

A separate, explicit owner decision should be requested only after the team can present all of these items:

1. **Target and lineage:** exact project/branch/database/endpoint/role readback, with a known and reviewed parent lineage and a demonstrably isolated disposable target.
2. **Contents:** a safely obtained and reviewed content classification. Do not infer empty from project age, logical size, written_data_bytes, or the bounded query results in this wave.
3. **Recovery:** verified backup availability and a successful restore rehearsal, with a versioned recovery plan.
4. **PostgreSQL 18 rehearsal:** the exact 14-file migration chain tested in order against a disposable PostgreSQL 18 database with representative synthetic starting states, including the 0003 value conversion, 0010 backfill, and later state-dependent preflights.
5. **Security and release evidence:** reviewed database-native tenant controls or an explicitly accepted alternative; exact-source checks and runtime evidence scoped to their actual commit; no unverified provider or deployment claims.
6. **Fresh authorization:** a new owner approval that names the precise target, migration files, data impact, execution window, recovery authority, and permitted provider operations. That approval must not be interpreted as permission to change other projects, branches, roles, endpoints, compute, production, Vercel, or billing.

Until those gates and a fresh approval exist, stop before any migration, DDL/DML, seed, teardown, or provider mutation. If a future migration starts and errors or partially applies, stop immediately; preserve logs and state, inspect only under a separately approved safe method, and use an owner-approved restore or versioned repair plan. Never blindly replay migrations or edit the Drizzle ledger to make it appear current.

## Evidence and limits

- Application source baseline: d4fc471a988c070ca2118e12ddbb0b363daa6541 (tree 15bb2fc622f19d0715906479083ae87bcbb85cec).
- Documentation baseline: 4836d7858932c06f231e1960f6084e9535203bc9.
- Agent A qualified the method conditionally; local PostgreSQL validation was not run.
- Agent B completed exactly one guarded transaction; target contents remain NOT VERIFIED.
- Agent C passed 209 focused tests and offline Drizzle checks, using local tests/PGlite; PostgreSQL 18 migration rehearsal and backup/restore were not run or verified.
- No source patch, migration, deployment, merge, or paid action occurred.

See the Coordinator Report and the three lane reports in this directory for commands, provider readbacks, scope, and evidence boundaries.
