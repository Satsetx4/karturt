# Wave 13A Agent A — Staging Target Guard

**Result: source guard implemented; staging runtime remains closed.**

## Implemented

`src/lib/staging-database-target.ts` now contains a source mapping for the exact Wave 12.6B staging identity:

| Field | Reviewed value |
|---|---|
| Organization | `org-ancient-boat-57106549` |
| Project | `karturt-v1-staging-clean` / `falling-bread-33359184` |
| Branch | `staging` / `br-muddy-frost-azot13fb` |
| Region | `aws-ap-southeast-1` |
| Database | `karturt_staging` / `702718` |
| Initial role name | `karturt_staging_owner` |
| Endpoint | `ep-silent-butterfly-azrflu40` |
| Direct hostname | `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech` |
| Port | `5432` |

The manifest fingerprint is `02e3eef71c827b775dffe962c275beb559ea763121386bd86fa9d06a2b2949ff`. The validator accepts only the direct hostname, database, role name, port, required safe TLS mode, and a small query allowlist. It rejects aliases, poolers, unknown or duplicate query keys, malformed URLs, unsafe TLS values, and incorrect identity fields. It performs no connection.

The older staging target is denied across environment labels and remains untouched: project `wild-art-99835126`, branch `br-hidden-cake-a1ge5xqp`, database `42079960`, endpoint `ep-snowy-meadow-a10304d9`. The approved new endpoint is also denied under non-staging labels.

`assertDatabaseTargetForEnvironment` still rejects new-target staging runtime access because `stagingIsolationVerifiedEmpty` is fixed at `false`. The operator-only URL identity check does not open that runtime gate.

## Tests and limits

Focused tests cover wrong host, pooler and alias hosts, wrong database/role/port, duplicate and unsupported query parameters, malformed credential-bearing URLs, old-target denial, cross-environment denial, and the new-target runtime block. Five additional offline smoke assertions passed in the isolated agent worktree; the integrated focused suite passed 41/41.

This source mapping is not live provider attestation. It does not prove the project/branch relationship, the target contents or lineage, effective database privileges, network access rules, authentication mode, or runtime readiness. The earlier scoped catalog output is not used to set the emptiness flag.
