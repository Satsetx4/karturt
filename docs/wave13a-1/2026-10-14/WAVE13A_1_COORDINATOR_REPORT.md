# KartuRT V1 Wave 13A.1 Coordinator Report

Date: 2026-10-14
Verdict: **REMEDIATION PARTIAL**

## Scope and refs

Source repository: Satsetx4/karturt
Source base: codex/wave13a-staging-hardening-20261014 at 1f6c71c75a3e1cf9400f6e14ea06f3a362bd8f57
Source result: codex/wave13a-1-focused-remediation-20261014 at bb566ee432b5abf1905699c01ed70e9ed34624c0
Docs base: docs/wave13a-staging-preflight-20261014 at 6623ddc624e02e609ecfdc19fee385043ffcfacd
Docs result branch: docs/wave13a-1-remediation-20261014

The source branch is based directly on the requested Wave 13A source SHA. The docs branch is based directly on the requested Wave 13A docs SHA. Six source commits are ahead of the source base. No migration SQL, Drizzle journal, or workflow file changed.

## Delegation and integration

Three agents worked in separate worktrees from the exact source base.

- Agent A: restored the local development migration command through a dedicated guarded entrypoint. Agent commit f127cb470214dc7902898ee324ba54dea54cc0f5; integrated as 6e164392b289368cf4ad96df0f044654ad397219.
- Agent B: bounded the migration and shutdown waits, then added public PoolClient release(error) handling for a migration that does not complete cleanly. Agent commits 81c1f18f0256addccf49b5efe801e44a7bbd383f and f87bbd5018c3089846c9e84bad9314038701bb00; integrated as 6097e5a and baa3e3a.
- Agent C: added regression coverage and checked raw Git blob hashes for all 14 migrations and the journal. Agent commits 11a97803ff7af419b92bb1dbf2a69fb5c90ecf28 and 0fa0aaf7cc7281ba97283f14a15ec8888440d07f; integrated as a307f82 and 6700649.
- Coordinator: corrected the README local-migration instructions and fixed TypeScript issues in the new development-migration tests; integrated as bb566ee432b5abf1905699c01ed70e9ed34624c0.

The primary checkout was not edited. Source work was done in a separate coordinator worktree.

## Changes

1. npm run db:migrate again targets local development only through src/db/migrate-development.ts. It requires explicit matching development labels, applies the existing environment-file preflight, and revalidates the exact local karturt_dev target and karturt role before creating a client. The staging operator command remains on its separate staging-only entrypoint.
2. The operator migration runner now bounds its migration wait to 15 minutes and client shutdown wait to 10 seconds. On timeout or migration failure, the runner asks the public PoolClient API to discard the active client. It reports an unknown database outcome, does not retry, and directs the operator to stop and seek separately authorized read-only reconciliation.
3. Regression tests cover local target rejection, unsafe environment files, mismatched labels, the six smoke command callers, the blocked staging runtime, approval replay and consumption order, client creation count, timeouts, late success, shutdown failures, and sanitized errors.

The timeout path does not claim that the server canceled a query or rolled back partial effects. The CLI sets a nonzero exit code after failure. Natural Node process exit still depends on the installed driver/runtime closing the referenced transport and delivering its end event; that behavior was not exercised against a PostgreSQL server in this wave.

## Verification

- npm ci completed in the coordinator worktree. Database-related environment variables were removed from the verification processes.
- npm test -- --maxWorkers=1: **78 test files passed, 543 tests passed**.
- npm run lint: passed with **0 errors and 2 existing warnings** in scripts/phase-12-household-browser-smoke.ts and src/lib/billing/resident-card.ts.
- npm run typecheck: passed.
- npm run db:check:offline: passed.
- git diff --check: passed.
- All 14 migration SQL Git blobs and drizzle/meta/_journal.json were hashed from raw Git blob bytes at the exact Wave 13A base. The three supplied comparison hashes for migrations 0000 and 0003 and the journal matched. Local checkout CRLF differences do not change the Git blob hashes.
- The staging isolation flag remains false. The pinned owner Ed25519 public key remains null.
- No Docker, Podman, psql, postgres, or pg_ctl facility was available, so no disposable PostgreSQL 18 rehearsal was run.

## Publication and external state

The source branch was pushed to GitHub at the exact SHA above. A post-push readback confirmed the branch SHA and unchanged source base. GitHub reported no workflow runs and no commit statuses for this SHA; this is not a CI pass. The checked-in workflows did not target this new branch, and no workflow files changed.

Read-only Vercel project inspection returned no repository-link field and zero deployments before the push. After the push, the branch and SHA filters still returned zero deployments. No Vercel mutation or deployment was made.

No Neon project, branch, role, endpoint, or database was connected, queried, or mutated. No migration was executed. No PR was opened, no default branch was changed, and the old staging project was not used.

## Why the verdict is partial

The development migration regression, source regression suite, static checks, offline Drizzle check, source publication, and fail-closed staging guards are verified. The migration timeout path now makes a bounded shutdown attempt through the public driver API and returns an unknown-outcome failure. A live PostgreSQL runtime was unavailable, so natural process exit after destroying a timed-out active transport remains unverified. Treat the timeout process-exit edge as an outstanding validation item. Wave 13A.1 stops here; Wave 13B did not start.
