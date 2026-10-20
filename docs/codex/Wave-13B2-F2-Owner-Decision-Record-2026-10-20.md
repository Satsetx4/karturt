# Wave 13B.2 F2 — Owner Decision Record (2026-10-20)

**Decision recorded:** 2026-10-20 10:41:49 Asia/Jakarta
**Decision state:** `GO_WITH_ACCEPTED_LINEAGE_UNCERTAINTY_EXCEPTION_FOR_PREPARATION_ONLY`
**F2 execution state:** `BLOCKED — NOT AUTHORIZED`

## Owner decision

The owner explicitly selected **Option B**: accept the unresolved root-lineage uncertainty as a narrow exception so non-secret preparation and owner review of a fresh approval for exactly one F2 read-only catalog inspection may continue.

This record uses “Option B” as defined in the owner's latest instruction. The earlier preparation packet used the same letter for a different choice (requiring direct ancestry evidence); this record supersedes that letter mapping for the current decision. The historical evidence and packet remain unchanged.

The accepted exception does **not** make direct ancestry a PASS. Its evidence status remains **UNKNOWN**. The decision is limited to preparation and owner review. It does not authorize this agent or anyone else to create/sign an approval, connect to a database, execute SQL, or run F2. A fresh owner signature, offline preflight, and a separate explicit owner authorization to execute one read-only query are still required. No migration, role change, provider mutation, deployment, merge, or production action is authorized.

## Binding and source transition

| Item | Exact binding |
|---|---|
| Pull request | [Satsetx4/karturt #58](https://github.com/Satsetx4/karturt/pull/58), OPEN and unmerged when rechecked |
| Candidate branch | `codex/karturt-wave13b2-f2-fail-closed-20261017` |
| Base branch / SHA | `codex/karturt-v1-staging-activation-20261015` / `8abfd871cef2b95aae09079f6fb8e9fea85f5d03` |
| Source SHA at decision review | `4b4e54aeaaec800bae5b71ea123e75aa90cdeab8` |
| Read-only query | `docs/codex/wave13b2-read-only-catalog-preflight.sql`; SHA-256 `bd4a9c725268dc80e3eab10d28da585da3399e6f75db676c29e9e014c5127c49`; 18,498 LF-only bytes |
| Migration snapshot | 15 raw Git blobs; fingerprint `e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4` |
| Root-lineage attestation digest | `e5e2793cb2323f4c00bcb0ad83fcced2dc9ca5a9a68a8489014c6f469046780b` |

This documentation commit changes the PR source SHA. The decision-review SHA above is historical context only; it must not be used for a new approval. After the documentation commit is pushed and the final head is confirmed, the owner-local expected-state copy must set `binding.finalSourceSha` to that exact final 40-character SHA. The owner-local target manifest and fresh approval must bind the same SHA. Recheck the exact-head CI before signing. Any later source change invalidates those bindings and requires a new review and approval.

The checked-in expected-state template intentionally keeps `binding.finalSourceSha` null and every `catalogObserved` value null. The target-manifest template's provisional source pin is not a final approval binding. Do not edit either template to pin this document's own commit.

## Exact target scope

The owner-provided target tuple for this one inspection is:

- Organization: `org-ancient-boat-57106549`
- Project: `broad-star-40451875` (`karturt-v1-synthetic-staging-20261015`)
- Branch: `br-orange-recipe-azed9f78` (`main`)
- Endpoint: `ep-mute-firefly-azjcru4h`
- Database / role: `neondb` / `neondb_owner`
- Region / PostgreSQL / compute / plan: `aws-ap-southeast-1` / PostgreSQL 18 / 0.25 CU / Free

These identifiers were supplied by the owner and the prior preparation packet; provider metadata was **not refreshed in this preparation**. The owner must refresh and compare it before any later signature or run. No provider mutation or database access occurred.

## Evidence and unknowns

**Directly rechecked during this preparation:** PR #58 was OPEN, unmerged, and at source SHA `4b4e54aeaaec800bae5b71ea123e75aa90cdeab8` before this record was added. The base SHA matched the binding above. Gate A and the Windows query-integrity/LF check passed on both exact-head runs `39356757766` (push) and `39356761340` (pull request). Launch Safety was skipped by its branch filter in both runs and is **UNVERIFIED**. The raw query verifier passed at the reviewed source SHA; the raw Git migration snapshot check returned 15 blobs and the pinned fingerprint above.

**Owner/prior-packet evidence, not refreshed here:** the provider metadata reportedly omitted `parent_id` and returned `init_source=parent-data`; the limited historical project-create-contract attestation records a root-lineage-only scope. Its request digest was not captured and its reviewer checksum is not a provider signature.

**Still UNKNOWN:** the target branch's direct ancestry chain; current provider metadata; catalog contents; successful TLS/database identity; staging isolation or emptiness; and any F2 result. `stagingIsolationVerifiedEmpty` remains `false`. Zero written bytes, branch metadata, `init_source`, a signature, or a future `F2_DONE` marker alone cannot establish catalog emptiness or physical isolation.

## Stop conditions

Stop and preserve all existing evidence if the target tuple or Free-plan/compute/region/PostgreSQL state drifts; exact final source SHA, query digest, migration fingerprint, expected-state binding, CA digest, or trusted-key fingerprint differs; `catalogObserved` is not entirely null before the run; the source-bound owner directory already exists; ACL or reparse-point checks fail; the approval is unsigned, invalid, expired, or has less than 120 seconds remaining at the required check; exact-source Gate A/query-integrity CI is not green; or the owner has not made a separate explicit execution decision. Launch Safety remains **UNVERIFIED** unless a fresh applicable run provides evidence.

Preserve the previous signed approval and attempt marker byte-for-byte. Never reuse them, clear them, overwrite them, move them into Git, or retry with them. Any failure leaves catalog state **UNKNOWN** and F2 **BLOCKED**.

## Preparation performed

This record is documentation of the limited owner decision and its exact scope. It does not convert the prior lineage attestation into a stronger claim. No owner-only directory, private/public key file, password file, CA bundle, old approval, or attempt marker was inspected or created. No signature, database connection, SQL/psql command, migration, provider operation, CI rerun, merge, or deployment was performed as part of recording this decision.
