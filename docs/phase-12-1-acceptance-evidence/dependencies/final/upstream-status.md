# Corrected final dependency registry check

Captured: 2026-10-04 (Asia/Bangkok). Package files were not changed.

The earlier combined-field snapshot associated micromatch versions with the braces versions field. It has been preserved as upstream-registry-checks.superseded.json and is not valid evidence for braces releases. The replacement upstream-registry-checks.json contains isolated sequential queries: npm view braces versions --json, exact braces@3.0.3 version/dist/time metadata, and exact release probes.

The isolated published version list ends at braces 3.0.3. The exact queries npm view braces@3.0.4 version --json, npm view braces@3.0.5 version --json, and npm view braces@3.1.9 version --json each returned exit code 1 with E404. The latest release metadata is braces@3.0.3, published 2024-05-21T08:59:11.390Z, with the tarball and integrity hash recorded in the corrected JSON.

GitHub Advisory Database GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 still lists <=3.0.3 as affected and patched versions as None: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

Together, the isolated npm registry result and advisory state confirm that no patched braces release is available. The dependency blocker remains open under the frozen full-audit no-High policy.
