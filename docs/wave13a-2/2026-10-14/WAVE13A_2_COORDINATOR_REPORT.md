# Wave 13A.2 Coordinator Report

Date: 2026-10-14
Result: WAVE13A2 VERIFIED — DISPOSABLE PG18 DRIVER EXIT PASS

## Scope and refs

- Source baseline: bb566ee432b5abf1905699c01ed70e9ed34624c0 on codex/wave13a-1-focused-remediation-20261014.
- Documentation baseline: 2dacec1f7865952c41b66e2a8113a50b14e7cbcd on docs/wave13a-1-remediation-20261014.
- Final Wave 13A.2 source SHA: 48b92abbe93fbd499448b6c885d3042cb49c2128.
- Source branch: codex/wave13a-2-pg18-evidence-20261014.
- Disposable verification branch: verify/karturt-wave13a2-pg18-20261014, pointing at the same source SHA.
- Documentation branch: docs/wave13a-2-validation-20261014.
- origin/main remained 96c84588ae0c13f68a17cffd997a3e583fb7da82 at the final remote readback.
- No PR, merge, default-branch update, Neon SQL/provider mutation, or Vercel deployment was performed.

## Execution and local verification

Three bounded lanes were used: Agent A corrected migration evidence and errata; Agent B built the disposable PostgreSQL 18 harness; the coordinator added and reviewed the independent Agent C safety QA.

- npm ci succeeded.
- Focused runtime guards: 12/12 passed.
- Typecheck passed.
- Full lint: 0 errors, 2 existing warnings in unrelated files.
- Drizzle offline check passed.
- Full local suite: 80/80 files, 559/559 tests.
- Committed diff whitespace check passed.
- All 15 raw Git blob SHA-256 values match the manifest at the final source SHA and at both Wave 13A reference SHAs.
- No migration SQL or journal content changed.
- The owner approval public key remains null and stagingIsolationVerifiedEmpty remains false.

## Disposable PostgreSQL 18 runtime

The corrected exact-SHA workflow run 38538027706 passed on source SHA 48b92abbe93fbd499448b6c885d3042cb49c2128: https://github.com/Satsetx4/karturt/actions/runs/38538027706

The workflow used PostgreSQL 18, the real Node pg.Pool driver over loopback TCP, and a run-scoped disposable database with a database-owning role lacking cluster privileges. It completed normal query/close, immediate query error, and timed-out query scenarios. Child exit codes were 0 for success, 1 for immediate error, and 1 for timeout; all children exited naturally within the 8-second bound, each scenario invoked its migration body once, and no retry occurred.

The timeout scenario used a 300 ms JavaScript deadline around synthetic SELECT pg_sleep(60). PostgreSQL still showed the backend active for 3,046 ms after the child exited. It then disappeared after 57,192 ms of bounded observation without a cancellation request. This run proves bounded Node child-process exit for this direct TCP harness. It does not prove server-side query cancellation, migration rollback, or Neon behavior. The runtime script issues synthetic SELECT statements only and applies no migrations.

The first run, 38536692408, failed because the harness incorrectly expected the backend to disappear within three seconds. That result exposed the query continuation; the corrected harness now records and reports it. The failure and its correction are preserved in the Agent B report.

The Neon serverless WebSocket transport was not tested. No Neon endpoint was contacted.

## Other CI

Test Gate A run 38538027707 passed on exact source SHA 48b92abbe93fbd499448b6c885d3042cb49c2128: https://github.com/Satsetx4/karturt/actions/runs/38538027707. Lint, typecheck, unit, integration/migration, constraints, authorization, security closure, full suite, Drizzle journal, schema drift, and production build steps all succeeded. The separate PostgreSQL 17 concurrency job was skipped by its existing branch allowlist.

## Cost and deployment readback

The repository is public, and both workflows used standard ubuntu-latest GitHub-hosted runners. GitHub documents standard runner use as free for public repositories: https://docs.github.com/en/billing/concepts/product-billing/github-actions. No larger runner, paid service, artifact storage, or provider resource was used.

After branch pushes, the Vercel project karturt-review-staging-20261012 returned live=false and latestDeployment=null; deployment listing returned count 0. The authenticated team's linked Git projects did not include Satsetx4/karturt. No Vercel deployment was created.

## Next gate

Wave 13A.2 does not authorize Wave 13B. The next deliberate decision is an owner-specific security, network, role, approval-key, and read-only preflight package. Neon SQL, provider changes, key generation/pinning, signed authorization, migrations 0000–0013, staging guard activation, application integration, and deployment remain unauthorized.

Related records: WAVE13A_2_AGENT_A_EVIDENCE_CORRECTION.md, WAVE13A_2_AGENT_B_PG18_TIMEOUT_VERIFICATION.md, WAVE13A_2_AGENT_C_INDEPENDENT_QA.md, WAVE13A_2_MIGRATION_EVIDENCE_ERRATA.md, and WAVE13A_2_OWNER_NEXT_GATE.md.
