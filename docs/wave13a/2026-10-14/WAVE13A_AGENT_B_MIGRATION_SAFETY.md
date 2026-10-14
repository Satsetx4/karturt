# Wave 13A Agent B — Migration Safety

**Result: operator path implemented and tested offline; live execution remains disabled.**

## Operator-only path

`src/db/migrate.ts` no longer uses the application database client or `DATABASE_URL`. The separate path requires matching explicit `APP_ENV=staging` and `DATABASE_ENV=staging`, a distinct `MIGRATION_DATABASE_URL`, and exactly the explicit one-shot command arguments with an absolute authorization-file path outside the source worktree. The migration URL is checked against Agent A’s direct-target identity guard before an approval file is read.

The source checkout must be at a clean exact Git commit. Before operator confirmation, the executor verifies the pinned Git-blob SHA-256 values for all 14 migrations and `_journal.json`, then verifies a short-lived Ed25519 approval bound to:

- the exact source SHA;
- the target manifest fingerprint;
- the migration manifest fingerprint;
- a unique 64-hex authorization id and a maximum 15-minute authorization window.

The operator must use an interactive terminal and type a one-time challenge. The prompt prints the source SHA, target manifest fingerprint and reviewed target identity, plus the migration manifest fingerprint. An exclusive local replay marker is fsynced under the Git common directory **before** a database pool can be created. The pool is dedicated to the migration command, is limited to one connection, and uses connection, statement, lock, and overall execution timeouts.

Failure, timeout, or client-close error is reported as an unknown/possibly partial outcome. The executor does not retry. Stop and request separately authorized read-only reconciliation before deciding on recovery. A disposable rebuild or deletion/recreation requires its own explicit owner approval.

## Trust-anchor stop

`PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM` is intentionally `null`. The migration command therefore stops with “staging migration is disabled” before authorization can succeed or a pool can be created. Tests inject ephemeral signing keys only into the pure offline verifier; they do not make a key available to the production entrypoint.

The replay marker is local to the Git common directory on the machine running the command. No shared replay registry or cross-host one-use authority was established in Wave 13A. The production verifier remains disabled pending an independently verified owner key, key-custody process, and explicit source review. A future key pin changes the source SHA, so any signed authorization must bind the resulting new SHA.

The exact migration manifest fingerprint is `e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4`. Every expected file hash appears in the owner packet. No SQL migration or Drizzle journal was edited.

## Verification

Offline unit coverage exercises exact flags, environment mismatch, rejection of the runtime URL, missing or wrong target/approval, source/target/migration binding, expiry, invalid signatures, replay rejection, consumption order, safe error output, and no retry after an error or timeout. The final focused suite passed 41/41; the full suite passed 526/526 on the integrated implementation. No Neon connection or client was created.

No owner key, live role privilege, database identity attestation, migration, post-migration SQL check, or rollback/rebuild was performed. This path is a reviewed source mechanism, not permission to use it.
