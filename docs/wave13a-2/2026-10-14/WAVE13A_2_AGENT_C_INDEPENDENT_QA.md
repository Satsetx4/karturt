# Wave 13A.2 Agent C: Independent Safety QA

Date: 2026-10-14
Result: PASS — source safety assertions and exact-SHA local suite passed.

## Coverage added

The independent test file tests/unit/wave13a2-independent-safety-qa.test.ts checks that:

- db:migrate remains the local development migration command and the staging operator is separately named;
- current and legacy staging endpoints are rejected under development, production, and test labels, while staging execution remains blocked;
- the owner approval key is null and authorization consumption, challenge confirmation, client creation, migration execution, and shutdown are not reached when the key is unpinned;
- all six asynchronous smoke callers retain explicit APP_ENV/DATABASE_ENV labels and use the guarded Next command helper.

The test uses synthetic URLs and stubs only. It does not connect to a database or read application credentials.

## Independent review

The new PostgreSQL 18 workflow is branch-scoped, read-only at the GitHub permission layer (contents: read), has no artifact upload or deployment action, and runs only a loopback disposable service with synthetic credentials. The runtime validates the repository, branch, run-scoped database identity, PostgreSQL 18 version, empty user schema, and least-privilege test role before running the child scenarios.

The runtime exercise is not evidence for Neon serverless transport. It makes no request to Neon, does not invoke the staging authorization gate, and does not run migration SQL. The approval key remains null and stagingIsolationVerifiedEmpty remains false.

The first PostgreSQL 18 run confirmed natural process exit but showed the server backend still executing pg_sleep(60) at three seconds after child exit. The corrected harness records this explicitly and waits for the synthetic query to finish. It does not claim server cancellation or rollback.

At source SHA 48b92abbe93fbd499448b6c885d3042cb49c2128, local checks passed: runtime guard tests 12/12; typecheck; full lint with 0 errors and 2 pre-existing warnings; offline Drizzle consistency; full Vitest suite 80/80 files and 559/559 tests; raw blob integrity 15/15; migration/journal unchanged; and committed diff whitespace check.

PostgreSQL 18 exact-SHA workflow run 38538027706 passed: https://github.com/Satsetx4/karturt/actions/runs/38538027706. Test Gate A run 38538027707 also passed on the exact source SHA: https://github.com/Satsetx4/karturt/actions/runs/38538027707. The separate PostgreSQL 17 concurrency job was skipped by its existing branch allowlist.
