# Fast Track KartuRT V1 — Kanban / Task control

**Baseline:** 2026-10-24 Asia/Jakarta. **Authoritative coordination:** master [issue #78](https://github.com/Satsetx4/karturt/issues/78), phase issues #79–#83. **Proposed planning PR:** [#84](https://github.com/Satsetx4/karturt/pull/84) (DRAFT, not merged). This file is a snapshot, not an auto-refreshing GitHub Project board. Maintain status in issues after each change; do not assume this static file is live.

| State | Phase/workstream | Issue | Completion condition / blocker |
|---|---|---|---|
| IN_PROGRESS | F0 Coordinator | [#79](https://github.com/Satsetx4/karturt/issues/79) | Read-only baseline recorded; source-vs-PR integration graph, ownership and plan review remain |
| TODO | F1 App + QA | [#80](https://github.com/Satsetx4/karturt/issues/80) | Integrated app features, contracts and exact-SHA tests |
| BLOCKED / safe prep allowed | F2 DB/Staging | [#81](https://github.com/Satsetx4/karturt/issues/81) | Proven synthetic isolation/lineage, proper Free target, actual TLS/PG18 before migrations |
| BLOCKED / safe prep allowed | F3 QA + DB | [#82](https://github.com/Satsetx4/karturt/issues/82) | F1/F2 PASS, staging E2E and **real PostgreSQL concurrency PASS** |
| NO-GO | F4 Release | [#83](https://github.com/Satsetx4/karturt/issues/83) | F1–F3 evidence, full exact-SHA CI, preview and recovery |
| DEFERRED V1.1 | Solo Owner custom ledger/Viewer | [#75](https://github.com/Satsetx4/karturt/issues/75), [#77](https://github.com/Satsetx4/karturt/issues/77) | Preserve security artifacts without V1 release blocking; never declare historical gate PASS |
| NOT AUTHORIZED | Production F5 | [#78](https://github.com/Satsetx4/karturt/issues/78) | Owner's explicit final GO only after F4 PASS |

## Proposed next task queue (atomic; Codex coordinator picks these without further routine approval)

| Priority | Issue / phase | Workstream | Independent safe starting action |
|---|---|---|---|
| P0 | F0 #79 | Coordinator | Map `main` vs all active PR heads; commit small integrated V1 change shortlist |
| P0 | F1 #80 | App | Audit annual billing and current/future transfer eligibility in actual source, test gaps |
| P0 | F1 #80 | QA/Security | Audit real role and financial constraints, receipts and double verification tests |
| P0 | F2 #81 | DB/Staging | Read-only provider candidate + provenance evidence; no SQL or migration until isolation PASS |
| P1 | F1 #80 | App | Implement smallest reviewed fixes and open separate DRAFT PR |
| P1 | F3 #82 | QA/Security | Prepare deterministic PG concurrency harness/fixtures offline; do not claim real PASS |
| P1 | F4 #83 | Release | Audit existing restore/preview evidence and develop current SHA release checklist without modifying production |
| P2 | F2→F4 | Coordinator | Execute phase gates only with real evidence; consolidate any owner action into one packet |

## Work-in-progress and branch policy

- Keep independently edited scopes on isolated branches; one agent owns each file group, no parallel writes to same path.
- Avoid duplicating a task merely because two issue checklists mention related tests.
- All PRs start DRAFT. Exact-SHA CI is necessary but not sufficient: environment and real PG proof are separate.
- Coordinator updates issue checkbox only when related DoD evidence is linked; a green screenshot/mock alone is not enough.
- Refresh this file when an acceptance gate materially changes; GitHub Issues comments hold the live audit history.
- If GitHub Projects kanban mutation tooling becomes available, the coordinator may mirror these columns after ensuring it does not create paid services, but not claim an actual Project board exists now.

## Current six-stage summary

1. Inventory/CI **PARTIAL** — verified protected main and legacy CI, current source feature graph outstanding.
2. Solo Owner Gate **DEFERRED for V1** — not PASS and not erased.
3. Staging Identity/Isolation **BLOCKED** — unknown lineage/synthetic-only state.
4. PostgreSQL18/migration **BLOCKED** — real TLS/catalog + migration not proven.
5. Staging UAT/RC **NO-GO** — real PG concurrency not yet run on current target.
6. Preview/Production **NO-GO** — production always requires owner GO.

**Owner involvement target:** 1 consolidated access/authorization packet if a genuine external blocker exists; 1 final production GO/NO-GO decision. No guarantee that platform security verification can be automated.
