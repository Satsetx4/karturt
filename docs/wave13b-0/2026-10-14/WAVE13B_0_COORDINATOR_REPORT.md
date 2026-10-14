# KartuRT V1 Wave 13B.0 — Coordinator Report

Date: 2026-10-14
Result: **D1 OWNER APPROVAL PACKET READY** — documentary review and scoped read-only preflight design are complete for owner decision. D1 itself remains **not approved and not executed**.

## Scope and stop boundary

Wave 13B.0 prepared an owner decision packet for a possible single, fixed, server-enforced read-only preflight against the named new staging target. It did not perform a database operation. This report does not authorize Neon SQL or connection/wake, provider configuration or role changes, key generation or pinning, signing, migrations `0000`–`0013`, staging runtime access, Vercel changes/deployment, or any change to old staging or production.

The five mandatory reports in this folder are the complete Wave 13B.0 report set. The owner packet also links one permitted, inert Markdown SQL reference so the D1 statement set is concrete and reviewable. The reference is not a script. The D1 decision text is in [WAVE13B_0_OWNER_APPROVAL_PACKET.md](WAVE13B_0_OWNER_APPROVAL_PACKET.md).

## Immutable anchors and current repository refs

| Ref | Expected and freshly read before publication |
|---|---|
| Accepted Wave 13A.2 source branch `codex/wave13a-2-pg18-evidence-20261014` | `48b92abbe93fbd499448b6c885d3042cb49c2128` |
| Documentation parent `docs/wave13a-2-validation-20261014` | `b30597abef9375435ea8524b093690375e4824e1` |
| Historical `main` ref at this audit | `96c84588ae0c13f68a17cffd997a3e583fb7da82` |
| New docs branch | `docs/wave13b-0-security-approval-20261014`, based directly on the exact documentation parent above |

The Wave 13A.2 evidence reviewed was its Coordinator, Agent A, Agent B, Agent C, Migration Evidence Errata, and Owner Next Gate reports under `docs/wave13a-2/2026-10-14/`. Relevant earlier owner approval and next-gate records were also reviewed. The source and documentation refs are independent; source evidence is not transferred to a different source SHA.

## Lane results

| Lane | Result | Report |
|---|---|---|
| A — Neon security and control-plane metadata | **Scoped audit complete.** The exact new target IDs align in the readback. Public-network posture is exposed; role grants, SQL identity, and lineage remain unknown. No connection, SQL, wake, credential read, or mutation. | [Agent A — Neon Security](WAVE13B_0_AGENT_A_NEON_SECURITY.md) |
| B — SQL preflight design | **Design complete.** Fixed statement set, exact target scope, result classifications, transaction safeguards, and no-retry stop behavior are documented. No SQL or connection. Tool transaction wording is not treated as proof of session affinity or error-abort semantics. | [Agent B — SQL Preflight](WAVE13B_0_AGENT_B_SQL_PREFLIGHT.md) |
| C — authorization and recovery | **Source review complete.** Current approval trust anchor is null; the local consumed marker is not a global replay registry; timeout/process exit does not prove backend cancellation. No key or signature operation. | [Agent C — Authorization and Recovery](WAVE13B_0_AGENT_C_AUTHORIZATION_RECOVERY.md) |
| Owner handoff | **Ready for a bounded D1 decision.** D2 sub-decisions and D3 migration remain separate, ungranted gates. | [Owner Approval Packet](WAVE13B_0_OWNER_APPROVAL_PACKET.md) |

The exact inert statement text for D1 is in [Read-Only Preflight SQL Reference](WAVE13B_0_READ_ONLY_PREFLIGHT_SQL_REFERENCE.md).

## Evidence carried forward and its limits

At exact source SHA `48b92abbe93fbd499448b6c885d3042cb49c2128`, the reviewed Wave 13A.2 records report two completed-successful GitHub Actions runs: PostgreSQL 18 timeout runtime `38538027706` and Test Gate A `38538027707`. A fresh GitHub CLI read confirmed both runs have `status=completed`, `conclusion=success`, and that exact `headSha`. The same records report 80/80 test files and 559/559 tests, typecheck, lint with 0 errors and 2 prior warnings, offline Drizzle consistency, schema drift, build, and all 15 raw Git blob SHA-256 entries matching the manifest. No SQL migration file or journal changed.

