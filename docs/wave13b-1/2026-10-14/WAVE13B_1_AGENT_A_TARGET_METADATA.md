# Wave 13B.1 Agent A - Target Metadata

Date: 2026-10-14
Result: IDENTITY_PREFLIGHT_PASS
Method: Neon control-plane metadata only; no SQL

## Exact target readback

| Field | Approved value | Observed |
|---|---|---|
| Organization | org-ancient-boat-57106549 | Match; satset |
| Project | falling-bread-33359184 | Match; karturt-v1-staging-clean |
| Branch | br-muddy-frost-azot13fb | Match; staging |
| Database | ID 702718; karturt_staging | Match |
| Role | karturt_staging_owner | Match |
| Compute/endpoint | ep-silent-butterfly-azrflu40 | Match |
| Direct host | ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech | Match |
| PostgreSQL version | 18 | Match |
| Region | aws-ap-southeast-1 | Singapore |

The endpoint was reported idle and read-write during the metadata review. The five completed lifecycle operation records visible in the operations listing were unchanged on a second read. No operation was initiated by this lane.

## Safety boundary and limits

Only the approved organization, project, branch, database, endpoint, and role metadata were inspected. The excluded old staging project and production were not queried. No SQL, credentials, connection URLs, application rows, or provider mutations were involved.

This is an identity match, not a grant or emptiness finding. Effective SQL privileges were not inspected. The branch metadata includes init_source=parent-data; logical size and written-byte counters do not prove physical emptiness or establish lineage. Catalog cleanliness, if later observed, would not prove either condition.

Agent A made no file changes in its worktree.
