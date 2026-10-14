# KartuRT V1 Wave 12.3 — Agent A CI / Drizzle Tooling

**Date:** 2026-10-14 (Asia/Bangkok)\
**Lane:** W12.3-A01–A08 — CI drift gate reproduction and minimal-fix assessment\
**Result:** **PASS — the current drift command works; no source patch is warranted.**\
**Source baseline:** `d4fc471a988c070ca2118e12ddbb0b363daa6541` (tree `15bb2fc622f19d0715906479083ae87bcbb85cec`).\
**Drizzle Kit:** locked version `0.31.11`.

## Commands and evidence

The current Gate A workflow invokes:

```sh
npm run db:generate:offline -- --name gate_a_ci_drift
```

The package script supplies `drizzle-kit generate --config drizzle.offline.config.ts`. On a disposable copy of the clean baseline, the exact workflow command exited **0** and made no generated changes. The copied Drizzle directory diff and working-tree status were empty.

The same command was then run after adding one synthetic table to the copied schema only. It exited **0** and generated migration `0014_gate_a_ci_drift.sql`, its snapshot, and the journal update. The expected drift check, `git diff --exit-code -- drizzle`, exited **1** and listed those changes. This proves the current gate detects schema drift without writing artifacts into the tracked baseline.

A separate CLI argument check confirmed that combining `--config` with `--out` is rejected by locked Drizzle Kit 0.31.11. Gate A does not pass `--out`; this behavior does not break the current workflow invocation.

`npm ci` exited **0** in the agent worktree. Lint, typecheck, and build were not run in this lane; coordinator exact-final-SHA evidence is recorded separately.

## Change decision

No CI or Drizzle source change was needed. No tracked source files were edited. The four temporary scratch directories created for copied-schema experiments remained untracked because the environment did not permit their removal; they are excluded from all commits and publication.

**Agent A disposition:** `PASS — CURRENT DRIFT COMMAND AND NEGATIVE DRIFT DETECTION VERIFIED ON DISPOSABLE COPIES`.
