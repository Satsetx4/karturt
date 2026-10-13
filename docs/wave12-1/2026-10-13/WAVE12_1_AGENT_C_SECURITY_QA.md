# W12.1 Agent C — Security, QA, and Publication Trigger Review

**Date:** 2026-10-13
**Verdict:** PARTIAL; the exact-host cross-environment gap in the Wave10 baseline is closed by the reviewed Agent A patch, while tests and database/readiness evidence remain incomplete. Direct-push publication-trigger preflight is PASS for the named branches.
**Review scope:** Static review only. No tests, Neon connection/wake/query, environment-file or credential reads, GitHub mutation/push, Vercel deployment/configuration write, or access to another Vercel project was performed.

## Revisions and evidence reviewed

- Documentation checkout: `docs/wave12-1-staging-readonly-20261013` at `8678fb388ae64ab7f4f48b11372ebc1775f375ba`.
- Application source inspected by immutable Git reads: Wave10 source commit `355c5804df9767e7ce8456edde4439a4a7eaedc9`, tree `df520d59d675e46f43c4b224798fe4b237e36360`. The docs SHA is not an application source SHA.
- Read all five files in `docs/wave12/2026-10-13/`, then reviewed source auth/tenant controls, environment guards, migration entrypoints, and `.github/workflows/gate-a.yml` at the exact source commit.

## Agent A exact patch review (static)

I independently inspected commit `d4fc471a988c070ca2118e12ddbb0b363daa6541` (tree `15bb2fc622f19d0715906479083ae87bcbb85cec`) against Wave10 baseline `355c5804df9767e7ce8456edde4439a4a7eaedc9`. The exact diff changes only `src/lib/staging-database-target.ts` and `tests/unit/environment.test.ts`.

The source constants now identify the metadata-approved project, branch, database ID/name, endpoint ID, and canonical hostname. `isApprovedStagingEndpoint()` derives the pooler hostname from that exact endpoint, and the non-staging branch rejects both canonical direct and pooler hosts before returning. The staging path still requires the canonical direct hostname, port 5432, and database name; the isolation flag remains `false`, so the exact staging URL still fails closed before use. Legacy endpoint/database, mismatched database/host, unrelated host, wrong endpoint parameter, and missing-password cases were added to the focused environment tests; direct and pooler off-label rejection cases cover both development and production labels.

**Patch result:** the Wave10 cross-environment gap is **CLOSED for the exact canonical direct and pooler hostnames** in the supplied metadata. This is a static diff review; I did not execute the tests. The guard compares URL host/database values and cannot independently prove Neon project/branch/database identity or reject an alternate alias/IP to the same endpoint; exact provider metadata readback remains necessary. Staging access itself remains blocked while `stagingIsolationVerifiedEmpty=false`.
## Security findings

### High (Wave10 baseline finding; closed by Agent A patch) — Current staging endpoint was not blocked under non-staging labels

At Wave10 baseline `355c5804df9767e7ce8456edde4439a4a7eaedc9`, `src/lib/staging-database-target.ts:69-71` rejected a non-staging connection only when its host matched the hard-coded legacy staging target (`ancient-smoke-51787007` / `br-dry-block-b3fsqjo3` / endpoint `ep-raspy-meadow-b3ppifq6`). The current approved target hostname `ep-snowy-meadow-a10304d9.ap-southeast-1.aws.neon.tech` was absent from that check. Under matching `development` or `production` labels, the new staging URL therefore bypassed the `stagingIsolationVerifiedEmpty = false` gate.

The exact Agent A patch reviewed above replaces the legacy target constants and adds the new direct/pooler host rejection for all non-staging labels, closing this specific canonical-host gap. The isolation flag remains false, and the staging-labeled exact URL still fails closed.
### Positive static controls; runtime proof remains absent

- `src/lib/auth/principal.ts` derives the principal from the authenticated session, rejects inactive accounts, ties residents to an active person/household using matching RT and household IDs, ties official assignments to the account and RT, and requires a verified TOTP factor for System Admin.
- `src/lib/auth/permissions.ts` restricts resident permissions to self-service, requires household and RT scope for resident actions, and denies System Admin access to RT-scoped permissions. Sampled resident payment-request logic (`src/lib/billing/resident-payment-request.ts`) scopes due selection to the principal’s `rtUnitId` and `householdId`; the resident route requires a resident principal and same-origin mutation.
- `src/db/schema.ts` contains composite RT-scoped unique keys and foreign keys across core household and payment relationships. No RLS policy or RLS enablement was found in the inspected source/schema/migration paths, so these controls do not establish a database-native tenant boundary if application credentials are used outside the guarded app.
- Existing focused suites include `tests/authorization/permissions.test.ts`, `tests/authorization/phase-12-household-route-security.test.ts`, and `tests/authorization/phase-12-household-security.test.ts`. This lane did not execute them. The Wave12 documents report that Agent B could not run the tenant suites because Vitest was absent; the prior Agent A document reports 11 environment tests passing, which was not independently rerun here.

### Environment and migration entrypoints

