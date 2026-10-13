# Wave 9 KartuRT V1 — Owner Action and Decision Packet (C01–C08)

**Status per 13 October 2026 (Asia/Bangkok): BLOCKED / NO-GO** for Vercel Preview, merge/publication, Neon staging, and Demo/F3/production actions. This packet prepares owner decisions from existing evidence. It is not authorization to change settings, create resources, connect to a database, publish, or deploy.

## Decision record

| Gate | Current result | Decision needed from owner |
|---|---|---|
| Demo/F3 deployment safety | **BLOCKED — current project settings and aliases unverified** | Review a fresh, identity-matched Vercel dashboard evidence set for both projects; choose to keep the paths closed or request a separate, narrowly scoped configuration change. |
| Rp0 / quota / no-overage | **BLOCKED — no current account-specific proof** | Billing owner supplies current usage, included limits, remaining headroom, billing behavior at limits, and written confirmation for the exact proposed workload. |
| Neon target and connection safety | **BLOCKED — no eligible target identified** | Keep work local, or later nominate an already-existing target whose lineage, emptiness, isolation, access, and Rp0 are independently proven. The recorded `parent-data` branch is ineligible. |
| Exact-SHA CI, Preview, and publication | **BLOCKED — no Wave 9 final integrated SHA or owner GO is recorded here** | Review the final coordinator report, then decide separately on exact-SHA CI/push, a protected Preview, PR #23 merge, and any production/Demo/F3 publication. |
| Rollback | **BLOCKED — written steps exist, but no healthy target or drill is verified** | Identify the presently serving healthy deployment and prove a cost-safe code and data recovery path before any publication. |

**Recommended immediate choice:** remain local-only and keep every cloud/provider gate closed. This preserves Rp0 and the existing Demo/F3/production state while Wave 9 closes local security and recovery evidence. Any later cloud action needs its own explicit owner GO after the evidence below is complete.

## Baseline and evidence freshness

The requested Wave 9 checkout is branch `codex/w9-agent-c-20261013` at the Wave 8 baseline SHA `6aa044e37f8d0020562a99ebfdc56c03e1d86eb5`, parent `34a2af3195a09220a6639bdcb2aff369a813d5c2`. This is a local planning baseline; it is not a release candidate declaration. The coordinator must replace it with the final integrated SHA and tree before evaluating any later gate.

