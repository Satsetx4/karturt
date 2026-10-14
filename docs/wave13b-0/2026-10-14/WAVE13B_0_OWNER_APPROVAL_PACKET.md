# KartuRT V1 Wave 13B.0 — Owner Approval Packet

Date: 2026-10-14
Packet status: **D1 OWNER APPROVAL PACKET READY**
Owner decision status: **PENDING — no D1, D2, or D3 authorization has been given in this wave.**

## Decision requested now: D1 only

Please review and decide whether to authorize the one bounded preflight below. The only possible approval at this point is D1. This packet itself does not execute or authorize a database operation. No Neon SQL, connection, compute wake, provider change, key generation/pinning, signature, migration, application runtime access, Vercel change/deployment, or old-staging/production action has occurred.

### Exact target binding

| Resource | Required value |
|---|---|
| Organization | `satset` / `org-ancient-boat-57106549` |
| Project | `karturt-v1-staging-clean` / `falling-bread-33359184` |
| Branch | `staging` / `br-muddy-frost-azot13fb` |
| Database | `karturt_staging` / ID `702718` |
| Endpoint | `ep-silent-butterfly-azrflu40` / `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech` |
| Role | `karturt_staging_owner` |
| Region / engine | `aws-ap-southeast-1` / PostgreSQL 18 |
| Source SHA referenced by design | `48b92abbe93fbd499448b6c885d3042cb49c2128` |

A fresh metadata-only readback must happen immediately before any later D1 call and must match every listed ID and the full host. If the readback can wake compute, retrieve credentials, or mutate a resource, skip it and stop. SQL cannot attest to the organization, project, branch, or endpoint IDs: the future operator must bind explicit connector arguments and fresh control-plane metadata to those values. No fallback to the old staging target is permitted.

### Known facts and unresolved questions

- Control-plane metadata aligns the named IDs. It reports the new project's endpoint as read-write and idle, `block_public_connections=false`, an empty IP allow list, organization `require_mfa=false`, branch `protected=false`, `init_source=parent-data`, logical size 31,686,656 bytes, `written_data_bytes=0`, endpoint `passwordless_access=true`, and `store_passwords=true`.
- These values do **not** prove an unauthenticated PostgreSQL path, physical or historical emptiness, independent branch lineage, SQL-effective grants, or an individual's MFA state. Neon documentation does not define the endpoint `passwordless_access` metadata flag as bypassing PostgreSQL role authentication. Treat it as unknown.
- The initial role inventory reports password authentication but no effective membership or object grants. Neon documentation says roles created through Console/API/CLI are members of `neon_superuser`; whether this target role has that membership has not been checked with SQL. Do not treat the owner role as an application credential.
- The current Free plan has residual public-network exposure. Current Neon docs place IP Allow and Private Networking on Scale. This packet does not require a paid upgrade. D2 must either explicitly accept the residual for bounded staging work or stop and select another separately reviewed route. TLS does not make a public endpoint private.
- The source guard remains `stagingIsolationVerifiedEmpty=false`; the pinned Ed25519 public key remains `null`. No code change is part of this packet.

The precise provider evidence and official references are in [Agent A — Neon Security](WAVE13B_0_AGENT_A_NEON_SECURITY.md). Do not infer additional facts from metadata-only fields.

### D1 approval statement

If the owner wants to authorize only this preflight, approve the following bounded statement through the separately approved owner-authorization process:

> **D1 — scoped read-only preflight only.** I authorize one call to `run_sql_transaction` against organization `org-ancient-boat-57106549`, project `falling-bread-33359184`, branch `br-muddy-frost-azot13fb`, database ID `702718` / name `karturt_staging`, endpoint/compute ID `ep-silent-butterfly-azrflu40`, and role `karturt_staging_owner`, using the exact ordered statement set in `WAVE13B_0_READ_ONLY_PREFLIGHT_SQL_REFERENCE.md`. The call may start or use the currently idle endpoint's compute. The call must pass `project_id`, `branch_id`, `compute_id`, `database_name`, and `role_name` explicitly, use one server transaction and session, begin its statement array with `SET TRANSACTION READ ONLY`, immediately verify server read-only mode, exact database and role, and PostgreSQL 18, then return only the fixed catalog metadata in that reference. It may not read application table rows, large-object contents, SQL definitions, secrets, connection options, or credentials; invoke user-defined routines; access another database; or change data, schema, roles, network settings, authentication, or any provider resource. Any identity mismatch, guard failure, transaction/session-affinity or abort-on-error uncertainty, missing result group, permission error, timeout, or unapproved object/result is STOP; do not retry, use another tool/driver/target/role, clear, reset, rebuild, or migrate. This approval authorizes no D2/D3 action, source change, runtime access, rollback, Vercel action, or production/old-staging access.

**Owner response:** `D1 APPROVE` only if every limitation above is accepted, or `D1 DECLINE`. No response is not approval. Do not send credentials or key material with the response.

The exact statement order, expected results, error behavior, and classification are in the linked [fixed preflight SQL reference](WAVE13B_0_READ_ONLY_PREFLIGHT_SQL_REFERENCE.md) and [Agent B design report](WAVE13B_0_AGENT_B_SQL_PREFLIGHT.md). The connector describes ordered statements as one transaction but does not document session affinity, statement error handling, or whether query invocation wakes compute. If those connector properties cannot be proven before the call, D1 remains unexecuted and the result is `UNKNOWN`.

### D1 outcome rules

