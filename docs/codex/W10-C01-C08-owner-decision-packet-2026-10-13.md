# Wave 10 C01–C08 — Owner Infrastructure Decision Packet

**Status: BLOCKED / NO-GO for all cloud, publication, merge, and production gates.** Prepared 13 October 2026 (Asia/Bangkok) from local Wave 10 work and owner-supplied UI evidence. This packet is a decision aid; it does not change provider settings, create resources, connect to a database, publish source, run a Preview, merge, or deploy.

## Decision snapshot

| Gate | Current disposition | Evidence required before a separate owner GO |
|---|---|---|
| Safe source publication | **NO-GO** | Exact proposed SHA and remote branch; identity-matched Demo/F3 trigger and alias readback; exact-workload Rp0 evidence; confirmation that a push cannot cause an unapproved deployment. |
| Isolated staging creation/use | **NO-GO** | Named project and branch; proven empty/synthetic-only source and full lineage; access restrictions and role scope; exact-workload Rp0 proof. The previously reported parent-data branch is ineligible. |
| Protected Preview | **NO-GO** | Exact SHA and Vercel project ID; protected Preview URL/access; Preview-only environment scope; safe isolated database choice; no production domain mapping; Rp0 proof. |
| PR #23 controlled merge | **NO-GO** | Final Wave 10 SHA, completed-successful required CI on that exact SHA, PR #23 head/base/state, verified merge effects and rollback. PR #56 remains comparison-only. |
| Production | **NO-GO** | Separate production acceptance, exact deployment SHA/domain, account-specific cost proof, owner operational acceptance, and verified code plus data recovery. |

Blank or unchecked means **NO-GO**. Each GO below covers one named action only; it does not authorize the next gate.

## Evidence boundary and current checkpoint

