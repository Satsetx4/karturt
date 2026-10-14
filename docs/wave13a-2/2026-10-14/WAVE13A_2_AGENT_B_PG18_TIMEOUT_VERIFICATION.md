# Wave 13A.2 Agent B: Disposable PostgreSQL 18 Timeout Verification

Date: 2026-10-14
Result: PASS — bounded real pg.Pool child exit; server-side query continuation explicitly observed.

## Implementation

The workflow .github/workflows/wave13a2-pg18-timeout-runtime.yml runs only on push to verify/karturt-wave13a2-pg18-20261014, has contents: read, uses a standard GitHub-hosted Ubuntu runner and a disposable postgres:18 service, and keeps checkout credentials disabled. It creates a database and login role scoped to the workflow run. The role owns only that database and has no superuser, create-database, create-role, or replication privilege.

The runtime step removes inherited database, Neon, Vercel, Supabase, and token environment variables and launches with an explicit environment allowlist. Credentials in the workflow are synthetic fixtures for the local service and are not provider secrets. The workflow uploads no artifact and has no deployment step.

The child harness uses the real Node pg.Pool TCP driver and the Wave 13A.2 migration timeout/shutdown helper. Scenarios cover a successful SELECT, an immediate synthetic SQL error, and a 300 ms JavaScript deadline around SELECT pg_sleep(60). The parent requires natural child exit within 8 seconds, expected exit codes, one migration-body invocation, no automatic retry, and sanitized stdout/stderr.

## First exact-SHA run and correction

Run 38536692408 (job 115761182254) ran on 85cefe54b813aeebd5d5ddccf593a281ebf18015: https://github.com/Satsetx4/karturt/actions/runs/38536692408

The success child exited naturally with code 0; the immediate-error child exited naturally with code 1; the timeout child exited naturally with code 1 within the 8-second bound, with one migration invocation and no retry. The run then failed because PostgreSQL still listed the pg_sleep(60) backend as active three seconds after the child closed its connection.

This is direct evidence that a JavaScript timeout plus pool/client shutdown does not establish server-side cancellation. No cancellation request was sent. The timed-out SQL was a read-only synthetic sleep; it did not apply migrations or write data.

The harness-only correction is source commit 48b92abbe93fbd499448b6c885d3042cb49c2128. It requires the backend to remain active during a three-second post-exit observation, then waits at most 70 seconds for the synthetic sleep to finish naturally and disappear. It sends no cancellation request.

## Corrected exact-SHA run

Run 38538027706, job 115765597633, completed successfully on source SHA 48b92abbe93fbd499448b6c885d3042cb49c2128: https://github.com/Satsetx4/karturt/actions/runs/38538027706

Recorded PostgreSQL major: 18. Driver: pg.Pool over loopback TCP. Migration approval flow: not invoked. Child results: success exit 0, immediate SQL error exit 1, timeout exit 1. All exits were natural, within the hard process bound, with one invocation and no retry.

The pg_sleep backend remained active for at least 3,000 ms after child exit (3,046 ms observed), then disappeared from pg_stat_activity after 57,192 ms of bounded observation. No cancellation request was sent. No migration writes occurred; the harness issued synthetic SELECT statements only.

## Limits

- Database: per-run disposable PostgreSQL 18 service only; no Neon endpoint was contacted.
- Driver: pg.Pool over loopback TCP. Neon serverless/WebSocket transport parity was not tested.
- This verifies bounded child-process exit for this direct TCP harness. It does not prove server cancellation, transaction rollback, migration safety, or behavior of the Neon WebSocket driver.
- Shutdown uses public Pool.end() and PoolClient.release(error) APIs. Unknown outcomes retain the fail-closed message and one-shot approval remains consumed.
