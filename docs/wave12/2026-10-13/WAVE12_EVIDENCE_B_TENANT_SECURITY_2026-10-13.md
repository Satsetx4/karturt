# KartuRT V1 Wave 12 — Agent B Tenant/Security Evidence

Audit date: 2026-10-13 (Asia/Bangkok)
Scope: W12-B01–B07, source/static review and preparation proposals only.

## Decision

**Agent B: PARTIAL. Gate remains BLOCKED for staging execution.** Checked-in tenant controls are structurally strong and the repository contains focused cross-RT and IDOR tests. Those tests could not be executed because this worktree has no Vitest executable installed. More critically, the checked-in staging target guard still names the prior Neon project/branch/database and deliberately leaves `stagingIsolationVerifiedEmpty=false`; it does not match the current resource identities supplied for W12. Keep that guard fail-closed. Do not connect, wake, run SQL, migrate, seed, or alter it during this audit.

The supplied W12 context says the new `karturt-v1-staging` project/branch/database was created empty and not cloned. **This audit did not independently inspect database contents**: no connection, query, migration, or content inspection was performed. Treat emptiness here as owner-provided creation history, not an independently verified empty-database result.

## Baseline and instructions

- Worktree: `D:\!AGY\karturt-wave11-b`
- Root: `D:/!AGY/karturt-wave11-b`
- HEAD: `355c5804df9767e7ce8456edde4439a4a7eaedc9`
- Tree: `df520d59d675e46f43c4b224798fe4b237e36360`
- Branch state: detached HEAD; `git status --short --branch` reported `## HEAD (no branch)`; `git status --porcelain=v1` was empty.
- `AGENTS.md` was read. It contains the Next.js agent guidance and no repository instruction requiring a source change for this review.
- No source changes, commits, pushes, provider calls, `.env` reads, environment-secret reads, or connection-string handling were performed.

Commands/evidence:

| Command/check | Result |
|---|---|
| `git -C D:\!AGY\karturt-wave11-b rev-parse HEAD` | `355c5804df9767e7ce8456edde4439a4a7eaedc9` |
| `git -C D:\!AGY\karturt-wave11-b rev-parse 'HEAD^{tree}'` | `df520d59d675e46f43c4b224798fe4b237e36360` |
| `git -C D:\!AGY\karturt-wave11-b status --porcelain=v1` | Empty; clean before and after review. |
| `Test-Path D:\!AGY\karturt-wave11-b\node_modules\.bin\vitest.cmd` | `False`; Vitest launcher absent. |
| Targeted Vitest launch for three F12 authorization tests and `phase-12-household-database.test.ts` | Not launched: fail-fast check found no executable. No test exit code exists. No package install was attempted. |

The Vitest config (`vitest.config.mts`) sets `envDir: false` and invokes `assertNoProjectEnvironmentFiles` before tests. The shared test helper (`tests/helpers/database.ts:1-31`) constructs an in-memory `PGlite` instance and reads checked-in SQL files into that isolated instance; it does not use `DATABASE_URL`. These properties establish the selected tests' intended offline test path, but they do not establish test results. PGlite is not independent PostgreSQL service or PostgreSQL concurrency evidence.

## Task status

| Item | Status | Evidence and limit |
|---|---|---|
| B01 Baseline/instructions | PASS | Exact SHA/tree/status verified; no tracked or untracked worktree changes. |
| B02 Composite tenant constraints | PARTIAL | Schema definitions include same-RT composite FKs/unique keys across households, people/accounts, assignments, billing, payment, and allocation records. Focused tests exist but could not run here. |
| B03 Authentication, roles, and IDOR | PARTIAL | Principal/permission/lifecycle/route code is scoped and focused negative-path tests exist. Runtime results are not verified because Vitest is missing. |
| B04 Bootstrap/environment isolation | BLOCKED | Bootstrap is local-development gated and has first-RT/identity guards, but staging allowlist is stale and the new DB has not had an independent empty-content check. |
| B05 Credential handling | PASS (static only) | No credential values were read. Environment is passed internally to the pool; reviewed guard errors are generic and do not echo the connection URL. A bounded `rg` scan found no matching `console.*`/throw patterns that log `DATABASE_URL`/`databaseUrl` under `src` or `scripts`. No runtime secret-flow test was executed. |
| B06 Synthetic fixture/teardown design | PASS (proposal only) | Matrix and run-owned cleanup controls below; nothing was seeded or removed. |
| B07 Database/runtime validation | BLOCKED | No tests ran; no real PostgreSQL or Neon access was made. Any real-PostgreSQL results remain NOT RUN. |

