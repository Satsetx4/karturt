# Wave 13B.1R Coordinator Report

Date: 2026-10-14

Status: **DISPOSABLE PG18 VALIDATION PASS — DOCS PUBLICATION PENDING — NO NEON SQL OR D1v2 EXECUTION**

## Scope and immutable references

This wave remediates the transaction-contract evidence and bounded PostgreSQL 18 catalog SQL for a future owner review. It ends before live D1v2, D2, and D3. Work is isolated to the documentation branch `docs/wave13b-1r-preflight-remediation-20261014`, based on docs SHA `c0ea88c40cef4bba595992290477e9d74784f465`.

| Reference | Required value | Current check |
|---|---|---|
| Repository | `Satsetx4/karturt` | Confirmed from configured remote |
| Wave 13A.2 source branch | `codex/wave13a-2-pg18-evidence-20261014` | Required SHA `48b92abbe93fbd499448b6c885d3042cb49c2128` |
| Documentation base | `docs/wave13b-1-readonly-preflight-20261014` | Required SHA `c0ea88c40cef4bba595992290477e9d74784f465` |
| Historical `main` | `main` | Must remain `96c84588ae0c13f68a17cffd997a3e583fb7da82` |
| Prior approved SQL artifact | Wave 13B.0 reference | Blob `78501ab327bdc7b7a9a06a0a0f66fe039fc8d148`; 29 SQL fences, unchanged |

The primary checkout's existing untracked screenshots were preserved. No source files are modified by this work. The source guard remains `stagingIsolationVerifiedEmpty=false` and `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null`.

## Delegated lanes and integration

| Lane | Deliverable | Current result |
|---|---|---|
| Agent A — connected transaction contract | `WAVE13B_1R_AGENT_A_CONNECTOR_CONTRACT.md` | G1 **UNVERIFIED**. Tool descriptors are insufficient to establish actual session affinity, ordering, fail-fast/rollback, commit, cancellation, or target binding. |
| Agent B — privilege coverage and fixed SQL | `WAVE13B_1R_AGENT_B_PRIVILEGE_SQL.md`, `WAVE13B_1R_FIXED_SQL_REFERENCE.md` | Bounded 26-statement candidate and core/extended coverage review integrated; exact packet passed Agent C's PostgreSQL 18.6 disposable validation. |
| Agent C — independent disposable PostgreSQL 18 validation | `WAVE13B_1R_AGENT_C_INDEPENDENT_VALIDATION.md` | Exact frozen 26-statement packet PASS on PostgreSQL 18.6 (180006), Actions run `38586768128`, test branch SHA `1bdf371bb3d18265af2bb82602882b8ad93a5139`. No live Neon use. |
| Coordinator — packet and audit | This report and `WAVE13B_1R_D1V2_OWNER_APPROVAL_PACKET.md` | D1v2 packet prepared for separate owner review; no live action approved or executed. |

Work was split among three isolated agent worktrees. Integration is on the docs-only branch. Any disposable-CI source branch is kept separate from the documentation artifact and will be reported with its own exact SHA and Actions result.

## G1 — actual connected transaction contract

The visible connected transaction tool descriptor(s) claim multiple statements execute “as one transaction,” but expose no implementation/server version, release/source identifier, session trace, or runtime evidence. The descriptors do not prove one backend session, ordered execution, first-error stop, rollback/commit behavior, savepoint behavior, timeout/cancellation behavior, or enforcement of all five explicit target arguments. No Neon transaction tool was called. **G1 remains UNVERIFIED.**

Agent A documents a narrow alternative for separate review: one `psql` process with `-X`, `ON_ERROR_STOP=on`, `ON_ERROR_ROLLBACK=off`, and `--single-transaction`, using only the exact approved file and a separately prepared target. PostgreSQL 18's official psql docs describe the client behavior. This is not authorization to connect or execute, and a lost connection still leaves server cancellation unknown.

## G2 — privilege evidence remediation

