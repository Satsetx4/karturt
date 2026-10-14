# Wave 12.6B Agent C — Security and Integration Boundary

**Disposition:** SOURCE GUARD PRESERVED; NEW PROJECT NOT APPROVED FOR APP INTEGRATION.

## Source identity and guard

The reviewed application source baseline is SHA 3bc69c83265dce3a6a0863cbfceea188f40f6168 with tree f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9. At that source SHA, src/lib/staging-database-target.ts sets stagingIsolationVerifiedEmpty=false. No source file was changed in this wave, so the guard remains fail-closed.

## New provider identities

The new Free project is falling-bread-33359184 in organization org-ancient-boat-57106549. Its PostgreSQL 18 branch br-muddy-frost-azot13fb is named staging and is the sole primary/default branch. Database karturt_staging has ID 702718 and role karturt_staging_owner. Endpoint ep-silent-butterfly-azrflu40 is attached to that project and branch in aws-ap-southeast-1.

Provider security metadata for the new project reports:

- Endpoint type read-write and state active.
- passwordless_access=true.
- Project allowed_ips.ips is an empty list.
- block_public_connections=false.

These settings were only read. No access control, endpoint, credential, role, or provider setting was changed. Treat this endpoint as not approved for application or user traffic until exposure, authentication, role privileges, and any required restrictions are separately reviewed.

## Preservation and Vercel boundary

The existing staging project wild-art-99835126 and its locked branch, database, role, and endpoint identifiers still matched a post-create readback. The project updated_at value was unchanged. No old-project SQL, role operation, or content access occurred.

The read-only Vercel check targeted only project karturt-review-staging-20261012 (prj_Mv4rABJvDNAvSD78SVt5WbjFakEq). Its metadata returned live=false and latestDeployment=null; no Git link fields were reported. The deployment list was empty, and the project was absent from the authenticated linked-Git-project context. The requested docs branch is not included in the repository workflow push filter. No Vercel settings or deployment were changed.

## Stop boundary

No application environment integration, runtime connection, source-guard change, migration, seed, deployment, or test was performed. The defined SQL catalog result does not establish physical emptiness or full security posture. Any integration, access hardening, or Wave 13 work requires a separate target-specific owner decision and review.
