# Wave 13A.1 Agent A: Development Migration Compatibility

## Finding

At Wave 13A base 1f6c71c75a3e1cf9400f6e14ea06f3a362bd8f57, both db:migrate and db:migrate:staging:operator invoked src/db/migrate.ts. That file had become the interactive staging-only operator entrypoint, breaking the normal local development migration command.

## Change

- db:migrate now invokes src/db/migrate-development.ts.
- db:migrate:staging:operator remains wired to src/db/migrate.ts with the explicit one-shot operator arguments.
- The new entrypoint requires APP_ENV and DATABASE_ENV to both equal development before loading project env files.
- NODE_ENV must be unset or development, and CI must be unset or empty.
- The existing env-file preflight remains in force. Local env-file loading still needs the existing explicit opt-in, and the target is checked again after loading.
- The exact database target is local localhost PostgreSQL on port 5432, database karturt_dev, role karturt, with no query or fragment. Staging, production, test, remote, unexpected-port, unexpected-database, and alternate-role targets are rejected before a database client is created.
- README instructions now identify the local target and the limited purpose of db:migrate.

No migration was executed during implementation or verification. The staging operator path, target guard, stage runtime flag, owner approval key, SQL files, and Drizzle journal were not loosened or changed.

## Tests

The offline unit tests cover explicit environment labels, target acceptance, target rejection, post-env-load revalidation, ordering of load/connect/migrate/close, and rejection before client creation. The full source suite passed: 543 tests across 78 files. Typecheck passed.
