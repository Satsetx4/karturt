# Owner decision + V1 safety gates — 2026-10-24

## Decision record KRT-FAST-TRACK-20261024

**Decision maker:** single human owner, explicit ChatGPT approval on 2026-10-24.  
**Decision:** replace the *mandatory critical-path* Trusted Neon Viewer / Solo Owner custom ledger wiring with a simpler, auditable Staging Identity & Isolation Check and manual owner production GO. Authorize coordinated, autonomous preparatory work from F0 through F4 with minimal repeated human input.

**Why:** near release deadline; prevent prolonged setup/reviewer/token ceremony from consuming time without testing core resident data and financial transaction safety.  
**Tradeoff:** accept reduced *approval provenance assurance* relative to planned custom replay-proof Solo Owner Gate. Compensate through native GitHub protected branch, short-lived least-privileged staging access, exact-SHA CI, real staging TLS/PG18 checks, negative authorization and concurrency tests, sanitized read-only logs, backup/rollback evidence and explicit production owner GO. This is a documented risk/design change, **not** proof of old gate completion.

## Supersession scope (V1 only)

| Prior requirement | V1 Fast Track | Guardrail |
|---|---|---|
| Trusted Neon Viewer token-level effective VIEWER proof | **SUPERSEDED**, not passed | Authenticated staging target identification, provenance, role separation and safe data access still required |
| A4-03.5/.6 writer token-level proof | **DEFERRED** | App stays scoped to ledger; no use of key/token in V1 |
| A4-04 live ticket race/replay and A4-05 integration | **DEFERRED to V1.1** | No live tag writes, no claims of atomic replay control |
| Phase-0 old trusted launcher | **INERT / HISTORICAL** | Do not enable or elevate from `contents:read`; `exit 78` unchanged |
| Old Wave13B.2 F2 FAILED attempts | **PRESERVED as FAIL** | No retry or relabel under this decision |
| Real staging isolation + TLS + PG18 + synthetic fixtures | **REQUIRED** | STOP if target/provenance ambiguous |
| Payment financial invariant and role authorization | **REQUIRED** | Real PostgreSQL concurrency PASS, no double settlement |
| Github exact SHA CI, protected main | **REQUIRED** | Never bypass; scope existing branch policy separately |
| Production release | **REQUIRES SEPARATE OWNER GO** | F0–F4 authority never implies production deploy or production credentials |

## Safety-gate matrix

| Gate | Evidence required | Failure behavior |
|---|---|---|
| G0 Baseline | Current main, candidate source, open PR graph, existing CI actual jobs and skipped tests | Mark UNKNOWN; no arbitrary stack merge |
| G1 V1 App | Correct annual dues, current/arrears-only online request, treasurer future cash, oldest-to-target allocation, paid receipt amount + verification timestamp | FAIL F1 until corrected/tested |
| G2 Authorization | Resident, treasurer and admin policy tests incl. cross-resident/tenant negative cases | FAIL F1/F3 on escape |
| G3 Identity & isolation | Authenticated provider project/branch/endpoint info, independently proven no production-derived contents, Free plan, no production-linked Vercel resources | STOP staging mutation |
| G4 DB transport | TLS identity and PG18 actual DB evidence, correct journal, scoped approved staging access | STOP migration |
| G5 Migration | Guard PASS, staging-only SQL migration, no destructive prod risk, verified synthetic fixture and constraints | Roll back disposable staging, report FAIL |
| G6 UAT | Real HTTPS staging E2E, payment idempotency and actual PostgreSQL concurrency tests `success` (not skipped) | FAIL F3 |
| G7 RC | Exact SHA CI/build, preview smoke, backup restore evidence, documented production runbook and rollback, zero critical defects | F4 BLOCKED / NO-GO |
| G8 Production | Explicit owner GO for exact candidate/environment after F4 PASS | No production activity |

## Minimal owner involvement and authorization boundaries

**Already authorized:** documentation/planning and backlog management; safe source changes on isolated feature branches; draft PRs; CI/negative tests, read-only project inventory and audit; staging-only activities **subject to independent isolation proof, scoped access, and platform/account permission**. Owner need not answer between independent tasks.

**Not blanket-authorized:** production writes, domain cutover, billable resources, secret export or use in PR-controlled contexts, disabling Github branch protection, changing environment reviewer/secret settings, using ledger App key, live A4-04/05, and merging protected main. Where these are essential, issue a *single consolidated owner-action packet* with exact action, risks and safe execution path.

