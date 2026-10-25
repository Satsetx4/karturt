# RELEASE FIRST V1 — R3 concurrency evidence worksheet

**Template only.** Do not run a race from this worksheet. R3 requires exact-SHA R2 `PASS`, a reviewed observer, an app instance running the same SHA, and separate target-bound R3 authorization. The structural observer alone always returns `UNVERIFIED` and cannot prove that a recorded UAT action caused the observed database activity.

## Run identity

| Field | Value / evidence reference |
|---|---|
| Exact candidate SHA and PR | |
| GitHub Actions run ID and attempt | |
| R2 evidence reference | |
| R3 target-bound authorization reference | |
| Neon project / branch / endpoint / database | |
| PostgreSQL version and region readback | |
| App mode / origin / app-instance SHA | |
| Fixed business date and timezone | |
| Synthetic actor aliases | |
| Independent verifier | |

## One row per race attempt

Do not reuse a run/scenario tag. Do not include passwords, cookies, session tokens, personal details, SQL text, backend PIDs, or raw rows.

| Race scenario and unique run/scenario ID | App SHA / origin | Worker instance A / B | Action start/end timestamps | Expected app result | Actual sanitized app result | Pre/post persistence and negative-state check | Observer sample time / artifact / structural result | Independent operation-correlation evidence | Verifier / evidence reference |
|---|---|---|---|---|---|---|---|---|---|
| R3-RACE-REQUEST | | | | | | | | | |
| R3-RACE-VERIFY | | | | | | | | | |
| R3-RACE-CASH | | | | | | | | | |
| R3-RACE-REVERSAL | | | | | | | | | |

## Acceptance checks

| Check | Status | Exact-SHA result / evidence reference |
|---|---|---|
| Two distinct same-SHA app workers and pools | NOT RUN | |
| Two distinct encrypted PostgreSQL 18 backend sessions | NOT RUN | |
| Overlap and lock contention observed in one sample | NOT RUN | |
| App outcome and persisted state independently correlated to this operation | NOT RUN | |
| Expected counts, amounts, allocations, audit effects, and negative checks match frozen fixture oracle | NOT RUN | |
| No retry, reset, or repeated staging race without fresh authorization | NOT RUN | |

The observer's `OBSERVED` value is structural evidence only. Record application outcomes and persistence checks separately, then have an independent verifier tie them to the same unique run/scenario ID and exact target. Any missing correlation, wrong SHA/version, unexpected mutation, or duplicate financial effect keeps the race result `UNKNOWN`, `FAIL`, or `UNVERIFIED`; it cannot be promoted to `PASS` by the observer output alone.
