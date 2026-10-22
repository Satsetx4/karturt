# KartuRT V1 — Sesi 2 Solo Owner Gate A1–A4

**Tanggal:** 2026-10-22 (Asia/Jakarta)  
**Repositori:** [Satsetx4/karturt](https://github.com/Satsetx4/karturt)  
**Branch:** `codex/solo-owner-a1-a4-session2-20261022`  
**Status:** Draft review; all sensitive actions remain blocked.

## Scope and boundaries

This session hardens the phase-0 launcher and adds offline regression cases for issue [#69](https://github.com/Satsetx4/karturt/issues/69). It does not authorize live capture, secrets, SQL/database access, F2, migration, environment or Neon changes, merge, deployment, staging GO, or production GO. The protected workflow must continue to stop with exit 78.

Existing draft PRs were reviewed as dependencies/context:

- [#65](https://github.com/Satsetx4/karturt/pull/65) still refers to the older `wild-darkness-00489132` candidate and its current branch ancestry needs separate review before any merge.
- [#67](https://github.com/Satsetx4/karturt/pull/67) contains the phase-0 inert launcher and offline gate prototypes; this session branch is based on its then-current head.
- [#71](https://github.com/Satsetx4/karturt/pull/71) remains candidate-only and does not authorize a target cutover.
- [#70](https://github.com/Satsetx4/karturt/issues/70) keeps the new Neon project as a candidate; root lineage, synthetic-only proof, Viewer identity and live catalog/TLS checks remain unresolved.

## A1 — Trusted dispatch and SHA provenance

The launcher remains `workflow_dispatch` only and checks the exact repository name/ID, owner ID, protected `refs/heads/main`, event, owner login/ID, triggering owner, first attempt, and exact workflow reference.

The source and launcher are separate bindings:

- `github.sha` is treated as the source SHA of the dispatched protected ref. The dispatch input must equal it; the protected approved source SHA must equal that input.
- `github.workflow_sha` is treated as the launcher SHA. The protected approved launcher SHA must equal it.
- Both SHAs must be full lowercase 40-hex values. The guard does not assume that GitHub's source and workflow-file SHAs are always equal.

Wrong repository/ref/event/actor, an unprotected ref, a rerun, or a SHA mismatch fails before the phase-0 stop. The launcher still performs no checkout or protected data access.

## A2 — Short-lived protected approval

The protected job validates the approved source SHA, launcher SHA, ticket, issued-at timestamp, and expiry. Timestamps are strict UTC seconds; approval cannot be from the future or older than 15 minutes; the approval window cannot exceed 15 minutes. Missing, malformed, stale, future, expired, or mismatched values fail closed.

The ticket remains non-secret audit metadata. A valid ticket/window is not by itself proof of single use.

## A3 — Offline negative regression

The existing offline reservation tests now include wrong repository/owner/actor IDs, unprotected ref, event and rerun rejection, source/launcher SHA mismatch, malformed and stale/future approval timestamps, ticket mismatch, expiry limits, and duplicate reservation attempts. The executable Bash and PowerShell workflow tests exercise the exact embedded guards with local fake inputs; they do not call GitHub, Neon, or PostgreSQL.

A concurrent duplicate test models an atomic create-only store with an in-memory fake. This proves only the mock contract. It is not live race evidence and does not prove a remote store's atomicity, immutability, or writer scope.

## A4 — Single-use authorization: BLOCKED

The existing ledger helper hashes the ticket and attempts a GitHub Contents API create without a `sha` overwrite field. It is not called by the protected workflow. The observed ledger ruleset blocks deletion and non-fast-forward updates, but does not prove append-only behavior or a narrowly scoped writer identity; normal authorized fast-forward edits remain possible. A repository-wide `contents:write` token is not an acceptable substitute.

A true gate must atomically consume a unique ticket digest in a durable store, bind the repository/ref/owner/triggering actor/source SHA/launcher SHA/run ID/attempt/approval interval, and complete consumption before loading any sensitive value. It must fail closed on duplicate/race, outage, permission downgrade, or audit inconsistency. An independently scoped writer or separate trusted transactional service and its live race/replay proof are not available within this session's restrictions.

Therefore A4 is **not implemented as a live security control**. No offline test or static ledger prototype is reported as replay-proof. The workflow remains inert and exits 78.

## Six-stage roadmap after this session

| Stage | Status | Remaining gate |
| --- | --- | --- |
| 1. Source and CI inventory | Partial | Keep PR/base/SHA and exact-head CI evidence current. |
| 2. Solo Owner authorization (A1–A4) | Partial; A1–A3 coded, A4 blocked | Review the implementation; select and verify an atomic durable store with restricted writer scope before sensitive access. |
| 3. Trusted Neon Viewer metadata (Wave C) | Blocked | Secure single-use gate first; then owner-installed Viewer identity and authenticated, exact-target metadata/provenance capture. |
| 4. Cloud PostgreSQL 18 readiness (Wave D) | Blocked | Separate authorization for real direct TLS/channel-binding and bounded read-only catalog checks. |
| 5. Signed staging migration and isolated UAT (Wave E) | Blocked | Fresh exact-SHA readiness PASS, separate signed migration authorization, restore rehearsal and synthetic UAT. |
| 6. Vercel preview and production release | Blocked | Verify approved Vercel target, finish preview/UAT, then obtain explicit production GO. |

No staging readiness PASS or production GO is claimed. F2 remains blocked and must not be retried.
