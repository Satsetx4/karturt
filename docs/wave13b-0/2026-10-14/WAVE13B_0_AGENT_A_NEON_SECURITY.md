# Wave 13B.0 Agent A — Neon Security Review

Date: 2026-10-14
Lane: W13B0-A01..A07 — read-only Neon security and metadata audit
Result: **PASS — scoped metadata and official-documentation review completed; remaining provider and SQL facts are explicitly unknown.**
Docs worktree base: `b30597abef9375435ea8524b093690375e4824e1`
Accepted source baseline: `48b92abbe93fbd499448b6c885d3042cb49c2128`

## Scope and evidence method

I used only Neon management metadata reads scoped to the specified new project: `list_organizations`, `list_projects`, `list_branches`, `list_postgres_endpoints`, `list_postgres_databases`, and `list_postgres_roles`. These are control-plane inventory/read operations; no SQL, database introspection, connection-string retrieval, credential read, compute start, or provider mutation was performed. The endpoint metadata reported `idle`; no action was taken that could wake it. The old staging project and its branch/database/endpoint were not queried or touched.

I reviewed current official Neon documentation on 2026-10-14. Provider metadata is evidence of the returned control-plane fields only. It does not establish SQL-effective grants, object or row contents, physical storage emptiness, network reachability, or PostgreSQL authentication behavior.

## Current metadata readback

| Resource | Read-only result | Evidence boundary |
|---|---|---|
| Organization | `satset`, ID `org-ancient-boat-57106549`, plan `free`, `require_mfa=false` | Org-level MFA enforcement is not enabled in the returned metadata. This does not reveal whether an individual account has MFA enabled. |
| Project | `karturt-v1-staging-clean`, ID `falling-bread-33359184`, AWS `aws-ap-southeast-1`, PostgreSQL 18 | Exact project identity and advertised engine/region only. |
| Project network settings | `allowed_ips.ips=[]`; `protected_branches_only=false`; `block_public_connections=false` | The project metadata reports no IP allow entries and public connections not blocked. This is consistent with a publicly reachable endpoint, but this lane did not make a network connection test. |
| Branch | `staging`, ID `br-muddy-frost-azot13fb`; primary/default; state `ready`; `protected=false`; `init_source=parent-data`; `logical_size=31,686,656` bytes; `written_data_bytes=0` | `init_source=parent-data` and non-zero logical size are material lineage/contents unknowns. Zero tracked written bytes and catalog metadata do not establish an empty database or independent lineage. Do not mark clean from these fields. |
| Endpoint | ID `ep-silent-butterfly-azrflu40`; host `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech`; `read_write`; `idle`; `disabled=false`; `passwordless_access=true`; pooler disabled | Endpoint identity and control-plane flags only. The `passwordless_access` flag is not proof that unauthenticated PostgreSQL connections succeed. |
| Database | ID `702718`, name `karturt_staging`, owner name `karturt_staging_owner` | Provider database metadata only; no catalog or data inspection. |
| Role inventory | `karturt_staging_owner`, authentication method `password` | Role listing did not return effective memberships or object privileges. No role secret was read. |
| Additional project field | Metadata included `store_passwords=true` | This audit did not retrieve credentials or determine the setting’s exact retention/integration effects. Treat its operational meaning as unverified and review it before any future change. |

The target name/ID tuple aligns across the org, project, branch, endpoint, database, and listed owner-role metadata. For any future operator action, require the IDs and endpoint hostname to match the signed target fingerprint; names alone are insufficient. The branch’s `parent-data` source and logical-size values remain **UNKNOWN / STOP for a clean-lineage assumption** until the owner reviews the evidence and a separately authorized D1 preflight supplies its bounded catalog result. Even a clean catalog result would not prove physical storage emptiness or complete ancestry.

## Neon security facts and Free-plan boundary

