# F12.1 dependency audit assessment

Assessment date: 2026-10-04 (Asia/Bangkok)
Worktree baseline: b933cc9a279d91191d6d7fa8c76f6202fbb68da5
Dependency files and installed packages were not changed during this read-only pass.

## Audit results

| Command | Exit | Result |
|---|---:|---|
| npm audit --json | 1 | 5 High entries, 0 Critical; the 5 entries are one advisory propagated along its dependency chain |
| npm audit --omit=dev --json | 0 | 0 vulnerabilities |
| npm outdated --json | 1 | 11 packages have newer registry versions; see npm-outdated.json |

The sanitized machine-readable outputs are npm-audit-full.json, npm-audit-production.json, and npm-outdated.json. The outdated report omits local absolute paths and replaces the worktree package name with <repo>.

## Vulnerable package path

eslint-config-next@16.3.6 (dev dependency)
→ @next/eslint-plugin-next@16.3.6
→ fast-glob@3.3.1
→ micromatch@4.0.8
→ braces@3.0.3

GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 is High severity (CVSS 8.7). GitHub lists braces <= 3.0.3 as affected and no patched versions. The issue is stack exhaustion / process availability from deeply nested brace patterns. Npm currently resolves braces@3.0.3; braces is development-only through the Next ESLint config chain in this lockfile.

## Upstream fix investigation

- The GitHub Advisory Database entry, last reviewed October 2, lists the affected range as <= 3.0.3 and patched versions as None: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- The npm registry reports braces latest as 3.0.3; the published versions list has no 3.0.4: https://www.npmjs.com/package/braces?activeTab=versions
- npm view eslint-config-next@16.3.8 dependencies --json reports @next/eslint-plugin-next: 16.3.8. npm view @next/eslint-plugin-next@16.3.8 dependencies --json still pins fast-glob: 3.3.1.
- npm view micromatch version versions dist-tags --json reports 4.0.8 as latest; micromatch@4.0.8 depends on braces: ^3.0.3.
- The upstream braces issue for this CVE remains open and reports no fixed release available: https://github.com/micromatch/braces/issues/73

The currently available compatible eslint-config-next@16.3.8 update therefore retains the same vulnerable chain. npm's audit suggestion is eslint-config-next@14.2.35 and marks it as a SemVer-major change; this is a major downgrade and does not provide a patched braces release. It is outside the approved remediation policy. No speculative override or downgrade was applied.

## Decision

Dependency blocker remains open. F12 stays FAIL / F13 NO-GO. The clean production-only audit does not close the frozen acceptance criterion, which requires the full audit to have no High finding. Recheck upstream package and advisory status before any later acceptance decision.
