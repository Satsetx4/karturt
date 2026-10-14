# KartuRT V1 Wave 12.6A — Provisioning Specification

**Date:** 2026-10-14 (Asia/Bangkok)
**Lane:** W12.6-A01–A08 — independent Neon project provisioning preparation
**Disposition:** **PROVISIONING PREFLIGHT PARTIAL — exact organization and published Free-plan limits verified; remaining project capacity and Rp0/no-overage are NOT VERIFIED.**
**Wave boundary:** documentation and narrowly scoped, read-only organization metadata only. No project creation, SQL, database connection, compute inspection/wake, source change, or paid action occurred.

## 1. Immutable baselines and evidence read

| Item | Verified value |
|---|---|
| Repository | Satsetx4/karturt |
| Application source | SHA **3bc69c83265dce3a6a0863cbfceea188f40f6168**, tree **f82ad13142a1c3e09b9d20e94d0e76d6dbd9f9e9** |
| Documentation base | SHA **01a3e532b258efb1813630cea610f6ab10a14410**, tree **9c57dbade44b77a72053e3481483a4ba37778a27** |
| Agent worktree | Branch **codex/wave12-6-agent-a-20261014**; clean before this report |

The source object, its tree, documentation HEAD/tree, clean status, and the five Wave 12.5 report paths were checked in the assigned worktree. All five Wave 12.5 reports were read. Relevant prior evidence reviewed included the Wave 12.1 coordinator report, Wave 12.3 PostgreSQL 18.6 rehearsal, and Wave 12.4 Agent A lineage and coordinator reports.

The inherited evidence remains bounded: the existing staging branch reports init_source=parent-data with unknown parent/source point; Wave 12.4 was schema-clean only for its fixed catalog scope; and the successful Wave 12.3 rehearsal was on a disposable synthetic PostgreSQL 18.6 service, not Neon. The source guard still has stagingIsolationVerifiedEmpty=false. Recovery Option 1 is a future disposable rebuild design; it does not authorize project creation, replacement, or deletion. The existing project remains PRESERVE UNCHANGED.

## 2. Exact organization read and Free-plan capacity

A filtered organization metadata lookup using the exact organization ID returned:

- Name: **satset**
- ID: **org-ancient-boat-57106549**
- Plan: **free**

The Coordinator’s same-day exact-organization metadata summary reported an aggregate project count of **4**. No project names or per-project internals are used here. The response did not expose a remaining-project-quota or Free-capacity field. No project enumeration was performed by this lane.

Neon’s current pricing page lists Free at $0, with 100 projects, 100 CU-hours per project per month, and 1 GB Postgres storage per project. Neon’s October 2, 2026 update confirms the 100-project and 1 GB figures. These are **published limits**, not a readback of the organization’s remaining capacity or usage. The aggregate count does not establish provider eligibility, remaining capacity, or other organization restrictions. Do not derive or claim a verified remaining count from subtracting the aggregate count from a published limit.

**Capacity gate: QUOTA NOT VERIFIED.** Actual Free project capacity for this organization is not exposed in the permitted metadata evidence. The target therefore cannot be called capacity-ready.

The Free plan is publicly listed at $0 and requires no credit card, but that alone does not prove this creation and its initial compute will stay within verified limits or that no charge/overage path applies to this organization. Creating a project initializes resources and the connector waits for its default compute to become ready, which can consume plan usage. No current billing/usage headroom or no-overage control was verified.

**Cost gate: Rp0 / NO-OVERAGE NOT VERIFIED.** Do not create the project until a separate approval checkpoint has current provider evidence that the exact operation remains within Free limits, cannot trigger a paid plan or charge, and will stop on any unexpected billing behavior. Do not upgrade the plan.

Official references:

- [Neon pricing](https://neon.com/pricing) — Free price and published project, compute, and storage limits.
- [Neon Free-plan update, October 2, 2026](https://neon.com/blog/neon-free-plan-1-gb-per-project) — current published Free-plan project and storage limits.

## 3. Proposed manifest — not a live resource

| Field | Proposed value |
|---|---|
| Organization | satset, ID org-ancient-boat-57106549 |
| Project name | karturt-v1-staging-clean |
| PostgreSQL major version | 18 |
| Region | aws-ap-southeast-1 (Singapore) |
| Plan | Free only; no upgrade |
| Root/default branch name | staging |
| Initial database name | karturt_staging |
| Origin | New independent project root |
| Data policy | Synthetic data only |
| Source relationship | No branch, clone, import, dump, snapshot, restore, or other copy from any existing Neon project |
| Existing staging | Preserve unchanged; do not inspect, connect, wake, alter, migrate, reset, or delete it in this wave |

The project creation request, if separately authorized later, must explicitly name the exact organization, project, PostgreSQL version, region, root branch, and initial database. The branch must be the new root/default branch; its parent must not be the existing staging project or any other database. If the provider cannot create the requested root/database mapping as part of the approved creation request, stop before any follow-up mutation and obtain a new scope.

The proposed new project does not prove its database is empty or migration-ready. Any later baseline verification requires its own explicit permission and exact target identifiers. No source guard change is proposed here; stagingIsolationVerifiedEmpty remains false.

Neon’s Create Project API supports specifying the project’s region and PostgreSQL version, and documents support through PostgreSQL 18. The branch API describes a project’s initial root/default branch. The requested region and branch values above are owner-locked choices, not independently inferred defaults. See [Create project API](https://api-docs.neon.tech/reference/createproject) and [Retrieve branch details API](https://api-docs.neon.tech/reference/getprojectbranch).

## 4. Automatic creation side effects requiring explicit consent

A future create_project request is a resource mutation, not a reservation of a name. Its expected side effects must be included in a separate Wave 12.6B approval:

1. A new project is created under the selected organization and consumes project-plan capacity.
2. A root/default branch is created. It must be the requested staging branch and must have no parent/copy source.
3. An initial Postgres database is created on that branch. Neon documents the project response as including a database connection URI; the request must target karturt_staging, and the exact returned database mapping must be read back.
4. At least one non-protected Postgres role is created with a password. The actual role name and ID must be captured only as metadata. Do not put the password in this report, logs, source, or GitHub.
5. The default branch has a primary read-write compute endpoint. The Neon create-project connector waits until the default compute is ready; this can consume Free compute allowance. Capture endpoint ID, hostname, region, type, and state only after authorized creation. See [Manage computes](https://neon.com/docs/manage/computes).
6. A connection URI/credential may be returned by the provider API or retrieved separately. It contains credential material and is not required for this preparation report. Do not retrieve, print, or store it in GitHub. Any future secret storage or database connection requires its own scoped authorization and an approved server-side secret channel.

Neon’s Create Project API says that project creation returns a connection URI with a database, password, and role; at least one non-protected password role is created, and the returned operations must finish before connecting. The provider documentation also warns that a POST request may have succeeded despite a missing response and that retrying non-idempotent methods is generally unsafe. See [Create project API](https://api-docs.neon.tech/reference/createproject) and [Retrieve connection URI API](https://api-docs.neon.tech/reference/getconnectionuri).

This lane did not create a resource or request a connection URI. The above list is an approval disclosure, not authorization.

## 5. Provenance and no-copy record template

Populate these placeholders only after a separately authorized project creation and a permitted exact-target metadata readback. Preserve the record with sanitized metadata only:

| Evidence field | Value to record later |
|---|---|
| Separate owner authorization reference, date/time, operator, stop authority | NOT AUTHORIZED / NOT CREATED |
| Exact organization ID and plan readback | org-ancient-boat-57106549 / [read back] |
| Project name, generated project ID, creation timestamp, sanitized operation IDs | [pending authorized creation] |
| Project creation source reported by provider | [exact returned value or NOT EXPOSED] |
| PostgreSQL version and region readback | 18 / aws-ap-southeast-1 / [verify] |
| Root/default branch name and ID; parent ID/source metadata | staging / [pending] / [must be root; record exact returned evidence] |
| Initial database name and provider ID, if returned | karturt_staging / [pending] |
| Role name and provider ID, if returned | [pending; never record password] |
| Compute endpoint ID, hostname, branch binding, region, type, and state | [pending; metadata only] |
| Plan, available project/compute/storage capacity, and cost/overage checkpoint | [pending; must be positively verified] |
| Import/clone/restore/snapshot/dump source | None — operator and reviewer attest no external data was copied |
| Creation request and parent/source fields | [sanitized request summary; no credentials] |
| Data set | Synthetic only; no real resident or operational data |
| No-copy attestation, reviewer, timestamp | [pending separate execution] |
| Connection string or password | NOT RECORDED HERE; secret reference only if later authorized |

If any parent/source field is non-null or ambiguous, or the provider indicates import, clone, restore, snapshot, or inherited data, stop and preserve the returned resource. Do not attempt a cleanup, reset, follow-up branch, or delete under this wave. A “new project” label or clean-looking metadata alone does not prove database emptiness.

## 6. Failure-safe creation and stop rules

Project creation uses a non-idempotent POST. If a future, separately authorized request times out or returns an ambiguous result:

1. Do not retry the creation request.
2. Do not create a second project or guess which response was lost.
3. Under a separately authorized exact-target metadata readback, identify whether the named project was created and capture its sanitized IDs/operation status. Do not enumerate unrelated projects.
4. If identity, completion, parentage, billing, or resource contents are uncertain, stop and preserve the partial resource and sanitized operation evidence. Do not delete it.
5. Keep existing staging untouched. Any retry, cleanup, reset, or replacement requires a new owner authorization naming the exact project and action.

Stop before creation if actual quota/cost cannot be verified, organization/project identity differs, the request cannot guarantee an independent root and no-copy origin, PostgreSQL 18 or the requested region is unavailable, the provider proposes a paid plan, or any unexpected side effect appears. No paid action is allowed.

## 7. Permissions and next owner decision

**Wave 12.6A authorizes:** this documentation and exact-organization read-only metadata lookup only.

**Not authorized:** creation or update of a Neon project/branch/database/role/endpoint; SQL or connection; compute wake; snapshot/restore/import/clone; migrations; source guard changes; Vercel/GitHub deployment changes; plan upgrade; or any cost-bearing action.

The owner has **not** authorized Wave 12.6B project creation. A later approval must separately authorize one project-creation operation with the exact manifest above, acknowledge the automatically created branch/database/password-bearing role/default compute endpoint/credential-bearing URI, require a no-copy provenance record, and set a fail-stop condition for unverified quota, cost, or unexpected provider behavior. Recovery Option 1 does not authorize deleting or replacing the existing staging resources.

Until actual Free quota/headroom and Rp0/no-overage are positively verified, this preparation remains **PARTIAL** and is not an approval-ready create packet.

## 8. Source record

- [Wave 12.5 target decision](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_AGENT_A_TARGET_DECISION.md) — new independent project recommendation and separate quota/cost gate.
- [Wave 12.5 recovery runbook](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_AGENT_B_RECOVERY_RUNBOOK.md) — Option 1 failure handling and preserve-old-target boundary.
- [Wave 12.5 security decisions](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_AGENT_C_SECURITY_DECISIONS.md) — source guard, identity, and access boundaries.
- [Wave 12.5 coordinator report](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_COORDINATOR_REPORT.md) and [owner decision packet](https://github.com/Satsetx4/karturt/blob/docs/wave12-5-recovery-decision-20261014/docs/wave12-5/2026-10-14/WAVE12_5_OWNER_DECISION_PACKET.md) — prior scope and separate-permission rule.
- Neon project and usage behavior: [Create project API](https://api-docs.neon.tech/reference/createproject), [Free plan pricing](https://neon.com/pricing), [branch details API](https://api-docs.neon.tech/reference/getprojectbranch), and [compute documentation](https://neon.com/docs/manage/computes).

**Agent A final state:** PROVISIONING PREFLIGHT PARTIAL. No Wave 12.6B creation or Wave 13 migration is authorized.
