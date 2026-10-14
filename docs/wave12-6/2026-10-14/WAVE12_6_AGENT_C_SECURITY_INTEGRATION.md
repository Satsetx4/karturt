# KartuRT V1 Wave 12.6A — Security and Integration Design

**Date:** 2026-10-14 (Asia/Bangkok)

**Lane:** W12.6-C01–C09 — application security, target identity, and integration design

**Result:** **PARTIAL — static review and future-gate design completed; no source, database, or provider operation performed.**
**Authorization boundary:** This report does not authorize Wave 12.6B project creation, SQL, database connection, migration, source changes, credential or access changes, Vercel changes, deployment, or cost-bearing action. Wave 13 remains **NOT AUTHORIZED**.

## Baseline and evidence boundary

| Item | Reviewed value |
|---|---|
| Repository | `Satsetx4/karturt` |
| Application source | SHA `3bc69c83265dce3a6a0863cbfceea188f40f6168`, tree `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9` |
| Source read method | Static reads of files at the immutable source SHA; the source branch was not checked out or modified. |
| Documentation reference | Wave 12.5 reports in the assigned documentation worktree; docs base SHA `01a3e532b258efb1813630cea610f6ab10a14410`. |
| Prior evidence reviewed | All five Wave 12.5 reports, plus security, owner, coordinator, read-only inspection, and PostgreSQL 18 rehearsal evidence from Waves 12.1–12.4. |

The review covered the staging target guard, environment loader, Drizzle online/offline configuration, migration and bootstrap entry points, connection pool, Better Auth setup, principal and permission checks, schema/migrations, package commands, and direct Next CLI smoke-script call sites. The conclusions below are static source findings unless explicitly labeled as historical report evidence. No tests or builds were run. No `.env` file, credential value, database content, Neon or Vercel API, SQL statement, connection, or compute state was accessed. The only file produced by this lane is this report.

## Owner-locked target and prior-target boundary

The current owner decision selects a **new independent Neon project** in organization `satset` (`org-ancient-boat-57106549`), PostgreSQL 18, Singapore (`aws-ap-southeast-1`), Free Plan, target spend Rp0, with synthetic data only. The proposed project name is `karturt-v1-staging-clean`; proposed root branch is `staging`; proposed database is `karturt_staging`. Provider-generated IDs, role identity, endpoint ID, and hostname are not yet known. This report treats these as proposed names only. It does not verify quota, cost, or project availability.

Recovery is **Option 1 — Disposable Rebuild from a separately verified known-clean baseline**. No external data may be copied, cloned, imported, or restored into the new project. Existing staging remains preserved and unchanged. The old target’s identifiers and evidence are carried forward only from prior reports; this lane did not inspect or query it. Wave 12.5 records `init_source=parent-data` and an unexplained metadata tree entry labeled `public.show_db_tree`, which was not SQL-verified. Do not create a child branch from that old target or treat the metadata entry as a confirmed database routine. These unresolved old-target facts reinforce the no-inheritance boundary.

The source guard still has `stagingIsolationVerifiedEmpty = false`. Owner selection of a new target and a recovery strategy is not evidence that a future database is empty and does not authorize changing this guard.

## Static source findings

