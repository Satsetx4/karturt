# KartuRT V1 Wave 13A Coordinator Report

**Decision:** `SECURITY/PREFLIGHT PARTIAL`

**Date:** 2026-10-14

Wave 13A implemented the source-side staging target guard, an operator-only migration gate, and guarded asynchronous Next.js smoke launches. The source patch is local and reviewable. The separate approval packet is preparation for a later decision; it grants no database or deployment permission.

## Baselines and candidate

| Item | Branch | Commit | Tree |
|---|---|---|---|
| Immutable source baseline | `codex/wave12-3-pg18-rehearsal-20261014` | `3bc69c83265dce3a6a0863cbfceea188f40f6168` | `f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9` |
| Wave 13A source candidate | `codex/wave13a-staging-hardening-20261014` | `1f6c71c75a3e1cf9400f6e14ea06f3a362bd8f57` | `c53759bb297b472d55901ac2b04b1103ac4d8d17` |
| Documentation base | `docs/wave12-6b-new-staging-provisioning-20261014` | `bee9b4219f052d050870b2612c66c99f41b35e21` | `6374ce1aa98eb29dddc3ccdefc8e4731edf72763` |

The source changes do not modify any checked-in Drizzle migration or journal file. All 14 migration SQL files and `drizzle/meta/_journal.json` were rehashed against the immutable baseline; the results are in the owner packet.

## Workstream results

| Workstream | Result |
|---|---|
| Agent A — staging identity and environment guard | Implemented and integrated. Exact new-target URL validation is separate from provider attestation and runtime readiness. The old target remains denied. |
| Agent B — migration-only gate | Implemented and integrated. It binds a short-lived Ed25519 approval to the exact source, target manifest, and migration snapshot; requires an interactive typed challenge; consumes the approval before client creation; and refuses retry after uncertain outcome. The owner public key is unset, so production execution remains disabled. |
| Agent C — async smoke launcher | Implemented and integrated. All six assigned asynchronous Next launches pass environment and project-file preflight before spawn, while retaining their child-process lifecycle handling. |

The maximum of three delegated agents was observed. Their isolated worktrees and original commits were:

- Agent A: `D:\!AGY\karturt-wave13a-agent-a-20261014`, commit `744c06ebf895fbf28b39f7398238dfffb0ab2c3d`.
- Agent B: `D:\!AGY\karturt-wave13a-agent-b-20261014`, commit `a19ede44ad10c129c9de896d8ae9837899b4cb03`.
- Agent C: `D:\!AGY\karturt-wave13a-agent-c-20261014`, commit `29099cf5ddcc40c5ec18437751c72fb0aaefccb4`.

## Local verification

- `npm ci` completed at the source baseline, installing 442 packages. Wave 13A adds a package script but no dependencies or lockfile changes.
- Focused Wave 13A tests: **41/41 passed** on the final source candidate.
- Full Vitest suite: **526/526 passed** on the integrated Agent A/B/C implementation. The later source edits only corrected and strengthened the new operator-review test; the focused suite passed again afterward.
- `npm run lint`: **0 errors**, with two warnings in unchanged files: `scripts/phase-12-household-browser-smoke.ts:1007` and `src/lib/billing/resident-card.ts:91`.
- `npm run typecheck`: passed on the final source candidate.
- `npm run db:check:offline`: passed; this verifies offline schema/journal consistency only.
- `git diff --check` for the source baseline-to-candidate range: passed.
- Local PostgreSQL 18 rehearsal: **not run**. Docker, Podman, `psql`, `postgres`, and `pg_ctl` are not installed on this host.
- No Vite test, source check, or migration test used a Neon credential or opened a database client. Relevant inherited database and Neon environment variables were removed for test commands.

The earlier GitHub Actions PostgreSQL 18.6 rehearsal, run `38503239173`, passed at baseline SHA `3bc69c83265dce3a6a0863cbfceea188f40f6168`. It rehearsed migrations `0000–0013` and observed 14 ledger entries, 27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, and 7 enums. That result is evidence for the baseline rehearsal only, not for Neon staging or a new candidate rehearsal.

`npm audit` reported five high advisories on development/lint dependency paths and zero production dependency advisories. No dependency upgrade was in scope.

## Readiness limits and stop

The source maps the approved Wave 12.6B staging identity but does not prove live provider identity, physical emptiness, data provenance, role grants, network controls, or runtime readiness. `stagingIsolationVerifiedEmpty` remains `false`; normal staging application access is blocked. No Neon SQL, connection, compute wake, migration, role or network change, or source runtime opening was performed.

The migration executor cannot pass its preflight in this source revision because no owner Ed25519 public key is pinned. The earlier bounded catalog result was limited to its defined read-only scope and is not used as proof of physical emptiness or migration readiness. Provider and runtime acceptance remain owner-controlled decisions.

The exact Vercel review project was rechecked read-only before publication review: `live=false`, no latest deployment, and zero deployments returned. The candidate changes no workflow files. The two repository push workflows do not include the Wave 13A branch names in their push filters, and no pull request was created. Post-push Actions and Vercel observations belong in the coordinator’s final delivery record; an absent Actions run is not a CI pass.

Wave 13A stops here. See `WAVE13A_OWNER_MIGRATION_APPROVAL_PACKET.md` for the future gates and independent owner decisions. Wave 13B/13C, Neon access, app connectivity, and deployment require separate authorization.
