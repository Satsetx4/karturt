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

## Gate V1 implementation snapshot

- Draft implementation PR: [#65](https://github.com/Satsetx4/karturt/pull/65), open and unmerged at this snapshot.
- Implementation SHA: `f7b06eca307fc0b4a107aaaedee56a89677a8c6b`.
- Local validation: four focused Vitest files / 140 tests, PostgreSQL 18 migration-timeout regression 12/12, typecheck, changed-file lint, `git diff --check`, and local production build passed.
- Exact-head push CI run [`39571785367`](https://github.com/Satsetx4/karturt/actions/runs/39571785367) and PR run [`39571791405`](https://github.com/Satsetx4/karturt/actions/runs/39571791405) attempt 2 passed Gate A and Windows query-integrity/PowerShell checks at that exact SHA. The separate Launch Safety concurrency job was skipped by branch filter and remains UNVERIFIED. Preserve PR attempt 1's production-build failure in the run history; the same-SHA retry passed, and the cause of the first failure was not captured.
- Migration approval schema v2 now binds the SHA-256 of a freshly recomputed Gate V1 PASS evaluation. Migration remains blocked while provider capture, branch isolation, authenticated probe, and a pinned public key remain unknown or unavailable.

## Provider metadata snapshot

### Previous candidate — snapshot at 2026-10-21 08:46 UTC

Read-only Neon control-plane readback at 2026-10-21 08:46 UTC:

| Check | Observed | Evidence meaning |
| --- | --- | --- |
| Organization plan | Free | Provider plan metadata observed |
| Project | `broad-star-40451875` | Exact project id; name is descriptive metadata, not isolation proof |
| Project region | `aws-ap-southeast-1` | Provider metadata |
| PostgreSQL major | 18 | Provider metadata, not live SQL proof |
| Endpoint | `ep-mute-firefly-azjcru4h`, direct host `ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech`; idle/suspended, pooler disabled, read-write endpoint | Exact endpoint identity candidate; must be re-read before any live gate |
| Compute min/max | 0.25 CU | Provider metadata at snapshot time |
| Branch | `br-orange-recipe-azed9f78`, ready, primary/default | Exact branch id; provider metadata |
| Branch lineage | `parent_id` omitted; `init_source=parent-data` | Isolation/content provenance UNKNOWN |
| Public connectivity | Enabled; no IP allowlist | Provider metadata; constrain any future credentialed inspection |
| Logical size | 31,686,656 bytes; zero current storage-hour/write counters | Does not prove empty application catalog or synthetic-only lineage |

No SQL connection, Neon SQL connector call, database mutation, or migration was performed for this 08:46 evidence snapshot. The `broad-star-40451875` candidate is now retired for Gate V1 and remains blocked as a legacy staging target; it was not deleted or modified.

### New project — created 2026-10-21 09:23:42 UTC; read back 09:23:55 UTC

The Neon connector created a new project in the existing Free organization with PostgreSQL 18, region `aws-ap-southeast-1`, a 0.25 CU min/max, and a default branch named `staging-readiness-gate-v1`. The create request supplied no parent, source project, clone, import, or restore fields. Neon documents that a project starts with its own root/default branch and that `parent_id` identifies a parent branch ([create project API](https://api-docs.neon.tech/reference/createproject), [retrieve branch API](https://api-docs.neon.tech/reference/getprojectbranch), [branch management](https://neon.com/docs/manage/branches)).

| Check | Observed | Evidence meaning |
| --- | --- | --- |
| Organization plan | Free | Fresh Neon control-plane readback |
| Project | `wild-darkness-00489132` (`karturt-v1-staging-readiness-gate-v1`) | New project; create response shows no source project binding |
| Project region / PostgreSQL | `aws-ap-southeast-1` / 18 | Provider metadata |
| Branch | `br-spring-shadow-b37rykzl`, `staging-readiness-gate-v1`, ready, primary/default | One branch observed in the new project |
| Branch parent fields | `parent_id` omitted; `init_source=parent-data` | Consistent with a new project's root/default branch; `init_source` alone is not lineage proof |
| Database and owner role | `karturt` / `karturt_owner` (database id `669644`) | Provider control-plane metadata; not a catalog query |
| Endpoint | `ep-silent-haze-b3pcaa3t`, direct host `ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech`, read-write, active, pooler disabled | Exact current provider target metadata |
| Compute | Min/max `0.25` CU | Matches the Free-plan cap |
| Passwordless metadata | `passwordless_access=true` | Not used as credential or TLS evidence |

The endpoint and database/role metadata were refreshed through additional read-only connector calls later in this task. Project-level structural isolation from the former project is supported by the new project create request and Neon’s root-branch contract, but the control-plane snapshot is not a signed capture. **Synthetic-only application data and catalog emptiness remain UNKNOWN** until trusted evidence and the audited Gate V1 probe establish them. The branch still reports `init_source=parent-data`; no conclusion is drawn from that value alone.

The provider rejected the optional `store_passwords=false` setting as unsupported, so project creation used Neon’s default provider-side password storage. No connection string or password was retrieved, displayed, committed, or used. No SQL, catalog query, data write, migration, old F2 retry, or production action occurred. The new project is the selected Gate V1 target; the previous candidate is preserved as a protected legacy target.

## Migration authorization snapshot

Local repository inspection shows migration approval verification is fail-closed while `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM` is null. Existing checks bind signed approval to source, target, and migration manifest and require a one-shot interactive challenge. The guard now revalidates the clean source SHA, target URL/manifest, migration snapshot, fresh readiness digest, and exact signed-approval bytes after that challenge and again immediately before client creation. Regression coverage was added for stale or changed bindings during the wait and after one-shot consumption. The broad owner authorization does not replace the signed approval. Migration execution remains BLOCKED.

## Current gate status

| Gate | Status | Reason |
| --- | --- | --- |
| PR #60 static/runtime guard review | REVIEWED | Static review only; operational F2 superseded for future use |
| Free plan and compute scope | PASS — provider snapshot only | New project metadata shows Free and 0.25 CU; refresh immediately before any future database probe |
| Exact target provider metadata | PASS — provider metadata only | New project/branch/database/role/direct endpoint identifiers were read back; not an authenticated Gate V1 capture |
| Project root isolation | PARTIAL — create-contract and metadata only | Separate project and root/default branch are consistent with structural isolation; control-plane readback is not a signed capture artifact |
| Synthetic-only content and empty catalog | UNKNOWN | No database SQL/catalog inspection has run |
| Strict libpq TLS and channel binding | UNKNOWN | No same-session libpq connection performed |
| Read-only application catalog | UNKNOWN | No Gate V1 SQL inspection performed |
| Gate V1 local regressions | PASS — LOCAL ONLY at `f7b06eca307fc0b4a107aaaedee56a89677a8c6b` | Four focused Vitest files / 140 tests; PG18 migration-timeout regression 12/12; PowerShell 7 parser/preflight regression; typecheck, lint, diff check, and local production build passed |
| Exact-head CI for Gate V1 | Gate A + Windows PASS on push and PR attempt 2; Launch Safety UNVERIFIED | Push run `39571785367` and PR run `39571791405` attempt 2 passed Gate A and Windows query-integrity/PowerShell checks on the exact SHA. The separate Launch Safety concurrency job was branch-filter skipped, not passed. PR attempt 1 failed during Turbopack `next/font/google` resolution; attempt 2 passed, and the cause remains unknown. |
| Referenced evidence and migration binding | IMPLEMENTED — LIVE PATH NOT UNLOCKED | Migration schema-v2 approval binds the exact evaluation SHA-256; runner and evaluator require byte digests, artifact schema/type, exact source SHA, target binding, freshness, and recomputed PASS. Provider-source authenticity remains a separate evidence-layer question. |
| Provider/runner capture authenticity | UNKNOWN — DB launch blocked | Connector output is available in this task but is not a trusted signed capture for the offline evaluator; the runner stops before psql and the evaluator downgrades provider/isolation/probe claims to UNKNOWN |
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
- 2026-10-21 07:59 UTC: Clean exact source `e1e353eae896b0f9487f326121c866ccb039fbed` passed 3 focused Vitest files / 120 tests, PowerShell 7 AST parsing, and the missing/self-asserted-provider early-stop regression. The evaluator subprocess test verified report and stdout agree on UNKNOWN and `migrationAllowed=false`. `git diff --check` passed. Local lint/typecheck could not be run because this worktree has no installed dependency tree; exact-head CI remains pending and must be checked on this SHA. No database/provider connection, SQL, migration, or provider mutation occurred.
- 2026-10-21 08:01 UTC: Exact-head push run 39566053222 and PR run 39566077920 both reference source SHA `a19fbec0e614bdb13423f218d499b8e8fd9e053f`. The Windows query-integrity/PowerShell job passed, and lint passed with 0 errors plus 2 existing warnings in unchanged files. Typecheck failed before test jobs with TS18046 at `src/db/staging-readiness-gate-v1-artifact.ts:205` and TS2345 at `tests/unit/staging-readiness-gate-v1-artifact.test.ts:218`; remaining Gate A jobs were skipped. These exact-SHA failures are retained as historical evidence; fixes are in the next working-tree revision and must receive a new exact-head CI run.
- 2026-10-21 08:09 UTC: Exact-head push run 39567017817 and PR run 39567023553 both reference source SHA `429390c81f01b0cfebf72afb7509532309f370f4`. Windows query-integrity/PowerShell, lint, and typecheck passed; unit tests failed 3 pre-existing staging-target assertions because their synthetic URLs omitted required `channel_binding=require`, so identity validation correctly failed before the expected runtime-isolation block. Remaining Gate A jobs were skipped. Independent review also found the offline evaluator computed migration permission conditionally; commit `d13081c` makes that report field unconditionally false. Current working changes update the three test fixtures to include the strict channel-binding value and must receive fresh local verification and exact-head CI. The failed 429 runs remain historical evidence and are not carried forward.
- 2026-10-21 08:46 UTC: Fresh read-only Neon control-plane metadata showed Free plan, PostgreSQL 18, `aws-ap-southeast-1`, project and direct endpoint compute bounds of 0.25 CU, and a ready endpoint with pooler disabled. Exact project, branch, and endpoint identifiers were re-read. Branch `init_source=parent-data` persists and `parent_id` is omitted; neither establishes root lineage or synthetic-only contents. Logical size was 31,686,656 bytes; zero usage/write counters do not prove an empty catalog. Public connections remain enabled with no IP allowlist. No connection-string retrieval, credentials, SQL, provider mutation, or migration occurred.
- 2026-10-21 08:53 UTC: Source SHA `f7b06eca307fc0b4a107aaaedee56a89677a8c6b` passed local readiness/migration regressions (140 focused tests), PostgreSQL 18 timeout regression (12 tests), typecheck, changed-file lint, diff check, and production build. Exact-head push CI run `39571785367` passed Gate A and Windows query-integrity/PowerShell checks; the separate Launch Safety concurrency job was branch-filter skipped and remains UNVERIFIED. PR run `39571791405` attempt 1 failed during production build with 35 Turbopack `next/font/google` internal-module resolution errors; an exact-SHA retry started as attempt 2. No database connection or provider mutation was part of these checks.
- 2026-10-21 09:04 UTC: Exact-SHA PR run `39571791405` attempt 2 passed Gate A, including the production build, and passed the Windows query-integrity/PowerShell checks. The same-run Launch Safety concurrency job remained branch-filter skipped and UNVERIFIED. The first PR attempt's font-resolution failure was not reproduced; its cause remains unknown.
- 2026-10-21 09:23:42 UTC: After a Free-plan restriction rejected a custom suspend interval, the Neon connector created project `wild-darkness-00489132` with PostgreSQL 18, `aws-ap-southeast-1`, 0.25 CU bounds, database `karturt`, and the root/default branch `br-spring-shadow-b37rykzl`; no parent/source/import/restore field was supplied. Read-only provider calls at 09:23:55 and later confirmed the branch and endpoint `ep-silent-haze-b3pcaa3t` on the direct host `ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech`, plus role `karturt_owner`. Neon rejected `store_passwords=false`; default provider-side storage was used, but no credential or connection string was retrieved. Structural root isolation is supported by the create contract and provider readback, while synthetic-only data and catalog state remain UNKNOWN. No SQL, data writes, migration, old F2 retry, or production action occurred. The former `broad-star-40451875` candidate remains untouched and is now protected as legacy. The target source mapping and new evidence still require local regressions and exact-head CI.
- Build failure triage: Next.js issue [#97378](https://github.com/vercel/next.js/issues/97378) reports a similar `next/font/google` internal-module error after a font-file fetch failure. The failed run here did not expose a request URL or HTTP status, so that issue is context only, not a confirmed cause. Local build and both exact-SHA push/PR retry builds passed.
- 2026-10-21: Migration operator regression review found and closed a freshness window: readiness revalidation now recomputes raw provider and database-probe freshness against current migration time, not merely the report’s earlier completion time. Tests cover underlying probe/provider observations older than 120 seconds while the report remains under 120 seconds old, time passing during the interactive challenge, and time passing after one-shot consumption. The generic client executor is now module-private so the exported staging command requires its one-shot preflight binding. These are source/guard regressions only; no database client or migration was opened.
