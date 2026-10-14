# KartuRT V1 Wave 12.4 — Agent C Recovery and Security Review

**Date:** 2026-10-14 (Asia/Bangkok)<br>
**Lane:** W12.4-C01–C09 — Neon Free recovery, security, and publication preflight<br>
**Result:** **PARTIAL — staging remains NOT READY; migration remains NOT AUTHORIZED.**

## Baselines and evidence method

| Evidence | Verified value |
|---|---|
| Application source branch | `codex/wave12-3-pg18-rehearsal-20261014` |
| Application source SHA / tree | `3bc69c83265dce3a6a0863cbfceea188f40f6168` / `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9` |
| Documentation branch and baseline | `docs/wave12-3-migration-rehearsal-20261014`, `1b5d2facdafba0818bd205d872e006c9b6ecb257`, tree `252019635420aab8126e1ddfc9b446d333bd03ce` |

The checked-out source SHA/tree matched the requested baseline. `git ls-remote` independently returned those exact SHAs for both named remote branches. The starting Agent C worktree was clean and detached at the source SHA.

I read all five Wave 12.3 reports under `docs/wave12-3/2026-10-14/`, all five Wave 12.2 reports under `docs/wave12-2/2026-10-14/`, and all five Wave 12.1 reports under `docs/wave12-1/2026-10-13/`. I also reviewed the checked-in migration SQL, staging guard, auth/permission modules, Next command wrapper, GitHub workflow files, and the exact Vercel project through read-only metadata.

Provider metadata calls were limited to project `wild-art-99835126`; no SQL, database connection, compute wake, migration, seed, restore, snapshot creation, or other Neon mutation was attempted. No Vercel or GitHub write, deployment, PR, or merge was performed. The only networked dependency check was `npm audit`; it did not modify the lockfile or run tests.

## Exact staging target and recovery evidence

Fresh read-only Neon metadata matched the allowlisted target:

| Resource | Read-only metadata result |
|---|---|
| Organization / plan | `org-ancient-boat-57106549` / Free (`free_v3`) |
| Project | `karturt-v1-staging`, `wild-art-99835126`, `aws-ap-southeast-1`, PostgreSQL 18 |
| Branch | `staging`, `br-hidden-cake-a1ge5xqp`; `primary=true`, `default=true`, state `ready` |
| Branch source | `init_source=parent-data`; lineage and inherited content are unresolved |
| Database | `karturt_staging`, ID `42079960`, owner `karturt_staging_owner` |
| Endpoint | `ep-snowy-meadow-a10304d9`, bound to the approved branch, type `read_write`, currently idle |
| Database roles | Provider listing returned `karturt_staging_owner`; database metadata identifies it as owner. The listing does not attest least-privilege/read-only grants. |

The branch reports a logical size of 31,686,656 bytes and `written_data_bytes=0`. Neither logical size, zero recorded writes, zero synthetic storage, nor recent project creation proves database emptiness or safe lineage.

The Wave 12.2 metadata readback and the current source guard comment record `passwordless_access=true`. The current endpoint-list response omitted that property, so this Agent C reread did not independently refresh its value. In any case, `passwordless_access` is not a read-only guarantee: the endpoint is `read_write`, and the database owner role is not an inspection-only role. The connector should not be treated as read-only without the separately approved transaction-level server guard.

The project metadata reports `history_retention_seconds=21600` (six hours). `list_snapshots` returned an empty list and the branch snapshot schedule returned an empty schedule. No project-specific snapshot or scheduled backup is currently evidenced.

### Documented Free-plan recovery features

