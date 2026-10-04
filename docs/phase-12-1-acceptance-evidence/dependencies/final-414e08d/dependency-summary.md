# Dependency result for source HEAD 414e08d

Source SHA: 414e08d1689e2a5775f3c34f4ca6fe7010fcf2c7.

npm audit --json reports 5 High / 0 Critical entries, all associated with the same braces advisory through the dependency chain in dependency-path.txt. npm audit --omit=dev --json reports 0 findings. npm outdated --json reports 11 packages.

Vulnerable path:
eslint-config-next@16.3.6 -> @next/eslint-plugin-next@16.3.6 -> fast-glob@3.3.1 -> micromatch@4.0.8 -> braces@3.0.3

A fresh sequential npm view braces versions --json query still ends at 3.0.3. The current GitHub Advisory Database record for GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 still rates the issue High, lists <=3.0.3 as affected, and has no patched versions: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

Upstream patch status has not changed since the previous check. Package manifests and lockfile were not modified.
