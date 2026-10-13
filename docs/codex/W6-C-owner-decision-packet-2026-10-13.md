# Wave 6 KartuRT V1 — Lane C Owner Decision Packet

**Status: BLOCKED / NO-GO for candidate publication or release.** This is a read-only provider audit and decision packet; the project settings and account evidence available in the connected provider APIs do not establish safe publishing or Rp0 headroom.

## Snapshot and boundaries

- Captured 2026-10-13 05:06:45–05:10:19 UTC (12:06:45–12:10:19 WIB / Asia/Bangkok, UTC+7). Neon resource timestamps below are provider-reported UTC values.
- Local audit branch: codex/w6-agent-c-20261013. Requested baseline: 4a1d19a59feb4afede17d00676adf327614a067c.
- Current GitHub checkpoint still identifies PR #23 as OPEN/DRAFT and the only eventual controlled integration path; PR #56 remains OPEN/DRAFT and comparison-only. The Wave 5 checkpoint reports the candidate as local-only and blocked. No status promotion is implied here.
- Agent C did not push code, create a PR, merge, deploy, modify a provider setting or alias, create a resource, connect to or wake Neon, run SQL, migrate, write to GitHub, or run CI on an exact candidate SHA.
- No credentials, connection strings, emails, or resident data are included.

## W6-C01–C06 disposition

| Work item | Result | Evidence and limit |
|---|---|---|
| W6-C01 — Vercel Demo/F3 audit | PASS for read-only collection | Git linkage, recent deployments, target records, aliases, and exposed project fields were read. The project-level production branch and current Ignore Build Step value were not returned by the available read API, so release safety remains BLOCKED. |
| W6-C02 — Rp0 cost/headroom | BLOCKED | Vercel charges returned 404 costs_not_found; contract commitments returned no records; the Hobby plan label is not a hard cost cap. Neon Free metadata and usage counters do not prove remaining quota or no-overage headroom. |
| W6-C03 — Neon metadata-only review | PASS for the read-only boundary; BLOCKED for staging readiness | Project, branch, and endpoint metadata were read only. The branch remains inherited from an unknown parent, primary/default, unprotected, publicly connectable, and passwordless. |
| W6-C04 — Release-gate evaluation | BLOCKED / NO-GO | No evidence proves a safe candidate Preview, project-level production behavior, or Rp0 headroom. Neon isolation is not established. |
| W6-C05 — Owner decision packet | PASS | This local packet records evidence, limits, and the recommended owner decision. |
| W6-C06 — Evidence and handoff | PASS | Results are timestamped, linked to the Wave 5 checkpoint, and kept separate from CI, browser, database, and production evidence. |

## Vercel Demo and F3

The Vercel Git deployment context links both named projects to the GitHub repository Satsetx4/karturt. The team plan field returned Hobby. These facts establish linkage and account labeling only; they do not establish a build quota or cost ceiling.

| Project | Current project readback | Recent deployment and alias evidence |
|---|---|---|
| Demo — karturt-demo-20261006, project prj_iI7jxoyFgnoNZNnQngj1vB6fRgAv | Project readback said live=false. Latest deployment dpl_9eyuRyx67JTRNYDKYyRMXnjX4kx7, branch codex/karturt-v1-wave2-candidate-20261012, SHA 145770d042c082b03a4f39735c09696ee8073152, was CANCELED with target=null. The latest-50 query returned 35 CANCELED and 15 ERROR records, all target=null. | Nine alias records were returned. A branch alias exists for the READY demo/socialization-2026-10-06 deployment dpl_8STZitvnoZAqq5HU8U93LUdNfWFU (target=null). A separate production-target record for that branch, dpl_FtWjH6ck4QyZWZdkbKFNjvkfC4pr, was CANCELED. |
| F3 — karturt-f3-staging, project prj_OgnBy1d7z2beP8wQHRowF0yJc3PU | Project readback said live=false. Latest deployment dpl_5pRhUR8nJLeBuYVzyvKuNEgcA4Nq, branch codex/karturt-v1-wave2-candidate-20261012, the same SHA 145770d042c082b03a4f39735c09696ee8073152, was CANCELED with target=null. The latest-50 query returned 49 CANCELED and 1 ERROR record, all target=null. | Eleven alias records were returned. The main alias maps to dpl_4EhE94BV5P8p2r3Btb1znPqJH55B, a CANCELED deployment of main at 96c84588ae0c13f68a17cffd997a3e583fb7da82 whose target was production. Another older production-target record on feat/delivery-readiness-single-rt was also CANCELED. |

