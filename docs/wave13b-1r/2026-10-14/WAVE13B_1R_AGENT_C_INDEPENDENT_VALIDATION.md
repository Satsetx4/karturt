# Wave 13B.1R Agent C — Independent Validation

Date: 2026-10-14
Status: **DISPOSABLE POSTGRESQL 18 VALIDATION PASS — CONNECTOR/NEON NOT TESTED**
Scope: independent review and bounded validation of the exact frozen 26-statement reference; no Neon access or live database activity.

## Frozen reference and provenance

- Exact reference: `WAVE13B_1R_FIXED_SQL_REFERENCE.md`, Git blob SHA-1 `e011f0e843d42d53c7c4c76ba479854644137fc9`.
- The reference contains 26 ordered SQL statements. Its ordered statement-manifest SHA-256 is `ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0`.
- The test fixture was pinned to that exact blob and the harness independently checked all 26 statement fingerprints and the ordered manifest before execution.
- Historical Wave 13B.0 reference blob `78501ab327bdc7b7a9a06a0a0f66fe039fc8d148` (29 SQL fences) was inspected only; it was not modified or executed.

## Prior Wave 13B.1 evidence context

- Agent A's earlier result was a metadata-only pass; it did not establish effective grants or catalog cleanliness.
- Agent B's earlier result left actual connector session affinity and first-error transaction semantics unverified.
- Prior Agent C and coordinator/D1 reports identified privilege-evidence gaps and recorded `UNKNOWN — NOT EXECUTED — CONTRACT/SAFETY BLOCKED`. No earlier result is transferred to this revised statement set.

## Runtime and exact successful run

The host did not have a usable local PostgreSQL 18 or container runtime. The bounded test therefore used the approved exact-branch GitHub Actions workflow and an ephemeral `postgres:18` service container. The repository was public; GitHub documents standard hosted runners as free and unlimited for public repositories, including the `ubuntu-latest` label ([GitHub runner selection documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)). The observed runner image was Ubuntu 24.04.5.

| Evidence | Exact value |
| --- | --- |
| Verification branch | `test/w13b1r-pg18-disposable-20261014` |
| Verification commit | `1bdf371bb3d18265af2bb82602882b8ad93a5139` |
| Remote branch readback | `1bdf371bb3d18265af2bb82602882b8ad93a5139` |
| GitHub Actions run | [38586768128 — success](https://github.com/Satsetx4/karturt/actions/runs/38586768128) |
| Job | `exact-sql-pg18` — success; cleanup succeeded |
| PostgreSQL server | `18.6 (Debian 18.6-1.pgdg13+2)`, `server_version_num=180006` |
| Fixed-reference blob / manifest | `e011f0e843d42d53c7c4c76ba479854644137fc9` / `ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0` |

The harness invoked the fixed packet with `psql -X -qAt`, `ON_ERROR_STOP=on`, `ON_ERROR_ROLLBACK=off`, `--single-transaction`, and `--file=-`. The psql client version and Node.js version were not separately emitted or captured, so this report does not claim them. The exact server version above came from the passing run output.

## Review and executed scenarios

The harness checked the fixed statement count, per-query SHA-256 values, ordered manifest, fixed-reference blob, result column counts, ordered result markers, and bounded result limits before evaluating results. The complete packet passed against the disposable PostgreSQL 18 server for each of these cases:

1. **Clean catalog:** target database/role/read-only/version guards passed; the clean synthetic database had no user relations or migration ledger.
2. **Synthetic privilege matrix:** role membership edges preserved grantor and ADMIN/INHERIT/SET options. Raw catalog ACL checks covered database, schema, table, column, sequence, routine, type, language, large object, tablespace, and configuration-parameter fixtures. Applicable information-schema views cross-checked table, column, routine, and sequence grants; Q19 intentionally does not report PostgreSQL 18 `MAINTAIN`. Q26 checked target-role effective privilege booleans, including `MAINTAIN` and type `USAGE`.
3. **Wrong target guards:** wrong database, wrong login role, and a read-write transaction failed closed, returned the expected guard SQLSTATE, and did not continue beyond the first guard error.
4. **Fail-fast and rollback:** a test-only synthetic marker insert followed by a deliberate SQL error stopped at the first error; a fresh psql session confirmed the marker was rolled back by `--single-transaction`.
5. **Successful commit:** a separate test-only marker insert completed under `--single-transaction`; a fresh psql session confirmed the committed marker. These DML probes were disposable-harness setup only and were not part of the frozen read-only packet.
6. **Unexpected catalog and ledger:** an unexpected schema relation and migration-ledger relation were visible in the fixed query results.

The final run emitted `result=PASS`, the PostgreSQL server version, the frozen-reference blob and manifest hashes, and the statement count. It did not emit catalog row contents.

## Result bounds, redaction, and a log limitation

The harness rejects a statement result at the configured cap (501 returned rows; Q25 uses a tighter cap of 2) and fails closed on result-shape/order mismatches. For Q26 cap diagnostics it reports row counts by the fixed object classes only, without object identities or privilege values. Psql stdout/stderr is withheld from failure messages; harness diagnostics are static messages and safe counts/booleans.

**Observed limitation:** GitHub's service-container teardown log includes PostgreSQL server error logs for the intentional guard and rollback probes. Those server logs echo the failing guard SQL and the test-only deliberate error statement. No secret, credential, application row, or catalog row data appeared, but the service logs are broader than the harness's redacted output contract. The harness's own psql output remains suppressed. This validation therefore confirms result redaction in the harness, while service-container log suppression remains an operational limitation to resolve before relying on a stricter logs-only guarantee.

## PostgreSQL 18 information-schema boundary

Q22's `information_schema.usage_privileges` cross-check is asserted for sequence `USAGE`, not user-defined type privileges. PostgreSQL 18 documents that this view applies to collations, domains, foreign-data wrappers, foreign servers, and sequences, and its `object_type` list contains no user-defined `TYPE` entry ([PostgreSQL 18 `usage_privileges`](https://www.postgresql.org/docs/18/infoschema-usage-privileges.html)). Type privilege coverage is instead checked from the raw type ACL in Q16 and the target-role effective privilege boolean in Q26. This is a bounded documented cross-check, not a claim that the information-schema view enumerates all PostgreSQL object classes.

## Superseded harness iterations

Runs `38584797614`, `38585289040`, `38585868049`, and `38586434087` were failed, superseded harness/reference iterations. Their assertion and result-bound corrections were incorporated before the exact successful run above. They are not counted as validation evidence and do not change the final run's exact SHA or outcome.

## Limits of this evidence

- This proves the frozen query packet and the psql transaction mechanism on one disposable PostgreSQL 18.6 instance with synthetic objects and roles. It does not prove the behavior of the connected `run_sql_transaction` tool, backend-session affinity, its target-argument binding, its client cancellation semantics, or its error handling.
- No Neon SQL, connection, compute wake, provider mutation, credential retrieval, or network test occurred. The run says nothing about Neon lineage, physical emptiness, current endpoint policy, or actual staging contents.
- The fixtures are synthetic. No application data was used.
- The test does not establish complete cluster-wide privilege-universe coverage, nor does it approve D1v2, D2, D3, migrations, or deployment.