The Wave 9 checkpoint in [Issue #17, comment 6141597355](https://github.com/Satsetx4/karturt/issues/17#issuecomment-6141597355) records branch codex/wave9-integration-20261013 at local candidate 91fcdffb213ed842f6573190283495b554e27725, tree 9298f5b3c18a1c9643b8fb809761d46f7152f2e3. It reports local recovery and repeatability evidence, but also leaves the direct bare next build environment-loading path partially open, the five independent PostgreSQL races not run, and five HIGH development-only audit findings unresolved.

[Issue #25, comment 6141602211](https://github.com/Satsetx4/karturt/issues/25#issuecomment-6141602211) confirms the owner infrastructure evidence was still missing: current Vercel UI captures, account-specific usage/headroom/no-overage proof, and a verified isolated Neon target. It says Wave 9 did not re-read Vercel, Neon, billing, or production state. Wave 10's candidate will have a different final SHA if coordinator integration changes it; fill that exact SHA from the coordinator's final report before any later gate review.

The [Wave 9 owner packet](./W9-C01-C08-owner-action-packet-2026-10-13.md) is retained as a historical source and has useful project-name/ID search hints. Its provider observations are not current readbacks. This Wave 10 packet requests a **new owner UI evidence path**; it does not repeat API readbacks or claim that any old value still applies.

## C01–C03 — Vercel Demo/F3 owner capture

Capture the following separately for Demo and F3. Use the team switcher to select the owning team, open the project, and verify the project ID under **Settings → General** before recording anything. Historical project IDs in the Wave 9 packet are cross-check hints only; if a name or ID differs, stop and report the mismatch. Do not change a value, reconnect Git, trigger a build, or redeploy while capturing evidence.

1. **Production branch:** open **Settings → Environments → Production → Branch Tracking**. Capture the exact branch name and project identity. Record what a push to the proposed Wave 10 branch and a merge to main would do.
2. **Git connection and triggers:** open **Settings → Git**. Capture the connected repository and account, automatic deployment behavior, Preview behavior, branch-specific exclusions, and any deploy hooks. Do not infer trigger behavior from a canceled deployment.
3. **Ignored Build Step:** open **Settings → Build and Deployment → Ignored Build Step**. Capture the selected mode and full command. Compare it with the exact candidate SHA's repository configuration, including vercel.json ignoreCommand: the repository value overrides the dashboard setting, and exit code 0 skips a build while exit code 1 continues it. A canceled/ignored deployment is still a deployment/quota event; it is not proof that every trigger is harmless.
4. **Domains and aliases:** open **Settings → Domains** and record every assigned domain, its branch assignment if shown, and any redirect. Then open **Deployments** and inspect the latest record, latest production-target record, candidate-SHA record if present, and last known healthy record. Map each domain/alias to deployment ID, target, branch, SHA, state, and timestamp. Specifically resolve whether main or any production domain is attached to F3. Do not edit mappings.
5. **Preview protection and variables:** open **Settings → Deployment Protection** and record the active protection mode for Preview. Open **Settings → Environment Variables** and capture variable names and environment scopes only; do not expose values. Confirm Preview cannot receive production secrets, traffic, or data.
6. **Healthy rollback target:** identify the deployment that currently serves each intended domain and capture its deployment ID, SHA, target, state, and domain mapping. A canceled record, target=null, or historical deployment is not a verified rollback target.

Use dated screenshots with the team and project ID visible; redact secrets, connection strings, personal information, and environment-variable values. A setting that cannot be read, conflicting values across pages, or an unexpected production trigger keeps that project blocked. Do not test a trigger with a push.

The UI paths and trigger behavior above follow Vercel's current [project settings](https://vercel.com/docs/project-configuration/project-settings), [Git deployments and Production Branch](https://vercel.com/docs/git), and [ignoreCommand configuration](https://vercel.com/docs/project-configuration/vercel-json) guidance, reviewed 13 October 2026.

## C04 — Rp0, quota, headroom, and no-overage evidence

The billing owner should capture fresh evidence for the exact Vercel team, Neon organization, projects, SHA, and bounded workload proposed for a later decision. Show the billing-cycle start/end and reset time, currency and units. Do not expose payment details.

| Account view | Owner capture |
|---|---|
| Vercel team **Usage** | Select the owning team in the team switcher, open **Usage**, capture the current billing cycle and **Last 30 days**, then filter Demo and F3 separately. Show included allotment, consumed amount, remaining headroom, projected cost, and every metric the named action can consume (builds, deployment quota, compute/functions, transfer/requests, storage, and applicable add-ons). |
| Vercel **Settings → Billing → Spend Management** | Show the current plan, spend amount, enabled action, and whether the action actually pauses consumption or only sends an alert. Include any separate paid add-ons. A notification threshold or plan label alone does not establish Rp0. |
| Neon organization **Billing / Usage** | Show the exact organization and project, billing cycle, plan, current usage and included amount, remaining headroom, reset date, and applicable compute, storage, transfer, branch, restore, or other billable metrics. Show what happens at each limit and whether an actual enforced stop exists. Do not wake or connect to a database to obtain usage. |
| Billing-owner statement | Name the billing authority and date. State that the exact named SHA and bounded actions, duration, and expected traffic/database runtime add **Rp0** and cannot incur an overage or separate add-on. Link the supporting account views. |

An absent metric, ambiguous project/account linkage, stale cycle, insufficient headroom, or alert-only limit means **Rp0 BLOCKED**. Vercel documents that Pro usage can incur on-demand charges unless the applicable pause action is configured; Neon's 24 April 2026 spending-limit notice described alerts as available and compute suspension as forthcoming. Re-check the account's current UI for the proposed action; do not treat a budget label as an enforced cap. See [Vercel usage](https://vercel.com/docs/pricing/manage-and-optimize-usage), [Vercel spend management](https://vercel.com/docs/spend-management), [Vercel plans](https://vercel.com/docs/plans), and [Neon organization spending limits](https://neon.com/blog/introducing-organization-spending-limits).

## C05 — Neon staging lineage, emptiness, and protected access

No Wave 10 Neon provider operation is in scope. Do not open a connection, wake compute, run SQL, use db:check, migrate, reset, or create a project/branch while collecting this packet. The old parent-data staging branch described in Wave 9 remains **ineligible**: zero recorded writes, an idle endpoint, or a name containing “empty” does not prove that inherited data is empty.

For a later separately authorized candidate, the owner must provide:

1. **Identity and lineage:** in the Neon console, select the exact organization and project, open **Branches**, select the proposed branch, and capture project ID, branch ID/name, parent branch ID, creation source/time, source point, and primary/default flags. Include the full parent-to-child lineage. The parent must be independently proven empty or synthetic-only; Neon branches inherit their parent's schema and data unless created from a schema-only source. Metadata or branch names alone do not prove empty contents.
2. **Verified emptiness:** provide provenance for a clean synthetic-only source and a redacted schema/data inventory showing no real resident data. If that requires a database query, it is outside this Wave 10 action; it needs a separate explicit owner authorization and must target only the newly verified isolated candidate. No credentials or row-level personal data belong in the evidence packet.
3. **Protected access:** capture the branch's current protected/unprotected indicator in **Branches** without selecting a change action. Capture current network/IP allow settings from **Project Settings → IP Allow** (or the console's current equivalent), whether public connections are allowed, whether passwordless access is enabled, and the least-privilege role/grant scope. Show role names and scopes only, never secrets. Confirm the application's Preview credentials would be scoped to this one staging target and cannot reach production.
4. **Cost and target guard:** attach the exact Neon billing/headroom/no-overage evidence above and identify the approved project/branch/database tuple. If branch protection or required network restrictions are unavailable under the account's plan, staging remains blocked until an alternative is reviewed and explicitly approved.

Do not use the previously reported ancient-smoke-51787007 / br-dry-block-b3fsqjo3 parent-data target as a shortcut. A new resource, a new connection, or any migration is a separate future decision after the owner proves isolation and Rp0. Neon explains branch inheritance in its [branching workflow guide](https://neon.com/docs/get-started-with-neon/workflow-primer) and the capture paths for [protected branches and IP Allow](https://neon.com/blog/restrict-access-to-the-production-branch).

## C06–C08 — Five separate owner decisions

Select one action per row. A GO must name the exact SHA and target, cite the evidence bundle, and record the owner and timestamp in WIB and UTC. Empty fields or a conditional/unbounded GO remain NO-GO.

| Owner decision | Preconditions that must be attached to the decision | Owner choice |
|---|---|---|
| **1. Safe source publication** — publish one branch/commit to GitHub | Final SHA and local evidence report: ______; repository and remote branch: ______; expected GitHub checks and Vercel side effects: ______; current Demo/F3 trigger evidence: ______; Rp0 evidence: ______; rollback/stop plan: ______. This does not authorize Preview, merge, or deployment. | [ ] GO for this exact publication  [ ] NO-GO |
| **2. Isolated staging creation/use** | Exact Neon organization/project/branch or bounded creation plan: ______; source lineage and empty/synthetic-only proof: ______; access restrictions/role scope: ______; Rp0 evidence: ______; permitted connection/migration scope: ______; recovery plan: ______. | [ ] GO for this exact staging scope  [ ] NO-GO |
| **3. Protected Preview** | Final SHA: ______; Vercel team/project ID: ______; Preview URL/branch: ______; protection mode: ______; Preview-only environment scopes: ______; isolated DB target or explicit local-only scope: ______; no-production-domain proof: ______; Rp0 and rollback evidence: ______. | [ ] GO for this one protected Preview  [ ] NO-GO |
| **4. PR #23 controlled merge** | PR #23 exact head SHA: ______; approved base: ______; completed-successful required CI run(s) for that exact SHA: ______; branch protection/readiness: ______; Vercel merge-trigger and production-domain effects: ______; cost/rollback proof: ______. PR #56 is comparison-only and is not a substitute. | [ ] GO to merge PR #23 at this exact SHA  [ ] NO-GO |
| **5. Production** | Exact merged SHA: ______; project/domain/target: ______; production acceptance evidence: ______; operational owner: ______; billing/no-overage evidence: ______; verified healthy rollback deployment and separate data restore evidence: ______. | [ ] GO for this named production action  [ ] NO-GO |

The current Wave 10 work has not supplied a final integrated SHA, current provider UI captures, account-specific Rp0 evidence, safe staging proof, protected Preview proof, or production acceptance. Therefore all five choices remain **NO-GO** unless and until the missing evidence is attached and the owner records a bounded decision.

## Stop and rollback

Stop without making a compensating provider or database change if project/team/branch/SHA identity differs; triggers, Ignore Build Step, environment scope, domain mapping, protection, lineage, or account linkage is unclear; cost evidence cannot rule out overage; a check is missing/failed/skipped/canceled or belongs to another SHA; a target may contain resident data; or no healthy recovery target exists.

For any later authorized action, halt further pushes/builds/promotions on an unexpected effect and preserve the deployment, alias, and billing evidence. Restore only through a separately authorized procedure to a previously verified healthy deployment; do not use a canceled record as the target. Treat database recovery separately from an alias rollback. Do not delete or recreate branches, projects, aliases, or data to hide an incident. If recovery requires unknown spend, credentials, an untested migration, or an unverified target, stop and return for a new owner decision.

## Sources

- [Issue #17, Wave 9 checkpoint, comment 6141597355](https://github.com/Satsetx4/karturt/issues/17#issuecomment-6141597355).
- [Issue #25, Wave 9 owner checkpoint, comment 6141602211](https://github.com/Satsetx4/karturt/issues/25#issuecomment-6141602211).
- [Wave 9 C01–C08 owner packet](./W9-C01-C08-owner-action-packet-2026-10-13.md), historical consolidation only.
- Vercel documentation, reviewed 13 October 2026: [project settings](https://vercel.com/docs/project-configuration/project-settings), [Git deployments](https://vercel.com/docs/git), [vercel.json configuration](https://vercel.com/docs/project-configuration/vercel-json), [usage](https://vercel.com/docs/pricing/manage-and-optimize-usage), [spend management](https://vercel.com/docs/spend-management), [plans](https://vercel.com/docs/plans).
- Neon documentation, reviewed 13 October 2026: [branching workflow](https://neon.com/docs/get-started-with-neon/workflow-primer), [protected branches and IP Allow](https://neon.com/blog/restrict-access-to-the-production-branch), [organization spending limits](https://neon.com/blog/introducing-organization-spending-limits).
