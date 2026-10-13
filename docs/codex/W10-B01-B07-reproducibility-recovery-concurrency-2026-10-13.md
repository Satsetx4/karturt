# Wave 10 — Agent B Reproducibility, Recovery, and Concurrency

- Date: 2026-10-13 (Asia/Bangkok)
- Worktree: `D:\!AGY\karturt-wave10-agent-b-20261013`
- Branch: `codex/w10-agent-b-20261013`
- Starting SHA: `91fcdffb213ed842f6573190283495b554e27725`
- Starting tree: `9298f5b3c18a1c9643b8fb809761d46f7152f2e3`

## Result

| Item | Status | Evidence and limit |
| --- | --- | --- |
| W10-B01 — baseline, recovery bundle, restore evidence | PASS | Assigned worktree began clean at the required SHA/tree. Wave 9 bundle verifies as complete history with the expected ref and SHA-256. Coordinator separately confirmed named-ref restore to the expected SHA/tree, clean status, and `git fsck --full --strict` exit 0. The older Wave 8 recovery bundle is valid but contains only the Wave 7 ref, not Wave 8/9. |
| W10-B02 — Wave 8/Wave 9 route output comparison | PASS | Both isolated `npm run build` runs exited 0 and generated 18/18 static pages. Equivalent manifests match exactly: 55 app paths; 39 static routes; 16 dynamic routes; 11 prerender entries; no static or dynamic path differences. The reported “55 routes” and “18 static pages” are different manifest/log metrics, not a route regression. |
| W10-B03 — deterministic install and regression | PASS on local patched worktree | `npm ci` exited 0 and installed 442 packages. The full suite on this worktree, based on the Wave 9 starting SHA with the cleanup patch applied, passed 72 files and 476 tests. Full lint exited 0 with two existing warnings; typecheck passed. Focused cleanup/identity tests passed 21/21. The coordinator will rerun gates on the final integrated commit SHA. |
| W10-B04 — PostgreSQL engine preflight | BLOCKED | No Docker, Podman, `psql`, `pg_isready`, `pg_ctl`, or `initdb` command; no matching Windows service/process; no local listener on port 5432. No engine invocation or DB connection was attempted. |
| W10-B05 — five independent PostgreSQL races | BLOCKED / NOT RUN | There is no proven disposable local PostgreSQL target or verified real-engine teardown. The five races were not run. PGlite is not used as substitute evidence. |
| W10-B06 — runner ownership/cleanup negative audit | PASS for mocked states; real engine BLOCKED | Added exact-name fallback only when the runner has no usable ID, then re-inspects the canonical ID and run label before mutation. Mocked tests prove mismatched label, inspect failure, ambiguous ID, and 12-character abbreviated ID cannot trigger stop/remove. |
| W10-B07 — five HIGH dev-only dependency entries | FINDINGS RECORDED | Current `npm audit --json` exited 1 with five HIGH, zero Critical. All five lockfile entries are `dev: true` and form one `braces` advisory chain. npm offers only a semver-major `eslint-config-next@14.2.35` downgrade, incompatible with the Next 16 baseline. No safe non-breaking mitigation was established; none was applied or suppressed. |

## Bundle and source integrity

Read-only checks:

| Artifact | Result |
| --- | --- |
| `D:\!AGY\karturt-wave9-candidate-91fcdff-20261013.bundle` | `git bundle verify` exit 0; complete history; ref `91fcdffb213ed842f6573190283495b554e27725 refs/heads/codex/wave9-integration-20261013`; SHA-256 `0CB103A78779C61E41E5CEF79F810CCB15095C7220681264CF18EF8514E22247`. |
| `D:\AGY\karturt-wave8-recovery-34a2af3.bundle` | `git bundle verify` exit 0; complete history; ref only `34a2af3195a09220a6639bdcb2aff369a813d5c2 refs/heads/codex/w8-agent-a-20261013`; SHA-256 `547C8659ECB7AA6821FE6771879D00946BEA4121EEE88CF9F5CB979154368521`. It does not contain the later Wave 8 integration SHA. |
| Wave 8 comparison source archive | The saved 500-file ZIP had 0 path/content differences against a fresh `git archive` of `6aa044e37f8d0020562a99ebfdc56c03e1d86eb5`. Extracted build folder had all 500 tracked files plus the build-generated `next-env.d.ts`. |
| Assigned Wave 9 worktree | Initially clean at SHA `91fcdffb213ed842f6573190283495b554e27725`, tree `9298f5b3c18a1c9643b8fb809761d46f7152f2e3`. |

