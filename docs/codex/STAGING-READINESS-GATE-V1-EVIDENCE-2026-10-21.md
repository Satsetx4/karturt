# Staging Readiness Gate V1 — Evidence Ledger

Date: 2026-10-21
Purpose: sanitized, append-only status snapshot for the decision and implementation branch. This ledger contains no credentials or owner contact details.

## Evidence labels

- **Local source:** repository content inspected at a recorded commit or worktree.
- **Exact-head CI:** workflow results tied to one exact source SHA.
- **Provider metadata:** Neon control-plane metadata only; does not prove database catalog or live client TLS.
- **Owner report:** facts reported by the owner; not independently verified.
- **Live database:** direct SQL evidence from the exact database. None has been collected for Gate V1.

## Owner-reported attempt-2 outcome

Source: current owner request. The owner reports `psqlExitCode=3`, verified audit, failure `TLS_NOT_ACTIVE / CONNECTION_GUARD_FAILED` from `pg_stat_ssl`, and passing connection identity, PostgreSQL 18, and read-only transaction checks. Catalog status is UNKNOWN. Treat this as an immutable owner-reported result; do not copy raw attempt artifacts, overwrite markers, retry the old F2 procedure, or relabel it PASS.

## PR #60 review snapshot

- PR: [#60](https://github.com/Satsetx4/karturt/pull/60)
- Reviewed source SHA: `019aeeb6d6c411ed3b95b42c3c0f1c4130381b28`
- Local branch base and new implementation branch base: exact PR source SHA above.
- The PowerShell 7 guard appears to reject unsupported Windows PowerShell before importing the runner module or creating an attempt marker.
- Exact-head [workflow run `39525230095`](https://github.com/Satsetx4/karturt/actions/runs/39525230095): Gate A passed; Windows query-hash/LF/document check passed; Launch Safety was skipped. The first browser-CSRF attempt at this SHA failed to connect to localhost port 80; its rerun passed.
- The PowerShell/PostgreSQL 18 regression script was not included in that exact-head CI run. Do not promote its local/historical result to CI PASS.
- Review implication: PR #60 remains an open historical F2 change and is not the staging readiness approval. No merge is authorized by this review.

## Provider metadata snapshot

Read-only Neon control-plane readback at 2026-10-21 07:10:28 UTC:

| Check | Observed | Evidence meaning |
| --- | --- | --- |
| Organization plan | Free | Provider plan metadata observed |
| Project | `karturt-v1-synthetic-staging-20261015` | Name is descriptive metadata, not isolation proof |
| Project region | `aws-ap-southeast-1` | Provider metadata |
| PostgreSQL major | 18 | Provider metadata, not live SQL proof |
| Endpoint | `ep-mute-firefly-azjcru4h` | Exact endpoint identity candidate; must be re-read before any live gate |
| Compute min/max | 0.25 CU | Provider metadata at snapshot time |
| Branch | `main`, ready, primary/default | Provider metadata |
| Branch lineage | `parent_id` omitted; `init_source=parent-data` | Isolation/content provenance UNKNOWN |
| Public connectivity | Enabled; no IP allowlist | Provider metadata; constrain any future credentialed inspection |
| Storage counters | zero reported | Does not prove empty application catalog or synthetic-only lineage |

No SQL connection, Neon SQL connector call, database mutation, or migration was performed for this evidence snapshot. Live database catalog and libpq TLS remain UNKNOWN.

## Migration authorization snapshot

Local repository inspection shows migration approval verification is fail-closed while `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM` is null. Existing checks bind signed approval to source, target, and migration manifest and require a one-shot interactive challenge. The broad owner authorization does not replace those checks. Migration execution remains BLOCKED.

## Current gate status

| Gate | Status | Reason |
| --- | --- | --- |
| PR #60 static/runtime guard review | REVIEWED | Static review only; operational F2 superseded for future use |
| Free plan and compute scope | PASS — provider snapshot only | Must refresh immediately before any future inspection |
| Exact target provider metadata | PARTIAL | Candidate identifiers captured; must be freshly read and matched |
| Synthetic-only branch isolation | UNKNOWN | Missing lineage and content proof |
| Strict libpq TLS and channel binding | UNKNOWN | No same-session libpq connection performed |
| Read-only application catalog | UNKNOWN | No Gate V1 SQL inspection performed |
| Gate V1 local regressions | PENDING FINAL POST-COMMIT RUN | Earlier pre-CLI run: 118/118. Expanded focused unit suite and preflight script must pass against clean exact HEAD |
| Exact-head CI for Gate V1 | PENDING | Must run on the new implementation SHA |
| Referenced evidence integrity | IMPLEMENTED — NOT YET EXERCISED ON LIVE ARTIFACTS | Runner and offline evaluator require byte digests, artifact schema/type, exact source SHA, and target binding; provider-source authenticity remains a separate evidence-layer question |
| Provider/runner capture authenticity | UNKNOWN — DB launch blocked | Hashes authenticate bytes only. Unsigned local JSON and connector output copied into a file do not prove who produced it; the runner now stops before psql and the offline evaluator downgrades provider/isolation/probe claims to UNKNOWN |
| Staging migration authorization | BLOCKED | Pinned public verification key is null |
| Production | OUT OF SCOPE | No production action authorized or performed |

## Change log

- 2026-10-21: Initial sanitized ledger created from PR #60 review, owner report, and read-only provider metadata. No live database evidence or provider mutation.
- 2026-10-21 07:21:11 UTC: Fresh read-only Neon metadata refresh confirmed organization plan value `free`; project compute min/max are both 0.25 CU, PostgreSQL 18, and region `aws-ap-southeast-1`. The branch is ready, primary/default, but the API response omits the `parent_id` field and reports `init_source=parent-data`; this does not prove root lineage or synthetic-only content. Public connections remain enabled with no IP allowlist. The source manifest's internal plan label `free_v3` is not the organization API's plan value and must not be used as a direct comparison.
- 2026-10-21 07:26:09 UTC: Combined fresh read-only refresh of organization, project, branch, and endpoint confirms organization plan `free`; project and endpoint min/max are 0.25 CU, PostgreSQL 18, exact endpoint host `ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech`, branch state ready and primary/default, endpoint enabled and direct (`pooler_enabled=false`). The branch API still omits `parent_id` and reports `init_source=parent-data`; root lineage and synthetic-only provenance remain UNKNOWN. Public connections remain enabled with no IP allowlist. No SQL or provider mutation was performed.
- 2026-10-21 07:29:31 UTC: Fresh read-only control-plane refresh again confirms organization plan `free`, PostgreSQL 18, project and endpoint compute bounds 0.25 CU, the reviewed project/branch/endpoint IDs, and a ready primary/default direct endpoint. Both branch detail and branch-list responses omit the `parent_id` property; the branch reports `init_source=parent-data` and `creation_source=console`. These fields do not establish root lineage or synthetic-only contents. Public connectivity remains enabled with no IP allowlist. No SQL, credential access, or provider mutation was performed.
- 2026-10-21: Local offline regressions on the uncommitted Gate V1 candidate based on PR #60 source `019aeeb6d6c411ed3b95b42c3c0f1c4130381b28` passed: 3 focused files / 118 tests, PowerShell 7 parser, workflow YAML and package JSON parsing, and a subprocess preflight regression proving an early provider stop produces `UNKNOWN` preflight/isolation statuses without reaching database connection. A runner/evaluator review led to byte-verified evidence references, current-time freshness validation, and explicit checks for every catalog dimension. These source changes still require exact-head CI. This is local evidence only; no Gate V1 database probe or migration has run.
- 2026-10-21: The most recent provider metadata snapshot in this ledger is from 07:29:31 UTC and is now historical; refresh the provider plan, compute bounds, exact target, and lineage immediately before any future Gate V1 probe. The observed `parent_id` omission and `init_source=parent-data` remain unresolved; catalog and synthetic-only state are UNKNOWN.
- 2026-10-21 07:53 UTC: Fresh read-only Neon connector calls to list organization, describe the exact project, read the exact branch, list its branches, and inspect branch compute metadata reconfirmed organization plan `free`; PostgreSQL 18; project and direct endpoint min/max 0.25 CU; branch ready and primary/default; endpoint enabled with pooler disabled. The branch still reports `init_source=parent-data` and the provider response omits `parent_id`; logical size is 31,686,656 bytes despite zero current storage-hour and write counters. This does not establish a clean root or synthetic-only data. Public connections remain enabled with no allowlist. No SQL, connection-string retrieval, credential access, provider mutation, or migration was performed. Locally, PostgreSQL 18 psql and PowerShell 7 exist, while `NEON_API_KEY`, `NEON_API_TOKEN`, `PGPASSFILE`, and `PGSSLROOTCERT` are unset. Since MCP metadata output is not cryptographically bound to the runner, the runner now stops with `PROVIDER_CAPTURE_UNAUTHENTICATED`; provider, isolation, and probe inputs remain UNKNOWN until a trusted collection/attestation path exists.