## Source review findings

### Tenant scope in database schema

The schema carries `rtUnitId` through core tenant-owned data and uses composite keys to prevent mixing rows from separate RTs:

- `src/db/schema.ts:59-110`: houses are unique by RT plus case-folded number; households reference houses by `(rtUnitId, houseId)`; people reference household by `(rtUnitId, householdId)`.
- `src/db/schema.ts:189-255`: app accounts have one auth user, RT/person/household composite FKs, resident membership uniqueness, and a role-specific scope check; official assignments reference `(rtUnitId, appAccountId, appAccountType)` and require the `official` type.
- `src/db/schema.ts:257-346`: billing year, fee-rate, and monthly-dues references bind RT, year, household, and fee rate together.
- `src/db/schema.ts:348-384`: due adjustments bind the due and official actor to the same RT.
- `src/db/schema.ts:387-491`: payment requests, verified/resolved actors, payments, and reversals carry composite RT/household/request scope.
- `src/db/schema.ts:519-704`: waiver items, payment request items, allocations, active settlements, and request claims bind child rows to the corresponding parent/due tuples.

The `audit_events` table is actor-account scoped (`schema.ts:706-722`) rather than carrying its own RT column. Any cross-tenant audit presentation must continue to derive allowed rows through the authenticated account; no schema-wide database RLS boundary was established by this static review.

Existing targeted tests include:

- `tests/constraints/database-constraints.test.ts:22-29`: same house number is rejected within one RT but allowed in a different RT.
- `tests/constraints/database-constraints.test.ts:128-150`: foreign-RT household references and resident person/household mismatches are rejected.
- `tests/constraints/database-constraints.test.ts:290-307`: a monthly due cannot reference another RT's billing year.
- `tests/authorization/phase-12-household-security.test.ts:93-149`: foreign and nonexistent household IDs produce the same not-found message with no foreign audit event; role denials are asserted.

Those are code/test-design observations, **not executed PASS results for W12**.

### Principal, role, and IDOR paths

- `src/lib/auth/permissions.ts:27-118` limits residents to their own household and RT, restricts tenant operations to the matching RT, gives payment verification/cash/reversal to the Treasurer, and does not grant tenant administration to System Admin. Existing role tests in `tests/authorization/permissions.test.ts:17-118` encode these constraints.
- `src/lib/auth/principal.ts:13-108` derives the principal from the authenticated user and active app account; resident membership joins on RT, household, person, and active membership; official assignment lookup includes the account's RT and active date. A System Admin principal has null tenant scope and requires a verified application TOTP factor (`principal.ts:34-44`, `79-85`). The user-approved organization-MFA waiver does not by itself change this app-level account requirement.
- `src/lib/households/lifecycle.ts:296-341` requires an RT Chairman, verifies active account/auth-user/RT identity and exactly one active Chairman assignment. The mutation paths use the principal's RT when looking up and locking target rows (`lifecycle.ts:344-425`, `744-783`, `895-1042`); list/detail reads also carry RT filters (`lifecycle.ts:1045-1150`).
- Household API tests reject extra tenant/role/account fields before principal or DB access and reject foreign-origin mutations (`tests/authorization/phase-12-household-route-security.test.ts`). Service tests assert foreign and missing IDs share a not-found result (`phase-12-household-security.test.ts:93-149`).
- Additional existing tests cover cross-RT adjustment lookup (`tests/authorization/chairman-adjustment.test.ts:238-265`), account provisioning from the wrong RT (`tests/integration/account-provisioning.test.ts:37-54`), and ambiguous cross-RT resident login identities (`tests/integration/authentication.test.ts:251-297`). No such test was executed in this worktree.

### Bootstrap and staging target guard

`src/lib/staging-database-target.ts:1-15, 78-93` still allows only the earlier target:

- old configured project: `ancient-smoke-51787007`
- old configured branch: `br-dry-block-b3fsqjo3`
- old database: `karturt_stage`
- old endpoint: `ep-raspy-meadow-b3ppifq6`
- `stagingIsolationVerifiedEmpty = false`

The W12 request provides current target identities `wild-art-99835126`, `br-hidden-cake-a1ge5xqp`, and `karturt_staging`, which differ. The source guard is fail-closed, but it cannot authorize this target. **Do not change the allowlist or the false isolation flag based only on creation history.** An authorized later guard update must use a fresh provider metadata readback and a separate decision. The old Wave 11 report was inspected as untrusted evidence; its stale-target claim matches the current checked-in source, but it is not authority for a new connection or mutation.

