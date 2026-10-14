# KartuRT V1 Wave 12.3 — Coordinator Report

**Date:** 2026-10-14 (Asia/Bangkok)\
**PG18 disposition:** **PG18 REHEARSAL PASS — OWNER REVIEW REQUIRED**\
**Staging disposition:** **BLOCKED / NOT READY; migration NOT AUTHORIZED; release NO-GO**

## Source and publication

| Item | Result |
|---|---|
| Application branch | `codex/wave12-3-pg18-rehearsal-20261014` |
| Exact application SHA | `3bc69c83265dce3a6a0863cbfceea188f40f6168` |
| Exact source tree | `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9` |
| PostgreSQL 18 Actions run | [38503239173](https://github.com/Satsetx4/karturt/actions/runs/38503239173) — completed success on the exact SHA above |
| Documentation branch | `docs/wave12-3-migration-rehearsal-20261014` — publication pending |
| Pull request / merge | None created; no default branch changed |

The source branch is an additive non-default branch based on `d4fc471a988c070ca2118e12ddbb0b363daa6541`. It adds the branch-scoped disposable PostgreSQL 18 workflow and synthetic migration fixture runner; no migration SQL, Drizzle schema, or `stagingIsolationVerifiedEmpty` guard was changed. The `drizzle/` tree remains unchanged from the source baseline.

## PostgreSQL 18 evidence

The exact SHA completed a GitHub-hosted `postgres:18` service-container rehearsal on PostgreSQL 18.6. The checked-in Drizzle migrator applied migrations 0000–0013 in journal order and verified 14 expected ledger entries. Final results:

- 27 public tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums; all expected named catalog objects were present.
- Negative cross-RT constraint rejection: **PASS**.
- Injected migration failure and rollback: **PASS**; catalog remained intact.
- Synthetic migration coverage: 0003 legacy conversion, 0010 cash and transfer settlement backfill, 0011 legacy-waiver preflight failure and clean retry, 0012 ownership preflight rollback and valid migration, and 0013 household-period overlap preflight failure and clean retry: **PASS**.
- `pg_dump` / `pg_restore`: **PASS** on the disposable database; restored database cleanup: **PASS**.
- Both run-owned fixture databases were identity-checked, dropped, and verified absent. GitHub Actions stopped and removed the service container and job network.

The full case detail is in [Agent B's report](WAVE12_3_AGENT_B_PG18_REHEARSAL.md). This runtime proves behavior for this exact code SHA and synthetic data on one disposable PG18.6 service; it says nothing about the contents or lineage of Neon staging.

## Local and CI checks

| Check | Status | Evidence boundary |
|---|---|---|
| Targeted PG18 guard tests | **PASS — 24/24** | Exact final source content; local Vitest tests |
| Full test suite | **PASS — 74 files / 502 tests** | `npm test -- --maxWorkers=1`; final exact SHA; 295.34s |
| ESLint | **PASS, 0 errors; two existing warnings** | Warnings are in unchanged files: `scripts/phase-12-household-browser-smoke.ts` and `src/lib/billing/resident-card.ts` |
| TypeScript | **PASS** | `npm run typecheck` on final source content |
| Offline Drizzle journal check | **PASS** | Final branch; offline only |
| Gate A schema-drift command | **PASS; no generated changes** | Final branch; separate disposable-copy negative-drift proof in Agent A report |
| Safe production build | **PASS** | `npm run build` on final SHA, with a dummy database URL targeting loopback port 1 and no project `.env` file loaded |
| `git diff --check` / migration tree | **PASS** | No whitespace error and no migration/schema change |

All checks above were completed on the final source SHA. The safe build does not read project `.env` files; the only matching file in the worktree is `.env.example`. Its database placeholder points to loopback port 1 and no live service is contacted.

One earlier full-suite run on a preceding SHA failed while reading the temporary Chrome `DevToolsActivePort` file (`EBUSY`); the final exact-SHA run completed all 502 tests successfully. This earlier transient failure is not counted as final-SHA evidence.

Agent A independently reproduced Gate A's current Drizzle command on a clean copied baseline and proved both no-drift and synthetic-drift detection. No CI/Drizzle source patch was warranted. See [Agent A's report](WAVE12_3_AGENT_A_CI_TOOLING.md).

## Publication-trigger safety and run history

The GitHub repository was confirmed public. Gate A's `push.branches` allowlist excludes both Wave 12.3 branches; no pull request or manual workflow dispatch was created. The source push triggered only the exact-branch Wave 12.3 PostgreSQL 18 workflow. The documentation branch does not match that workflow. Read-only metadata for the exact Vercel project returned `live=false`, `latestDeployment=null`, no domains, and no Git `link` property; the exact-project listing also returned no repository field. No Vercel deployment or setting was changed. These checks establish the metadata observed at review time, not a guarantee about future provider configuration.

The initial workflow iterations found fixture issues and were corrected before run 38503239173. Earlier runs are not PASS evidence. One initial run (`38498331790`) briefly logged a run-scoped local PostgreSQL service URL and temporary non-auth identity marker in a public Actions environment block; that URL contained no password or external database credential. The logging was changed to construct the URL inside the shell step and mask it before use. The final successful run reports the URL as redacted. Historical run logs were not deleted or altered.

The successful Actions run also carried nonblocking platform notices: the run used Ubuntu 24.04 while `ubuntu-latest` is scheduled to move to Ubuntu 26 on 2026-10-19, and `actions/checkout@v4` / `actions/setup-node@v4` were run under Node.js 24 despite targeting Node.js 20. The job completed successfully; a future rerun may use a different runner image.

The PostgreSQL image explicitly cautions against trust authentication because it permits unauthenticated connections to hosts that can reach the port ([image documentation](https://github.com/docker-library/docs/blob/master/postgres/content.md)). In this workflow it is limited to the one ephemeral service container on a standard GitHub-hosted runner. GitHub documents standard hosted runners as free for public repositories ([runner documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)) and destroys service containers when the job ends ([service-container documentation](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers?learn=continuous_integration)). No secrets, external database URL, persistent resources, or artifacts were used.

## Staging and release boundary

No Neon connection, SQL, compute wake, migration, seed, or provider write occurred in Wave 12.3. The previous one-time Neon read-only authorization remains consumed. Wave 12.2's result remains `READ-ONLY PREFLIGHT PARTIAL`: inherited lineage `init_source=parent-data` and bounded no-row results do not prove target emptiness. The source guard remains `stagingIsolationVerifiedEmpty=false`.

Database-native tenant RLS was not found in the reviewed checked-in schema/migrations; application-layer controls do not prove deployed RLS. The five historical development-only HIGH dependency advisories remain unrefreshed, and direct Next CLI invocations remain outside the wrapper policy. The disposable dump/restore rehearsal does not prove a Neon backup or staging recovery path.

**Owner decision:** review the evidence only. Staging remains **NOT READY**, no staging migration is authorized, and release remains **NO-GO**, even with this PG18 pass. Required future gates and bounded authorization conditions are in [the owner approval packet](WAVE12_3_OWNER_APPROVAL_PACKET.md).
