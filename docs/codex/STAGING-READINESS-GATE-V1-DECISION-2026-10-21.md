# Staging Readiness Gate V1 — Decision Record

Date: 2026-10-21
Decision: Replace operational use of the old F2 inspection with a read-only, client-verifiable Staging Readiness Gate V1 for KartuRT V1 staging.

## Context

The owner reports that F2 attempt-2 exited with `psqlExitCode=3`, audit verified, and `TLS_NOT_ACTIVE / CONNECTION_GUARD_FAILED` based on `pg_stat_ssl`; connection identity, PostgreSQL 18, and transaction read-only checks passed. The catalog remains UNKNOWN. These are owner-reported attempt results, not independently re-run or re-certified evidence. Attempt-1 and attempt-2 records remain immutable. The old F2 procedure will not be retried.

PR #60 source `019aeeb6d6c411ed3b95b42c3c0f1c4130381b28` receives a static review only. Its PowerShell 7 fail-fast guard appears correctly ordered before module import and attempt-marker creation. On that exact head, Gate A and the Windows query-hash/LF/document job passed after a rerun; Launch Safety was skipped, and the PowerShell/PostgreSQL 18 regression script was not wired into exact-head CI. This does not establish operational F2 readiness.

## TLS finding and decision

PostgreSQL documents `pg_stat_ssl` as SSL information for server-side database backends. libpq exposes client-connection TLS state through its own connection APIs; `psql \\conninfo` reports the active SSL protocol and cipher for the current client connection. Therefore, a false value in `pg_stat_ssl` is not equivalent to `PQsslInUse=false` and cannot by itself establish that the client connection was unencrypted.

Neon documents a connection proxy and TLS/channel-binding support. This makes a boundary or reporting discrepancy plausible, but the reviewed public evidence does not prove that this exact project/endpoint's proxy caused the attempt-2 result or establish the TLS state of every internal hop. The cause remains UNKNOWN; no false-negative or proxy-cause claim is made.

Neon also documents that ordinary branches inherit their parent's schema and data unless a schema-only option is selected. Therefore, a staging branch name, a missing parent field, or zero storage counters cannot establish synthetic-only provenance.

Gate V1 requires a direct libpq connection to the exact approved endpoint with `sslmode=verify-full` and `channel_binding=require`. The same session must show active SSL protocol and cipher. `pg_stat_ssl` is recorded as a diagnostic only; it neither substitutes for nor overrides libpq proof. The gate must not downgrade TLS or infer a pass from metadata alone.

### PostgreSQL 18 `\\conninfo` output contract

PostgreSQL 18 changed `\\conninfo` from prose to a two-column table. With the runner's `-A -t` settings and the query's unaligned, tuples-only settings, the expected English/C-locale output is a fixed sequence of `Label|Value` rows: the 12 base connection fields, six SSL detail fields when SSL is active, and optionally `Host Address` when DNS resolution differs from the supplied hostname. The runner now parses and validates that pinned PostgreSQL 18 shape, rejects duplicate, missing, additional, malformed, localized, legacy, or non-TLS output, and still compares the database, client user, host, and port against the exact target. Offline tests use synthetic rows only; this source-level compatibility fix is not a live TLS or staging result.

References:

