# KartuRT V1 Wave 12.6B — Owner Next Gate

**Current status:** **NEW STAGING PROVISIONED — VERIFICATION PARTIAL**

## Created resource

| Item | Verified value |
|---|---|
| Organization / plan | satset / org-ancient-boat-57106549 / Free |
| Project / tier | karturt-v1-staging-clean / falling-bread-33359184 / free_v3 |
| PostgreSQL / region | 18 / aws-ap-southeast-1 |
| Root branch | staging / br-muddy-frost-azot13fb; primary/default; no parent_id returned |
| Database | karturt_staging / 702718 |
| Role | karturt_staging_owner (credential value not read) |
| Endpoint | ep-silent-butterfly-azrflu40; read-write; passwordless access enabled |

## What this wave establishes

- Exactly one new project was created under the Free organization after the owner authorized the attempt and allowed Neon to enforce its Free eligibility.
- The create request contained no copy/source selection. Provider read-back shows the initial branch as the sole primary/default branch with no parent identifier. The init_source=parent-data marker also appears in Neon’s fresh-project example, so that value alone is not evidence of a copied project.
- One ordered 26-statement transaction began with SET TRANSACTION READ ONLY; the server confirmed read-only mode, exact database/role identity, and a catalog-clean result within the documented query scope.
- The existing staging project still matches its locked identifiers and was not targeted by a write.

## What remains unverified

- Physical emptiness, table-row absence, and synthetic-only data content. The catalog inventory does not inspect table rows or all possible object/storage state.
- Full database provenance beyond the create request and parentless initial-branch metadata.
- Role grants and least privilege, credentials custody, endpoint exposure suitability, network allowlisting, and runtime security. Current metadata reports passwordless_access=true, an empty allowed IP list, and public connections not blocked.
- Account-specific billing history, remaining Free capacity, or a no-overage guarantee. The project and organization read back as Free; that is not a billing ledger or charge proof.
- Production, runtime, device, rollback, and release acceptance.

## Required next decision

Review the five Wave 12.6B reports and the exact project/branch/database/endpoint IDs. Decide separately whether the bounded catalog result and creation provenance are sufficient for a target-specific Wave 13 preflight. Any later approval must name the exact target and allowed operations and resolve the remaining lineage/content and security gates. Keep the source guard at stagingIsolationVerifiedEmpty=false until a separate source review and owner decision.

Wave 12.6B does not authorize migrations 0000–0013, seed data, endpoint or role changes, application integration, source changes, deployment, reset, deletion, or creation of a replacement project. Preserve both the existing staging resource and the new project. No further provider operation is authorized by this report.
