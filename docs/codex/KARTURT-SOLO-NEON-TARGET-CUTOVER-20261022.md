# KartuRT V1 — Solo Neon staging target cutover (Issue #70)
 
Date: 2026-10-22 (Asia/Jakarta). **Status: candidate only, no authorized runtime target cutover.** User approved continuing KartuRT V1 within Free plan and existing safety gates. This document is a source-controlled OFFLINE cross-check, not a signed provider artifact, root-lineage proof, SQL catalog result, or authorization to migrate.

## Exact existing / proposed target matrix

| Property | Existing Gate V1 candidate in draft PR #65 (NO CHANGE) | New candidate from pre-recorded create call |
| --- | --- | --- |
| Project | `wild-darkness-00489132` | `super-band-12770762` |
| Organization | `org-ancient-boat-57106549` | same |
| Project name | `karturt-v1-staging-readiness-gate-v1` | `karturt-v1-solo-provenance-20261022` |
| Branch | `br-spring-shadow-b37rykzl` | `br-solitary-king-a1qdsiln` |
| Branch name | `staging-readiness-gate-v1` | `karturt-solo-root-20261022` |
| Endpoint | `ep-silent-haze-b3pcaa3t` | `ep-falling-mountain-a1hlzrdb` |
| Direct host | `ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech` | `ep-falling-mountain-a1hlzrdb.ap-southeast-1.aws.neon.tech` |
| PG, region, CU | PG18, Singapore, 0.25 | PG18, Singapore, 0.25 |
| Plan | Free | Free (provider `free_v3`) |
| Database ID | `669644` | `42124647` (Neon read-only database metadata on 2026-10-22) |
| Lineage | UNKNOWN | UNKNOWN; new default branch still `init_source=parent-data` without `parent_id` |
| Synthetic-only and SQL catalog | UNKNOWN / not proved | UNKNOWN / no SQL run |
| Status | Existing PR #65 binding | **Offline candidate only** |

## New candidate source pointers and limits

