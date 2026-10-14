# KartuRT V1 Wave 12.6A — Coordinator Report

**Verdict: BLOCKED**

The documentation and read-only review were completed far enough to define a future provisioning request. The packet is not ready to authorize project creation because account-specific free-project capacity and a no-overage/Rp0 cost boundary could not be verified within the approved metadata scope. Wave 12.6B project creation and Wave 13 migration remain unauthorized.

## Locked owner decisions

- Target candidate: one new, independent Neon project in organization **satset** (ID **org-ancient-boat-57106549**), PostgreSQL 18, Singapore region **aws-ap-southeast-1**, Free plan.
- Proposed names: project **karturt-v1-staging-clean**, root branch **staging**, database **karturt_staging**.
- Origin: new independent project; synthetic data only; no copy, clone, import, child branch, snapshot, or restore from any existing project.
- Recovery: **Option 1 — Disposable Rebuild**, from a separately verified clean baseline. A partial or failed instance and sanitized evidence must be preserved. Recreate/delete requires a separate future authorization.
- Existing staging stays preserved and unchanged: project **wild-art-99835126**, branch **br-hidden-cake-a1ge5xqp**, database **karturt_staging** (ID **42079960**), owner role **karturt_staging_owner**, endpoint **ep-snowy-meadow-a10304d9**.
- Source guard remains **stagingIsolationVerifiedEmpty=false**.

## Baseline and workspace verification

| Item | Verified value |
|---|---|
| Repository | Satsetx4/karturt |
| Application source branch | codex/wave12-3-pg18-rehearsal-20261014 |
| Application source SHA / tree | 3bc69c83265dce3a6a0863cbfceea188f40f6168 / f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9 |
| Documentation base branch | docs/wave12-5-recovery-decision-20261014 |
| Documentation base SHA / tree | 01a3e532b258efb1813630cea610f6ab10a14410 / 9c57dbade44b77a72053e3481483a4ba37778a27 |
| Wave 12.5 packet | Five required reports present at docs/wave12-5/2026-10-14/ |

The coordinator and all three agent worktrees were created from the exact documentation base. The shared primary checkout was already on feat/phase-9-payment-reversal with pre-existing untracked phase-9 evidence images; it was not edited or cleaned. The application source SHA and documentation base were verified independently; the application tree was not merged into the documentation branch.

## Evidence and limits

The Wave 12.3 disposable PostgreSQL 18.6 rehearsal at the exact application SHA passed the 14-migration chain and synthetic failure/dump/restore scenarios. Its reported 14 ledger entries and catalog counts (27 tables, 355 constraints, 89 indexes, 53 triggers, 41 functions, 7 enums) apply only to that disposable rehearsal. Wave 12.4’s 26/26 catalog results were schema-clean only for its defined scope on the old target. Neither result proves the new project’s initial state, physical emptiness, lineage, cost, or migration readiness.

The exact-organization Neon read-only lookup showed the organization plan as Free and an aggregate project count of 4. The coordinator's organization fetch unexpectedly included nested project records; no individual record details were used to calculate capacity, and no further project-level reads were made. Agent A separately performed an exact-ID filtered organization lookup that returned organization identity and plan only. No explicit remaining-project quota or account-wide capacity field was exposed.

Neon’s current public pricing page lists Free at $0 and includes 100 projects, 100 CU-hours per project per month, and 1 GB storage per project. The October 2, 2026 Neon update confirms the 100-project Free limit. Those are published plan limits, not proof of this account’s remaining quota, billing configuration, overage behavior, or a guaranteed Rp0 outcome. Therefore:

- **Published Free limit:** 100 projects.
- **Observed aggregate organization count:** 4 projects.
- **Actual available capacity:** **QUOTA NOT VERIFIED**. The simple difference is not accepted as an account-specific remaining quota.
- **No-overage / Rp0 checkpoint:** **NOT VERIFIED**. Do not infer zero cost from the Free plan label alone.

Project creation has material automatic side effects. Neon’s project-creation API documents a connection URI containing a database, password, and role, with at least one password-bearing non-protected role; the provider create-project operation waits for the default compute to become ready. A new project also initializes its branch/database and compute endpoint. Creation can consume compute allowance, so a later request must explicitly authorize those effects and stop if Neon reports a charge, plan change, or unexpected configuration.

## Publication and deployment safety

- The sole workflow at the documentation base is .github/workflows/gate-a.yml. Its push branch filters do not match docs/wave12-6-provisioning-preflight-20261014. It also has a generic pull_request trigger, but this task creates no PR.
- Read-only Vercel metadata for project **karturt-review-staging-20261012** (ID **prj_Mv4rABJvDNAvSD78SVt5WbjFakEq**) reported live=false, latestDeployment=null, no domains, and SSO protection enabled. A scoped deployment-list read returned zero deployments. The project response did not include a linked-repository field. No Vercel setting, deployment, or environment value was changed.
- Publication is limited to the five requested sanitized Markdown files on the non-default documentation branch. No PR, merge, default-branch update, force push, or deployment change is part of this wave.

## Agent and task matrix

| Lane | Required artifact | Scope/result |
|---|---|---|
| Agent A — provisioning specification | [WAVE12_6_AGENT_A_PROVISIONING_SPEC.md](WAVE12_6_AGENT_A_PROVISIONING_SPEC.md) | Proposed manifest, official Free-plan facts, creation effects, quota/cost blocker, and no-copy provenance placeholders. |
| Agent B — verification/recovery | [WAVE12_6_AGENT_B_VERIFICATION_RECOVERY.md](WAVE12_6_AGENT_B_VERIFICATION_RECOVERY.md) | Future ordered read-only proposal, Wave 13 preflight gates, failure-stop recovery, acceptance checklist, permissions matrix. |
| Agent C — security/integration | [WAVE12_6_AGENT_C_SECURITY_INTEGRATION.md](WAVE12_6_AGENT_C_SECURITY_INTEGRATION.md) | Static source review and future fail-closed target, credential, tenant, RLS, and wrapper design; no patch. |
| Coordinator | This report and [owner approval packet](WAVE12_6_OWNER_APPROVAL_PACKET.md) | Baseline audit, metadata review, reconciliation, documentation integration, and publication. |

All lanes are documentation-only. No SQL, connection, compute wake, migration, resource change, credential/access change, source edit, Vercel mutation, or paid action was performed.

## Required next decision

Do not authorize Wave 12.6B yet. First obtain current account-specific capacity and billing/no-overage evidence through an aggregate read-only source that does not expose unrelated project records. After that checkpoint is documented, the owner must make a separate, explicit decision for exactly one new project creation. That decision must not include SQL inspection, role creation, guard/source changes, migration, Vercel deployment, or old-project cleanup unless separately authorized.

## Official references

- [Neon pricing](https://neon.com/pricing)
- [Neon Free plan update, October 2, 2026](https://neon.com/blog/neon-free-plan-1-gb-per-project)
- [Neon Create Project API](https://api-docs.neon.tech/reference/createproject)
- [Neon compute and endpoint model](https://neon.com/docs/manage/endpoints/)