| Result | Meaning | Next action |
|---|---|---|
| `CLEAN_CATALOG_PREFLIGHT` | Every fixed result group is present, exact target/session identity and PG18 match, server read-only guard and `SHOW` pass, object/extension allowlist matches, no application objects, Drizzle ledger, or large objects are found, and role privileges are fully returned. | Return to owner review. This is catalog cleanliness only, not migration approval or proof of physical emptiness/lineage. Keep source isolation guard false. |
| `UNCLEAN` | Safely read-only on the exact target, but any unapproved object, extension, ledger, large object, or rejected privilege finding appears. | Stop and preserve target. No row-content follow-up, retry, reset, cleanup, or migration. |
| `UNKNOWN` | Target, transaction, session, identity, permissions, results, or outcome cannot be fully classified. | Stop. No alternate query path, fallback target, retry, reset, rebuild, or migration. |

Even a `CLEAN_CATALOG_PREFLIGHT` cannot prove physical storage emptiness, that prior contents were never removed, or independent branch ancestry. Current `init_source=parent-data` remains a lineage unknown. Positive lineage/content provenance is a separate prerequisite for D3. Catalog metadata, a missing ledger, zero tracked writes, and logical-size output are not positive lineage proof.

## Later gates — listed for clarity, not approval

### D2 — provider security, roles, and trust setup

D2 is not included in D1 and must be split into individually approved choices before any later operation:

1. **Network/authentication choice:** reconfirm exact new-target IDs and decide whether to accept the Free-plan public-network residual for a bounded staging window or stop to design another route. No plan upgrade is proposed or authorized. Do not change `block_public_connections`, IP allow settings, MFA, or branch protection from this packet.
2. **Role/grant choice:** first review exact effective grants. Keep the human owner/break-glass principal separate from a migration-only principal and an application runtime principal. Runtime access should have no DDL, role-creation, database-creation, or broad administrative authority. Authorize exact role names and grants in a separate decision. Do not create provider roles through a route that grants `neon_superuser` by default. Do not distribute or enable a runtime credential here.
3. **PKI/approval choice:** only in a later separately authorized ceremony, generate an Ed25519 key under owner-controlled offline or hardware-backed custody, independently verify public key/fingerprint and recovery/revocation, then pin only the public key in a separately reviewed source change. Never disclose or commit a private key. Pinning changes source SHA; re-review the resulting full SHA, target fingerprint, and 15-blob migration fingerprint before issuing any migration authorization.
4. **Credential and human recovery:** use a password manager/secret manager for any later human-managed credential. Keep the operator-only `MIGRATION_DATABASE_URL` out of code, chat, logs, artifacts, shell history, CI output, and application runtime. Confirm human MFA and a second-admin or recovery path before a signed action; current org policy metadata does not enforce MFA.
5. **Transport choice:** before any later connection, verify that the selected driver supports TLS hostname verification (`sslmode=verify-full`) and the selected channel-binding policy. A driver limitation is STOP, not permission to downgrade. The PG18 rehearsal used loopback TCP, not Neon serverless/WebSocket.

See [Agent A](WAVE13B_0_AGENT_A_NEON_SECURITY.md) for current Free capabilities and risk controls, and [Agent C](WAVE13B_0_AGENT_C_AUTHORIZATION_RECOVERY.md) for the signed-approval trust chain and source review. Unselected D2 sub-scopes remain unauthorized.

### D3 — one-time 14-file DDL migration

D3 requires a new, explicit decision after accepted D1 evidence, independently established lineage/empty-target provenance, completed D2 prerequisites, exact effective-grant review, and source/key trust review. If key pinning or remediation changes source, the approved SHA and all bindings must be recomputed at the resulting SHA. D3 would cover only one execution of migrations `0000`–`0013`, in journal order, from the exact 15-entry raw-Git-blob manifest (14 SQL blobs plus `_journal.json`) against only the named new target. It would use one unique, short-lived (maximum 15-minute) signed approval bound to the full final source SHA, exact target fingerprint, migration fingerprint, and authorization ID.

The Wave 13A.2 baseline reports 15/15 raw-blob SHA-256 matches at source SHA `48b92abbe93fbd499448b6c885d3042cb49c2128`, and no migration files changed. Its timeout rehearsal shows a client process can exit while a PostgreSQL backend query remains active; it does not prove server-side cancellation, rollback, or Neon transport behavior. Any mismatch, error, timeout, process interruption, connection loss, or uncertain outcome consumes that authorization and requires separately approved read-only reconciliation. No automatic retry, ledger edit, rollback, reset, rebuild, delete, or recreate is allowed.

Post-migration verification is a further separate read-only decision. Historical source-specific expectations after the exact migration order are 14 ledger entries, 27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums. Reconcile catalog counting rules and compare object identity/definitions and ledger hashes to the exact source; counts alone do not pass. These are not universal PostgreSQL guarantees.

The existing old staging project `wild-art-99835126`, its branch/database/endpoint, and production remain preserved and are never fallback or recovery targets. Any rollback or rebuild needs its own owner decision that names exact operations and preserves both staging projects.

## Evidence and handoff

- [Coordinator report](WAVE13B_0_COORDINATOR_REPORT.md) records immutable source/docs anchors, Wave 13A.2 evidence, lane results, and workflow/deployment checks.
- [Agent A — Neon Security](WAVE13B_0_AGENT_A_NEON_SECURITY.md) records provider metadata readback and current official Neon references.
- [Agent B — SQL Preflight](WAVE13B_0_AGENT_B_SQL_PREFLIGHT.md) records fixed query design, classifications, and post-migration checks.
- [Fixed preflight SQL reference](WAVE13B_0_READ_ONLY_PREFLIGHT_SQL_REFERENCE.md) supplies the exact inert statement text for D1 review.
- [Agent C — Authorization and Recovery](WAVE13B_0_AGENT_C_AUTHORIZATION_RECOVERY.md) records source trust, replay, key custody, and unknown-outcome limits.

This Wave 13B.0 packet ends at owner review. **D1 is not approved by the existence or publication of this packet.**