- `src/lib/env.ts` requires explicit matching `APP_ENV`/`DATABASE_ENV` labels for DB operations, requires a PostgreSQL URL, and delegates target policy to the staging guard. Test DB URL connections are rejected.
- `src/db/migrate.ts` runs the project-env loader and `requireDatabaseEnvironment()` before `migrate()`. `drizzle.config.ts` uses the same guard before handing the URL to Drizzle Kit. `scripts/check-db.ts` also validates the DB environment before connecting.
- The phase 5 and phase 11 smoke scripts call the migrator directly but contain development-target checks and write synthetic fixtures. They are operationally mutating commands and must not be repurposed for staging. The guard bypass above means the general environment guard still needs correction before current-stage URLs are safe under other labels.
- `npm run dev/build/start` route through `scripts/run-next-*` and `scripts/lib/next-command.ts`, which apply an environment-file policy. Invoking the Next CLI directly bypasses this wrapper policy and allows Next’s own `.env*` loading behavior. Treat this as a tooling bypass; it does not by itself bypass the database target check.
- `src/db/migrate.ts` and `scripts/check-db.ts` log caught exception objects. No explicit connection-string interpolation was found in the reviewed guards, but raw driver errors should be sanitized before inclusion in shared evidence or CI artifacts.

## GitHub Actions and Vercel publication safety

### GitHub Actions

The only workflow at the reviewed checkout/source tree is `.github/workflows/gate-a.yml`:

- `push.branches` is an explicit allowlist (`.github/workflows/gate-a.yml:4-26`) and contains neither `docs/wave12-1-staging-readonly-20261013` nor `codex/wave12-1-staging-target-20261013`.
- Its `paths-ignore` only ignores `docs/test-gate-a-report.md` (`:27-28`). Thus a direct push to either proposed branch does not start Gate A under the current push branch filter.
- `pull_request` has no branch filter (`:29`), so opening/updating a PR would run Gate A. `workflow_dispatch` is also enabled (`:30`). Neither was invoked here.
- The independent PostgreSQL concurrency job is conditioned on three other named branches (`:91-92`), not either proposed branch. It would not constitute PostgreSQL 18 or staging evidence.
- No GitHub Actions deployment workflow was present in the inspected workflow directory.

### Vercel

Read-only Vercel project metadata was fetched only for approved project ID `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`. The response identified `karturt-review-staging-20261012`, framework `nextjs`, `live: false`, `latestDeployment: null`, no project domains, and SSO protection enabled for all deployments. A deployment listing scoped to that exact project returned count `0`.

Coordinator-read dashboard evidence for this exact project at Settings > Git (`https://vercel.com/sekawan/karturt-review-staging-20261012/settings/git`) explicitly states: “This Project is not connected to a Git repository,” and says a Git connection is required to set up Deploy Hooks. This is direct project-scoped UI evidence in addition to the API metadata. It establishes that GitHub pushes to the proposed branches cannot trigger Vercel Git-integration auto-deploys for this project in the observed configuration. No other Vercel project was inspected.

**Publication-trigger preflight: PASS for direct pushes to the two proposed branch names only.** GitHub `gate-a.yml` push filters exclude `docs/wave12-1-staging-readonly-20261013` and `codex/wave12-1-staging-target-20261013`; no PR is created, so its unfiltered `pull_request` trigger does not run. The exact Vercel project is not connected to Git, and its API deployment count is zero. Agent C performed no push, PR, manual workflow dispatch, deployment, or Vercel configuration change. The coordinator subsequently pushed the source branch after this review; the documentation packet is being published separately. This trigger result is not CI/test readiness or staging/release approval.
## Neon and readiness limitations

The initial Wave10 source guard named the legacy target above. Review of patch `d4fc471a988c070ca2118e12ddbb0b363daa6541` confirms that it now names the metadata-aligned project `wild-art-99835126`, branch `br-hidden-cake-a1ge5xqp`, database `karturt_staging`, endpoint `ep-snowy-meadow-a10304d9`. The same metadata readback reports `init_source=parent-data`, `passwordless_access=true`, and a `read_write` endpoint. The available SQL interface cannot guarantee a read-only role/session, so no wake, connection, or query was made. Database emptiness and catalog contents are **NOT VERIFIED**.

No tests were run in this lane. The prior Wave12 evidence leaves five HIGH development-only dependency advisories unrefreshed; PostgreSQL 18 migration/runtime compatibility, independent PostgreSQL concurrency, backup/restore, and deployment behavior remain unproven. These are not PASS evidence for staging readiness.

## Final status

- **Static tenant/auth review:** PARTIAL; sampled controls look structurally scoped, but runtime suites and DB-native RLS are absent/unverified.
- **Environment/staging guard:** PASS by static review of patch `d4fc471a988c070ca2118e12ddbb0b363daa6541` for the exact direct/pooler endpoint under non-staging labels; staging connectivity remains BLOCKED because `stagingIsolationVerifiedEmpty=false`. The new unit cases were not run by this lane.
- **Neon read-only preflight:** BLOCKED; no safe read-only query path was available and database emptiness is unverified.
- **GitHub Actions direct-push trigger:** PASS for the two proposed branch pushes; no Gate A push run is triggered, and no PR or manual dispatch was created.
- **Vercel deploy-on-push safety:** PASS for Git-integration auto-deploy; the exact project Settings > Git page says it is not connected to a Git repository.
- **Publication trigger preflight:** PASS for direct pushes to the two named branches only. The coordinator pushed the source branch after this review; no PR was created.
- **Migration / staging readiness / release:** NOT PASS / NOT READY / NO-GO.
