# Wave 13B.1v2 — Owner Next-Gate Decision Packet

Date: 2026-10-14

Status: **D1v2 owner approval recorded; execution held before connection for missing local access prerequisites. D2 and D3 remain closed.**

## D1v2 decision already recorded

The owner approved one run of the exact 26-statement frozen companion by the reviewed psql single-transaction method against the fixed target, including one possible endpoint wake. No repeat approval is needed for that unchanged scope. Any new statement, target, connection method, retry, or follow-up query needs a new explicit decision.

## Minimum local setup to unlock the approved D1v2 run

On the machine that will execute the check:

1. Make a PostgreSQL 18 `psql` client available and report only its version/path; do not send credentials.
2. Install or locate the trusted Neon CA certificate so libpq can use `sslmode=verify-full` and validate the exact endpoint hostname. Do not weaken TLS verification.
3. Create an owner-only credential file/path for `karturt_staging_owner` and the exact approved endpoint/database. Keep the secret local; do not paste it into chat, GitHub, source, a command line, or captured output. Confirm only that the secure path is available.
4. Before execution, repeat a non-waking provider identity readback for the exact org/project/branch/compute/database/role tuple. Stop if any identity changes or cannot be read without waking compute.
5. Approve or prepare a written expected-state baseline for roles/memberships, schemas/extensions, ownership, object grants/raw ACLs, effective privileges, and expected migration-ledger objects. D1v2 output includes names and ACLs, so execution must capture only sanitized status/counts/version/read-only mode in visible logs and keep any raw comparison private.

The run must use the exact SQL-only extraction and ordered hashes already frozen in `WAVE13B_1R_FIXED_SQL_REFERENCE.md`, with one psql process, one backend and one transaction. On any target mismatch, failed guard, cap, missing/truncated output, SQL error, timeout, raw-ACL mismatch, or unclassified result: stop; do not retry, add SQL, switch methods, or switch targets.

Result classification stays bounded: `CLEAN_CATALOG_PREFLIGHT` requires complete result sets and a matched approved baseline; `UNCLEAN` requires a complete mismatch; otherwise `UNKNOWN`. No psql run means `NOT EXECUTED — ACCESS/SAFETY BLOCKED`.

## What D1v2 cannot unlock by itself

- `init_source=parent-data`, the logical-size value, zero tracked writes, branch name, or empty catalog output cannot prove independent lineage or physical emptiness.
- `passwordless_access=true` metadata cannot prove unauthenticated SQL access.
- The staging endpoint is public-network reachable by metadata, the branch is unprotected, and the allowlist is empty. No provider settings were changed.
- An idle/suspended endpoint or Free plan does not prove Rp0/no-overage.

Before any staging migration, the owner must provide positive, independently reviewable evidence that the exact staging database is isolated and empty or synthetic-only, plus current account-level Rp0/no-overage confirmation and an approved least-privilege role/network posture. A clean bounded catalog result is not a substitute.

## D2/D3 prerequisites still required

1. Resolve target lineage and contents using independent creation/provenance evidence; do not infer emptiness from catalog rows, metadata, or zero writes.
2. Review exact role separation for migration, runtime, and human operator, including network exposure and least privilege.
3. Owner performs the Ed25519 private-key ceremony outside the agent. The agent must not create, hold, or sign with the owner private key. Pin only the verified public key in a reviewed immutable source revision.
4. Re-verify the final exact source SHA and all 15 migration blob hashes after any source change.
5. For D3 only, obtain a one-time owner Ed25519 signature bound to that exact source SHA, target, migration hash, and a maximum 15-minute validity window. A general permission statement is not a cryptographic migration authorization.
6. Execute only the once-approved migration after every gate passes. Timeout, connection loss, or error is an unknown outcome: stop and reconcile read-only under a separate authorization. Never auto-retry, reset, clear, or recreate.

## Explicitly closed

No DDL or development-only migrate path; no staging guard flip; no credential retrieval; no key generation or signing; no old staging or production fallback; no Vercel environment or deployment; no paid resource, purchase, or plan change; no main merge; no cleanup of old demo/F3 resources.

## Owner action requested

Please make the four local D1v2 prerequisites available (client, trusted CA, private credential path, and an expected-state baseline) and tell me when they are ready. Do not send any secret. The existing D1v2 approval remains in force only for its exact frozen artifact, target, method, and one run.
