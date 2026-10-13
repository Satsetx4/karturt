# Wave 9 — Agent B Reproducibility, Recovery, and Concurrency

Date: 2026-10-13 (Asia/Bangkok)
Worktree: `D:\!AGY\karturt-wave9-agent-b-20261013`
Branch: `codex/w9-agent-b-20261013`
Required starting SHA: `6aa044e37f8d0020562a99ebfdc56c03e1d86eb5`
Wave 7 SHA: `34a2af3195a09220a6639bdcb2aff369a813d5c2`

## Result

| Item | Status | Evidence and limit |
| --- | --- | --- |
| W9-B01 — exact baseline and ancestry | PASS | The initially clean worktree was at the required SHA. `git merge-base --is-ancestor 34a2af3195a09220a6639bdcb2aff369a813d5c2 HEAD` exited 0. The baseline tree is `888f38a999382eee7ce1214ca03a6a6275ee851f`. |
| W9-B02 — bundle integrity and restore drill | PASS | The Wave 8 bundle verifies as complete history, with the expected Wave 7 ref and SHA-256 recorded below. A clone into a fresh path under this worktree restored the advertised commit, passed `git fsck --full --strict`, and had clean status. The restore clone was retained. |
| W9-B03 — deterministic install | PASS | `npm ci --no-audit --no-fund` exited 0 and installed 442 packages. The lockfile remained unchanged. `node_modules` is a normal directory in this worktree. |
| W9-B04 — local PostgreSQL engine preflight | BLOCKED | Docker, Podman, `psql`, `pg_isready`, `pg_ctl`, and `initdb` were absent from PATH; no matching Windows service/process or local port 5432 listener was found. No engine command or database connection was attempted. |
| W9-B05 — five independent PostgreSQL races | BLOCKED / NOT RUN | No verified disposable local PostgreSQL target exists. The five races were not run. PGlite/full-suite results are not PostgreSQL concurrency evidence. |
| W9-B06 — run identity and cleanup safety | PASS for mocked state transitions; runtime BLOCKED | The identity allowlist and database rechecks are described below. New cleanup tests use an injected command mock only; 11 focused tests passed across the cleanup and identity suites. No Docker/Podman command was invoked. |
| W9-B07 — dependency audit classification | FINDINGS RECORDED | Wave 8's audit reported five HIGH package entries from one `braces` advisory chain. All five are marked dev-only in the unchanged lockfile. No upgrade was applied. Current patch availability was checked against the GitHub Advisory Database and npm package listing; the finding remains open. |

## Baseline and recovery bundle

The required local branch began clean at `6aa044e37f8d0020562a99ebfdc56c03e1d86eb5`. The Wave 7 commit is an ancestor. No original worktree or other worktree was changed.

Wave 8 recorded its recovery artifact at `D:\AGY\karturt-wave8-recovery-34a2af3.bundle` (the path uses `D:\AGY`, without the `!`). The file exists and has size 6,236,027 bytes. Checks:

| Check | Result |
| --- | --- |
| SHA-256 | `547C8659ECB7AA6821FE6771879D00946BEA4121EEE88CF9F5CB979154368521` |
| `git bundle verify` | Exit 0; bundle is okay and records complete history. |
| `git bundle list-heads` | `34a2af3195a09220a6639bdcb2aff369a813d5c2 refs/heads/codex/w8-agent-a-20261013` |
| Dry restore clone | `D:\!AGY\karturt-wave9-agent-b-20261013\work\w9-bundle-restore-drill-5bf1b3fb7b8c439581909c22cb6ac037` |
| Restored state | Branch `codex/w8-agent-a-20261013`, HEAD `34a2af3195a09220a6639bdcb2aff369a813d5c2`, tree `cb57864dec9812bb02adf7b3d55bed9dbd9ceffd`, clean status. |
| `git fsck --full --strict` | Exit 0. |

This bundle restores the Wave 7 base. It is not a bundle of the later Wave 8 integration SHA. The Wave 9 baseline's exact SHA and tree are present in the assigned local worktree; this report does not claim the Wave 7 bundle alone recovers Wave 8 commits.

## Reproducibility and regression commands

The install was run locally at the Wave 9 starting SHA before the cleanup patch. npm emitted only the existing allow-scripts and deprecated-package warnings; no lockfile change resulted. The same `package-lock.json` blob is present from Wave 7 through the required Wave 9 baseline.

The Wave 8 reports contain earlier build and regression commands, but they are not promoted here to exact Wave 9 final-SHA evidence. The coordinator requested that `npm ci`, build, and full regression be repeated read-only against the final integrated SHA. Those checks remain pending until the coordinator supplies that path and SHA.

