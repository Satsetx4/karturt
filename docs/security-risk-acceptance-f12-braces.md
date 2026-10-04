# Security Risk Acceptance — RA-2026-F12-001

**Status:** **KNOWN / ACCEPTED RESIDUAL RISK — NOT RESOLVED**
**Decision date:** 2026-10-04
**Scope:** One High-severity advisory in the development-only lint toolchain for the KartuRT F12 clean integration checkpoint.

## Finding

- **Advisory:** [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) / CVE-2026-93687
- **Affected package:** `braces@3.0.3`
- **Severity:** High. This acceptance does not downgrade the advisory or describe the package as safe.
- **Dependency path:** `eslint-config-next@16.3.6 → @next/eslint-plugin-next@16.3.6 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`
- **Exposure:** Development lint tooling only; this chain is not in the production dependency graph.
- **Upstream status at approval:** No patched upstream `braces` release was available.
- **Audit evidence:** The full `npm audit` reports **5 High entries and 0 Critical entries**, all propagated from this one root advisory. `npm audit --omit=dev` reports **0 vulnerabilities**.
- **Remediation applied:** No speculative override, downgrade, or lockfile workaround was used.

The project owner explicitly accepted this narrowly scoped residual risk after reviewing the finding and its production-only audit result. This record documents that decision; it does not resolve the advisory.

## Acceptance boundary

This acceptance applies only to GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 affecting `braces@3.0.3` through the development lint-tooling path above.

It does **not** apply to:

- Any future or unrelated High finding.
- Any Critical finding.
- Any vulnerability in the production/runtime dependency graph.
- Authentication, authorization, credential-handling, or other security defects.
- Vulnerabilities in direct application code or any package outside this exact finding and dependency path.

The production-only dependency audit must remain at zero vulnerabilities. If the dependency path or exposure changes, this acceptance no longer covers the changed condition.

## Review triggers

Reassess this risk when any of the following occurs:

1. A patched `braces` release becomes available.
2. The dependency chain changes to a patched version or alternative.
3. The advisory's severity, affected versions, or technical details change.
4. `braces` or this chain enters the production dependency graph.
5. Before F22 Security Hardening.
6. Before staging or production launch.

## Close process when a compatible patch is available

1. Confirm the published fix and compatibility with the current lint-tooling chain.
2. Upgrade through the narrowest supported dependency change; do not use a speculative override or major downgrade.
3. Re-run the full and production-only dependency audits and required quality gates.
4. Confirm the advisory is absent from the full audit and production-only audit remains at zero.
5. Update this record to **RESOLVED**, record the fixing dependency/source revision and audit evidence, and remove the accepted-residual-risk status.

Until that evidence exists, the status remains **KNOWN / ACCEPTED RESIDUAL RISK**.

## Related records

- F12.1 acceptance evidence and historical verdict: `docs/phase-12-1-acceptance-closure-report.md`
- F12 household-management report and F12.2 addendum: `docs/phase-12-household-management-report.md`
