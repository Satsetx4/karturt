# KartuRT V1 Wave 12.6B — New Neon Free Staging Provisioning

**Date:** 2026-10-14 (Asia/Bangkok)<br>
**Status:** **NEW STAGING PROVISIONED — VERIFICATION PARTIAL**<br>
**Decision boundary:** one owner-authorized Free-tier project creation and its bounded metadata/catalog readback only.

## Result

Exactly one new Neon project was created successfully in the locked organization. The provider read back the project as Free, PostgreSQL 18, and Singapore region. Its initial branch, database, role, and compute endpoint were read back against the returned project and branch IDs.

The single authorized SQL inspection completed in one transaction. The first statement enabled transaction-level read-only mode; the server returned read-only status, the exact database/role assertion passed, and all 26 ordered result groups were returned without a truncation marker. The fixed inventory found only the expected public namespace and the system plpgsql extension. No non-system relations, other inventoried non-system objects, or Drizzle journal were listed. This is **SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE**.

This does not prove physical database emptiness, absence of table rows, synthetic-only contents, or migration readiness. The branch reports init_source=parent-data, while its provider branch details omit parent_id and other source IDs. The project was created with no source, parent, clone, import, snapshot, or restore input, and its sole branch is marked primary/default. Neon’s own fresh-project example also reports init_source=parent-data. The branch graph and creation request support a new root, but the label and catalog inventory do not prove physical contents or data provenance. Keep the application guard closed.

## Exact resource record

| Resource | Read-back |
|---|---|
| Organization | satset / org-ancient-boat-57106549 |
| Organization plan | Free before and after creation |
| Project | karturt-v1-staging-clean / falling-bread-33359184 |
| Project subscription tier | free_v3 |
| PostgreSQL | 18 |
| Region | aws-ap-southeast-1 |
| Creation source | console |
| Created at | 2026-10-14 05:57:27 UTC |
| Initial branch | staging / br-muddy-frost-azot13fb; sole listed branch; primary/default; ready; no parent_id returned |
| Branch source marker | init_source=parent-data |
| Database | karturt_staging / 702718 |
| Role | karturt_staging_owner (name only; no credential read) |
| Compute endpoint | ep-silent-butterfly-azrflu40; read-write; pooler disabled; region matches project |
| Endpoint host | ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech |
| Provider operations | create_timeline, start_compute, epc_sync, and apply_config completed |

The create request named only the exact organization, project, PostgreSQL version, region, root branch name, and database name. The connector did not expose a plan or source/parent field. The organization remained Free and the new project read back as free_v3. No card, payment method, paid-plan prompt, or charge indication was encountered. This records the provider-accepted Free creation; it is not account-specific billing, quota headroom, or a billing-ledger proof. No plan upgrade or payment method was added.

## One-time read-only catalog inspection

The only SQL call targeted project falling-bread-33359184, branch br-muddy-frost-azot13fb, database karturt_staging, endpoint ep-silent-butterfly-azrflu40, and role karturt_staging_owner. It reused the previously reviewed fixed 26-statement Wave 12.4 catalog array without substitution. No retry or fallback was made.

- Statement 1: SET TRANSACTION READ ONLY.
- Read-only confirmation: transaction_read_only=on.
- Server-side exact database/role assertion: wave124_guard=1.
- Identity read-back: database karturt_staging; role karturt_staging_owner; read-only on.
- Namespace inventory: public only.
- Extension inventory: plpgsql 1.0 in pg_catalog only.
- Relation, constraint, index, sequence, type/domain, enum, range, routine, trigger, event-trigger, policy, foreign-data, publication, subscription, and Drizzle journal inventories: zero rows in the defined query scope.
- No table rows, routine bodies, credentials, connection URI, foreign options, or subscription connection details were selected.

The result does not certify storage-level emptiness or data provenance. The provider’s written_data_bytes=0 and logical-size values are metadata only and are not used as proof. The PostgreSQL 18.6 rehearsal in GitHub Actions run 38503239173 remains evidence for its disposable rehearsal target only.

## Preservation and security boundaries

The prior staging project wild-art-99835126 was re-read after creation. Its project, branch br-hidden-cake-a1ge5xqp, database 42079960, role name karturt_staging_owner, and endpoint ep-snowy-meadow-a10304d9 still matched the locked record; the project updated_at value was unchanged. No operation in this wave targeted that project. No old-project SQL or row access occurred.

The new endpoint metadata reports passwordless_access=true. Project metadata reports allowed_ips.ips as an empty list and block_public_connections=false. No access setting was changed. Treat the new endpoint as not approved for application integration; any exposure or role hardening needs a separately scoped decision.

## Publication and deployment side-effect check

The documentation branch was created from exact Wave 12.6A docs SHA 6b8ba8e80f22628d8428b3adf1d0acf588e3b82b. The only intended changes are the five sanitized files in docs/wave12-6b/2026-10-14/.

The workflow push filter in .github/workflows/gate-a.yml does not include this documentation branch. No pull request was opened. For Vercel project karturt-review-staging-20261012 (prj_Mv4rABJvDNAvSD78SVt5WbjFakEq), read-only metadata returned live=false and latestDeployment=null, with no link/Git repository fields; the deployment list was empty and the project did not appear in the authenticated linked-Git-project context. No Vercel mutation or deployment was made. These readbacks exposed no Git auto-deploy path for this docs-only push.

## Work performed and stop

Three bounded agent lanes used separate worktrees for creation provenance, the reviewed SQL method, and security/source-guard review. The coordinator made the sole project-creation call and the sole SQL transaction call.

No migrations, seed, reset, deletion, source edit, guard change, app integration, Vercel setting change, deployment, pull request, merge, or default-branch push occurred. The source guard remains stagingIsolationVerifiedEmpty=false. Preserve both the old staging project and this new project pending a separate owner review.

**Coordinator disposition:** new project provisioned under Free entitlement; defined catalog scope is clean; physical emptiness and synthetic-only data provenance remain unverified; Wave 13 is not authorized by this report.