- [PostgreSQL 18 `pg_stat_ssl`](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-PG-STAT-SSL)
- [libpq SSL status functions](https://www.postgresql.org/docs/18/libpq-status.html#LIBPQ-PQSSLINUSE)
- [psql `\\conninfo`](https://www.postgresql.org/docs/18/app-psql.html#APP-PSQL-META-COMMAND-CONNINFO)
- [PostgreSQL 18 release notes: tabular `\\conninfo`](https://www.postgresql.org/docs/18/release-18.html)
- [PostgreSQL 18 `\\conninfo` implementation](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/bin/psql/command.c#L792-L907)
- [libpq certificate verification](https://www.postgresql.org/docs/18/libpq-ssl.html#LIBPQ-SSL-CLIENT-CERT)
- [libpq channel binding](https://www.postgresql.org/docs/18/libpq-connect.html#LIBPQ-CONNECT-CHANNEL-BINDING)
- [Neon security overview](https://neon.com/docs/security/security-overview)
- [Neon connection errors and proxy guidance](https://neon.com/docs/connect/connection-errors)
- [Neon on SCRAM channel binding and proxy security](https://neon.com/blog/postgres-needs-better-connection-security-defaults)
- [Neon database branching workflow and inherited data](https://neon.com/docs/get-started-with-neon/workflow-primer)

## Gate design

1. Read exact provider metadata from the control plane, freshly enough to avoid using a stale target snapshot. Require the exact organization/project/branch/endpoint and Free plan with at most 0.25 CU.
2. Prove the live branch is isolated and synthetic-only. Provider names, absent `parent_id`, `init_source=parent-data`, and zero-byte counters are insufficient proof. Require source-bound create-request, readback, dataset-manifest, and attestation artifacts; verify each referenced file's bytes against its recorded SHA-256, target identity, artifact type, and source SHA before any database connection. A digest establishes byte integrity, not the origin of a file. Provider, isolation, and probe artifacts must have trusted capture/runner provenance; if that provenance cannot be verified, label the claims `UNKNOWN` and stop before connecting.
3. Connect using the direct endpoint, exact database and role, a trusted root certificate, `sslmode=verify-full`, and `channel_binding=require`. Keep credentials outside argv, console output, repository, localStorage, and evidence artifacts.
4. In the same authenticated session, verify endpoint/database/role identity, server major 18, active read-only transaction, empty application-owned catalog, absent Drizzle journal, and SSL protocol/cipher. Require exactly the default `public` non-system schema and `plpgsql` extension, no non-system routines, no role memberships granted to the target database role, and no default ACLs. Use bounded timeouts.
5. Record only sanitized results in a new immutable evidence artifact. Revalidate probe completion and all provider timestamps against the current clock during offline evaluation. Keep provider metadata, client TLS proof, catalog results, local CI, remote CI, and owner reports labeled as separate evidence layers.
6. Return readiness PASS only when every required check is proven. Never perform writes in Gate V1. Keep `migrationAllowed=false`; migration authorization remains a separate guard.

The exported `evaluateStagingReadinessSignalsV1` core API is explicitly technical-only: it returns `technicalStatus`, individual checks, diagnostics, and an informative separate authorization check. It has no `status`, `readiness`, or `migrationAllowed` field. The offline artifact CLI is the only combined report path in this implementation, and it forces provider/isolation/probe authenticity to `UNKNOWN` because no trusted capture attestation is available.

### Staging target decision — 2026-10-21

The selected Gate V1 target is the newly created Neon Free project `wild-darkness-00489132`, default branch `br-spring-shadow-b37rykzl`, database `karturt`, role `karturt_owner`, and direct endpoint `ep-silent-haze-b3pcaa3t` in `aws-ap-southeast-1` on PostgreSQL 18 with 0.25 CU bounds. Creation omitted parent, source project, clone, import, and restore fields. This supports a separate-project/root-default-branch structure according to the provider create contract, but the connector response is not a signed capture and the branch still reports `init_source=parent-data` while omitting `parent_id`.

Therefore project-level structural isolation is **PARTIAL evidence only**. Synthetic-only application content and catalog emptiness are **UNKNOWN**. No database connection, SQL/catalog query, data write, or migration has been performed on this target. The prior `broad-star-40451875` project remains untouched and is protected as a legacy target. The project is within the approved Free-only staging boundary; this decision does not authorize a paid feature, production access, deployment, or merge.

## Migration decision

Owner authorization permits guarded staging changes, but it does not bypass the repository's migration controls. The migration operator requires external evaluation, probe, and signed-approval artifacts. It recomputes Gate V1 from the exact probe bytes and requires a fresh, exact-source, exact-target report with every check PASS before reading approval, challenging the operator, consuming approval, or creating a client. Every readiness recomputation evaluates the raw provider and probe timestamps against the current migration time, so a recent report cannot extend older evidence's freshness window. After the challenge, it rechecks the clean source and exact SHA, target URL and manifest, migration snapshot, readiness digest, and unchanged signed-approval bytes before consuming the one-shot authorization. The combined command repeats these checks after consumption immediately before client creation; failure at that last check leaves the approval consumed and opens no client. The low-level client executor is module-private; the exported staging command requires a preflight-bound context. The version-2 signed approval binds the full report SHA-256; the review prints that digest and the one-time challenge includes its prefix. Regression tests cover UNKNOWN, stale, tampered, mismatched, and falsely asserted PASS reports plus source/target/manifest/approval changes and freshness expiry during the interactive wait and after consumption. The current offline evaluator still forces provider/isolation/probe authenticity to UNKNOWN, so readiness remains blocked. The pinned public verification key is also null, which independently disables approval verification. No migration may run until authenticated provider/runner evidence, synthetic-only proof, a trusted authorization mechanism, and every exact-SHA/target/manifest/preflight/interactive check pass. Do not access or derive owner private-key material.

## Rejected outcomes

- Do not retry old F2 or alter/delete either attempt's marker or evidence.
- Do not lower TLS settings, accept a failed `verify-full`, disable channel binding, or assume Neon proxy behavior from an observed symptom.
- Do not treat `pg_stat_ssl=false`, zero storage counters, a project name, or old metadata as proof of isolation or transport state.
- Do not execute DDL/DML, migrations, production changes, paid-service setup, deployment, or merge to a production/default branch.

Status: decision is adopted for the staging-only implementation. The current local Gate V1 runner intentionally stops with `PROVIDER_CAPTURE_UNAUTHENTICATED`: it cannot verify that unsigned local JSON came from the Neon control plane. The offline evaluator also keeps provider/isolation/probe claims `UNKNOWN` without authenticated provenance. This must remain fail-closed until a trusted capture and runner-attestation path is implemented. Staging database inspection and migrations remain gated on the evidence and authorization above.