- Neon’s current plan comparison lists **IP Allow** and **Private Networking** as Scale features. The dedicated IP Allow page also says it is available with Scale. The Private Networking guide says it uses AWS PrivateLink, is available on Scale, and that public access still works until the project is explicitly configured to block it. Therefore the current Free project has a documented residual public-network risk; do not describe TLS or a password as network isolation. This finding does not require a paid upgrade: D2 may explicitly accept the Free-plan residual for bounded staging work, or stop and plan another route. No plan change is proposed here.
- Neon requires SSL/TLS for database connections. Neon’s secure-connection guide recommends `sslmode=verify-full`, which verifies the certificate chain and hostname; it also documents `channel_binding=require` with SCRAM-SHA-256-PLUS. A future operator must verify the selected driver’s support and effective settings before connecting. Do not claim the earlier PostgreSQL TCP rehearsal proves Neon transport, hostname-verification, or WebSocket behavior.
- Neon documents two distinct passwordless concepts. Its CLI/browser `neon psql` flow authenticates a human to Neon and asks them to select an account/project/compute. Separately, the endpoint metadata has a boolean named `passwordless_access`; the current public endpoint documentation does not establish that this flag bypasses PostgreSQL role authentication. Do not infer that it does, and do not infer the reverse from metadata alone. The listed role still reports `authentication_method=password`.
- Neon says roles created with its Console, API, or CLI are members of `neon_superuser`; its documented privileges include database/role administration and broad data access (with some privilege details depending on project age). Roles created using SQL are not automatically members and must receive explicit grants. Since the target’s listed owner role matches the initial database owner, broad administrative membership is a strong documented default inference, **not a live SQL grant verification**. Do not use it as an application/runtime credential.
- Neon’s project-level `require_mfa=false` metadata means organization policy currently does not require MFA. It does not prove that any particular human account lacks MFA. Before a later owner action, require the owner/operator account to have MFA and confirm a recovery path; if a later D2 proposes organization enforcement, verify account coverage and a second-admin/break-glass route before changing it.

## Attack and risk matrix

| Risk | Evidence / assessment | Free-compatible mitigation and stop condition |
|---|---|---|
| Credential leak | The owner role authenticates by password. A role connection string carries the password. Neon recommends environment/secret-manager storage and regular rotation. No credential was retrieved. | Keep `MIGRATION_DATABASE_URL` operator-only, out of source, chat, logs, shell history, artifacts, and application/runtime settings. Use a password manager or secret manager; inject only for the approved operator session. On suspected exposure, stop, revoke/rotate using a human-controlled provider flow, and reconcile before retry. |
| Public endpoint exposure | Current project metadata reports empty `allowed_ips` and `block_public_connections=false`. Neon’s current plan docs place IP Allow and Private Networking on Scale. | On Free, use unique high-entropy role passwords, TLS with verified hostname/CA (and supported channel binding), least privilege, short credential exposure, and owner-approved time window. Explicitly accept this residual in D2 or stop; never claim the endpoint is private. Do not upgrade or buy a plan in this wave. |
| Overprivileged role | Current role inventory does not expose memberships/grants. Neon’s documented initial/Console/API/CLI role path grants `neon_superuser` membership. | Keep `karturt_staging_owner` for human administration/break-glass only. Later, after exact grant review, create a separate migration principal and a separate runtime principal with SQL-defined least privilege; do not create either through the Console/API/CLI if that would grant `neon_superuser`. Stop if runtime needs the owner role or if effective grants cannot be enumerated. |
| Target spoofing or wrong environment | Names can be duplicated. Current metadata aligns the exact IDs, but no SQL session identity has been tested. | A future preflight must bind and assert organization/project/branch/database/endpoint/host/role identifiers before any data operation. Compare the exact full host, not a suffix or display name. Any mismatch, redirect, unexpected branch, or stale URL is STOP; no fallback. |
| Old-staging path or credential reuse | Old staging was deliberately not queried. This lane cannot establish what any local or CI environment variable currently points to. | Keep the new target’s operator-only URL separate from all old-staging and production values. Reject known old project/branch/endpoint/database identities in the future target guard. Never wake, connect to, migrate, or use the old project as fallback. |
| Weak owner control / lockout | Organization metadata has `require_mfa=false`; `protected=false` is reported for the target branch. | Confirm human MFA and an independent recovery/admin path before owner-signed actions. Do not change the MFA requirement or branch protection without a scoped D2 decision and verified rollback/recovery access. |

## Proposed D2 security decision and exact scope

D2 should be a separate, affirmative owner decision with these explicit items; it is not granted by this audit:

