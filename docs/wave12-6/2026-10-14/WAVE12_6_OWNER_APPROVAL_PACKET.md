# KartuRT V1 Wave 12.6A — Future Project-Creation Approval Packet

**Status: BLOCKED — NOT READY FOR PROJECT-CREATION APPROVAL**

This packet records the owner’s already locked target and recovery choices. It does not authorize creation now. Account-specific free-project capacity and no-overage/Rp0 controls are not verified. Wave 12.6B must wait until those blockers are resolved and the owner separately authorizes exactly one project creation.

## Locked decisions

- **Target:** new independent Neon project in organization **satset** (ID **org-ancient-boat-57106549**).
- **Plan and region:** Free plan; PostgreSQL 18; **aws-ap-southeast-1** (Singapore).
- **Proposed names:** project **karturt-v1-staging-clean**, root branch **staging**, database **karturt_staging**.
- **Recovery:** Option 1 — Disposable Rebuild from a separately verified clean baseline.
- **Data rule:** synthetic data only; do not copy, clone, import, branch from, snapshot, or restore from any existing project.
- **Existing staging:** preserve unchanged. Do not connect, wake, query, migrate, clean up, reset, detach, or delete it.

Existing staging identifiers, included only to mark the preservation boundary:

- Project **wild-art-99835126**
- Branch **br-hidden-cake-a1ge5xqp**
- Database **karturt_staging**, ID **42079960**
- Owner role **karturt_staging_owner**
- Endpoint **ep-snowy-meadow-a10304d9**

The current application guard remains **stagingIsolationVerifiedEmpty=false**. Owner selection of a new target does not verify the new project’s state and does not authorize a source/guard change.

## Current plan facts and unresolved gates

| Gate | Current evidence | Decision |
|---|---|---|
| Organization identity | Exact organization metadata identifies satset / org-ancient-boat-57106549. | Verified for this packet. |
| Organization plan | Read-only organization metadata reports Free. | Verified as a current plan label only. |
| Published Free project limit | Neon pricing currently lists 100 projects. | Published plan limit; not account-specific remaining capacity. |
| Aggregate organization project count | Exact-organization metadata reported 4 projects. The fetch response also included nested project records; no individual project data was used. | Aggregate count only. |
| Actual remaining free capacity | No explicit account-wide or organization-specific remaining quota field was exposed without reading other project records. | **QUOTA NOT VERIFIED — BLOCKER.** Do not represent the 100 minus 4 arithmetic as available quota. |
| No-overage / Rp0 | Public pricing states Free is $0 and has included resource limits. Current account-specific billing, usage headroom, and enforcement of a hard zero-spend boundary were not verified. | **NOT VERIFIED — BLOCKER.** Do not infer Rp0 from the Free label. |
| New-project initial state | No project was created, so no returned IDs, origin metadata, or catalog baseline exist. | Future authorized readback required. |

Current public sources: [Neon pricing](https://neon.com/pricing) lists Free at $0, 100 projects, 100 CU-hours per project/month, and 1 GB storage per project; [the October 2, 2026 Free-plan update](https://neon.com/blog/neon-free-plan-1-gb-per-project) confirms the project and storage limits. These pages describe product limits, not the current account’s remaining capacity or billing state.

## Side effects of a future creation

Neon project creation is one provider operation with automatic initialization. The official [Create Project API](https://api-docs.neon.tech/reference/createproject) documents a connection URI containing the database, a password, and a role, and at least one non-protected password-bearing role. The provider create-project operation waits for the default compute to become ready. A new project also receives an initial branch, database, compute endpoint, and compute. Compute can consume included usage after it starts; the generated connection material must remain server-side and must never be written to this repository or public report.

The request must stop before creation if the current account capacity, Free capability, or zero-cost boundary remains unverified, or if the provider would select a paid plan, create different resources, copy data, or report any charge. A timed-out create request must not be retried blindly; verify existence only through a separately authorized, exact-project metadata readback. Preserve both the existing project and any partially created new project until a distinct owner decision.

## Proposed no-copy provenance manifest

Populate the returned identifiers and timestamps only after a separately authorized creation and exact readback. Do not fabricate values.

| Field | Planned value / post-creation placeholder |
|---|---|
| Organization | satset / org-ancient-boat-57106549 |
| Project name | karturt-v1-staging-clean |
| Project ID | [not created] |
| Plan at creation | Free — must be read back |
| PostgreSQL version | 18 — must be read back |
| Region | aws-ap-southeast-1 — must be read back |
| Root branch name / ID | staging / [not created] |
| Branch parent / source | New project origin; [provider-returned provenance to record] |
| Database name / ID | karturt_staging / [not created] |
| Owner role name / role ID | [not created; read back, do not assume the old role identifier] |
| Endpoint ID / hostname | [not created; record only after exact readback] |
| Creation source | [provider-returned value] |
| Creation operation ID | [not created] |
| Created-at / readback timestamps | [not created; record in UTC] |
| External data copied | No — must be evidenced by create request/provenance and later baseline review |
| Synthetic-only content | Required — validate only after separate read-only SQL authorization |
| Source guard status | stagingIsolationVerifiedEmpty=false until separate evidence and source review |

No snapshot is required by default for this disposable staging design. No snapshot, restore, SQL inspection, role change, source change, connection, migration, or deployment is authorized by this packet.

## Exact future approval checkpoint

The following owner approval is intentionally blank. It becomes actionable only after the coordinator adds current, account-specific quota and no-overage evidence and replaces this packet’s BLOCKED status. Until then, no approval checkbox below grants authority.

- [ ] **Authorize one Neon project creation only:** project karturt-v1-staging-clean in org satset / org-ancient-boat-57106549; PostgreSQL 18; aws-ap-southeast-1; Free; root branch staging; database karturt_staging; new independent origin; synthetic data only; no external copy/clone/import/restore.
- [ ] **Acknowledge automatic initialization:** initial branch, database, owner role, compute endpoint, and compute will be created; any generated password/connection URI must remain secret and server-only.
- [ ] **Cost stop condition:** stop before any paid plan, charge, overage, unexpected quota behavior, or unexpected provider side effect. Rp0 must be evidenced before this approval is requested.
- [ ] **Failure handling:** if creation times out or partially succeeds, do not retry, reset, delete, or recreate. Preserve the partial instance and sanitized provider evidence; use only separately authorized exact-project metadata readback.
- [ ] **Preservation:** existing staging IDs above remain unchanged and untouched.

This authorization, if later completed after blockers are cleared, covers only the single project-creation operation and its automatic initialization. It does not cover connection-string retrieval, SQL (including read-only SQL), role/access changes, source or guard changes, migrations, Vercel environment/deployment changes, snapshot/restore, replacement-project creation, or deletion. Each requires its own explicit decision.

## Required owner step before Wave 12.6B

Provide or authorize a safe aggregate-only readout for the account’s current project quota/capacity and billing/no-overage controls that does not reveal unrelated projects. The account-specific Free-plan capacity and Rp0 gates must be recorded and reviewed. Only then can the owner make a separate, explicit Wave 12.6B creation decision. Wave 13 remains not authorized.
