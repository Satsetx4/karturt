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
| Lineage | UNKNOWN | UNKNOWN; new default branch still `init_source=parent-data` without `parent_id` |
| Synthetic-only and SQL catalog | UNKNOWN / not proved | UNKNOWN / no SQL run |
| Status | Existing PR #65 binding | **Offline candidate only** |

## New candidate source pointers and limits

- Exact original create-request intent timestamped **before** API call at [issue #68 pre-creation](https://github.com/Satsetx4/karturt/issues/68#issuecomment-6333016123).
- Actual provider readback (project, branch, endpoint, PG18 Free, 0.25 CU, operations) at [issue #68 post-creation](https://github.com/Satsetx4/karturt/issues/68#issuecomment-6333045271).
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
