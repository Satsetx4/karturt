# KartuRT V1 Wave 12.3 — Owner Approval Packet

**Date:** 2026-10-14 (Asia/Bangkok)\
**Current decision:** **Keep Neon staging migration BLOCKED / NOT AUTHORIZED.**\
**Wave 12.3 scope:** local CI/tooling repair, a run-owned disposable PostgreSQL 18 rehearsal if safely available, staging-safety review, and sanitized evidence. This packet does not grant provider access or authorize a migration.

## What the staging-safety review established

- The application source baseline is `d4fc471a988c070ca2118e12ddbb0b363daa6541` (tree `15bb2fc622f19d0715906479083ae87bcbb85cec`). It still sets `stagingIsolationVerifiedEmpty=false` and blocks staging access.
- Wave 12.2 recorded `init_source=parent-data`, a read-write endpoint with passwordless access enabled, and role metadata without proof of read-only privileges. Its one guarded, read-only transaction returned no matching relations or migration ledger, but did not establish emptiness or safe inherited lineage.
- Application authorization checks and 209 focused tests were recorded in Wave 12.2. The checked-in schema/migrations contain no database RLS policies. Application tests do not establish a database-native tenant boundary or current deployed RLS state.
- Wave 12.1/12.2 did not verify a backup or restore. The exact Wave 12.3 source SHA now passes `pg_dump` / `pg_restore` on a disposable PostgreSQL 18.6 database, with restored-database cleanup verified. This does not verify a Neon staging backup or restore path. The migration chain contains data conversion, backfill, and state-dependent preflight operations that may stop or partially apply when inherited data differs from the synthetic rehearsal state.
- Five historical development-only HIGH dependency advisories were not refreshed. Direct Next CLI invocations remain outside the repository's `next-command.ts` environment-file wrapper.
- At the exact source SHA, the proposed documentation and code branches do not match Gate A's push allowlist. No PR or manual dispatch was created. The current Vercel metadata supplied to Agent C had no Git-link field; prior Wave 12.2 evidence recorded that the exact project was absent from its same-day linked-project inventory. Agent C made no provider check. The coordinator's later read-only exact-project metadata check is recorded in the coordinator report; no deployment or setting was changed.

## Decision requested now

**No staging migration approval is requested. Keep the database access guard closed and migration unauthorized.** The previous one-time read-only inspection permission has been consumed. This packet does not request or imply a new Neon query, connection, compute wake, provider change, deployment, paid service, or migration.

## Wave 12.3 disposable PostgreSQL result

The exact source SHA `3bc69c83265dce3a6a0863cbfceea188f40f6168` passed the disposable PostgreSQL 18.6 rehearsal in [GitHub Actions run 38503239173](https://github.com/Satsetx4/karturt/actions/runs/38503239173). The checked-in 0000–0013 chain, 14-entry journal, expected catalog objects, negative cross-RT constraint, injected failure rollback, synthetic 0003/0010/0011/0012/0013 cases, `pg_dump` / `pg_restore`, and run-owned cleanup passed on that disposable service. Full details are in [Agent B's report](WAVE12_3_AGENT_B_PG18_REHEARSAL.md) and the [coordinator report](WAVE12_3_COORDINATOR_REPORT.md).

This pass qualifies only the exact source SHA and synthetic PostgreSQL 18.6 databases. It does not certify Neon staging contents, inherited lineage, a staging backup/restore path, deployed RLS, or release readiness. Any later migration SQL or rehearsal code change needs new exact-SHA evidence.

## Gates before a future migration authorization

A separate owner decision should be considered only after a concrete evidence packet closes each applicable gate:

1. **Exact target and lineage:** identify the project, branch, database, endpoint and role by exact provider identifiers; establish known parent lineage and prove the target is isolated and disposable. Any new branch/resource or provider operation needs its own explicit scope and cost evidence.
2. **Content classification:** provide safe, reviewed evidence for all existing content and objects. Do not treat no rows in a bounded query, `written_data_bytes=0`, logical size, idle compute, or a branch label as proof of emptiness.
3. **Tenant boundary:** review database-native RLS/policies or present an alternative control and its limits for explicit owner acceptance. Application-layer authorization tests alone are insufficient evidence for database-native isolation.
4. **PostgreSQL 18 rehearsal:** **PASS for source SHA `3bc69c83265dce3a6a0863cbfceea188f40f6168` on the disposable target in run 38503239173.** Rerun against any changed migration chain or rehearsal source. This evidence does not classify inherited staging data.
5. **Recovery:** the disposable run's dump/restore check passed. Still identify and verify a backup for the exact authorized staging target, prove its restore in a separately authorized disposable target, and version a recovery plan. Define who can authorize restore or repair if the chain stops partway through.
6. **Security/tooling:** refresh the historical dependency advisories and disposition them; close or explicitly accept the direct Next CLI wrapper gap; preserve sanitized failure logs.
7. **Fresh, bounded authorization:** name exact migration files, target identities, expected data impact, permitted database/provider operations, execution window, approver, backup/recovery authority and stop conditions. This approval must not extend to other projects, branches, production, Vercel, DNS, plan changes, or deployment.

## Mandatory stop conditions

- `stagingIsolationVerifiedEmpty` remains false while lineage and content are unresolved.
- Do not connect, wake, query, migrate, seed, or clean up Neon staging under this packet.
- If a future authorized migration fails or partially applies, stop immediately; preserve evidence and state. Do not retry blindly, manually edit the Drizzle ledger, or attempt ad hoc repair.
- A PostgreSQL 18 disposable rehearsal PASS does not authorize Neon migration or release.

## Evidence and limitations

- Agent C's report: `docs/wave12-3/2026-10-14/WAVE12_3_AGENT_C_STAGING_SAFETY.md`.
- Wave 12.2 source and staging evidence is documented under `docs/wave12-2/2026-10-14/`; five reports were reviewed for this lane.
- Agent C made no source/provider changes and did not execute tests or workflows. Source trigger checks were static. The Vercel readback supplied to the lane omitted Git linkage; the prior same-day Wave 12.2 report contains separate linked-project inventory evidence.
- The final PG18/source disposition and local exact-SHA suite/build evidence are recorded in the [coordinator report](WAVE12_3_COORDINATOR_REPORT.md).

**Owner decision status:** `MIGRATION NOT AUTHORIZED — REVIEW THE EVIDENCE, THEN KEEP STAGING BLOCKED.`
