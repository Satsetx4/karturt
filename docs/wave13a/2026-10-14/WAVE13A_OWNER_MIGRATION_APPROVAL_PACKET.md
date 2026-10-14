# Wave 13A Owner Packet — Future Migration Decision

**Packet state: prepared for review. This document is not an authorization to connect, query, migrate, alter provider resources, open runtime access, or deploy.**

## Exact source and manifest identities

| Item | Value |
|---|---|
| Repository | `Satsetx4/karturt` |
| Immutable source baseline | `3bc69c83265dce3a6a0863cbfceea188f40f6168` / tree `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9` |
| Wave 13A candidate | `codex/wave13a-staging-hardening-20261014` / `1f6c71c75a3e1cf9400f6e14ea06f3a362bd8f57` / tree `c53759bb297b472d55901ac2b04b1103ac4d8d17` |
| Target manifest fingerprint | `02e3eef71c827b775dffe962c275beb559ea763121386bd86fa9d06a2b2949ff` |
| Migration manifest fingerprint | `e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4` |
| Documentation base | `bee9b4219f052d050870b2612c66c99f41b35e21` |

The fingerprints are for the checked-in Wave 13A source mappings; they are not provider attestations. Any source change, target change, migration change, or key pinning creates a new approval scope.

## Staging resources in scope

The new identity is supplied for source mapping only. It has not been connected to or mutated during Wave 13A.

| Resource | New staging identity |
|---|---|
| Organization | `satset` / `org-ancient-boat-57106549` |
| Independent project | `karturt-v1-staging-clean` / `falling-bread-33359184` |
| Region | PostgreSQL 18, `aws-ap-southeast-1` |
| Root/default branch | `staging` / `br-muddy-frost-azot13fb` |
| Database | `karturt_staging` / `702718` |
| Initial role name | `karturt_staging_owner` |
| Endpoint | `ep-silent-butterfly-azrflu40` |
| Direct hostname and port | `ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech:5432` |

Preserve the old staging project unchanged and deny it in every application environment: project `wild-art-99835126`, branch `br-hidden-cake-a1ge5xqp`, database `42079960`, endpoint `ep-snowy-meadow-a10304d9`. It is not a migration source or fallback.

## Immutable migration snapshot

SHA-256 is over the raw Git blob at immutable baseline `3bc69c83265dce3a6a0863cbfceea188f40f6168`.

| File | SHA-256 |
|---|---|
| `drizzle/0000_messy_menace.sql` | `22a2dc6d5834b3a491d929be3832e4a5194a3102931587f70920f00203fd527a` |
| `drizzle/0001_classy_ricochet.sql` | `6663de22b090fb66e008ef72959b54af857994b61e5347bffa0e6a99c791f161` |
| `drizzle/0002_monthly_due_period_guard.sql` | `fbccce0e1d134a1868ef0307599bde28bddff470887bd160b3a0913cd22a03a6` |
| `drizzle/0003_due_auth_audit_domain.sql` | `1349af24e1d094e0cc879181e57072d9bc880f2e0c4fda980a9acc934e05370f` |
| `drizzle/0004_phase_5_payment_request.sql` | `57c6c844673694fbe1fb0ccca89fb7de4b1ac4492b26656710fd4a8cd83368e2` |
| `drizzle/0005_phase_5_1_payment_request_items_immutable.sql` | `b72bd0c4ad4384d300029bbdb8eab4d80ef603e70b5262c6c5396ec0c0a4db67` |
| `drizzle/0006_phase_6_treasurer_payment_ledger.sql` | `b5bd5dd3fd5621e800a6ca66e8bc0bfbbe3b4905e7d42c0208c5e9167a553273` |
| `drizzle/0007_phase_7_reject_cancel.sql` | `66401840229155f0cfe85e3d2ebaf4eff93c10bf3c8c0d156ad782745ffb6d44` |
| `drizzle/0008_phase_7_1_post_resolution_lifecycle.sql` | `f5bb31f899b941c5417e71b8b4a6b28142bc74210487a967ef145d127428082f` |
| `drizzle/0009_phase_8_cash_payment.sql` | `1a2bacce06cedbbea3c2df755ae12d6f94cbef87d7fe340b5d9df35402ea2720` |
| `drizzle/0010_phase_9_payment_reversal.sql` | `bc58acabf918fd359613d1b039b4e466c0137f32c7a19f5e79660b14499ae0da` |
| `drizzle/0011_phase_10_waiver.sql` | `e0a6cd44b8b80f0b5398f7ff43d5a6249d3e0378b40d552fd3b040ce0a78ea77` |
| `drizzle/0012_phase_11_tariff_adjustment.sql` | `cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54` |
| `drizzle/0013_phase_12_household_management.sql` | `994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85` |
| `drizzle/meta/_journal.json` | `1e3ecdb836832da360aa944609287622da2188d06bfffdf4a16e8da18d341d5e` |

