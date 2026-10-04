# Dependency comparison: source HEAD bc113ef

Compared against the immediately previous candidate 3034bc5d463d724217d07c892464963f62c44587. Current source HEAD: bc113efcd811f6b3872206e734d1c2e1e57b1346.

The new full npm audit still has 5 High and 0 Critical findings, with the same five reported package entries. The braces finding still references GHSA-vfj7-8cjw-p6xm, titled "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns", affected range <=3.0.3.

The dependency path is unchanged:
eslint-config-next@16.3.6 -> @next/eslint-plugin-next@16.3.6 -> fast-glob@3.3.1 -> micromatch@4.0.8 -> braces@3.0.3

The production-only audit remains 0 findings. No package or lockfile changes were made.