| Area | Exact-source finding | Classification |
|---|---|---|
| Staging target identity | [`src/lib/staging-database-target.ts`](https://github.com/Satsetx4/karturt/blob/3bc69c83265dce3a6a0863cbfceea188f40f6168/src/lib/staging-database-target.ts) hard-codes the old project, branch, database, endpoint, and direct hostname. The guard checks URL scheme, host, database name, port, and an optional endpoint query value; the staging path then throws while `stagingIsolationVerifiedEmpty` is false. Non-staging labels reject the canonical old direct/pooler endpoint. | **Closed for the old canonical endpoint; new target is not mapped.** URL host matching alone does not prove provider project, branch, database, or provenance. |
| Environment guard | [`src/lib/env.ts`](https://github.com/Satsetx4/karturt/blob/3bc69c83265dce3a6a0863cbfceea188f40f6168/src/lib/env.ts) requires explicit matching `APP_ENV` / `DATABASE_ENV` labels for operations, validates PostgreSQL URLs, and calls the target guard. Test mode rejects external database URLs. | **Fail-closed baseline remains in place; no new-project identity is authorized.** |
| Migration path | [`src/db/migrate.ts`](https://github.com/Satsetx4/karturt/blob/3bc69c83265dce3a6a0863cbfceea188f40f6168/src/db/migrate.ts) checks the environment before applying the full `drizzle/` folder. `drizzle.config.ts` also calls the guard before supplying a URL to Drizzle Kit. `drizzle.offline.config.ts` contains no database URL. `db:bootstrap-rt` and `db:bootstrap-initial-rt` are limited to the local development bootstrap target. | **No staging migration is enabled by this source state.** A migration command must not be inferred from a staging URL or target manifest. |
| Runtime/migration roles | [`src/db/client.ts`](https://github.com/Satsetx4/karturt/blob/3bc69c83265dce3a6a0863cbfceea188f40f6168/src/db/client.ts) creates the app pool from `DATABASE_URL`; `getDb()` is also used by the Better Auth Drizzle adapter. The source has no distinct runtime and migration credentials or grant policy. `src/db/migrate.ts` uses the same client path. | **Role split is not implemented.** Do not use the provider-created owner role as application runtime identity. |
| App authentication | [`src/lib/auth/server.ts`](https://github.com/Satsetx4/karturt/blob/3bc69c83265dce3a6a0863cbfceea188f40f6168/src/lib/auth/server.ts) configures Better Auth email/password login, disables self-sign-up, enables the two-factor plugin, rate-limits sign-in and verification routes, uses an environment-specific secret, and selects secure cookies for HTTPS. `requireAuthEnvironment()` requires a 32-character `BETTER_AUTH_SECRET`. `src/lib/auth/principal.ts` requires a verified TOTP factor for System Admin. | **This is the application login model; it is separate from Neon’s database `passwordless_access` setting.** No live auth flow was tested. |
| Tenant boundary | `src/lib/auth/principal.ts` binds resident principals to active person/household membership in the account RT and requires one active official RT assignment. `src/lib/auth/permissions.ts` checks self-service household/RT scope and RT-scoped permissions against the principal’s RT. The schema uses composite RT-scoped keys and foreign keys. Static search of `src/db/schema.ts` and `drizzle/*.sql` found no `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY`, or `FORCE ROW LEVEL SECURITY`. | **Application-layer controls exist; database-native RLS is absent from the reviewed source.** Static checks do not prove deployed tenant isolation. |
| Direct Next CLI launches | Six smoke scripts spawn `node_modules/next/dist/bin/next` directly, outside the shared environment-file policy in `scripts/lib/next-command.ts`: `phase-6-treasurer-verification-http-smoke.ts`, `phase-8-cash-payment-http-smoke.ts`, `phase-9-payment-reversal-http-smoke.ts`, `phase-10-waiver-http-smoke.ts`, `phase-11-tariff-adjustment-http-smoke.ts`, and `phase-12-household-browser-smoke.ts`. Several are development-only and enforce the existing development target; this does not close the shared preflight bypass because Next can load `.env*` before application configuration. | **Tooling gap remains open. Do not run these from a staging-credentialed checkout until a shared pre-spawn guard is separately implemented and reviewed.** |
| Dependency findings | Wave 12.4/12.5 reports record five historical HIGH development-dependency findings and zero in the then-reported production-only audit. Named packages were `eslint-config-next`, `@next/eslint-plugin-next`, `braces`, `fast-glob`, and `micromatch`. | **Historical, not refreshed in this lane.** The production-only result does not close development/CI exposure. |

The source contains 14 ordered migrations (`0000`–`0013`). Prior Wave 12.3 evidence records a successful PostgreSQL 18.6 rehearsal for this exact source SHA and synthetic fixtures. That rehearsal is not evidence about a future Neon project, its provenance, contents, grants, access settings, or readiness. In particular, the historical chain includes the `0003` enum/data conversion, `0010` settlement backfill, and `0011`–`0013` state-dependent preflights; no staging command or test was run here.

## Proposed independent proofs and future source mapping

Future use must pass these gates independently. No one row implies another, and environment variables or owner risk acceptance cannot be treated as proof of database contents.

| Proof | Required evidence before source guard or app use can change | Failure behavior |
|---|---|---|
| **1. Provisioning provenance / no-copy** | After separate project-creation authorization, read back the exact organization, new project ID, PG version, region, Free plan, root branch ID and parent/source metadata, database ID/name, role, endpoint ID/hostname, and creation timestamp. Record that the provider created an independent root and that no existing project, branch, snapshot, dump, resident data, or other external source was copied/restored. | Any inherited parent, unexpected origin, ID mismatch, unverified no-copy statement, or unexpected resource/charge stops review. Preserve the existing staging unchanged. |
| **2. Initial database baseline** | Under a separate, explicit, server-enforced read-only permission, prove the inspected session targets the exact new project/branch/database/role and classify expected PostgreSQL built-ins separately from unexpected non-system objects. Confirm no app tables/data and no Drizzle migration ledger before the first migration. This proof is distinct from provider “new project” metadata and from the disposable PG18 rehearsal. | Incomplete results, unexpected data/object/ledger, ambiguous timeout, or wrong role/target means stop and preserve the new instance and evidence. Do not try cleanup, reset, or a migration. |
| **3. Explicit migration permission** | A later owner authorization must name exact provider IDs, source SHA/tree, all 14 migration and journal hashes, migration principal, one execution window, intended work, recovery authority, and stop conditions. Keep migration credentials out of Vercel. No permission is given here. | Any mismatch or failure blocks the next migration step; preserve partial state and sanitized diagnostics. No blind retry, journal edit, drop, reset, or automatic replacement. |
| **4. Runtime connectivity** | Separate later authorization after the migration gate: review source target mapping, provider access posture, distinct runtime-role grants, server-only secret delivery, Better Auth configuration, synthetic-only data, exact-SHA authorization tests, and any explicitly accepted RLS alternative. Runtime `DATABASE_URL` is not migration consent. | Do not connect the app while any identity, access mode, grant, tenant test, or secret-custody check is missing. |

After a future authorized creation, a source proposal should map provider-returned values into one reviewed, immutable allowlist/manifest: organization ID; project ID; root branch ID and parent/source; database ID and name; endpoint ID and canonical hostname; PostgreSQL version; and region. The new IDs are **unknown until returned and read back**. Do not infer IDs from the proposed project name or accept self-asserted Vercel variables as provider proof. Compare the actual runtime URL against the reviewed canonical direct endpoint, expected port, exact database path, and endpoint identifier; keep rejecting aliases, arbitrary hosts, duplicate or unapproved query parameters, and endpoint reuse under non-staging labels. A pooler hostname should remain disallowed unless its mapping and behavior are separately reviewed.

Any future target-guard source change belongs in a separately authorized source wave. Keep `stagingIsolationVerifiedEmpty=false` during Wave 12.6A and until provenance and baseline evidence are positively established, independently reviewed, and explicitly accepted for that use. Do not replace this proof with a boolean set in Vercel, a passing rehearsal, an empty-looking metadata response, or a risk waiver.

## Access roles, passwordless setting, and application authentication

Design the new project with three distinct principals; none is created or configured by this lane:

| Principal | Future purpose | Boundary |
|---|---|---|
| **Project administrator / database owner** | Provider administration and narrowly controlled schema ownership. | Human-controlled and audited; never the Next.js runtime credential and never a general-purpose CI secret. A provider-created owner role is not an app role. |
| **Migration principal** | One explicitly authorized execution of the approved migration set. | Separate from the app runtime identity, limited to the named project and window, withheld from Vercel, and revoked/rotated when the authorized operation ends. Exact DDL grants must be read back under separate permission. |
| **Application runtime principal** | Next.js and Better Auth runtime reads/writes needed for application operation. | No project/role administration, schema creation, migration, or broad owner privileges. Grant only required schema usage, table operations, and specific function execution. The exact minimum cannot be asserted until runtime SQL paths and privileges are reviewed. |

The current code has no separate migration URL. If a later source change needs one, a separately guarded operator-only `MIGRATION_DATABASE_URL` may be proposed for the migration runner; this variable is not supported today and must never be configured in Vercel.

Before any new-project DB connection, verify the actual provider auth configuration and who can obtain access. If `passwordless_access` is enabled, stop before connecting; any change to that setting requires separately scoped authorization and a readback. Prefer a verified, controlled password-auth path for the named least-privilege role; neither a role name nor provider metadata alone proves its grants or actual access control. Do not place database credentials in source, logs, browser bundles, `NEXT_PUBLIC_*`, or shared reports.

The current app uses Better Auth password login, no self-sign-up, and a TOTP plugin. A future synthetic staging review should confirm the approved account provisioning path, disabled public registration, System Admin MFA, HTTPS trusted origin and cookies, separate staging `BETTER_AUTH_SECRET`, rate limits, and non-production account data before app connectivity. Neon passwordless database access is not the same as passwordless user login. No app accounts, credentials, or auth flows were exercised in this lane.

## RT isolation and acceptance boundary

The current source provides useful application controls and composite RT-scoped database constraints, but no checked-in RLS policies. Before any separately authorized staging app connection, prepare exact-source negative tests using only synthetic RT A / RT B accounts and records. Include at least:

- a resident from RT A trying to read or mutate another household or resident in RT B;
- an RT A Treasurer and Chairman trying cross-RT read and write routes, including resident management, payments/verification, adjustments, and reports;
- a System Admin attempting RT-scoped actions without the permitted role/scope;
- cross-RT foreign-ID and relationship attempts that must be denied without data leakage or side effects.

Expected outcomes are authorization denials or privacy-safe not-found responses, no mutation, and no database details in responses. Run relevant permission, household route/security, payment, and synthetic HTTP suites only after a later source/test authorization, against the exact source SHA and independently verified disposable target. The prior 209 focused tests are older-source evidence; Wave 12.3’s negative database-constraint rehearsal is not an application authorization test.

For synthetic-only disposable staging, any decision to proceed without RLS needs an explicit, bounded owner exception with compensating controls and passing exact-SHA cross-RT tests. No such exception is assumed here. Production remains blocked until database-native tenant enforcement or an independently reviewed equivalent is established and tested; app-layer checks alone are not a second database boundary.

## Minimal future Next CLI guard proposal

`npm run dev/build/start` route through `scripts/lib/next-command.ts`, but the six listed smoke scripts spawn Next directly. The smallest coherent future correction is to expose a shared **asynchronous guarded-spawn** helper alongside the existing wrapper, apply the same environment-file policy to the exact child environment before `spawn`, and route all six launch sites through it while preserving process tracking, readiness checks, and teardown. Add focused checks that reject unsafe environment files/labels before Next starts and cover all six call paths. The current synchronous wrapper is not a drop-in replacement for smoke scripts that manage a live child process. This is a proposal only; no wrapper, smoke script, or test was changed or run in Wave 12.6A.

## Future Vercel staging variable names — names only

If a later, separately authorized app-connectivity/deployment phase chooses Vercel, review these names for the staging Preview environment only; no values are supplied or configured here:

- `APP_ENV`
- `DATABASE_ENV`
- `DATABASE_URL` — server-only runtime-role connection secret
- `BETTER_AUTH_SECRET` — server-only, unique staging secret
- `NEXT_PUBLIC_APP_URL` — public HTTPS origin

Do not configure a migration credential in Vercel. Keep provider identity evidence in the reviewed source manifest/readback record rather than trusting a set of mutable deployment variables as proof of project, branch, database, or endpoint identity. Never add a database URL or credential under a `NEXT_PUBLIC_*` name. No Vercel settings, deployment, or provider metadata were inspected or changed by this lane.

## Lane disposition

| Gate | Agent C result |
|---|---|
| Exact source identity and guard state | Static review at the assigned SHA; guard remains closed for the old target and does not yet map the new project. |
| New target identity, provenance, and initial database baseline | **NOT VERIFIED**; no new project exists in this lane and no provider or SQL access was authorized. |
| Migration principal/permission and runtime role | **DESIGN ONLY**; not implemented or configured. |
| Auth and RT containment | Static design review only; no runtime test. RLS absent from reviewed source. |
| Dependency findings | Historical five HIGH development findings / prior production-only zero; not refreshed. |
| Six direct Next CLI paths | **GAP OPEN**; future guarded-spawn proposal only. |
| Source patch, Neon operation, SQL, Vercel change/deployment, or cost | **NOT PERFORMED**. |

**Agent C verdict:** `PARTIAL`. Wave 12.6A can inform the provisioning approval packet, but it does not certify a new target or authorize connection. Wave 12.6B project creation, later SQL, source guard changes, access/role changes, Vercel configuration, migrations, cleanup, and Wave 13 remain outside this lane and require separate explicit authorization.

## Prior report references

- [Wave 12.5 Coordinator report](../../wave12-5/2026-10-14/WAVE12_5_COORDINATOR_REPORT.md)
- [Wave 12.5 Agent A target decision](../../wave12-5/2026-10-14/WAVE12_5_AGENT_A_TARGET_DECISION.md)
- [Wave 12.5 Agent B recovery runbook](../../wave12-5/2026-10-14/WAVE12_5_AGENT_B_RECOVERY_RUNBOOK.md)
- [Wave 12.5 Agent C security decisions](../../wave12-5/2026-10-14/WAVE12_5_AGENT_C_SECURITY_DECISIONS.md)
- [Wave 12.5 Owner decision packet](../../wave12-5/2026-10-14/WAVE12_5_OWNER_DECISION_PACKET.md)
- Wave 12.1 Agent C security QA: `docs/wave12-1/2026-10-13/WAVE12_1_AGENT_C_SECURITY_QA.md`
- Wave 12.2 Agent C security QA: `docs/wave12-2/2026-10-14/WAVE12_2_AGENT_C_SECURITY_QA.md`
- Wave 12.3 Agent C staging safety: `docs/wave12-3/2026-10-14/WAVE12_3_AGENT_C_STAGING_SAFETY.md`
- Wave 12.4 Agent C recovery/security: `docs/wave12-4/2026-10-14/WAVE12_4_AGENT_C_RECOVERY_SECURITY.md`