| Evidence | Dated finding | What it proves and what remains unknown |
|---|---|---|
| [Issue #17, comment 6140163688](https://github.com/Satsetx4/karturt/issues/17#issuecomment-6140163688) | Wave 8 coordinator checkpoint, 13 Oct 2026 | Local Wave 8 candidate was `6aa044e…`; local lint/typecheck/full suite/build/schema checks passed; PostgreSQL races were blocked because no local engine was available; dependency audit retained five HIGH findings. The report explicitly kept Preview, merge/publication, Neon, and Demo/F3/production at NO-GO. |
| [Issue #25, comment 6140161055](https://github.com/Satsetx4/karturt/issues/25#issuecomment-6140161055) | Wave 8 detailed report, 13 Oct 2026 | Confirms no push, merge, deployment, Neon operation, resource creation, DNS/provider mutation, or WhatsApp send. It states that Wave 8 C consolidated dated records rather than performing a current provider readback. |
| [Wave 8 Lane C packet](./W8-C01-C08-owner-decision-packet-2026-10-13.md) | Prepared 13 Oct 2026 from Wave 7 and Wave 6 evidence | Prior Vercel values, aliases, plan labels, and Neon metadata are historical. Current triggers, aliases, production branch, usage, headroom, and safe staging remain unknown. |
| [Wave 6 Lane C packet](./W6-C-owner-decision-packet-2026-10-13.md) | Provider snapshot 13 Oct 2026, 05:06:45–05:10:19 UTC | Records resource identities and old states below. It is not current proof and must not be treated as a present-day readback. |

No Vercel or Neon API, dashboard, database, or provider was accessed by this Wave 9 Lane C work. The instructions below are an owner capture checklist, not new provider findings.

### Engineering residuals carried from Wave 8

These are the Wave 8 report's dated findings, pending coordinator recheck on the final integrated Wave 9 SHA: five HIGH development-tool dependency findings remained unresolved; PostgreSQL concurrency did not run because no local engine was available; lint had two warnings in untouched files; and one diagnostic invocation called `loadEnvConfig(process.cwd())` before its environment guard, so local env files may have been loaded (the report says no values were printed, copied, or used to connect). Wave 9 Agent A is assigned to close the environment-loader issue and Agent B to reassess disposable PostgreSQL/recovery and dependencies. This packet does not claim those new tasks passed. If any risk remains after Wave 9, it stays an engineering stop gate.

## C01–C03 — Vercel Demo/F3 identity, triggers, Ignore Build Step, and aliases

### Historical identifiers and risk

The Wave 6 snapshot recorded these project identities. Verify the ID in the dashboard before relying on any screenshot; a project name alone is insufficient.

| Project | Historical ID | Historical observation only |
|---|---|---|
| Demo `karturt-demo-20261006` | `prj_iI7jxoyFgnoNZNnQngj1vB6fRgAv` | Wave 6 readback reported `live=false`, latest deployment `CANCELED` with `target=null`, and a separate canceled production-target record. Wave 7 later summarized the most recent Demo/F3 candidate as canceled. Current production branch, Git trigger, Ignore Build Step, and aliases were not established. |
| F3 `karturt-f3-staging` | `prj_OgnBy1d7z2beP8wQHRowF0yJc3PU` | Wave 6 recorded alias `main` pointing to deployment `dpl_4EhE94BV5P8p2r3Btb1znPqJH55B`, a canceled `main` deployment at SHA `96c84588ae0c13f68a17cffd997a3e583fb7da82` with production target. Wave 7 reported the same concern. Whether the alias still exists or resolves to a live target is **unknown**. |

A canceled deployment, `target=null`, or `live=false` does not establish that a future commit cannot deploy or move a domain. No current target or rollback deployment is confirmed. Treat any existing `main` to production behavior as a possible side effect until the owner reads it back.

### Owner evidence to capture

Use the Vercel team switcher to select the account/team that owns each exact project ID. Capture dated screenshots or exports with the local time and UTC time, project name and ID visible, and no secrets or environment-variable values. Use the same checklist separately for Demo and F3:

1. **Project identity and environment settings:** project overview or General page with project ID; `Settings → Environments → Production → Branch Tracking` (or the current dashboard equivalent) with the exact Production Branch; Preview/Production environment scopes and protection state. Record whether `main` or another branch is production.
2. **Git connection and trigger:** `Settings → Git` and any deployment controls visible there. Capture linked repository `Satsetx4/karturt`, automatic Git deployments enabled/disabled, production branch, Preview branch behavior, and any branch-specific exclusions. State explicitly what a push to the candidate branch and a merge to `main` would trigger.
3. **Ignored Build Step:** `Settings → Build and Development Settings` (or current equivalent), showing the exact Ignored Build Step command and whether it is configured. Compare it against `vercel.json` at the exact candidate SHA, including `ignoreCommand`; do not infer that a dashboard value wins over repository configuration. Record expected behavior for the candidate branch and `main` from the exact source/configuration. Do not test the behavior with a push or redeploy.
4. **Deployment records:** `Deployments` list plus detail pages for the latest deployment, latest production-target deployment, candidate/SHA deployment if one exists, and the last known healthy deployment. Capture deployment ID, state, target, branch, commit SHA, and timestamp. A canceled record is not a rollback target.
5. **Domains and aliases:** `Settings → Domains` and the deployment alias view. Create a redacted table of every assigned domain/alias → deployment ID → branch → SHA → target → state. Specifically resolve whether `main` is still assigned to any production domain in F3. Do not alter domain or alias assignments.
6. **Preview access:** show SSO/access protection and environment-variable *scope names* for Preview; redact values. Confirm a Preview cannot inherit production secrets or receive production traffic/data. If protection or scoping cannot be demonstrated, Preview remains blocked.
7. **Rollback target:** identify the current healthy deployment that actually serves each intended domain, and capture its deployment ID, SHA, target, and alias mapping. The owner must verify it is healthy and restorable; a historical or canceled production record does not qualify.

Vercel documentation describes production deploys on pushes/merges to the configured Production Branch, and says a `vercel.json` `ignoreCommand` overrides the dashboard's Ignored Build Step. Under that documented behavior, an ignore command returning exit code `0` skips a build, while exit code `1` continues the build. Therefore, a prior “Ignored Build Step” success is containment evidence for that invocation only; it is not proof that all triggers, aliases, project settings, or merge effects are safe. See [Git deployments](https://vercel.com/docs/git) and [`ignoreCommand`](https://vercel.com/docs/project-configuration/vercel-json) (checked 13 Oct 2026).

**Vercel owner choice and consequence:**

| Choice | Consequence |
|---|---|
| Keep Demo/F3 closed and unchanged | Recommended now. No deployment or provider mutation; no V1 Preview/publication. Continue local-only work. |
| Request a specific trigger/branch/alias change | Requires a separate owner authorization naming the exact project ID, old value from the screenshot, new value, expected trigger effect, cost proof, and verified rollback. This packet performs no change. |
| Reopen a protected Preview for an exact SHA | Requires every Vercel and Rp0 prerequisite above, a safe Neon or local-only test scope as applicable, exact-SHA CI, and a separate explicit GO for that Preview. It does not authorize merge or production/Demo/F3 publication. |

If the project ID does not match, Production Branch is unreadable, main can trigger production unexpectedly, aliases conflict, or protection cannot be shown, keep that project **BLOCKED** and stop.

## C04 — Rp0, included quota, headroom, and overage proof

Wave 6 returned `404 costs_not_found` for Vercel billing charges, no commitment rows, and a `Hobby` plan label. Neon metadata showed `free_v3` plus usage counters. Wave 7 and Wave 8 explicitly say these do not establish a zero-cost action, remaining quota, or no-overage ceiling. No candidate cloud build was run. Therefore **no current Rp0 claim exists**.

Before any proposed Preview or staging resource, the billing owner should capture the following from the exact Vercel team and Neon organization/project. Include screenshot timestamps and billing-cycle boundaries; show units and reset time. Do not expose payment credentials or secrets.

| Service/view | Evidence required for the exact proposed workload |
|---|---|
| Vercel team → Billing/Usage | Current cycle and trailing 30-day usage for each build/runtime/resource metric the candidate can consume; included amount; consumed amount; remaining headroom; reset time; projected usage for the named candidate, expected duration, and test traffic. Include Demo/F3 project usage where separable. |
| Vercel plan and spend controls | Current plan and applicable allowances; whether additional usage, add-ons, or overage charges can accrue; the current spend/usage limit setting and whether it blocks consumption or only alerts. A plan label or alert is not a hard Rp0 cap. |
| Neon organization/project → Billing/Usage | Exact organization and project; current cycle usage by compute, storage, transfer, branch, and restore metric as applicable; included limits; remaining headroom; reset time; billing model and behavior when limits are reached; organization spend limit and whether it enforces a stop. Do not wake or connect to the old endpoint to get usage. |
| Billing-owner attestation | A dated written statement that the *named exact SHA and bounded actions* (CI, Preview build, test duration/traffic, database runtime) produce **Rp0 additional cost and no overage** under the displayed allowances/settings. Name the person authorized to confirm billing. |

If any relevant metric, account linkage, billable behavior, headroom, or no-overage control is missing or ambiguous, mark **Rp0 BLOCKED** and do not request cloud execution. Usage and plan features can change; capture them immediately before a later decision. Vercel's current billing references include [Pricing and billable resources](https://vercel.com/docs/pricing), [Manage and optimize usage](https://vercel.com/docs/pricing/manage-and-optimize-usage), and [Spend Management](https://vercel.com/docs/pricing/spend-management) (checked 13 Oct 2026). Neon's 24 Apr 2026 [organization spending-limits announcement](https://neon.com/blog/introducing-organization-spending-limits) says the currently described behavior is alerts and project suspension was still marked forthcoming at publication; an alert alone must not be treated as an enforced Rp0 cap. Re-read current billing details before any future decision.

**Owner cost choice and consequence:**

- **Rp0 not proven:** no cloud Preview, CI build that can invoke Vercel, resource creation, Neon compute, or staging migration.
- **Rp0 proven only for a named bounded action:** owner may consider a separate GO for that action only. It does not carry over to another SHA, duration, project, provider, or phase.

## C05 — Neon staging choice, verified emptiness, and safe access

### Existing branch: explicitly ineligible

The dated Wave 6 metadata snapshot recorded project `ancient-smoke-51787007` (`karturt-review-staging-20261012`) and branch `br-dry-block-b3fsqjo3` (`staging-empty`) with `init_source=parent-data`, `primary=true`, `default=true`, `protected=false`; logical size `31,686,656` bytes and zero written bytes; public connections allowed, IP allowlist empty, endpoint `ep-raspy-meadow-b3ppifq6` idle and passwordless. The parent lineage and inherited contents were not shown. Zero writes and an idle endpoint do not prove emptiness.

**Do not connect to, wake, query, run `db:check` against, migrate, reset, or otherwise inspect that branch to establish emptiness.** Do not use it for V1 staging. The name `staging-empty` is not evidence.

### Choices available without crossing current boundaries

| Choice | Status and consequence |
|---|---|
| Continue with local disposable PostgreSQL or PGlite using synthetic data | Only current path consistent with this Wave 9 authorization and Rp0. It supports local code evidence only; it does not prove Neon, cloud Preview, browser-from-provider, or device acceptance. Coordinator must report which runtime actually ran. |
| Reuse a pre-existing Neon target | Consider only if the owner can prove project/branch identity, complete lineage to a known empty/synthetic-only source, absence of production/resident data, no untrusted `parent-data`, isolated access, and Rp0 for the exact test. No eligible target is currently recorded. Any access/wake/query needs a later separately scoped authorization. |
| Create a new Neon project/branch | **Not permitted in Wave 9.** It is a cloud resource and could incur cost. It needs a separate explicit owner decision after account-specific Rp0 proof and a reviewed plan for an empty synthetic-only source. |

Before an already-existing candidate is reconsidered, the owner packet must contain: a non-secret screenshot of project and branch IDs, parent/child lineage and branch flags; documented source provenance proving empty/synthetic-only content; public access and IP allow settings; passwordless-access setting; role/credential scope (never the secret value); and exact billing evidence. Candidate access must use a dedicated least-privilege database identity, Preview-only environment scope, and a runtime guard pinned to the approved project/branch/database. No production credential or resident data may be used. Require network restriction where supported, and record any plan requirement or additional cost before considering it. Neon states that a branch inherits its parent's schema and data, so an unknown `parent-data` lineage cannot be assumed empty; see [branching workflow primer](https://neon.com/docs/get-started-with-neon/workflow-primer) and [branch protection guidance](https://neon.com/blog/restrict-access-to-the-production-branch) (checked 13 Oct 2026).

## C06 — Future exact-SHA CI, Preview, and publication sequence

This is a future gated sequence only. **No push, CI dispatch, Preview, merge, publication, or deployment is authorized by Wave 9.** The coordinator must fill in the final integrated SHA/tree and exact check evidence after the Wave 9 local lanes complete; `6aa044e…` is only the starting baseline.

1. **Finish local integration:** record one exact final SHA and tree; verify bundle/recovery state, security/environment preflight, lint, typecheck, full regression, two builds, isolated Drizzle/schema checks, dependency audit, and PostgreSQL races only if a safe disposable local engine is available. Retain exit codes and distinguish NOT RUN/BLOCKED from PASS. Do not call a local check GitHub CI or provider acceptance.
2. **Check GitHub state immediately before any future CI/push request:** verify PR #23's exact head/base/state and checks; PR #23 remains the sole future controlled main integration draft. PR #56 remains comparison-only and cannot substitute. No alternate main path or cherry-pick is implied. A GitHub Actions run must report the exact final SHA and completed successful required jobs. Check GitHub rules/protection and the possible side effects of any connected Vercel projects before causing a push or merge.
3. **If separately authorized, run exact-SHA CI:** request only the named commit/branch/check run after confirming the trigger cannot publish to Demo/F3/production and billing owner proves Rp0 for that workload. Compare the run's commit SHA with the reviewed final SHA. A missing, skipped, canceled, stale, or different-SHA job is not PASS.
4. **If separately authorized, run one protected Preview:** after Vercel identity/trigger/alias evidence, Rp0 proof, and a verified synthetic-only isolated database target, request Preview for the exact SHA. Confirm the resulting deployment's source SHA, Preview target, protected access, environment scope, and non-production hostname before opening it. Do not promote aliases or run migrations until separately authorized and the restore path is proven. If a database is not available safely, Preview/runtime remains blocked.
5. **Review Preview evidence by layer:** CI, deployment state, database, runtime/browser, device, cost, and governance each need their own evidence. A build success does not prove database isolation or release readiness. Owner records findings and any remaining block.
6. **Separate owner decisions:** a later GO must name exact SHA and one action: (a) Preview, (b) merge PR #23, or (c) specified production/Demo/F3 publication. One GO does not authorize the next. Before PR #23 merge, verify no production side effect will occur without authorization. Demo presentation is closed in the current Wave 8 checkpoint; do not revive Demo-only product scope.

Until then, every row above remains a plan, not an executed action. In particular, there is no claim of Preview READY, merge readiness, publication readiness, or release readiness.

## C07 — Rollback evidence and stop conditions

Wave 8 reports only a written rollback procedure. A live healthy rollback deployment, tested restore, and rollback drill are not evidenced. Before a future publication decision, capture the active domain-to-deployment map and confirm a healthy previous deployment is still available and can be reassigned without a new billable build. Do not use a canceled deployment as the rollback target. For any database mutation, separately prove a synthetic backup/restore path and Rp0; alias rollback cannot restore database writes.

If an authorized future publication behaves unexpectedly, the owner/operator must stop additional builds and promotions, preserve deployment and alias records, restore only to the previously verified healthy target using the authorized procedure, and separately assess database recovery. Do not delete or recreate projects, branches, aliases, or data to make the incident disappear. If rollback requires new resource spend, unknown credentials, untested migration recovery, or an unverified target, stop and request a new owner decision.

**Hard stop if any of these occur:**

- Project, team, GitHub repository, branch, or candidate SHA does not match the evidence packet.
- Production Branch, Git trigger, Ignore Build Step/`ignoreCommand`, environment scope, or alias-to-target mapping cannot be read or conflicts across views.
- A push, CI run, or merge could publish to a production/Demo/F3 domain without a separately approved effect.
- Cost evidence is missing, stale for the proposed action, lacks per-metric headroom, or cannot rule out overage.
- A database target has unknown parent lineage/content, public/unrestricted access, passwordless access, production credentials/data, or lacks an approved Rp0 proof.
- Exact-SHA CI is missing, failed, skipped, canceled, or runs a different SHA; unresolved security/dependency or teardown risks remain; or required concurrency did not run.
- There is no verified healthy rollback target, or database recovery has not been proven for the proposed mutation.
- Any unexpected deployment, alias, provider, database, DNS, spend, or resident-data effect appears.

At a stop, make no compensating provider/database mutation. Preserve evidence and ask the owner to decide on a new bounded action.

## C08 — Owner decision form

After reviewing the evidence, the owner can record decisions independently. Blank or unchecked is **NO-GO**.

- [ ] Keep Demo and F3 unchanged and closed; continue local-only work.
- [ ] Request a separate, specific Demo setting change (project ID: ______; old value/evidence: ______; requested new value: ______; rollback: ______).
- [ ] Request a separate, specific F3 setting change (project ID: ______; old value/evidence: ______; requested new value: ______; rollback: ______).
- [ ] Rp0 confirmed for this bounded action/SHA: ______; billing evidence dated: ______; billing owner: ______.
- [ ] Select existing Neon target for separate review (project/branch IDs: ______; lineage evidence: ______; synthetic-only evidence: ______; access proof: ______; Rp0 evidence: ______). This does not authorize connecting or migrating.
- [ ] Authorize exact-SHA CI only (SHA: ______; allowed workflow/run: ______; expected Vercel side effect: ______; cost evidence: ______).
- [ ] Authorize one protected Preview only (SHA: ______; Vercel project ID: ______; Preview hostname: ______; Neon target or local-only scope: ______; rollback: ______).
- [ ] Authorize PR #23 merge only after a separate exact-SHA review (SHA: ______; checks: ______; main/production effects: ______; rollback: ______).
- [ ] Authorize named production/Demo/F3 publication only after a separate review (project/domain: ______; SHA: ______; deployment target: ______; rollback: ______).

Record the owner, date/time in WIB and UTC, exact SHA, evidence URLs/files, selected single action, cost scope, and explicit stop conditions. Any decision to change provider settings, create a resource, access Neon, push source, merge, or deploy remains subject to the separately stated authorization boundary for that action.

## Sources

- [Issue #17 — Wave 8 coordinator checkpoint, comment 6140163688](https://github.com/Satsetx4/karturt/issues/17#issuecomment-6140163688), 13 Oct 2026.
- [Issue #25 — Wave 8 coordinator report, comment 6140161055](https://github.com/Satsetx4/karturt/issues/25#issuecomment-6140161055), 13 Oct 2026.
- [Wave 8 Lane C packet](./W8-C01-C08-owner-decision-packet-2026-10-13.md), a dated consolidation of Wave 7 and Wave 6 evidence; not a current provider readback.
- [Wave 6 Lane C packet](./W6-C-owner-decision-packet-2026-10-13.md), provider snapshot 13 Oct 2026, 05:06:45–05:10:19 UTC; historical only.
- Vercel documentation, reviewed 13 Oct 2026: [Git deployments and Production Branch](https://vercel.com/docs/git), [project configuration and `ignoreCommand`](https://vercel.com/docs/project-configuration/vercel-json), [pricing and usage](https://vercel.com/docs/pricing), [usage management](https://vercel.com/docs/pricing/manage-and-optimize-usage), [Spend Management](https://vercel.com/docs/pricing/spend-management).
- Neon documentation, reviewed 13 Oct 2026: [branching workflow primer](https://neon.com/docs/get-started-with-neon/workflow-primer), [organization spending limits announcement dated 24 Apr 2026](https://neon.com/blog/introducing-organization-spending-limits), [protected branches and network access](https://neon.com/blog/restrict-access-to-the-production-branch).