Neon’s current [pricing page](https://neon.com/pricing) lists the Free plan’s instant-restore limit as up to six hours or 1 GB of changes, whichever limit is reached first, and shows one snapshot. The project metadata’s 21,600-second history window matches the six-hour limit. Neon’s [October 2026 Free-plan update](https://neon.com/blog/neon-free-plan-1-gb-per-project) confirms the current Free plan and its limited restore window.

The pricing grid lists scheduled snapshot frequencies on paid tiers but not on Free. That agrees with the empty project-specific snapshot schedule. The one Free-plan snapshot allowance is a documented capability, not evidence that this project has a snapshot, and no snapshot was created here. Neon describes snapshots as point-in-time, read-only recovery points that restore into a new branch in its [snapshot guide](https://neon.com/blog/three-ways-to-use-your-snapshots). Neon’s [branch restore guide](https://neon.com/blog/announcing-point-in-time-restore) describes recovery to a timestamp or LSN within the configured retained history.

These features do not establish a verified backup for this staging branch. There is no current snapshot, no scheduled backup, no restore rehearsal for this project, and no proof of the parent branch’s content. The Wave 12.3 `pg_dump`/`pg_restore` pass applies only to its disposable PostgreSQL 18.6 service container, not Neon staging. Creating a snapshot, restoring a branch, or attaching compute would be a separate provider operation and was outside this lane.

## Recovery decision matrix

| Classified state | Safe disposition | Recovery requirements before any later migration decision |
|---|---|---|
| **Provably clean, disposable target with known lineage** | May be considered only after positive lineage and complete catalog/content evidence; current evidence does not meet this condition. | Freeze exact source and 0000–0013 migration hashes. Obtain separate authorization for any snapshot/restore resource operation. Verify the recovery point and rehearse restoration on an authorized disposable target. A fresh migration authorization must name the exact target and permitted operations. |
| **Existing application objects or data** | **STOP.** Do not apply the chain, drop objects, truncate, seed, or rewrite the Drizzle ledger. | Preserve the target and sanitized evidence. Classify schema, ledger, and data state. Any restore, repair, or reconciliation requires a versioned plan and separate owner authorization; use only an explicitly approved recovery source and target. |
| **Unknown lineage, unexpected objects, incomplete inventory, or partial migration state** | **STOP — this is the current classification until Agent A’s lineage and Agent B’s bounded inspection are reviewed.** | Keep `stagingIsolationVerifiedEmpty=false`. Do not infer emptiness from a no-row query, size/write metrics, branch name, or new-project creation. Complete safe lineage/catalog classification first. If a migration later fails, preserve state and logs; do not retry blindly or edit the migration journal. |

The six-hour/1-GB instant-restore window is a limited history feature, not a pinned pre-migration backup. A later migration decision must identify who may authorize a restore or repair if the chain stops after earlier migrations have committed.

## Migration-chain risk review

The source SHA contains 14 ordered SQL migrations (`0000`–`0013`), 14 journal entries, and 14 snapshots. Wave 12.3’s exact-SHA PostgreSQL 18.6 rehearsal passed against disposable synthetic fixtures, including 0003/0010/0011/0012/0013 cases. That is runtime evidence for that synthetic service only; it does not classify Neon staging.

- **0003 — legacy enum/data conversion:** converts legacy `waived` dues to `not_due`, clears the legacy waiver reason, replaces the monthly-due status enum, and drops the old enum types and indexes. This changes existing values and object identities; it is not a safe blind replay.
- **0010 — payment reversal / settlement backfill:** creates `active_due_settlements` and `payment_reversals`, checks that paid dues map to exactly one valid payment allocation and that non-paid dues have none, then inserts settlement ownership rows from existing payment/allocation history. Inconsistent financial history causes a named preflight failure. This requires correctly classified existing payment data.
- **0011 — waiver history:** refuses legacy `WAIVED` dues without structured waiver history, then adds waiver tables, constraints, functions, and triggers.
- **0012 — tariff adjustment:** preflights active settlement ownership against allocations and due state before adding adjustment structures and invariants.
- **0013 — household management:** refuses overlapping household periods, then changes login indexes and adds household-period guards.

These migrations contain non-idempotent DDL and state-dependent checks/backfills. On any error or partial state, stop, preserve evidence, and use a new authorized read-only review to determine the precise journal/catalog state. Do not rerun blindly, drop partial objects, or edit `drizzle.__drizzle_migrations` to make the chain appear complete.

## Tenant controls and database boundary

Static review at the exact source SHA found application-layer principal and permission checks in `src/lib/auth/principal.ts` and `src/lib/auth/permissions.ts`: residents are tied to active person/household membership in their RT, and RT-scoped permissions are checked against the authenticated principal’s RT and household.

A static search of checked-in `drizzle/*.sql` and `src/db/schema.ts` found no `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY`, or `FORCE ROW LEVEL SECURITY`. Composite RT-scoped keys and application checks help protect app-mediated operations, but they do not create a database-native tenant boundary for direct connections. The exact staging database owner role and writable endpoint therefore require tight credential/access control; this review does not attest deployed RLS or role grants.

The source guard at `src/lib/staging-database-target.ts` still sets `stagingIsolationVerifiedEmpty=false` and blocks staging access. Keep that value unchanged.

### Direct Next CLI wrapper gap

The package `dev`, `build`, and `start` scripts go through `scripts/lib/next-command.ts`, which checks project environment files before launching Next. Six repository smoke scripts instead invoke `node_modules/next/dist/bin/next` directly: the phase 6, 8, 9, 10, 11, and 12 smoke scripts. Those direct calls are outside the repository wrapper’s preflight. The [Next.js environment-variable guide](https://nextjs.org/docs/pages/guides/environment-variables) documents built-in `.env*` loading by Next.js. This remains a tooling coverage gap; no code or test change was made in this lane.

### Dependency advisory refresh

`npm audit --json --ignore-scripts --registry=https://registry.npmjs.org/` exited 1 and reported five HIGH findings in the development toolchain: `eslint-config-next`, `@next/eslint-plugin-next`, `braces`, `fast-glob`, and `micromatch`; zero LOW, MODERATE, or CRITICAL findings were reported. A separate `npm audit --omit=dev` exited 0 with zero production dependency findings. The five development findings are therefore still present in the audited lockfile graph; they are neither resolved nor a production-dependency finding. No dependency or lockfile change was made.

## GitHub and Vercel publication-trigger preflight

The current source tree has two workflows:

- `.github/workflows/gate-a.yml` uses an explicit push-branch allowlist. It excludes `docs/wave12-4-staging-readiness-20261014` and `codex/wave12-4-staging-safety-20261014`. Its `pull_request` trigger is unfiltered and it allows `workflow_dispatch`; neither event was created or dispatched by this lane.
- `.github/workflows/wave12-3-pg18-rehearsal.yml` only matches the Wave 12.3 source branch. It does not match either proposed Wave 12.4 branch.

Read-only Vercel metadata for exact project ID `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq` returned project name `karturt-review-staging-20261012`, `live=false`, `latestDeployment=null`, no project domains, and SSO protection enabled for all deployments. A project-scoped deployment listing returned an empty list. The API response did not include a Git-link field, so current Git linkage is **not independently verified by this reread**. Wave 12.1’s exact-project Settings > Git review recorded that it was not connected to a Git repository; that is prior-day evidence, not a fresh current setting read. No deployment or setting was changed.

## Lane verdict and remaining gates

| Gate | Result | Evidence boundary |
|---|---|---|
| Source/docs baseline | **PASS** | Exact source and documentation SHA/tree verified; remote branch SHAs match. |
| Exact Neon project/branch/database/endpoint alignment | **PASS for surfaced metadata** | Read-only provider metadata only; no SQL or connection. |
| Parent lineage / data emptiness | **NOT VERIFIED** | `init_source=parent-data`; provider size/write metrics do not prove emptiness. |
| Free-plan backup/restore readiness | **PARTIAL / NOT VERIFIED** | Six-hour instant-restore feature documented and configured; no current snapshot, no schedule, no project restore drill. |
| App tenant checks | **PARTIAL** | Static application checks; no database-native RLS found in checked-in source. |
| Migration behavior | **PASS only on disposable PostgreSQL 18.6 synthetic fixtures** | Wave 12.3 exact-SHA run; no Neon state or recovery proof. |
| Dependency advisories | **5 HIGH development findings remain; production audit 0** | Read-only npm registry audit; no package changes. |
| GitHub push workflow trigger | **No matching push workflow for proposed Wave 12.4 branches** | Static branch-filter review only; no workflow run. |
| Vercel Git linkage | **NOT CURRENTLY VERIFIED by this API reread** | Exact project read has no Git-link field; deployments empty; prior-day UI evidence says disconnected. |
| Neon migration authorization / staging readiness | **NOT AUTHORIZED / NOT READY** | This lane grants no migration or provider-resource permission. |

**Agent C disposition:** `PARTIAL`. Keep `stagingIsolationVerifiedEmpty=false`. Wave 12.4’s SQL inspection result, even if its reviewed catalog queries find no application objects, cannot resolve unknown parent lineage by itself. A later migration requires a separate owner decision and a reviewed recovery path for the exact target. Wave 13 migration is outside this authorization.

## Coordinator review addendum

At the time this lane report was drafted, Agent B’s one-time catalog inspection was still pending. It has since completed: 26 of 26 reviewed result groups returned, with a bounded `SCHEMA-CLEAN VERIFIED FOR DEFINED SCOPE` result. This does not resolve the unknown parent lineage, prove row or physical emptiness, or establish a recoverable pre-migration backup. The overall Wave 12.4 verdict therefore remains `STAGING PREFLIGHT PARTIAL` and migration remains unauthorized.