`src/lib/env.ts:13-58`, `src/db/client.ts:6-20`, `src/lib/env-file-preflight.ts:1-49`, and the bootstrap scripts show explicit matching `APP_ENV`/`DATABASE_ENV` gates, local-development bootstrap restrictions, no test `DATABASE_URL` path, and no error interpolation of the URL in the reviewed guard. `scripts/bootstrap-initial-rt.ts` calls the local development bootstrap guard before `getDb()`. The first-RT bootstrap uses an advisory lock and rejects more than one or a conflicting RT identity (`src/lib/rt/bootstrap.ts:77-114`); the first-Chairman bootstrap checks for prior account/person/household/billing state within that RT (`bootstrap.ts:153-267`).

These guards do not replace a separately approved full empty-database preflight. The application bootstrap checks specific RT-domain records, not every object/table in the database. Stop if any unexpected rows or schema state are discovered later.

## Proposed synthetic fixture matrix — NOT EXECUTED

Use only after separate owner approval for schema and fixture stages. Generate a new random run marker at execution time and record exact synthetic IDs in an external run-owned manifest. No real resident names, phone numbers, addresses, PINs, payments, or production credentials.

| Fixture | Tenant A | Tenant B | Intended negative check |
|---|---|---|---|
| RT identity/settings | Synthetic RT-A plus one settings row | Synthetic RT-B plus one settings row | RT identities and settings do not overlap. |
| House/current household/person | One synthetic house, active household, active person | Separate synthetic house, active household, active person | A household/person association carrying the other RT ID must be rejected. |
| Accounts/assignments | Synthetic Chairman, Treasurer, resident; one active same-RT assignment for each official | Same three roles with distinct auth users and assignments | Resident cannot widen tenant/household scope; Chairman/Treasurer cannot access other RT rows; System Admin cannot acquire tenant permissions. |
| Optional database-only house-number case | Same synthetic house number as B | Same synthetic house number as A | Composite uniqueness allows reuse across tenants; do not try resident login for duplicated identifiers because login resolution intentionally fails closed on cross-RT ambiguity. |
| Billing negative-path rows | One future year/rate and one future due, all tagged by synthetic values | Matching separate year/rate/due | A due row combining A household with B year/rate fails composite FK; authenticated foreign due lookup is indistinguishable from nonexistent ID. |
| Feature-specific children | Add payment request/items/allocations only for the exact test under separate fixture authorization | Same | Cross-RT parent/item/due/actor substitutions fail composite constraints; keep these rows out of base fixture if not needed. |

Use unique `.test.invalid` email values and freshly generated non-human identifiers. If an API test needs credential authentication, use disposable synthetic credentials held only in the approved test process and store only the account IDs in the manifest; never place the credential or hash in logs or evidence. PGlite/in-memory tests can exercise negative paths, but cannot substitute for an independently authorized real-PostgreSQL concurrency run.

## Proposed run-owned teardown manifest — NOT EXECUTED

The current schema has no general `run_id` column. Therefore cleanup must use an external manifest of **every exact generated primary key** plus the unique synthetic marker observed for that row. Do not rely only on a prefix query, broad RT ID, or truncation. Before deleting anything, compare the manifest against current target identity, row counts, and synthetic marker; require exact expected counts. If a row is missing, additional, or no longer has the expected marker, stop and ask for owner review.

Suggested child-first delete order, limited to rows explicitly recorded for this run: `payment_request_claims`, `active_due_settlements`, `payment_allocations`, `payment_reversals`, `payments`, `payment_request_items`, `waiver_items`, `waiver_actions`, `due_adjustments`, `payment_requests`, `monthly_dues`, `fee_rates`, `billing_years`, `audit_events`, `official_assignments`, `app_accounts`, `people`, `households`, `houses`, `rt_settings`, then the two `rt_units`; delete associated `session`, `account`, `twoFactor`, `verification`, and auth user rows only if the run created them and no remaining FK references exist. The actual order must be validated against the approved migration/schema and exact rows before a cleanup stage is authorized. Never truncate tables, remove a project/database, or clean records outside the manifest.

If seeding fails partway, stop and preserve the manifest and sanitized failure evidence. Do not rerun seeding automatically. A future cleanup attempt requires its own explicit approval and the same identity/count/marker checks.

## Proposed validation SQL snippets — NOT EXECUTED

The following are text-only proposals. None was sent to a database. The identity readback must happen outside SQL through fresh provider metadata and a locally protected connection configuration. SQL cannot prove the Neon organization/project/branch identity on its own.

Read-only post-migration identity/server summary (only after a future connection is separately authorized):

