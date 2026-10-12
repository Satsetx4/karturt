# KartuRT V1 — Live Execution Kanban (Codex)

**As-of:** 12 Oct 2026 WIB. **Canonical issue board:** [#25](https://github.com/Satsetx4/karturt/issues/25). **Legacy canonical roadmap:** [#17](https://github.com/Satsetx4/karturt/issues/17). **Detailed playbook:** [v1-codex-execution-plan.md](v1-codex-execution-plan.md). **Documentation PR:** [#24](https://github.com/Satsetx4/karturt/pull/24).

> Source of truth = individual GitHub issue status prefix; this Markdown is an initial SNAPSHOT. Coordinator must refresh after every wave. NO CODEX EXECUTION OR TASK DELEGATION has been claimed at time of creation.

## Kanban counters

| BACKLOG | READY | IN PROGRESS | REVIEW/VERIFY | BLOCKED | DONE | TOTAL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 7 | 0 | 0 | 15 | 0 | 22 |

**WIP hard cap: 3 cards.** First dispatch three READY cards in distinct scopes: Release [V1-101](https://github.com/Satsetx4/karturt/issues/26), Infrastructure [V1-102](https://github.com/Satsetx4/karturt/issues/27), QA [V1-105](https://github.com/Satsetx4/karturt/issues/30). Mark IN PROGRESS only after actual agent accepts. Never mark a READY issue DONE before independently verifying evidence.

## Full task matrix

| Card | Status | Wave | Responsible | Dependencies | Short task |
| --- | --- | --- | --- | --- | --- |
| [V1-101 #26](https://github.com/Satsetx4/karturt/issues/26) | **READY** | Wave 0/1 Preparation | Release A. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Audit dampak merge main ke Vercel lama |
| [V1-102 #27](https://github.com/Satsetx4/karturt/issues/27) | **READY** | Wave 0/1 Preparation | Infrastructure B. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Preflight jalur staging Preview & HTTPS origin |
| [V1-103 #28](https://github.com/Satsetx4/karturt/issues/28) | **READY** | Wave 0/1 Preparation | Infrastructure B. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Siapkan eksekusi CLI migrasi yang aman |
| [V1-104 #29](https://github.com/Satsetx4/karturt/issues/29) | **READY** | Wave 0/1 Preparation | Release A. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Review keamanan PR integrasi & latest CI |
| [V1-105 #30](https://github.com/Satsetx4/karturt/issues/30) | **READY** | Wave 0/1 Preparation | QA C. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Siapkan fixture satu RT + manifest sintetis |
| [V1-106 #31](https://github.com/Satsetx4/karturt/issues/31) | **READY** | Wave 0/1 Preparation | QA C. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Siapkan paket uji Android & iPhone pemilik |
| [V1-107 #32](https://github.com/Satsetx4/karturt/issues/32) | **BLOCKED** | Wave 2/3 Staging | Infrastructure B. **Depends on:** 103. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 103. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Migrasi 14 skema ke Neon staging baru |
| [V1-108 #33](https://github.com/Satsetx4/karturt/issues/33) | **BLOCKED** | Wave 2/3 Staging | QA C. **Depends on:** 105,107. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 105,107. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Bootstrap satu RT sintetis secara resmi |
| [V1-109 #34](https://github.com/Satsetx4/karturt/issues/34) | **BLOCKED** | Wave 2/3 Staging | Infrastructure B. **Depends on:** 102,107. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 102,107. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Deploy PR #23 ke Preview SSO hingga READY |
| [V1-110 #35](https://github.com/Satsetx4/karturt/issues/35) | **BLOCKED** | Wave 4 Browser & Recovery | QA C. **Depends on:** 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Uji browser auth, role dan tenant DENY |
| [V1-111 #36](https://github.com/Satsetx4/karturt/issues/36) | **BLOCKED** | Wave 4 Browser & Recovery | QA C. **Depends on:** 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Uji billing, pembayaran dan ledger nyata di staging |
| [V1-112 #37](https://github.com/Satsetx4/karturt/issues/37) | **BLOCKED** | Wave 4 Browser & Recovery | QA C. **Depends on:** 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 108,109. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Uji WhatsApp manual, PWA dan responsivitas |
| [V1-113 #38](https://github.com/Satsetx4/karturt/issues/38) | **BLOCKED** | Wave 4 Browser & Recovery | Infrastructure B. **Depends on:** 107,108. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 107,108. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Latihan backup/restore sintetis & rollback DB |
| [V1-114 #39](https://github.com/Satsetx4/karturt/issues/39) | **BLOCKED** | Wave 5 Owner devices | Owner. **Depends on:** 106,110,111,112. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 106,110,111,112. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Android Chrome — uji perangkat fisik pemilik |
| [V1-115 #40](https://github.com/Satsetx4/karturt/issues/40) | **BLOCKED** | Wave 5 Owner devices | Owner. **Depends on:** 106,110,111,112. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 106,110,111,112. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | iPhone Safari — uji perangkat fisik pemilik |
| [V1-116 #41](https://github.com/Satsetx4/karturt/issues/41) | **BLOCKED** | Wave 6 Merge | Release A. **Depends on:** 101,104,110,111,112,113,114,115. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 101,104,110,111,112,113,114,115. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Final pre-merge gate dan rollback packet |
| [V1-117 #42](https://github.com/Satsetx4/karturt/issues/42) | **BLOCKED** | Wave 6 Merge | Integrator. **Depends on:** 116. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 116. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Merge terkendali hanya PR #23 |
| [V1-118 #43](https://github.com/Satsetx4/karturt/issues/43) | **READY** | Owner decisions preparation | Release A. **Depends on:** —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | —. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Siapkan owner decision packet production Single RT |
| [V1-119 #44](https://github.com/Satsetx4/karturt/issues/44) | **BLOCKED** | Wave 7–9 Production & Pilot | Infrastructure B. **Depends on:** 117,118,OWNER-PRODUCTION-GO. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 117,118,OWNER-PRODUCTION-GO. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Production setup setelah GO terpisah |
| [V1-120 #45](https://github.com/Satsetx4/karturt/issues/45) | **BLOCKED** | Wave 7–9 Production & Pilot | QA + Owner. **Depends on:** 119,OWNER-F4-GO. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | 119,OWNER-F4-GO. **Product:** V1 SINGLE OPERATIONAL RT; multi-RT customer UX is V2. | Pilot 5–10 rumah tangga dengan consent |
| [V1-121 #46](https://github.com/Satsetx4/karturt/issues/46) | **BLOCKED** | Wave 7–9 Production & Pilot | QA + Owner. **Depends on:** 120,OWNER-F5-GO. **Scope:** V1 ONE operational RT. | 120,OWNER-F5-GO. **Scope:** V1 ONE operational RT. | Rollout satu RT penuh setelah pilot PASS |
| [V1-122 #47](https://github.com/Satsetx4/karturt/issues/47) | **BLOCKED** | Wave 7–9 Production & Pilot | Coordinator + Owner. **Depends on:** 119,120,121. **Scope:** V1 ONE operational RT. | 119,120,121. **Scope:** V1 ONE operational RT. | Handover F6, monitoring F7 dan final acceptance |

## Columns at checkpoint

### READY (7)
- [V1-101 — Audit dampak merge main ke Vercel lama](https://github.com/Satsetx4/karturt/issues/26)
- [V1-102 — Preflight jalur staging Preview & HTTPS origin](https://github.com/Satsetx4/karturt/issues/27)
- [V1-103 — Siapkan eksekusi CLI migrasi yang aman](https://github.com/Satsetx4/karturt/issues/28)
- [V1-104 — Review keamanan PR integrasi & latest CI](https://github.com/Satsetx4/karturt/issues/29)
- [V1-105 — Siapkan fixture satu RT + manifest sintetis](https://github.com/Satsetx4/karturt/issues/30)
- [V1-106 — Siapkan paket uji Android & iPhone pemilik](https://github.com/Satsetx4/karturt/issues/31)
- [V1-118 — Siapkan owner decision packet production Single RT](https://github.com/Satsetx4/karturt/issues/43)

### IN PROGRESS (0)
No cards.

### REVIEW/VERIFY (0)
No cards.

### BLOCKED (15)
- [V1-107 — Migrasi 14 skema ke Neon staging baru](https://github.com/Satsetx4/karturt/issues/32)
- [V1-108 — Bootstrap satu RT sintetis secara resmi](https://github.com/Satsetx4/karturt/issues/33)
- [V1-109 — Deploy PR #23 ke Preview SSO hingga READY](https://github.com/Satsetx4/karturt/issues/34)
- [V1-110 — Uji browser auth, role dan tenant DENY](https://github.com/Satsetx4/karturt/issues/35)
- [V1-111 — Uji billing, pembayaran dan ledger nyata di staging](https://github.com/Satsetx4/karturt/issues/36)
- [V1-112 — Uji WhatsApp manual, PWA dan responsivitas](https://github.com/Satsetx4/karturt/issues/37)
- [V1-113 — Latihan backup/restore sintetis & rollback DB](https://github.com/Satsetx4/karturt/issues/38)
- [V1-114 — Android Chrome — uji perangkat fisik pemilik](https://github.com/Satsetx4/karturt/issues/39)
- [V1-115 — iPhone Safari — uji perangkat fisik pemilik](https://github.com/Satsetx4/karturt/issues/40)
- [V1-116 — Final pre-merge gate dan rollback packet](https://github.com/Satsetx4/karturt/issues/41)
- [V1-117 — Merge terkendali hanya PR #23](https://github.com/Satsetx4/karturt/issues/42)
- [V1-119 — Production setup setelah GO terpisah](https://github.com/Satsetx4/karturt/issues/44)
- [V1-120 — Pilot 5–10 rumah tangga dengan consent](https://github.com/Satsetx4/karturt/issues/45)
- [V1-121 — Rollout satu RT penuh setelah pilot PASS](https://github.com/Satsetx4/karturt/issues/46)
- [V1-122 — Handover F6, monitoring F7 dan final acceptance](https://github.com/Satsetx4/karturt/issues/47)

### DONE (0)
No cards.

### BACKLOG (0)
No cards.


## Evidence and update protocol

- At kickoff, verify branch/main SHA, PR #23/#24, protected ruleset, Vercel main→production deployment risk, exact staging resources. Never create more resources.
- Agent must document SHA, worktree/branch, commands, tests, CI, staged project IDs (no URL password), synthetic manifest and environment isolation; report PASS, REVIEW, BLOCKED or FAIL. Do not treat preparations as tests.
- Coordinator updates each task title **and** this table/board/legacy #17 after independently reviewing proof. Keep 0–3 simultaneously IN PROGRESS and avoid overlaps in writable DB fixtures or files.
- Owner executes real physical Android/iPhone tasks V1-114/115 only after protected READY Preview/browser gates. Production tasks V1-119–122 require distinct explicit production/F4/F5 owner GO.
- PR #23 stays draft/unmerged until whole M0 gate PASS; PR #24 also stays unmerged if GitHub main triggers old Vercel production.
- Multi-RT UX onboarding/switching is V2 deferred; retain `rtUnitId` and negative cross-RT security tests. Single operational synthetic staging RT only.
- Rp0 hard stop. No mutations to production, existing demo, F3/UAT, real residents, DNS or WhatsApp sending.

## Parallel wave dispatch

W0: Agent A V1-101; Agent B V1-102; Agent C V1-105.  
W1: Agent A V1-104; Agent B V1-103; Agent C V1-106.  
W2: Agent A V1-118 decision packet; Agent B V1-107 migrations; Agent C prepare or (once migrated) execute V1-108.  
W3: Agent B V1-109 protected Preview; Agent C V1-108 fixture.  
W4: V1-110, V1-111, V1-112 browser QA with serialized financial writes and V1-113 backup/restore.  
W5: Owner V1-114 and V1-115 physical devices; agent verifies provided redacted evidence.  
W6: V1-116 final gate; if PASS, V1-117 conditional one-time merge.  
W7–9: Distinct owner GO for V1-119, V1-120 and V1-121; V1-122 ops handover and final signoff.

**Completion definition:** Code merge is not V1 done. Only after single-RT production + pilot + full-RT rollout + F6/F7 operations evidence and owner signoff, mark V1 COMPLETE.