The PG18.6 timeout scenario used Node `pg.Pool` over loopback TCP. Its child exited naturally with expected codes 0/1/1 and did not retry. A 300 ms JavaScript timeout did not cancel the running synthetic `SELECT pg_sleep(60)`: the backend remained active at 3,046 ms after child exit and disappeared after 57,192 ms of observation without a cancellation request. This is direct-TCP harness evidence only. Neon serverless/WebSocket behavior, live migration/rollback, database grants, and real network reachability remain unverified. No rehearsal was repeated in Wave 13B.0.

The exact source still has `stagingIsolationVerifiedEmpty=false` and `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null`. Both remain unchanged. The target role's effective privileges and the new branch's contents/lineage have not been established. Neither metadata nor an empty catalog result can establish physical storage emptiness or complete ancestry.

## Provider, workflow, and deployment checks

Read-only Neon control-plane inventory was limited to the named new organization/project/branch/database/endpoint/role. The Agent A report records exact IDs and fields, evidence boundaries, current Neon documentation, Free-plan controls, and residual risk. The old project and production were not queried.

Before pushing, the exact `karturt-review-staging-20261012` Vercel project ID `prj_Mv4rABJvDNAvSD78SVt5WbjFakEq` read back `live=false`, `latestDeployment=null`, with no domains; its deployment list was empty. Team Git deployment context contained no `karturt` project link, and a repo-URL project search returned zero linked projects. At the exact docs parent, `gate-a.yml` did not include `docs/**` in its push branch allowlist; the only other triggers are pull request and manual dispatch. This task does not open a PR or dispatch a workflow. Post-push results must be appended here before publication is declared complete.

## Owner boundary

D1 authorizes only the exact read-only query set and exact IDs if the owner later signs/approves the packet through an independently approved process. It is not permission for this agent to run that query. D2 independently covers specific network/authentication, role, and PKI decisions. D3 independently covers one-time DDL after all prior gates, exact-SHA review, grants review, lineage evidence, and approval trust setup. On any mismatch, timeout, uncertainty, unexpected catalog result, or deployment side effect, stop; no automatic retry, fallback, reset, deletion, rebuild, rollback, or migration is included.

## Publication readback

The initial documentation publication commit is `c0c1de08acd4a70440c7a794ca01c6d40f76d2c7`; its parent is the exact docs base `b30597abef9375435ea8524b093690375e4824e1`. A fresh read after pushing confirmed:

- `origin/docs/wave13b-0-security-approval-20261014` pointed to `c0c1de08acd4a70440c7a794ca01c6d40f76d2c7`.
- The GitHub compare readback was one commit ahead of the exact docs base, zero commits behind, and listed only the six Markdown paths in this folder. No source or workflow file changed.
- Source branch remained at `48b92abbe93fbd499448b6c885d3042cb49c2128`; docs base remained `b30597abef9375435ea8524b093690375e4824e1`; `main` remained `96c84588ae0c13f68a17cffd997a3e583fb7da82`.
- GitHub reported zero check runs for the published SHA and `gh run list` returned an empty list for the docs branch. This is **no workflow run / CI not applicable**, not a CI pass. The only workflow at the base does not include this branch in its push allowlist; this task did not open a PR or dispatch a workflow.
- Vercel project `karturt-review-staging-20261012` (`prj_Mv4rABJvDNAvSD78SVt5WbjFakEq`) still reported `live=false`, `latestDeployment=null`, and no domains; its deployment list count was zero. A repository-URL project search returned zero projects, and the team's linked Git projects contained no `Satsetx4/karturt` link.

The published package is documentation-only. No PR, merge, workflow dispatch, Vercel deployment, or source/provider action was performed. The final delivery message reports the current remote branch SHA after the report-only verification update.