```sql
-- NOT EXECUTED: proposed read-only summary; compare with separately verified metadata.
SELECT current_database() AS database_name,
       current_user AS database_role,
       current_setting('server_version') AS server_version;
```

Read-only emptiness sentinel (only after schema is authorized and migrations are complete). Expected counts must be explicitly agreed before running; any unexpected row means STOP. This is a partial application-data sentinel, not proof of whole-cluster emptiness:

```sql
-- NOT EXECUTED: proposed read-only count sentinel.
SELECT (SELECT count(*) FROM public.rt_units) AS rt_units,
       (SELECT count(*) FROM public.rt_settings) AS rt_settings,
       (SELECT count(*) FROM public.houses) AS houses,
       (SELECT count(*) FROM public.households) AS households,
       (SELECT count(*) FROM public.people) AS people,
       (SELECT count(*) FROM public.app_accounts) AS app_accounts,
       (SELECT count(*) FROM public.billing_years) AS billing_years,
       (SELECT count(*) FROM public.monthly_dues) AS monthly_dues;
```

Read-only consistency checks after the approved fixture step:

```sql
-- NOT EXECUTED: proposed zero-row checks for tenant-parent mismatches.
SELECT h.id
FROM public.households h
JOIN public.houses x ON x.id = h.house_id
WHERE h.rt_unit_id <> x.rt_unit_id;

SELECT d.id
FROM public.monthly_dues d
JOIN public.households h ON h.id = d.household_id
JOIN public.billing_years y ON y.id = d.billing_year_id
WHERE d.rt_unit_id <> h.rt_unit_id OR d.rt_unit_id <> y.rt_unit_id;
```

Composite-FK negative probes would require intentional DML and are therefore omitted as executable statements here. At a separately authorized stage, derive an invalid cross-RT row from the two run-owned fixture IDs, attempt it inside an explicitly controlled transaction, assert the expected FK rejection, and roll back; do not execute a probe on production or a database whose identity/emptiness is uncertain.

## Rollback and hard-stop rules

1. Before any future action, reread organization/project/branch/database identity and endpoint metadata. If any identifier, role, environment label, or schema state differs or is unknown, **STOP before connecting or issuing SQL**.
2. If any unplanned row exists at the empty preflight, **STOP**. Do not migrate, seed, delete, truncate, or attempt to normalize it.
3. If a migration fails, preserve the error and migration ledger in sanitized form; do not replay non-idempotent SQL or run an improvised repair. Reconcile schema/ledger and obtain owner approval for a recovery path before retrying.
4. If a fixture partially succeeds, stop and use the exact run-owned manifest; no bulk cleanup or project deletion.
5. Separate approvals remain required for schema migration, synthetic seed/teardown, GitHub/CI publication, and Vercel Preview. This Agent B audit grants none.

## Evidence limits and final status

- No test ran; the Vitest launcher was absent. No installation was attempted.
- No real PostgreSQL engine was used. PostgreSQL concurrency tests are **NOT RUN**.
- No Neon content readback was performed; the supplied empty-on-creation statement is owner-provided history only for this audit.
- No credentials or environment secrets were read, printed, or stored.
- Organization-level MFA and the detailed Rp0/usage audit are excluded as blockers by the W12 instruction. The app-level verified-TOTP requirement for System Admin remains in source.
- No source patch is proposed in this B lane. Preserve the fail-closed staging guard until its target is separately verified and an authorized source change is reviewed.

**Agent B verdict: PARTIAL; staging database execution remains BLOCKED. This is not a staging-readiness or release GO.**

## Coordinator dependency-tree follow-up

The coordinator worktree at `D:\!AGY\karturt-wave10-coordinator-20261013` was checked as a possible offline source for the missing test runner:

- Its HEAD and tree match this W11-b worktree exactly: `355c5804df9767e7ce8456edde4439a4a7eaedc9` / `df520d59d675e46f43c4b224798fe4b237e36360`.
- `package-lock.json` SHA-256 matches in both worktrees: `A957E6600F97D70C318EE4EE79F52ACCEA8682499C58288A0B62E59EB981CBC6`.
- The coordinator `node_modules` is a regular directory and its Vitest launcher exists. W11-b's local launcher is absent.
- A system process inventory returned 31 running `node` processes. It did not establish that the coordinator dependency tree was idle or unused by all processes.

Per the no-sharing safety condition, no junction/symlink was created and the coordinator tree was not used. No tests were run. The targeted in-memory/PGlite results therefore remain **NOT RUN**; no network install or copy was attempted. The W11-b Git worktree remains clean.
