# Wave 8 KartuRT V1 — Agent A build recovery evidence

**Result: PASS for the local build-recovery scope W8-A01–A08.** Two consecutive production builds passed after supplying explicit, isolated `test` labels. This establishes local dependency installation and buildability only; it does not establish application test, database, Preview, deployment, runtime, device, release, or production acceptance.

## Scope and starting state

- Date: 2026-10-13 (Asia/Bangkok).
- Worktree: `D:\AGY\karturt-wave8-agent-a-20261013` (path has no `!`).
- Branch: `codex/w8-agent-a-20261013`.
- Required start SHA: `34a2af3195a09220a6639bdcb2aff369a813d5c2`.
- Initial `git status --short --branch`: clean; `HEAD` matched the required SHA.
- Commit subject: `fix: confine RT bootstrap to local development`.
- Parent SHA: `1fe090bd76947b81654f81bf954c66eed0f887e9`; the baseline is present in local history and the assigned branch points to it.
- No application or dependency source changes were needed. Only this evidence report is added by this lane.
- No provider, Neon, production/demo/F3/DNS, cloud resource, or WhatsApp action was performed. Build-only environment variables were set for each invocation and cleared afterward; database URL and auth secret were empty, and no database command was run.

## Recovery bundle

A filename search in the assigned worktree did not find a Git bundle. The first creation attempt used the raw commit ID as a bundle ref and Git rejected it as empty; it exited 128. The destination did not exist afterward and was not overwritten. Creating from the local branch ref succeeded and includes the complete history.

| Action | Command/result |
|---|---|
| First attempt | `git bundle create D:\AGY\karturt-wave8-recovery-34a2af3.bundle 34a2af3195a09220a6639bdcb2aff369a813d5c2` — exit 128, “Refusing to create empty bundle.” |
| Successful creation | `git bundle create D:\AGY\karturt-wave8-recovery-34a2af3.bundle refs/heads/codex/w8-agent-a-20261013` — exit 0. |
| Verify | `git bundle verify D:\AGY\karturt-wave8-recovery-34a2af3.bundle` — exit 0; Git reports it is okay, uses SHA-1, and records complete history. |
| Advertised head | `git bundle list-heads D:\AGY\karturt-wave8-recovery-34a2af3.bundle` — exit 0; `34a2af3195a09220a6639bdcb2aff369a813d5c2 refs/heads/codex/w8-agent-a-20261013`. |
| Bundle file | `D:\AGY\karturt-wave8-recovery-34a2af3.bundle`; 6,236,027 bytes; SHA-256 `547C8659ECB7AA6821FE6771879D00946BEA4121EEE88CF9F5CB979154368521`. |

The bundle is a local recovery artifact outside the checkout, not a push or cloud resource. It was not deleted.

## Build environment and commands

- Runtime: Node `v24.19.0`; npm `12.0.2`; `package.json` requires Node `>=22.12.0`.
- Before installation, the worktree had no `node_modules` directory. `npm ci --no-audit --no-fund` exited 0 and installed 442 packages in 42 seconds from the existing lockfile.
- The installed `D:\AGY\karturt-wave8-agent-a-20261013\node_modules` is a normal directory, not a reparse point or junction. `.next/node_modules` is also a normal directory.
- The lockfile blob before/after installation matches `HEAD`: `927c66aff7007e33381d786a4046f6437b6fe9d8`; `git diff --exit-code -- package-lock.json` exited 0.
- npm emitted warnings that its `.npmrc allow-scripts` setting is ignored because `package.json` declares `allowScripts`, and that `@esbuild-kit/esm-loader`, `@esbuild-kit/core-utils`, and `eslint@9.39.5` are deprecated/unsupported. No dependency versions were changed in this lane.

The first plain `npm run build` exited 1 because the application requires explicit `APP_ENV` and `DATABASE_ENV` labels during page data collection. The failure named only the missing labels; it did not print credentials. The guard accepts `test` for an isolated build and does not require a database URL or auth secret. Both successful build commands used the following temporary process environment and cleared it immediately after the command:

```powershell
$env:APP_ENV='test'
$env:DATABASE_ENV='test'
$env:NEXT_PUBLIC_APP_URL='http://localhost:3000'
$env:DATABASE_URL=''
$env:BETTER_AUTH_SECRET=''
npm run build
```

| Run | Command | Exit | Evidence |
|---|---|---:|---|
| Initial, no explicit labels | `npm run build` | 1 | Expected configuration guard: explicit `APP_ENV` and `DATABASE_ENV` are required. |
| Build 1 | `npm run build` with the temporary environment above | 0 | Next.js 16.3.8/Turbopack compiled, TypeScript completed, and static page generation reached 18/18. |
| Build 2 | Same command and temporary environment | 0 | A separate build invocation completed compilation, TypeScript, and static page generation 18/18 again. The route summary matched Build 1. |

Both successful build logs list 55 app paths, including the expected application pages, API routes, `/robots.txt`, and `/sitemap.xml`. Build runs are not database or test-suite evidence. No lint, unit/integration suite, Drizzle, schema, security, or concurrency check was run by Agent A.

## Build artifact audit

The final `.next` output was inspected without printing environment or credential values:

- `.next/BUILD_ID` present; 55 app paths, 39 static routes, and 16 dynamic routes in the manifests.
- 1,027 files and 172,878,908 bytes under `.next` after the second build.
- No generated artifact filename matched `.env` or `.env.*`.
- Root and `.next` `node_modules` paths are both ordinary directories, not reparse points.
- Generated `.next` output and installed `node_modules` are ignored local build material; the report is the tracked evidence. No build artifact was added to Git.

## W8-A01–A08 disposition

| Item | Status | Evidence / limit |
|---|---|---|
| W8-A01 — recover exact baseline and ancestry | PASS | Worktree `HEAD` equals the requested SHA; parent commit and local branch containment verified. |
| W8-A02 — validate recovery bundle | PASS | No prior bundle was found in this worktree; a complete-history bundle was created from the exact branch ref, verified, and hashed. |
| W8-A03 — use a simple safe path | PASS | All build work ran under `D:\AGY\karturt-wave8-agent-a-20261013`, without `!`. |
| W8-A04 — keep native local dependencies | PASS | `node_modules` was absent before install and is now a native directory inside the assigned worktree. |
| W8-A05 — lockfile-consistent install | PASS | `npm ci` succeeded; the lockfile blob remains identical to `HEAD`. |
| W8-A06 — obtain a clean production build | PASS with explicit test labels | The unlabelled attempt exited 1 at the fail-closed environment guard; build passed with both labels set to `test` and connection/auth values empty. |
| W8-A07 — repeat build | PASS | A second separate production build completed with the same route summary. |
| W8-A08 — audit and record evidence | PASS | Artifact inventory, limits, warnings, exact commands/exits, recovery bundle hash, and statuses are recorded here. |

## Remaining evidence limits

- The local object store reported a stale shared-worktree metadata file (`garbage found: D:/!AGY/karturt/.git/worktrees/karturt-wave8-agent-a-20261013/refs`). It did not prevent reading the exact commit or creating/verifying the bundle. This lane did not alter shared Git metadata.
- The successful builds prove only that this source snapshot compiles in the isolated local environment. They do not validate database connectivity, migrations, financial invariants, tenant isolation, security, concurrency, cloud costs, Preview behavior, or release readiness.
- This report is documentation-only and is committed on the assigned local branch. No branch or code was pushed.