- Exact original create-request intent timestamped **before** API call at [issue #68 pre-creation](https://github.com/Satsetx4/karturt/issues/68#issuecomment-6333016123).
- Actual provider readback (project, branch, endpoint, PG18 Free, 0.25 CU, operations) at [issue #68 post-creation](https://github.com/Satsetx4/karturt/issues/68#issuecomment-6333045271).
- Provider `list_postgres_databases` on the new branch reported database ID `42124647`, database `karturt`, owner `karturt_owner`. This is **control-plane metadata only**, NOT a SQL catalog check or proof of emptiness.
- Provider create_timeline `287c6cc3-4c01-4622-8fdd-1f1d72f29f00`, project created 2026-10-22T04:52:37Z. The API reports `creation_source=console` and branch `init_source=parent-data`.
- Neon API currently connected with effective **ADMIN** rights, not suitable as the protected Viewer-only principal. No credential or connection URI was read or committed.
- Both GitHub comments can be edited. They are NOT cryptographic provider attestations or immutable original request bytes. Even a consistent, hash-matched request/readback packet cannot establish authenticated lineage or synthetic-only contents.

## Dependency impact before selecting target

A true cutover must **not** be done by replacing one project ID in a document or changing a runtime environment variable. On draft PR #65 at `dffc578fd294fcd8d8d294d09f1f5212ec26bc58`, critical target bindings include:

1. `src/lib/staging-database-target.ts`: `STAGING_MIGRATION_TARGET_MANIFEST`, root-lineage attestation, direct URL validation, legacy endpoint protection, and SHA256 fingerprint.
2. `scripts/staging-readiness-gate-v1.ps1` and referenced `scripts/lib/staging-readiness-*.psm1`: exact project/branch/endpoint host, TLS and file identity assertions.
3. `src/db/staging-readiness-gate-v1.ts`, `src/db/staging-readiness-gate-v1-artifact.ts`, `src/db/staging-readiness-gate-v1-cli-policy.ts`, `src/db/staging-readiness-migration-binding.ts`: source/target/evidence/authorization checks.
4. `src/db/migration-manifest.ts`, `src/db/migration-approval.ts`, `src/db/migration-safety.ts`: stage source, schema and separately signed one-shot execution gates.
5. `tests/unit/staging-database-target.test.ts`, `tests/unit/staging-readiness-gate-v1*.test.ts`, `tests/unit/staging-migration-authorization.test.ts`: replace fixtures/regenerate **new** expected fingerprints only in the specifically reviewed future cutover PR.
6. `docs/codex/STAGING-READINESS-GATE-V1-*2026-10-21.md`, related JSON evidence templates and SQL packet: preserve historical results, version new packet instead of overwriting old F2.
 
This list is **critical paths identified from PR #65**, not a claim of exhaustive full-text scanning. The old PR #65 target remains selected. A future cutover needs a full target-string inventory, immutable exact-head CI (prior concurrency does not carry to a changed SHA), new signed target/fingerprint authority, genuine origin/Viewer/attestation, then separately authorized same-session PG18 read-only catalog. **Do not execute F2, merge, migrate or deploy on this document's authority.**

## Offline implementation and acceptance

`src/lib/staging-solo-candidate.ts` exports a constant **non-active** target record. `assessSoloCandidateOffline` checks an exact normalized snapshot of the requested configuration, project, branch, endpoint and Neon operation. `tests/unit/staging-solo-candidate.test.ts` rejects mismatches, legacy cross-project reuse, extra clone/import/restore claims, malformed source, forged trust annotations and inconsistent timestamps.

Even if all normalized strings match, the function returns `MATCH_UNAUTHENTICATED` with `rootLineage=UNKNOWN`, `syntheticOnly=UNKNOWN`, `providerAuthentication=UNKNOWN`, `tlsAndCatalog=UNKNOWN`, `approvedForCutover=false`, `migrationAllowed=false`. It neither imports nor alters the active target or protected workflows.

Next dependency is an **authenticated trusted capture** that independently binds real creation request/response, provider operations, Viewer identity and signed artifacts. If no credible lineage and synthetic-only evidence exists, retain UNKNOWN/NO-GO. Separate owner approval is needed for actual merge and signed migration; old F2 historically FAILED and requires its own distinct authorization.

## Audited SHA-bound impact inventory (52 scoped files)

**Method and limitations:** On PR #65 exact SHA `dffc578fd294fcd8d8d294d09f1f5212ec26bc58`, enumerate its Git tree and fetch the full contents of **all 52 tracked text files** in scope: `docs/codex/`, `scripts/`, `src/db/`, `src/lib/`, and `tests/unit/` whose *file path names* contain one of `staging`, `migration`, `wave13b2`, `neon`, `gate-v1`, `f2`. Scan literal counts for `wild-darkness-00489132`, `br-spring-shadow-b37rykzl`, `ep-silent-haze-b3pcaa3t`, `broad-star-40451875`, and `STAGING_MIGRATION_TARGET_MANIFEST`. **52/52 scoped file reads succeeded; 23 files contain at least one of these strings.** This is exhaustive only for the stated path-name filter — not for the entire repository or all runtime imports, environment variables, or historical artifacts.

### Active target / source-dependent runtime & tests

| File on PR #65 | Direct old project / branch / endpoint occurrences | Target manifest references |
| --- | --- | --- |
| `src/lib/staging-database-target.ts` | 2 / 2 / 2 | 19 |
| `scripts/staging-readiness-gate-v1.ps1` | 1 / 1 / 2 | 0 |
| `scripts/test-staging-readiness-gate-v1-preflight.ps1` | 2 / 2 / 3 | 0 |
| `tests/unit/staging-database-target.test.ts` | 2 / 2 / 16 | 4 |
| `src/db/staging-readiness-gate-v1.ts` | 0 / 0 / 0 | 15 |
| `src/db/staging-readiness-gate-v1-artifact.ts` | 0 / 0 / 0 | 3 |
| `src/db/staging-readiness-migration-binding.ts` | 0 / 0 / 0 | 4 |
| `tests/unit/staging-readiness-gate-v1.test.ts` | 0 / 0 / 0 | 15 |
| `tests/unit/staging-readiness-gate-v1-artifact.test.ts` | 0 / 0 / 0 | 32 |

The `STAGING_MIGRATION_TARGET_MANIFEST` is a *source-to-target authorization boundary*. A future target swap invalidates current source fingerprint, Windows manifest, evidence links and signed migration bindings. A `PASS` from the old SHA/target cannot be reused.

### Current Gate V1 documents (historical evidence, NOT a replace-all instruction)

- `docs/codex/STAGING-READINESS-GATE-V1-DECISION-2026-10-21.md`: old project/branch/endpoint each 1, retired `broad-star-40451875` 1.
- `docs/codex/STAGING-READINESS-GATE-V1-EVIDENCE-2026-10-21.md`: old project 2, branch 2, endpoint 4, retired project 3.
- `docs/codex/STAGING-READINESS-GATE-V1-EXECUTION-GUIDE-2026-10-21.md`: old project 1, retired 1.

These are existing historical assertions and runbooks. Preserve historical source, timestamps and F2 failed evidence; write a versioned *new* cutover packet, never silently rewrite earlier output into successful new-target evidence.

### Retired F2 / previous staging references (preserve as historical)

| File | Literal occurrences of retired `broad-star-40451875` |
| --- | ---: |
| `docs/codex/Wave-13B2-F2-Owner-Decision-Record-2026-10-20.md` | 1 |
| `docs/codex/Wave-13B2-Free-Only-Staging-Operator-Packet-2026-10-15.md` | 1 |
| `docs/codex/wave13b2-read-only-catalog-preflight.sql` | 1 |
| `docs/codex/wave13b2-staging-expected-state.template.json` | 3 |
| `docs/codex/wave13b2-staging-target-manifest.template.json` | 2 |
| `scripts/preflight-wave13b2-local.mjs` | 2 |
| `scripts/run-wave13b2-f2-query.ps1` | 2 |
| `scripts/test-wave13b2-f2-psql-guard.ps1` | 1 |
| `scripts/verify-wave13b2-query-approval.mjs` | 1 |
| `scripts/wave13b2-f2-diagnostics.mjs` | 1 |
| `tests/unit/wave13b2-f2-diagnostics.test.ts` | 3 |

This inventory is **not** a recommendation to edit those historical references. Retired staging remains protected; old F2 attempt-2 failed and F2 needs its own independent owner approval.

### Go/no-go for next source change

Before a code-level cutover: perform a separate whole-repo identifier and call-graph search, review exact new `databaseId` from provider if included, verify authenticated source/Viewer/root/data provenance, then update source+PowerShell+tests in one reviewed exact-SHA change with all `UNKNOWN` guards preserved. Recompute target fingerprint only as a *new* manifest version; never reuse previously signed target or F2 evidence. Run correct push-event independent PostgreSQL concurrency and Gate A. Only after separate owner-authorized verified PG18 read-only catalog/TLS and Gate V1 PASS may migration be proposed; this document has no execution authority.

## Offline minimum-privilege / Viewer claim guard (next phase)

`src/lib/staging-solo-viewer-claim.ts` and `tests/unit/staging-solo-viewer-claim.test.ts` provide an additional **pure, inactive** exact-source/target/Viewer-claim consistency check. It rejects current connected Neon **ADMIN** permission, all Editor/Owner/unknown permissions, mismatched project/branch/endpoint/DB ID, stale or future observations, malformed SHA, and injected `trusted: true`/elevated claims. A fictional `VIEWER` string that matches yields only `METADATA_CONSISTENT_UNAUTHENTICATED`, **NOT** an authenticated Viewer API token or any permission to query provider data, connect to Postgres, cut over, run F2, migrate or deploy.

**Control boundary:** No token is captured or tested, because this code cannot independently verify effective Neon API key permissions. Effective **Viewer-only principal** and a trusted, signed in-process provider capture are still required in a later protected reviewed workflow, after actual Solo Owner single-use authorization and exact `main` release gates pass. Self-declared JSON, even with matched IDs and a hash, is not a cryptographically verified snapshot. Active manifest `wild-darkness-00489132` is unchanged.
