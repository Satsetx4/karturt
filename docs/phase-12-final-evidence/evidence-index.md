# F12.2 Final Evidence Index

## Provenance and scope

Product and browser evidence is tied to tested source commit 414e08d1689e2a5775f3c34f4ca6fe7010fcf2c7. Test Gate A passed on that exact SHA in run 37177247556. F12.1 documentation HEAD 2b6a5bb228d8fd2b0f6a9eec3e218d8b7f85e20d passed Test Gate A in run 37177673937.

The Neon evidence targets the development environment, branch karturt-development, database neondb. The F12.1 closure report dates its database evidence 2026-10-04 (Asia/Bangkok); the retained Neon JSON snapshots do not carry per-query timestamps. They are evidence for the tested F12.1 source, not a newly captured audit of the clean integration commit. The closure report separately records the 2026-10-04 read-only follow-up: migration 14 entries ending at 0013, Gate C 32/32 anomaly categories zero, and 11/11 global lifecycle categories zero. The 15/15 fixture checks in the retained post-smoke lifecycle artifact are prior F12.1 smoke evidence; they were not rerun as part of that global follow-up.

Browser and PIN JSON summaries have been reduced to outcome, status, and count fields; fixture IDs, household identifiers, and fixture manifests were excluded. The five screenshots are representative F12.1 acceptance flows.

## Retained files

| File | Evidence retained |
|---|---|
| browser-smoke-summary.json | Authenticated Chairman household list/search/add/edit, resident login, PIN reset/session results, migration preflight, and viewport result count. |
| pin-session-evidence.json | Reset confirmation, double-submit guard, session revocation, old PIN rejection, new PIN login, and credential-safe audit flags. |
| lifecycle-smoke-summary.json | Passing cross-RT access, Treasurer restrictions, interacted-due conflict, same-house replacement, and deactivation scenarios. |
| gate-c-financial-invariants.json | Read-only Gate C result: 32 anomaly categories, zero nonzero findings; migration remains at 0013. |
| neon-lifecycle-audit.json | Read-only lifecycle result and the prior 11 global / 15 fixture zero checks, with fixture inventory details removed. |
| neon-final-summary.json | Aggregate F12.1 Neon result, lifecycle counts, replacement/conflict snapshot counts, and Gate C counts. |
| ci-source-414e08d.json | GitHub CI result for exact tested source SHA 414e08d. |
| ci-f12-1-final-head.json | GitHub CI result for exact F12.1 final documentation HEAD 2b6a5bb. |
| dependency-assessment.md | Narrow dev-tooling advisory assessment and production-only audit interpretation. |
| npm-audit-full.json | Fresh full dependency audit from the clean integration source (2026-10-04): five High entries, zero Critical; all five are the accepted dev-tooling chain. |
| npm-audit-production.json | Fresh production-only dependency audit from the clean integration source (2026-10-04): zero vulnerabilities. |
| household-created-390x844.png | Representative mobile household creation state. |
| pin-reset-success-390x844.png | Representative mobile successful PIN reset state. |
| same-house-replacement-success-390x844.png | Representative mobile same-house resident replacement state. |
| interacted-due-conflict-390x844.png | Representative mobile conflict protection state. |
| household-list-1440x900.png | Representative desktop household management state. |

## Pruning record

The F12.1 source bundle contained 433 files totaling 12,947,409 bytes in the expanded worktree. The clean checkpoint retains 17 curated files (16 evidence artifacts plus this index); the 16 artifacts total 383814 bytes and the curated folder totals 387642 bytes. The superseded bundle is excluded from the integration commit and retained on the F12.1 source branch; it may remain as untracked files in this temporary worktree until worktree cleanup. Compared with the expanded source bundle, the checkpoint omits 416 files totaling 12,559,767 bytes.