Project domains were returned with gitBranch=null and without a target field. The Vercel read methods used were get_git_deployment_context, get_project, list_deployments, list_aliases, list_project_domains, get_deployment, list_deployment_aliases, get_team, list_billing_charges, and list_contract_commitments; the responses confirm Git linkage and deployment records but do not expose productionBranch or commandForIgnoringBuildStep. Therefore, the current production branch, current Ignore Build Step command, and the effects of a future merge to main remain unverified. A deployment row with target=null and state=CANCELED only says that row had no target and was canceled; it does not prove that the project has no production side effects or that a future merge is safe. The canceled production-target records are evidence of historical production-target deployments, not evidence that a current production deployment is active.

No new deployment or alias was initiated by this audit. Deployment records and aliases are provider state observed during the snapshot window; their existence does not constitute Preview acceptance or runtime verification.

## Rp0 and headroom

- Vercel billing charges were queried for 2026-10-13 00:00:00Z through 05:06:45Z. The API returned 404 costs_not_found. This is unavailable billing evidence, not a zero-cost result.
- Contract commitments returned zero rows. An empty result does not establish included quota or remaining headroom.
- The team plan field was Hobby. A plan name is not proof that the candidate build is free or protected from overage.
- Neon project metadata reports subscription_type=free_v3 and counters including 80 compute seconds, 312 active seconds, zero storage byte-hours, zero transfer bytes, and zero written bytes. These are usage counters, not remaining-quota or hard-cap evidence.
- Agent C initiated no cloud build, deployment, resource creation, endpoint start, database connection, query, or migration. No billable workload was requested by this lane; that action boundary does not prove headroom for a future candidate build.

**Rp0 verdict for any candidate cloud build: BLOCKED / UNKNOWN. No Rp0 claim is made.** Do not treat costs_not_found, empty commitments, plan labels, or current usage counters as Rp0 proof.

## Neon metadata-only read

The Neon read methods used were list_projects, describe_project, list_branches, and list_postgres_endpoints. These expose provider project, branch, endpoint, and usage metadata; they do not establish database emptiness, parent lineage, or remaining billing headroom. The existing project matched the previously approved identifier:

- Project ancient-smoke-51787007, named karturt-review-staging-20261012, region aws-ap-southeast-1, PostgreSQL 18. Provider project updated_at: 2026-10-12 04:39:01Z.
- Branch br-dry-block-b3fsqjo3, named staging-empty: current_state=ready, init_source=parent-data, primary=true, default=true, protected=false, logical_size=31,686,656 bytes, written_data_bytes=0. Provider branch updated_at: 2026-10-12 14:34:04Z. Parent identity and inherited contents are not exposed by this metadata.
- Project settings report block_public_connections=false and allowed_ips empty. Endpoint ep-raspy-meadow-b3ppifq6 is read_write, current_state=idle, and passwordless_access=true. Its provider suspended_at marker is 2026-10-12 04:44:02Z; no wake or endpoint request was made during this audit.

The branch name staging-empty does not prove that its inherited dataset is empty. Zero branch writes do not establish an empty dataset when init_source is parent-data. Do not connect to this branch, run db:check, wake its endpoint, or migrate it. Keep the database-target guard closed.

## Release gate and owner recommendation

**Recommendation: retain BLOCKED / NO-GO and keep the candidate local.** PR #23 remains the only eventual controlled integration path; PR #56 remains comparison-only. Do not publish either branch or merge to main based on the evidence in this packet.

Reconsider only after the owner has current, independently verifiable evidence for all applicable items:

1. Vercel project-level production branch, Ignore Build Step, Git auto-deploy behavior, and current alias/target mapping for Demo and F3, with the exact effects of a main merge understood.
2. A billing-owner readback that proves the exact candidate build fits within a hard Rp0/no-overage ceiling, including included quota and remaining headroom.
3. An approved Neon target with verified empty/synthetic lineage, restricted connection access, passwordless access disabled, and hard Rp0/no-overage evidence. The current branch does not meet this requirement.
4. A separately reviewed exact candidate SHA and exact-SHA CI/Preview evidence. No CI, Preview, runtime, browser, device, database, or release PASS is asserted by this lane.
5. Separate explicit owner GO decisions for any later publication, merge, deployment, production, or demo/F3 action.

## Sources

- [Wave 5 execution checkpoint, issue #17](https://github.com/Satsetx4/karturt/issues/17#issuecomment-6138353855)
- [Wave 5 board checkpoint, issue #25](https://github.com/Satsetx4/karturt/issues/25#issuecomment-6138354079)
- [Vercel audit card #26](https://github.com/Satsetx4/karturt/issues/26)
- [Neon audit card #28](https://github.com/Satsetx4/karturt/issues/28)
- [PR #23 — sole eventual controlled integration path](https://github.com/Satsetx4/karturt/pull/23)
- [PR #56 — comparison-only snapshot](https://github.com/Satsetx4/karturt/pull/56)
- [Vercel project configuration documentation](https://vercel.com/docs/project-configuration/vercel-json): documents Ignore Build Step behavior, but does not establish the current value in either audited project.
