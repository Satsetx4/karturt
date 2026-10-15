# Wave 13B.1T — RC Quality Acceptance

## Verdict

**RC_PARTIAL** — Gate A and PG17/PG18 exact-final-SHA checks all passed. The full npm audit still has one HIGH advisory affecting five development dependency nodes; no compatible patched release is available. Production-only npm audit reports zero vulnerabilities.

**D1V2: NOT_EXECUTED_ACCESS_SAFETY_BLOCKED.** No database connection or SQL was run; local access prerequisites and approved expected-state baseline remain missing.

**Isolation: UNKNOWN; D3 NO_GO.** Control-plane metadata does not prove independent lineage or physical emptiness, and network/branch controls are absent on the Free plan.

## Exact source identity

| Ref | Expected / read-back SHA |
|---|---|
| RC base | `193b25be6394db9196c22617e9b55b4427cf6f86` |
| Source branch `codex/karturt-v1-rc-quality-wave13b1t-20261015` | `0b1e3f525039496200b2bb5f698d312ded5cb3e3` |
| Verify alias `verify/karturt-v1-rc-quality-wave13b1t-20261015` | `0b1e3f525039496200b2bb5f698d312ded5cb3e3` |
| Remote `main` (not changed) | `96c84588ae0c13f68a17cffd997a3e583fb7da82` |

The final source change from the RC base consists of `.github/workflows/gate-a.yml`, `.github/workflows/wave12-3-pg18-rehearsal.yml`, `scripts/lib/disposable-postgres-identity.ts`, `scripts/lib/pg18-migration-rehearsal.ts`, and their two guard unit tests. No application finance source, package/lockfile, migrations, or isolation/pinning guards changed. The two initial workflow-only commits were superseded by the final correction; the failed PG18 attempt on `3509b1b` is not final evidence.

## Exact-SHA checks

| Gate | Run / job | Event | SHA | Status |
|---|---|---|---|---|
| Gate A (full) | Run `38699617335`, job `116304347197` | push | `0b1e3f525039496200b2bb5f698d312ded5cb3e3` | **PASS** — all 15 named steps success |
| PG17 concurrency | Job within Gate A run `38699617335`, job `116307663761` | push | `0b1e3f525039496200b2bb5f698d312ded5cb3e3` | **PASS** — run identity, concurrency proof, evidence upload |
| PG18 disposable rehearsal | Run `38699617221`, job `116304346369` | push | `0b1e3f525039496200b2bb5f698d312ded5cb3e3` | **PASS** |

Gate A includes dependency install, lint, typecheck, unit, integration/migration, constraints, authorization, security closure, full test suite, Drizzle journal consistency, schema drift, and production build. Mark PASS only when the completed run and every required job are `success`; skipped, cancelled, or failed jobs are not PASS.

The failed PG18 exact SHA attempt `3509b1b7131227465f57431556c14b1ac620c53e` was rejected by the intentionally push-only runtime branch guard before migration steps. The alias was added narrowly to the allowlists and tests, then a new push SHA was created. The earlier workflow-dispatch run was cancelled and does not count.

## Integrity invariants

- Migration blobs `drizzle/0000`–`0013` plus `drizzle/meta/_journal.json`: **15/15 byte-identical** to `48b92abbe93fbd499448b6c885d3042cb49c2128`.
- `stagingIsolationVerifiedEmpty`: **false**.
- `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM`: **null**.
- No production/main merge, provider mutation, or paid resource.

## Quality residuals

- `npm audit --json`: five HIGH package nodes from one advisory, GHSA-vfj7-8cjw-p6xm / CVE-2026-93687.
- `npm audit --omit=dev --json`: zero production dependency vulnerabilities.
- No patched `braces` version is available; an ESLint config downgrade to Next 14 was rejected as an incompatible major change. No suppression or forced fix was used.
- Keep overall RC at **PARTIAL** until a compatible upstream dependency patch is available and re-audited.
