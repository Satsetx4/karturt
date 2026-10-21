# Staging Readiness Gate V1 — Execution Guide

Date: 2026-10-21
Scope: KartuRT V1, one isolated synthetic-only staging target, Neon Free plan

## Source of truth

- Master issue: [#61 — Replace F2 with Staging Readiness Gate V1](https://github.com/Satsetx4/karturt/issues/61)
- Work items: [#62 evaluator and runner](https://github.com/Satsetx4/karturt/issues/62), [#63 staging evidence](https://github.com/Satsetx4/karturt/issues/63), [#64 exact-head CI and migration unlock review](https://github.com/Satsetx4/karturt/issues/64)
- Historical implementation under review: [PR #60](https://github.com/Satsetx4/karturt/pull/60), source `019aeeb6d6c411ed3b95b42c3c0f1c4130381b28`
- Decision record: [`STAGING-READINESS-GATE-V1-DECISION-2026-10-21.md`](STAGING-READINESS-GATE-V1-DECISION-2026-10-21.md)
- Sanitized evidence ledger: [`STAGING-READINESS-GATE-V1-EVIDENCE-2026-10-21.md`](STAGING-READINESS-GATE-V1-EVIDENCE-2026-10-21.md)

This guide and the issues define the active work. Statuses below distinguish completed local work from provider, CI, and authorization evidence. A result in one evidence layer does not establish another.

## Owner authorization boundary

The owner authorized all changes and tests for isolated, synthetic-only staging, including migrations after auditable guards pass. This does not authorize production mutations, production deployment or merge, paid services, uncontrolled deletion, exposure of credentials, or access to owner DPAPI/private-key material. Do not request credentials or use a connector pathway to bypass the required TLS or target guards.

Attempt-1 and attempt-2 evidence are immutable historical records. Do not overwrite, delete, retry, or relabel them. Do not retry the old F2 procedure.

## Kanban

| Phase | Status at planning revision | Exit evidence |
| --- | --- | --- |
| Inventory PR #60 and reconcile attempt-2 result | COMPLETE — source and provider facts recorded; attempt evidence remains owner-reported | Review comment and this evidence ledger |
| Implement Gate V1 evaluator, secure runner, and strict target guard | IN PROGRESS | Fail-closed evaluator, read-only SQL, byte-verified referenced evidence, auditable immutable evidence output, focused regression coverage |
| Offline regression and CI wiring | LOCAL PASS on `e1e353eae896b0f9487f326121c866ccb039fbed` — 120/120 focused tests, PowerShell 7 parser, and early-stop/self-assertion evidence regression passed on clean HEAD. Exact-head CI pending. | Required workflow jobs run on the exact new commit |
| Refresh provider metadata and prove synthetic isolation | BLOCKED — latest branch says `init_source=parent-data`; `parent_id` omitted; capture artifacts lack trusted provenance | Authenticated exact-target control-plane readback plus verifiable root lineage and synthetic-only content evidence |
| Run Gate V1 against staging | BLOCKED — the runner rejects unsigned provider JSON before psql; local provider API key, `PGPASSFILE`, and `PGSSLROOTCERT` are absent | Trusted provider capture and runner-attested probe, plus direct libpq `verify-full` / `channel_binding=require` and read-only catalog PASS |
| Review migration unlock | BLOCKED | Gate V1 readiness PASS and the existing migration-safety authorization checks pass with a trusted pinned verification key |
| Apply staging migrations | NOT AUTHORIZED YET — owner authorization is conditional on all guards | Exact source and target, valid signed approval, and all preflight/interactive checks; then one guarded staging execution |
| Production | OUT OF SCOPE | No production work in this plan |

## Gate contract

The core `evaluateStagingReadinessSignalsV1` API returns `PASS`, `FAIL`, or `UNKNOWN` for each technical check and a `technicalStatus` rollup only. That field is not overall staging readiness and exposes no migration-permission result. The offline artifact CLI is responsible for combining evidence; it currently forces provider, isolation, and database-probe authentication to `UNKNOWN`, so overall readiness cannot pass. Missing, stale, ambiguous, malformed, or contradictory evidence never defaults to success. A future readiness PASS would only establish that the target is ready for a separate migration authorization decision; it would not authorize writes, migrations, or production activity.

### Required evidence

1. **Exact target:** current provider metadata binds organization, project, branch, endpoint host, region, database, role, PostgreSQL major version, branch state, and compute limits. The live endpoint must match the approved staging target. Reject pooled or otherwise ambiguous endpoints.
2. **Free-only scope:** freshly observed organization plan is Free and the configured compute remains within the agreed 0.25 CU limit. A project name or static manifest is not provider proof.
3. **Staging isolation:** branch lineage and content provenance support synthetic-only staging. Missing `parent_id`, `init_source=parent-data`, or storage counters alone do not prove isolation.
4. **Client TLS:** a same-session libpq connection succeeds with `sslmode=verify-full` and `channel_binding=require`, uses the exact endpoint host and trusted root certificate, and reports active SSL protocol and cipher. No downgrade or fallback is permitted.
5. **Read-only identity and catalog:** in a read-only transaction, verify server/database/role identity, PostgreSQL 18, zero application-owned relations, zero standalone application types, and no Drizzle migration journal. Apply bounded statement and lock timeouts. Execute no DDL or DML.
6. **Evidence integrity and provenance:** capture source SHA, tool/client versions, check results, sanitized target identity, and UTC timestamps in a new immutable evidence artifact. Verify referenced file bytes against each SHA-256, expected artifact type, source SHA, and target IDs before connecting and again during offline evaluation. A digest proves byte integrity only. Provider, isolation, and database-probe files must also be authenticated to a trusted capture/runner. Unsigned JSON and connector output copied into a local file are not sufficient: the current runner stops with `PROVIDER_CAPTURE_UNAUTHENTICATED`, and the offline evaluator marks provider/isolation/probe claims `UNKNOWN`. Do not enable the probe until a trusted capture and runner-attestation path is verifiable. Never put a connection URI, password, token, private key, owner email, or raw credential path in logs or GitHub.

### Evidence artifact contract

Every referenced JSON file is UTF-8, no larger than 128 KiB, inside the same evidence directory, and includes `schemaVersion: "staging-readiness-gate-v1/evidence-artifact/v1"`, the expected `artifactType`, and the exact `sourceSha`. Lineage, synthetic-dataset, and attestation files also bind the reviewed `targetProjectId` and `targetBranchId`.

| Artifact type | Required content |
| --- | --- |
| `provider-metadata` | Fresh normalized Neon readback, including organization plan, project/branch/endpoint identity, region, PostgreSQL major, compute bounds, and branch parent/init-source fields |
| `lineage-create-request` | `method: POST`, `operation: create-project`, exact target IDs, and the recorded omission of all parent/clone/import/restore source fields |
| `provider-lineage-readback` | Exact target IDs, explicit observed-null project/source/branch parent fields, and the provider `init_source` value |
| `parent-data-resolution` | Exact target/source binding, `verificationStatus: VERIFIED`, and `resolvesToNewRoot: true`; required only when provider metadata says `parent-data` |
| `synthetic-dataset-manifest` | Exact target/source binding, `classification: SYNTHETIC_ONLY`, and `noProductionData: true` |
| `synthetic-only-attestation` | Exact target/source binding, `classification: SYNTHETIC_ONLY`, and `noProductionData: true` |

The SQL also records all baseline dimensions. Readiness requires one non-system schema named `public`, one extension named `plpgsql`, zero application relations and application-owned relations, zero standalone application types, no Drizzle journal, zero non-system routines, zero role memberships granted to the target database role, and zero default ACLs. The role-membership count is scoped to the current target role; it is not a global inventory of every role relationship in the database. The offline evaluator checks every dimension; no unknown count defaults to zero.

The PowerShell runner writes create-new `DATABASE_PROBE_STOPPED` evidence for safe stop conditions after the output directory is validated. In the current V1 implementation, an unsigned provider JSON is rejected before psql; no `DATABASE_PROBE_PASS` is available until trusted capture and runner attestation are implemented. The provider input, all referenced artifacts, probe output, and evaluation output must share one evidence directory so the offline evaluator can re-hash every relative reference. Evidence references must be bounded relative locators, never local absolute paths. Once authenticated probe evidence is safely stored outside the repository, run the offline evaluator from the clean repository root with two absolute paths, for example `npm run staging-readiness:evaluate -- 'D:\staging-evidence\probe.json' 'D:\staging-evidence\evaluation.json'`. The evaluation artifact is create-new, source-SHA-bound, and reports technical readiness separately from migration authorization. The evaluator performs no database or provider access. An output path must not already exist.

`pg_stat_ssl` is recorded only as a diagnostic about the PostgreSQL backend's server-side view. Its absence does not prove that libpq's client connection was unencrypted and does not prove a Neon proxy caused the discrepancy. The mandatory client-side proof is the strict libpq connection plus same-session SSL details. If the libpq proof is absent or inconclusive, stop.

## Stop conditions

Stop without retrying or mutating if any of these occur: target identity mismatch or ambiguity; provider metadata stale or unavailable; non-Free plan or compute above the limit; isolation/lineage unknown; SSL certificate or hostname verification failure; channel binding unavailable; no same-session SSL protocol/cipher; wrong database, role, or PostgreSQL major; catalog not empty as specified; read-only transaction not active; query timeout/error; evidence write or integrity failure; or any unexpected behavior.

## Migration boundary

Readiness and migration authorization are separate gates. Existing migration safety checks require an exact source SHA and raw migration manifest, clean state, staging labels, one-shot signed approval bound to source/target/manifest, an interactive one-shot challenge, and a single guarded execution. The repository's pinned staging approval public key is currently null, which deliberately disables approval verification. Do not add a key, weaken checks, access a private key, or treat this broad staging authorization as a signed migration artifact. Migration remains blocked until a valid trusted verification path is established and every existing guard passes.

## Definition of done

- Decision, acceptance criteria, evidence model, and blockers are in GitHub through issues and a reviewable draft PR.
- Exact-head CI runs the new focused regressions and reports their result on the matching SHA.
- The old attempt evidence remains intact and the old F2 execution path is not retried.
- Gate V1 has no database writes and produces a sanitized, immutable stop/readiness report.
- The database probe and offline readiness evaluation are separately labeled, source-SHA-bound, create-new, and authenticated to a trusted runner before any evidence can count toward PASS; neither result authorizes a migration.
- Staging readiness reaches PASS only with all required exact-target, provider, TLS, read-only catalog, isolation, and evidence checks proven.
- Migrations run only after the independent trusted authorization gate is enabled and passes.
- No production, paid-service, deployment, or production-merge action is included.