The PostgreSQL 18.6 disposable GitHub Actions rehearsal `38503239173` passed for baseline SHA `3bc69c83265dce3a6a0863cbfceea188f40f6168`, not the Wave 13A candidate and not Neon. Its counts are recorded in the coordinator report.

## Evidence limits and unresolved provider state

The prior single read-only catalog transaction reported schema clean for its defined scope. It did not establish physical emptiness, complete lineage/content provenance, effective role grants, runtime isolation, or migration readiness. The root `init_source=parent-data` label is not proof of a clone. Keep `stagingIsolationVerifiedEmpty=false` until separate positive evidence and owner review.

Supplied endpoint metadata showed read-write endpoint access, `passwordless_access=true`, `block_public_connections=false`, and an empty IP allowlist. The passwordless flag alone does not establish unauthenticated access. Network exposure, authentication enforcement, and effective grants are still unverified. No credential, database URL, token, resident data, or dump is included in this packet.

Wave 13A’s migration verifier has no pinned owner public key and will stop before client creation. The one-shot replay marker is local to the Git common directory; a shared cross-host replay registry is not in place. No runtime app connection or provider change was authorized.

## Independent owner decisions required later

Each item requires its own explicit approval. Approval of this packet or a source-branch push does not grant any of them.

| Separate decision | Wave 13A status |
|---|---|
| Verify owner Ed25519 public key, custody, revocation, and pin it through a separately reviewed source change | Not authorized |
| Configure provider authentication, network/IP access, and reviewed migration/runtime roles | Not authorized |
| Perform a narrowly scoped server-enforced read-only SQL identity, lineage, emptiness, catalog, and privilege preflight | Not authorized |
| Apply migrations `0000–0013` once to the exact new project/branch/database | Not authorized |
| Open the source staging runtime guard | Not authorized |
| Connect the application to staging and run RT-A/RT-B security acceptance | Not authorized |
| Change Vercel settings or deploy | Not authorized |

## Future operator runbook and stop conditions

Only after the owner decisions above are separately authorized and all preflight evidence is accepted:

1. Re-verify the exact new provider organization, project, branch, database, endpoint, direct hostname, region, network boundary, role grants, cost/headroom, empty-state evidence, and lineage. Stop on any mismatch or unknown.
2. Pin the independently verified owner public key in a separately reviewed source revision. Recompute the target and migration fingerprints and use that exact clean source SHA for a newly signed approval. Keep the private signing key outside the repository and execution host.
3. Issue an external signed authorization for the exact source SHA, target fingerprint, migration fingerprint, unique authorization id, and a validity window of no more than 15 minutes. Keep the artifact outside the worktree.
4. Provide only the approved migration credential as `MIGRATION_DATABASE_URL` in the operator process environment. Do not set `DATABASE_URL`. Use the exact one-shot CLI flags in a visible interactive terminal, review the printed identities, and type the displayed challenge. The executor consumes the authorization before it creates a one-connection migration pool.

   ```text
   npm run db:migrate:staging:operator -- --authorization-file <absolute-path-to-external-approval.json>
   ```

5. Apply the existing immutable sequence `0000–0013` once. Do not change migration SQL or the journal. Keep the migration and runtime roles separate.
6. After an unambiguous success, use a separately authorized read-only post-migration check for exact target identity, ordered migration ledger, schema counts, grants, and the approved application security checks. Do not use this runbook as live permission.

Stop before connection on an unexpected host/role/database/port, pooler or alias host, bad TLS/query setting, unpinned key, invalid/expired/replayed authorization, dirty or wrong source SHA, changed migration hash, non-empty/unproven target, unverified grants/network boundary, or an unexpected workflow/deployment side effect. On any timeout, process interruption, pool-close error, or migration error, assume a partial unknown outcome: do not retry or reuse the authorization. Request a new, separately approved read-only reconciliation. Consider a disposable rebuild only after its own owner authorization; never alter the preserved old project.

**Wave 13A ends before any of these live steps.**