For the known offline build path, Wave 8 Agent A used process-scoped `APP_ENV=test`, `DATABASE_ENV=test`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`, with `DATABASE_URL` and `BETTER_AUTH_SECRET` empty, and ran `npm run build` twice. Wave 8 Agent B reported `npm test -- --maxWorkers=1` passing 70 files and 453 tests. These are historical results, not Wave 9 final-SHA passes.

The workflow's general `pull_request` trigger is broad, but its separate `launch-safety-postgres-concurrency` job still has an explicit legacy branch condition in `.github/workflows/gate-a.yml`. That condition does not include this Wave 9 branch or `codex/wave8-integration-20261013`; a successful general Gate A run alone would not prove the independent PostgreSQL job ran.

## Runner identity and cleanup

`scripts/lib/disposable-postgres-identity.ts` requires `APP_ENV=test`, `DATABASE_ENV=test`, a run ID and 64-character token. It accepts only `postgresql:` URLs on exact host `127.0.0.1`, a valid port, the database/user derived from the run ID, a nonempty password, and no query or fragment. The launch-safety suite checks connected database, user, and identity marker before migrations. The CI initializer requires GitHub Actions run identity, verifies the database and user, requires no existing user relations and a blank marker, then writes and reads back a run-specific marker.

The baseline cleanup code had a fail-open case: it ignored `container stop` status and treated every nonzero `container inspect` after stop as if `--rm` had removed the container. This could turn an engine/verification error into cleanup success. The patch extracts `cleanupRunOwnedContainer` in `scripts/lib/disposable-postgres-cleanup.ts` and injects the command runner for deterministic tests. It:

- rejects missing or malformed IDs;
- verifies exact container ID and run label before stop;
- treats nonzero status, thrown command errors, malformed labels, and failed list/inspect verification as failure;
- checks the run label again before force removal if the container remains;
- reports success only when a successful, exact-ID filtered container list is empty after stop or removal.

The tests cover auto-removal with absence readback, persistent-container removal with a second absence readback, ownership mismatch with no mutation, changed ownership before removal, inspect failure, list failure, and missing identity. They use an in-memory command-result queue and never invoke Docker or Podman.

The safely mockable seam is the injected `runCommand(args)` in `cleanupRunOwnedContainer`. If any future engine-specific behavior needs validation, test it through a fake command adapter that returns controlled inspect/list/stop/remove results; do not make the unit suite depend on a local daemon. A real teardown proof remains blocked here.

The container wrapper itself calls `docker info` / `podman info` when run. This Wave 9 local preflight deliberately did not execute the wrapper, because the instruction was to inspect engine availability without connecting to an engine.

## Local verification commands and results

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci --no-audit --no-fund` | 0 | 442 packages installed; lockfile unchanged. |
| `npx vitest run tests/unit/disposable-postgres-cleanup.test.ts tests/unit/disposable-postgres-identity.test.ts --maxWorkers=1` | 0 | 2 files, 11 tests passed; command adapter is mocked. |
| `npx eslint scripts/lib/disposable-postgres-cleanup.ts scripts/run-disposable-postgres-concurrency.ts tests/unit/disposable-postgres-cleanup.test.ts` | 0 | No findings. |
| `git diff --check` | 0 | No whitespace errors. |

The full lint/typecheck/build/full suite and five PostgreSQL races were not run in this lane at this SHA. Exact integrated-SHA results must be recorded by the coordinator after the read-only handoff.

## Five HIGH dependency entries

Wave 8's `npm audit --json` result was exit 1 with five HIGH entries and zero Critical. Its package path is:

`eslint-config-next@16.3.8` → `@next/eslint-plugin-next@16.3.8` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`.

The five entries are the direct dev dependency `eslint-config-next` and its transitive `@next/eslint-plugin-next`, `fast-glob`, `micromatch`, and `braces`. Each corresponding lockfile package is marked `dev: true`. They represent one underlying `GHSA-vfj7-8cjw-p6xm` / `CVE-2026-93687` stack-exhaustion advisory on `braces`, not five separate root causes. The full audit is still HIGH; the historical Wave 8 production-only audit was clean, but this lane did not rerun `npm audit`.

As checked on 2026-10-13, the [GitHub Advisory Database](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) still covers `braces <= 3.0.3` and lists no patched version; the [npm package listing](https://www.npmjs.com/package/braces) still shows 3.0.3. The upstream discussion includes a maintainer dispute over whether there is an issue to fix ([maintainer issue thread](https://github.com/micromatch/braces/issues/84)), so applicability is contested. npm's recorded automatic suggestion was `eslint-config-next@14.2.35`, a semver-major downgrade that is not compatible with the project's Next.js 16 baseline. No compatible patched release, safe override, or dependency migration has been established. No speculative update was applied.

Safe next options are to recheck the advisory and package release when preparing a later gate, or to evaluate a maintained fork/backport or a replacement lint chain on a separate isolated branch with provenance, license, behavior, and full-regression evidence. Any accepted-risk waiver would leave the dependency gate unresolved until the owner records that decision; it is not a technical PASS.

## Scope limits

No Neon, cloud, provider, production, demo/F3, DNS, WhatsApp, or resident-data access occurred. No cloud or database resource was created. No code or branch was pushed. This report and the cleanup change are local-only evidence; it does not assert Preview readiness or release readiness.
