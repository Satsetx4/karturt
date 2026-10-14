# Wave 13A.2 Owner Next Gate

Date: 2026-10-14
Wave 13A.2 result: WAVE13A2 VERIFIED — DISPOSABLE PG18 DRIVER EXIT PASS.

## Verified scope

The migration evidence correction is complete: the 14 SQL filenames are corrected, the journal is included, and all 15 raw Git blobs match the manifest at the immutable Wave 13A baseline, Wave 13A.1 source revision, and Wave 13A.2 source SHA 48b92abbe93fbd499448b6c885d3042cb49c2128. The corrected old audit records its original Git blob SHA-1.

Local source checks passed: focused guards 12/12, typecheck, lint (0 errors, 2 existing warnings), offline migration check, full suite (80 files / 559 tests), raw blob integrity (15/15), unchanged SQL/journal, and git diff --check.

Disposable PostgreSQL 18 run 38538027706 passed on the exact source SHA. The real pg.Pool child exited naturally on success and error, and exited naturally with code 1 within 8 seconds after the 300 ms migration deadline, with one invocation and no retry. PostgreSQL continued the synthetic pg_sleep backend for at least 3,046 ms after child exit; it completed after 57,192 ms without a cancellation request. This proves child exit for pg.Pool TCP and does not prove query cancellation, rollback, Neon transport parity, or migration behavior.

Test Gate A run 38538027707 passed on the exact source SHA, including full tests, Drizzle journal and schema drift checks, and production build. Its separate PostgreSQL 17 concurrency job was skipped by the workflow branch condition.

## Explicitly out of scope

This work does not authorize or perform:

- Neon SQL, connection tests, migration, resource mutation, role/network changes, or deletion;
- changing either existing Neon project;
- generating or pinning an Ed25519 owner key or signing/consuming a migration authorization;
- running migrations 0000–0013 against staging or any live database;
- changing the staging isolation guard or setting stagingIsolationVerifiedEmpty true;
- Vercel environment changes, deployment, preview creation, merge, PR creation, or updating main.

## Proposed deliberate next decision

Prepare an owner-reviewed Wave 13B security and approval package that states the exact project/branch/database identity, restricted network posture, password and role scope, positive empty/synthetic lineage evidence method, server-enforced read-only preflight design, owner key custody and signing procedure, immutable source SHA, recovery plan, and cost/headroom evidence required before any later migration authorization.

That package is preparation only. Each subsequent provider inspection, approval-key action, signed authorization, migration, application integration, or deployment requires its own explicit owner decision. Keep PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM = null and stagingIsolationVerifiedEmpty = false until separately approved and positively verified.

Reference limits: prior runtime evidence does not transfer across SHAs or evidence layers. PostgreSQL 18 direct TCP does not establish Neon serverless WebSocket parity.