The recovery check used `git bundle verify <bundle>` for each bundle and `Get-FileHash -Algorithm SHA256 -LiteralPath <bundle>`. The coordinator's separate named-ref restore and strict fsck results are recorded as coordinator evidence; this lane did not create another restore clone.

## Build and manifest comparison

Wave 8 input is commit `6aa044e37f8d0020562a99ebfdc56c03e1d86eb5`; Wave 9 input is `91fcdffb213ed842f6573190283495b554e27725`. Both were installed using `npm ci --no-audit --no-fund --registry=https://registry.npmjs.org` (exit 0, 442 packages). The lockfile hashes match across these SHAs. `next.config.mts` is byte-identical. Wave 9 changes the npm build script from direct `next build` to `tsx scripts/run-next-build.ts`, which checks for project environment files and then starts the same local Next CLI. Both builds used the same process-only non-secret values: `APP_ENV=test`, `DATABASE_ENV=test`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`, and empty `DATABASE_URL` / `BETTER_AUTH_SECRET`.

Each source ran `npm run build` once, exit 0, under Next.js 16.3.8/Turbopack. The logs reached `Generating static pages ... (18/18)`. Manifest comparison command:

```powershell
node -e 'const fs=require("node:fs"); const roots=["D:/!AGY/karturt-wave8-6aa044e-comparison/.next","D:/!AGY/karturt-wave10-agent-b-20261013/.next"]; const all=roots.map(p=>({app:JSON.parse(fs.readFileSync(p+"/server/app-paths-manifest.json","utf8")),routes:JSON.parse(fs.readFileSync(p+"/routes-manifest.json","utf8")),pre:JSON.parse(fs.readFileSync(p+"/prerender-manifest.json","utf8"))})); const sets=all.map(x=>({app:Object.keys(x.app).sort(),s:x.routes.staticRoutes.map(r=>r.page).sort(),d:x.routes.dynamicRoutes.map(r=>r.page).sort(),pre:Object.keys(x.pre.routes).sort()})); console.log(JSON.stringify({wave8:{app:sets[0].app.length,static:sets[0].s.length,dynamic:sets[0].d.length,prerender:sets[0].pre.length},wave9:{app:sets[1].app.length,static:sets[1].s.length,dynamic:sets[1].d.length,prerender:sets[1].pre.length},staticEqual:JSON.stringify(sets[0].s)===JSON.stringify(sets[1].s),dynamicEqual:JSON.stringify(sets[0].d)===JSON.stringify(sets[1].d),staticOnlyW8:sets[0].s.filter(x=>!sets[1].s.includes(x)),staticOnlyW9:sets[1].s.filter(x=>!sets[0].s.includes(x)),dynamicOnlyW8:sets[0].d.filter(x=>!sets[1].d.includes(x)),dynamicOnlyW9:sets[1].d.filter(x=>!sets[0].d.includes(x))},null,2))'
```

It exited 0. Both outputs: 55 app paths, 39 static, 16 dynamic, 11 prerender entries; `staticEqual=true`, `dynamicEqual=true`, and all four path-difference arrays empty. Wave 8's own report records both 55 app paths / 39 static / 16 dynamic and 18/18 generated static pages. The two displayed counts describe unlike outputs.

## Cleanup runner audit and patch

The existing cleanup helper verifies the exact inspected container ID and the per-run ownership label before stopping; if it remains, it rechecks ownership before force removal, then requires a successful exact-ID absence readback. The launch identity helper restricts local DB bootstrap to test mode and loopback host `127.0.0.1`, with run-derived database/user identity and explicit connection validation. These safeguards are unit/mock evidence only here; no database was contacted.

The narrow failure addressed was a failed or malformed container-create ID leaving the run-owned auto-remove container without an ID available to cleanup. The wrapper now passes its generated exact name. If ID is missing or malformed, cleanup resolves only `karturt-pg-${runId}`, then performs the existing exact full-ID and run-label checks before any stop/remove. An abbreviated 12-character ID returned by name lookup is rejected by the following canonical full-ID equality check, with no mutation. Name lookup failure, ambiguous/malformed output, run-name mismatch, or ownership mismatch also fail closed.

Mock coverage added: valid exact-name recovery, different run label, exact-name inspection returning a 12-character ID, failed name inspection, and ambiguous/malformed returned ID. The 12-character regression test asserts exactly two inspect calls and no stop or remove. No mock test invokes Docker or Podman.

## Local verification commands and results

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci --no-audit --no-fund --registry=https://registry.npmjs.org` | 0 | 442 packages installed; lockfile unchanged. |
| `npx vitest run tests/unit/disposable-postgres-cleanup.test.ts tests/unit/disposable-postgres-identity.test.ts --maxWorkers=1` | 0 | 2 files; 21 tests passed. |
| `npx eslint scripts/lib/disposable-postgres-cleanup.ts scripts/run-disposable-postgres-concurrency.ts tests/unit/disposable-postgres-cleanup.test.ts` | 0 | No findings. |
| `npm run typecheck` | 0 | Passed. |
| `npm test -- --maxWorkers=1` | 0 | Local Wave 9 worktree after the Agent B cleanup patch; 72 files and 476 tests passed in 313.93 seconds. HEAD remained the Wave 9 starting SHA while the patch was uncommitted; this is not exact-commit-SHA evidence. |
| `npm run lint` | 0 | 0 errors; 2 warnings in untouched `scripts/phase-12-household-browser-smoke.ts:1005` and `src/lib/billing/resident-card.ts:91`. |
| `git diff --check` | 0 | No whitespace errors. |
| `npm audit --json --registry=https://registry.npmjs.org` | 1 | 5 HIGH, 0 Critical; findings summarized below. |
| `npm ls --all eslint-config-next @next/eslint-plugin-next fast-glob micromatch braces` | 0 | One chain: `eslint-config-next@16.3.8` → `@next/eslint-plugin-next@16.3.8` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`. |
| Read-only engine preflight | 0 | Commands `docker`, `podman`, `psql`, `pg_isready`, `pg_ctl`, `initdb`: 0 available; matching services 0; matching processes 0; port 5432 listeners 0. |

No real PostgreSQL race runner was invoked. The exact preflight checked command availability, local Windows services/processes, and the local listening socket only; it did not start a service, query a database, inspect remote resources, or install an engine.

## Dependency advisory review

The exact lockfile path is `eslint-config-next@16.3.8` → `@next/eslint-plugin-next@16.3.8` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`. All five package entries have `dev: true`. Current audit lists five HIGH package findings from the `GHSA-vfj7-8cjw-p6xm` / `CVE-2026-93687` braces advisory chain, zero Critical. npm's automatic suggestion is `eslint-config-next@14.2.35` and marks it semver-major, so it is not a safe fix for Next 16. As checked 2026-10-13, [GitHub Advisory Database](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists `braces <=3.0.3` with no patched release; [npm package metadata](https://www.npmjs.com/package/braces) still reports 3.0.3. No compatible patch, safe override, or non-breaking migration was established. No downgrade, override, or suppression was applied. This remains an open dependency finding.

## Scope limits

No Neon or remote DB access, cloud resource creation, source push, merge, deployment, production/demo/F3/Vercel/DNS change, real WhatsApp send, or resident data use occurred. The report and patch are local-only. PostgreSQL concurrency, staging, production, and CI evidence are not asserted as PASS.
