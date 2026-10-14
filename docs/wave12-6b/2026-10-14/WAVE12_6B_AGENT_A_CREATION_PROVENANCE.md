# Wave 12.6B Agent A — Creation Provenance

**Disposition:** ONE PROJECT CREATED; PROVIDER METADATA VERIFIED; PHYSICAL CONTENTS NOT VERIFIED.

## Pre-create checks

- Exact organization lookup returned satset / org-ancient-boat-57106549 with plan Free.
- The exact proposed project name karturt-v1-staging-clean was absent in the organization-scoped and global project-name searches immediately before creation.
- The protected older staging target was present with its previously recorded identity. No write was made to it.

## Sole create request

The coordinator made one successful Neon create-project call with these values:

| Field | Value |
|---|---|
| Organization | org-ancient-boat-57106549 |
| Project name | karturt-v1-staging-clean |
| PostgreSQL version | 18 |
| Region | aws-ap-southeast-1 |
| Initial branch | staging |
| Initial database | karturt_staging |

The connector did not expose a plan field or parent/source field. The request contained no source project, branch, snapshot, restore, import, or clone selector. No retry or second create call occurred.

## Returned resource mapping

| Resource | Provider read-back |
|---|---|
| Project | falling-bread-33359184 |
| Organization plan | Free before and after create |
| Project tier | free_v3 |
| Creation source | console |
| Branch | br-muddy-frost-azot13fb; staging; sole listed branch; primary/default; ready |
| Branch parent | No parent_id, parent ID, or source ID returned |
| Branch marker | init_source=parent-data |
| Database | karturt_staging / 702718 |
| Role | karturt_staging_owner (name only) |
| Endpoint | ep-silent-butterfly-azrflu40; read-write; Singapore |

The requested configuration and returned project/branch/database/endpoint identities align. The provider reports the initial branch as the sole primary/default branch, and the branch detail response contains no parent identifier. The creation request supplied no external source. Neon’s [branch detail API](https://api-docs.neon.tech/reference/getprojectbranch) describes project root/default branches and identifies branch ancestry through parent_id. Neon’s [fresh-project example](https://github.com/neondatabase/ai-rules/blob/main/neon-api-projects.mdc) also returns init_source=parent-data for a newly created project’s initial branch. Therefore that marker alone does not establish that an existing project was copied.

The creation request and branch graph support independent root creation with no requested external copy. They do not prove physical emptiness, synthetic-only content, or the origin of every database page. No data rows were read. The catalog-only SQL result is documented separately by Agent B and does not close this provenance gap.

## Plan and secret handling

The organization remained Free and the new project read back as free_v3. The provider accepted the request without a paid-plan or payment-method prompt. No account billing ledger or remaining capacity field was read, and this result must not be presented as zero-charge proof. No payment method was added, no plan change was requested, and no password or connection URI was requested or returned in the evidence.

**Agent A disposition:** creation provenance is consistent with a fresh independent root; no-copy request and parentless branch metadata are verified. Physical contents and data provenance remain unverified. Preserve the project; do not recreate or delete it.