1. **Network-risk choice:** confirm the exact new target metadata again, then either (a) accept that this Free-plan endpoint is public-network reachable for a bounded staging window with password authentication and verified TLS, or (b) stop and require a separately designed route. IP Allow and Private Networking are documented as Scale-only; this report does not request or imply a plan upgrade. Do not set `block_public_connections=true` without first proving the intended connection path still works and authorizing that exact provider change.
2. **Human account control:** confirm the owner’s own MFA and a second-admin/recovery path. If the owner wants an organization-level MFA policy change, authorize that as its own setting update after checking availability and lockout effects. The current metadata does not prove an individual account’s MFA state.
3. **Role separation:** authorize no role mutation until the exact SQL grants are reviewed against all 14 migrations and the eventual runtime requirements. The intended split is (i) human-only owner/break-glass, (ii) migration-only credential with only the reviewed DDL/ownership privileges needed for the approved migration, and (iii) runtime credential without DDL, role-creation, database-creation, or broad administration. Create restricted roles through SQL only after a later, exact, separately authorized role-change plan; never through a provider role-creation path that automatically grants `neon_superuser`. Do not distribute a runtime credential in D2 or enable staging runtime as a side effect.
4. **Credential custody and recovery:** if a later owner authorizes credentials, have the human generate/rotate them directly in the provider-supported flow and store them in a password manager or secret manager. Inject the one-time `MIGRATION_DATABASE_URL` only into the operator’s protected environment; never copy it into reports, repository files, action output, or the app runtime. Name a human break-glass custodian, specify how to rotate/revoke after suspected leakage, and require reconciliation before any retry. Keep the old and production credentials outside the procedure.
5. **Transport acceptance:** require a future approved client to use TLS with hostname verification (`sslmode=verify-full`) where supported; verify its root-CA handling and `channel_binding=require` behavior on that exact driver before use. A failed or unsupported security setting is STOP, not a reason to silently downgrade.

Stop before any later operation if the project/org/branch/database/endpoint IDs or full host differ; MFA/recovery control is unresolved; the owner does not accept the Free public-network residual; the role has unreviewed administrative grants; the branch lineage/contents conflict with the intended empty-staging premise; credential custody cannot be demonstrated; or a proposed network control would strand the approved operator path. No automatic retry, reset, deletion, or rebuild is authorized.

## Guardrails and non-actions

At accepted source SHA `48b92abbe93fbd499448b6c885d3042cb49c2128`, a static Git readback confirmed:

- `src/lib/staging-database-target.ts`: `stagingIsolationVerifiedEmpty = false`
- `src/db/migration-approval.ts`: `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM: string | null = null`

These fail-closed values must remain unchanged unless separately approved and positively evidenced. This report did not edit source. No key was generated or pinned; no authorization was signed; no SQL, connection, migration, role/network/auth change, compute wake, deployment, paid-plan action, old-staging action, or production action was performed. D1 preparation or acceptance is not permission to run a preflight.

## Official references reviewed (accessed 2026-10-14)

- [Neon plans](https://neon.com/docs/introduction/plans) — current plan feature matrix and Free limits.
- [IP Allow](https://neon.com/docs/introduction/ip-allow) — IP Allow is available on Scale.
- [Neon Private Networking](https://neon.com/docs/guides/neon-private-networking) — Scale availability, AWS PrivateLink, and public-access behavior until explicitly blocked.
- [Connect to Neon securely](https://neon.com/docs/connect/connect-securely) — enforced TLS, `verify-full`, and channel binding.
- [Connect from any application](https://neon.com/docs/connect/connect-from-any-app) — role/password/host/database connection-string contents and secret handling.
- [Passwordless auth](https://neon.com/docs/connect/passwordless-connect) — human-authenticated CLI/browser flow, distinct from endpoint metadata.
- [Manage roles](https://neon.com/docs/manage/roles) and [Manage database access](https://neon.com/docs/manage/database-access) — default administrative role membership and least-privilege role guidance.
- [Credentials & access](https://neon.com/docs/concepts/credentials-access) — credential scope and Postgres endpoint network-control boundary.
- [Security overview](https://neon.com/docs/security/security-overview) — secret-management recommendations.