**Provider credential rule:** use protected mechanisms without exposing raw secrets in chat, PR, GitHub issue, trace, logs or code. An authenticated ADMIN Neon connector can inspect metadata for planning but cannot be claimed to be VIEWER. Staging DB access should be narrowly restricted and only after guard PASS.

**Legacy ledger artifacts:** ledger repo `Satsetx4/karturt-solo-owner-ledger` ID 1430124299, bootstrap `7ebdb3399b2f8b99275d5d3423dd71533c8b5fc9`; tag ruleset 25665659 active; App ID 5435164 / installation 174427543 owner-UI evidence. Preserve, do not consume tags, do not pursue token-level check as a V1 blocker.

## Known audit caveats

1. `main` at `96c84588ae0c13f68a17cffd997a3e583fb7da82` on initial assessment; branch is protected. Re-read before any merge/release.
2. PR #74 Gate A `39878766542` attempt 2 SUCCESS at SHA `377d2c17aba4460cd52c2f00c93ad0f84b74ef16`, but independent PG concurrency SKIPPED. Its CI does not prove staging, and PR remains stacked DRAFT.
3. Historical `docs/delivery-readiness-report.md` from 2026-10-05 reports an earlier `PRODUCTION READY` on another SHA and isolated F3 staging. Treat as useful prior evidence **only**, not current V1 readiness. The new Fast Track must reconcile source graph and prove current release candidate.
4. Future cash and annual dues work appears in open draft PR #48/#55/#57 and other unmerged branches. Do not assume these improvements are on `main`.
5. Neon target project `super-band-12770762` is a candidate, not a proven clean root or authorized migration target.

## Decision acknowledgment

**Owner approved policy change and requested execution of work before eventual Codex delegation.** Planning branch / draft PR are to be treated as the portable handoff until formally reviewed and merged. Do not overwrite historical issues with unqualified PASS or close them as completed without proper technical evidence.


## 2026-10-24 owner decision — Functional First

Use [FUNCTIONAL-FIRST-DECISION-20261024.md](FUNCTIONAL-FIRST-DECISION-20261024.md) as the current owner decision and gate interpretation. The latest owner reply authorized creating one Neon Free staging project with default password storage; candidate little-bread-45461401 was provisioned with a root branch that has no parent. This authorization does not permit password retrieval/use or database use. flat-cloud-57657711 is the previous planning target; steep-heart-48842733 remains quarantined and preserved. F2 remains blocked pending content, least-privilege, network/TLS verify-full, and actual Rp0 evidence. P0 must pass; P1 must be fixed; only documented noncritical P2/P3 may be accepted. No further provider mutation, database operation, merge, deployment, or production action is authorized.

## Historical 2026-10-24 owner authorization addendum — exact conditional staging grant

The latest owner grant supersedes the earlier blanket statement that no DB use was authorized, but only for the ordered, guarded staging workflow in [FUNCTIONAL-FIRST-DECISION-20261024.md](FUNCTIONAL-FIRST-DECISION-20261024.md). Exact target: Free project `flat-cloud-57657711`, branch `br-sparkling-flower-azordm9k`, endpoint `ep-red-boat-azzqyf45`. The grant excludes all other Neon projects and production.

Gate result at that checkpoint: Free/$0 and target identity were verified from metadata; the branch was a newly-created root with no parent ID. The tool-created catalog role had `CREATEDB`, `CREATEROLE`, `REPLICATION`, and `BYPASSRLS`; the read-only SQL session reported TLS false. **Privilege and TLS gates failed; F2 stayed BLOCKED.** The SQL tool's empty-catalog output was not accepted as synthetic-only provenance proof. No migrations or downstream phase were authorized. IP Allow remained unchanged because Free availability was not established; no upgrade was used.

At that checkpoint, the owner password was not accessed, displayed, or used, and no production, duplicate-project, Vercel environment, deployment, or main-branch action occurred. A separate owner reply was still pending before removal of the overprivileged role; the later cleanup section records its outcome.

## Owner-authorized role cleanup outcome — 2026-10-24

The owner explicitly approved deleting only `karturt_f2_catalog_ro_20261024`. After confirming it existed on the exact target branch, that role was deleted from project `flat-cloud-57657711` / branch `br-sparkling-flower-azordm9k`; a subsequent role listing confirmed it was absent and showed only the pre-existing `karturt_staging_owner`. This cleanup does not satisfy F2: the earlier role privilege result and `pg_stat_ssl.ssl=false` remain recorded as failed security evidence, data provenance is still unproven, and no further SQL or staging work is authorized by that cleanup. F2 remains BLOCKED; F3 BLOCKED; F4 NO-GO; F5 LOCKED. No owner password was accessed, displayed, or used.