The revised inert reference contains 26 ordered statements: a read-only transaction command, a fail-closed identity/version/read-only guard, transaction and identity readbacks, then bounded catalog queries. Coverage includes visible role attributes; membership edge grantor and ADMIN/INHERIT/SET options; applicable roles; database/schema/relation/column/routine/type ACL and ownership; default ACLs; extension names, versions, schemas, and owners; PostgreSQL 18 MAINTAIN via raw relation ACL; FDW/server/language/large-object/tablespace/configuration-parameter ACLs; filtered information-schema cross-checks; safe-name secondary-object inventory; selected replication/event objects; migration-ledger object presence only; and built-in effective privilege booleans for the fixed target role across core migration classes.

The reference distinguishes the core migration-security minimum from extended coverage, sets per-query fingerprints and an ordered manifest, caps returned rows, and fails closed on cap, missing/truncated evidence, SQL error, visibility gap, or unresolved raw/effective privilege mismatch. It is **bounded and not a complete cluster-wide privilege-universe inventory**. It does not prove physical emptiness, independent lineage, network isolation, or unauthenticated access. Exact objects and privileges still require a migration-specific owner baseline and allowlist.

The old Wave 13B.0 29-statement document and its prior D1 approval remain unchanged and do not approve the revised 26-statement set.

## G3 — PostgreSQL 18 disposable validation

Local PostgreSQL/Docker was unavailable in the independent lane. A separate public-repository GitHub Actions branch used one ephemeral `postgres:18` service with `contents: read`, an exact verification-branch push trigger, no external service, and no deployment trigger. The exact committed fixture was pinned to fixed-reference blob `e011f0e843d42d53c7c4c76ba479854644137fc9`, 26 statements, and ordered manifest `ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0`. Run `38586768128` on SHA `1bdf371bb3d18265af2bb82602882b8ad93a5139` passed using PostgreSQL `18.6 (Debian 18.6-1.pgdg13+2)` / version `180006`; the disposable container cleanup also passed. It exercised clean catalog, synthetic role/ACL/effective privileges, wrong database/role, read-write and error guards, fail-fast rollback, successful commit readback, and unexpected object/ledger detection. Exact evidence and limitations are in Agent C's report. This validates PostgreSQL/psql behavior only; it does not validate the connected Neon transaction tool. PGlite and the unrelated Wave 13A.2 TCP result are not substitutes.

The harness suppresses psql result/error output and only emits fixed pass/fail diagnostics, row counts, booleans, versions, and fingerprints. GitHub's service-container teardown logs did include the SQL text for the intentionally failing guard and rollback probes. Those were fixed synthetic test statements; no secret, credential, application row, or catalog row data appeared. This is recorded as a logs limitation rather than a secret or user-data leak.

## G4 — D1v2 owner packet

The packet names the exact fixed target tuple and requires a fresh non-waking identity check immediately before any later execution. It records the frozen query artifact, alternative transaction method, possible compute wake, required result classes (`CLEAN_CATALOG_PREFLIGHT`, `UNCLEAN`, `UNKNOWN`), mandatory stop cases, and a pending owner sign-off. The historical target values are design references, not current verification. The old D1 authorization does not transfer. **No D1v2 approval is recorded.**

## G5 — publication and final verification

Publication is limited to six Markdown reports under `docs/wave13b-1r/2026-10-14/` on the docs-only branch. No PR, merge, main update, source edit, provider mutation, migration, Vercel deployment, or Neon action is in scope. Before push, verify the exact branch ancestry, changed paths, Vercel linkage/deployment state, and workflow triggers. After push, read back the exact remote docs SHA and file list, confirm source/main unchanged, inspect Actions status without treating absent runs as PASS, and recheck Vercel deployments. Record the actual results here before calling publication complete.

## Current decision and stop boundary

Current content verdict: **D1V2 APPROVAL PACKET READY — ALTERNATIVE METHOD, OWNER REVIEW REQUIRED**. The revised fixed SQL has disposable PostgreSQL 18 validation; the actual connected Neon transaction contract remains unverified. Publication readback is pending, and the packet authorizes no action until a separate owner decision.

This wave does not authorize any `mcp__Neon__run_sql_transaction`, `run_sql`, database connection, compute wake, SQL against either Neon staging target, role/grant/network/endpoint/branch/project mutation, credential retrieval, key generation/pinning/signing, migrations 0000–0013, staging runtime guard flip, Vercel environment/deployment, paid resource, merge, D1v2, D2, or D3. No other Neon project is a fallback.
