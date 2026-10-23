# Fast Track KartuRT V1 — Kanban / Task control

**Snapshot refreshed:** 2026-10-24 Asia/Jakarta. **Authoritative coordination:** master [issue #78](https://github.com/Satsetx4/karturt/issues/78), phase issues #79–#83. **Planning PR:** [#84](https://github.com/Satsetx4/karturt/pull/84) remains OPEN/DRAFT and unmerged at `cddf65b0931e59fe667031c579a73f145b0f15c0`; exact-head Gate A run [#40008588753](https://github.com/Satsetx4/karturt/actions/runs/40008588753) passed, while independent concurrency was skipped. This file is a snapshot, not an auto-refreshing GitHub Project board. Maintain live evidence in issues after each change.

| State | Phase/workstream | Issue | Completion condition / blocker |
|---|---|---|---|
| PASS — planning/read-only baseline only | F0 Coordinator | [#79](https://github.com/Satsetx4/karturt/issues/79) | Source integration map and read-only baseline are documented in #84; PR stays OPEN/DRAFT, unmerged |
| PASS — integrated candidate only | F1 App + QA | [#80](https://github.com/Satsetx4/karturt/issues/80) | Candidate PR #93 at `48b21ad3d208c983584fb32618254c9599297c07`; exact Gate A and disposable PostgreSQL 17 concurrency run #40019070722 passed; no main merge |
| BLOCKED before database access | F2 DB/Staging | [#81](https://github.com/Satsetx4/karturt/issues/81) | Provider metadata does not establish synthetic-only contents or effective least privilege/TLS; PR #94 source guard is separate from provider proof |
| BLOCKED — staging unavailable | F3 QA + DB | [#82](https://github.com/Satsetx4/karturt/issues/82) | Requires verified isolated synthetic staging, real PG18 role/payment/authorization UAT, retries and **real PostgreSQL concurrency PASS** |
| IN_PROGRESS / NO-GO | F4 Release | [#83](https://github.com/Satsetx4/karturt/issues/83) | PR #95 exact head `462d9f2153297ac012edac71445ea5c8a455d764`; Gate A #40028520046 in progress; independent review found no P0/P1/P2; Preview, dependency and recovery evidence remain open |
| DEFERRED V1.1 | Solo Owner custom ledger/Viewer | [#75](https://github.com/Satsetx4/karturt/issues/75), [#77](https://github.com/Satsetx4/karturt/issues/77) | Preserve security artifacts without V1 release blocking; never declare historical gate PASS |
| NOT AUTHORIZED | Production F5 | [#78](https://github.com/Satsetx4/karturt/issues/78) | Owner's explicit final GO only after F4 PASS |

## Original six roadmap lanes

| State | Lane | Current evidence |
|---|---|---|
| PASS — candidate only | [#86 Annual resident card + paid receipts](https://github.com/Satsetx4/karturt/issues/86) | Included in integrated candidate PR #93 at `48b21ad3d208c983584fb32618254c9599297c07`; exact Gate A and disposable PostgreSQL 17 concurrency run #40019070722 passed; not merged |
| PASS — candidate only | [#87 Arrears + reports](https://github.com/Satsetx4/karturt/issues/87) | Included in integrated candidate PR #93 at `48b21ad3d208c983584fb32618254c9599297c07`; exact Gate A and disposable PostgreSQL 17 concurrency run #40019070722 passed; not merged |
| PASS — candidate only | [#88 Cash + idempotency](https://github.com/Satsetx4/karturt/issues/88) | Included in integrated candidate PR #93 at `48b21ad3d208c983584fb32618254c9599297c07`; exact Gate A and disposable PostgreSQL 17 concurrency run #40019070722 passed; not merged |
| BLOCKED before database access | [#81 Staging identity + isolation](https://github.com/Satsetx4/karturt/issues/81) | Source guard PR #94 at `9cf7a78d31580245719bfbe4034990c4fb9e15ef` has Gate A run #40023086349 SUCCESS; provider lineage/content, effective role and TLS remain UNKNOWN |
| BLOCKED | [#82 Staging E2E/UAT](https://github.com/Satsetx4/karturt/issues/82) | No independently verified synthetic-only staging target; real PostgreSQL 18 role/payment/retry/concurrency UAT has not run |
| NO-GO | [#83 Release readiness](https://github.com/Satsetx4/karturt/issues/83) | PR #95 exact head `462d9f2153297ac012edac71445ea5c8a455d764`; Gate A run #40028520046 in progress; independent review found no findings; dependency, Preview and current-target recovery evidence remain open |

## Proposed next task queue (atomic; Codex coordinator picks these without further routine approval)

| Priority | Issue / phase | Workstream | Independent safe starting action |
|---|---|---|---|
| P0 | F4 #83 | Coordinator | Complete exact-head CI for #95; record the independent no-findings review and update evidence on #83 |
| P0 | F2 #81 | Owner + Coordinator | Consolidate required target-bound read-only authorization and authoritative synthetic-lineage evidence into one packet; verify Free/Hobby plans and Preview scope |
| P1 | F2 #81 | QA/Security | Finish independent source-guard review for #94; keep provider identity/content UNKNOWN until separately proven |
| P1 | F3 #82 | QA + DB | Prepare deterministic synthetic fixtures and concurrency procedure offline; do not claim staging PASS |
| P1 | F4 #83 | Release | Revisit dependency remediation only when npm policy permits an approved artifact; verify current-target recovery and Vercel Preview after F2 gates pass |
| P2 | F1 #80 | Coordinator | Preserve #93 as candidate PASS; do not merge protected main without separate authorization |
| P2 | F2→F4 | Coordinator | Advance only on objective DoD evidence; consolidate any owner action into one packet |

## Work-in-progress and branch policy

- Keep independently edited scopes on isolated branches; one agent owns each file group, no parallel writes to same path.
- Avoid duplicating a task merely because two issue checklists mention related tests.
- All PRs start DRAFT. Exact-SHA CI is necessary but not sufficient: environment and real PG proof are separate.
- Coordinator updates issue checkbox only when related DoD evidence is linked; a green screenshot/mock alone is not enough.
- Refresh this file when an acceptance gate materially changes; GitHub Issues comments hold the live audit history.
- If GitHub Projects kanban mutation tooling becomes available, the coordinator may mirror these columns after ensuring it does not create paid services, but not claim an actual Project board exists now.

## Current six-stage summary

1. Inventory/CI **PASS for F0 baseline; F1 candidate PASS** — F0 docs/read-only comparison are in #84; integrated F1 candidate #93 has exact Gate A and disposable PostgreSQL 17 CI success. Neither PR is merged.
2. Solo Owner Gate **DEFERRED for V1** — not PASS and not erased.
3. Staging Identity/Isolation **BLOCKED** — project/root metadata do not prove synthetic-only contents or effective least privilege; no database access.
4. PostgreSQL18/migration **BLOCKED** — target-bound identity, TLS and content preflight not authorized/proven; no migration or seed.
5. Staging UAT/RC **BLOCKED** — real PG18 concurrency and end-to-end UAT have not run on a verified isolated target.
6. Preview/Production **NO-GO** — Vercel Hobby/Preview and current-target recovery are unverified; production always requires owner GO.

**Owner involvement target:** 1 consolidated access/authorization packet if a genuine external blocker exists; 1 final production GO/NO-GO decision. No guarantee that platform security verification can be automated.
