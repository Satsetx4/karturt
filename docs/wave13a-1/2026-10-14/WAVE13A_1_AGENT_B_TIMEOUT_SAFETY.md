# Wave 13A.1 Agent B: Operator Timeout Safety

## Change

The staging operator runner now has a 15-minute JavaScript migration deadline and a 10-second client-shutdown deadline. Both are validated as positive timer values. The runner creates one client, consumes the signed one-shot authorization before client creation, and does not retry.

When the migration fulfills, the checked-out pool client is released normally. When it rejects or reaches its deadline, the runner passes a sanitized error to the public PoolClient.release(error) API so the pool removes and ends that client. It then bounds the wait for pool shutdown. A timeout, rejected migration, rejected close, or shutdown deadline produces a sanitized MigrationOutcomeUnknownError and a nonzero command result.

The message directs the operator to stop and request separately authorized read-only reconciliation. It does not claim database cancellation, rollback, or a known partial state. It never issues compensating SQL, calls process.exit, or uses private driver fields. The pinned owner approval key remains null, so staging migrations remain disabled.

## Tests

The suite covers a never-settling migration, a never-settling close, late migration success after timeout, a close error, migration rejection, duplicate replay, one client creation, approval consumption before client creation, public release(error) behavior, and secret redaction. Agent B reported its focused tests passing; the integrated full suite passed 543 tests across 78 files. Typecheck passed.

## Remaining runtime limit

The helper returns after a bounded shutdown wait and the command sets a nonzero exit code. Natural process exit still depends on the driver/runtime closing the referenced active transport and delivering its end event. A driver that leaves that handle referenced could keep Node alive. No live database or disposable PostgreSQL facility was available to exercise this path. The database outcome remains unknown; do not retry and do not infer cancellation or rollback. A separately authorized read-only reconciliation is required before any further operator action.
