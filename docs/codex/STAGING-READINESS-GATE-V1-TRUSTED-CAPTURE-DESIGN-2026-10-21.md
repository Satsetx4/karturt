# Staging Readiness Gate V1 — Trusted Capture Design

Date: 2026-10-21  
Status: Architecture selected; live capture remains blocked  
Scope: One isolated KartuRT V1 staging target on Neon Free

## Decision

Use a reviewed, manually dispatched GitHub Actions job on a GitHub-hosted runner as the trusted capture runtime. Keep short-lived credential files in that run's temporary directory. Upload and locally archive only sanitized evidence plus its attestation and verification record. Never use a self-hosted runner for the capture job.

The workflow captures provider metadata itself through a Neon identity whose effective permissions are Viewer-only, validates the pinned target and Free-plan scope, and stops unless lineage/isolation is established. Only then may it open one direct libpq session for the fixed, bounded, read-only catalog probe. `catalog` is `UNKNOWN` until that probe runs; it is not a precondition for the probe. The probe never reads application rows or writes data.

This route proves client-to-Neon-endpoint TLS. It does not make a claim about TLS on Neon-internal connections. `pg_stat_ssl` remains a separate diagnostic. An observed disagreement does not prove a Neon proxy false-negative, so F2 attempt-2 remains FAILED and unchanged.

## Storage and secret handling

### Capture runtime

- Run on a one-shot GitHub-hosted `ubuntu-24.04` runner. Do not use a self-hosted runner.
- Store temporary files under `$RUNNER_TEMP/karturt-staging-readiness/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT`.
- Keep the Neon API token and database password only in GitHub Environment secrets for `karturt-staging-readiness`; do not pass them as command-line arguments or print them.
- Write `PGPASSFILE` under the run's temporary directory with owner-only permissions (`0600` on Linux). Delete the directory at job exit, including failure paths.
- Use the operating system's trusted CA bundle or an independently pinned public root CA file. Record the selected trust source and digest, never a private key.
- Require the exact direct endpoint with `sslmode=verify-full`, `channel_binding=require`, and `gssencmode=disable`. No downgrade, pooler fallback, or alternate host is allowed.

The job's environment must be configured before any staging credential is added: restrict it to the reviewed capture ref, require an authorized reviewer distinct from the workflow initiator when self-review is disabled, and disallow protection-rule bypass. The API identity must have no effective write permissions and must be able to read both the Free-plan value and the pinned project metadata. If a Viewer identity cannot prove both, stop; do not substitute an organization-admin API key.

### Local evidence archive

The owner workstation keeps a protected directory outside the repository for sanitized capture bundles. Store only the provider snapshot, lineage and synthetic-only evidence, database probe, source/workflow identifiers, artifact digest, attestation bundle, and `gh attestation verify` output. Do not put `PGPASSFILE`, a connection URI, passwords, API tokens, private keys, or raw credential paths there. The same sanitized files may be uploaded as GitHub Actions artifacts because this repository is public; artifact contents must contain no secrets or personal data.

## Capture sequence

1. **Review and dispatch:** review the exact source SHA and workflow/action pins. Manually dispatch the existing workflow from that exact branch; the capture job is conditional on the dedicated ref and manual event only. The job references the protected environment before any secret is exposed to it.
2. **Provider preflight:** fetch fresh organization, project, branch, endpoint, database, role, and compute metadata directly from Neon using Viewer-only access. Require the pinned IDs, Free plan, PostgreSQL 18, region, direct non-pooler endpoint, and 0.25 CU bounds. Capture UTC observation times and only normalized fields.
3. **Lineage/isolation preflight:** bind create request, provider readback, and content provenance to the exact project and branch. Resolve the current `init_source=parent-data` signal and omitted `parent_id` from authoritative provider evidence. If lineage or synthetic-only status remains ambiguous, stop before opening a database connection. No metadata label, missing field, size counter, or operation name alone is enough.
4. **Read-only probe:** only after preflight, prepare the passfile and CA source under `$RUNNER_TEMP`. One libpq/psql session must collect `\conninfo` TLS protocol/cipher and run the fixed catalog query in a `BEGIN READ ONLY` transaction with bounded statement and lock timeouts. Check server/database/role identity and PostgreSQL 18 in that same session. Read catalogs only; do not select application rows, execute DDL/DML, or run migrations.
5. **Sanitize and attest:** produce create-new JSON evidence bound to the exact source SHA, workflow, target IDs, query digest, runner/tool versions, timestamps, and per-check results. Exclude credential values, connection strings, raw catalog object names, and unfiltered command output. Attest the sanitized bundle with GitHub Artifact Attestations.
6. **Verify and archive:** verify the bundle with `gh attestation verify`, restricting repository, signer workflow, source ref, and expected source digest; independently validate each evidence file's schema, hashes, target binding, freshness, and result fields. Copy only verified sanitized files, the bundle, and verification output to the protected local archive. Re-run the repository's offline evaluator against the exact clean source SHA.
7. **Migration remains separate:** a Gate V1 readiness PASS is not migration authorization. The staging migration operator still requires its distinct pinned public verification key and one-shot signed approval bound to the exact evaluation digest. No production work is part of this flow.

GitHub artifact attestation establishes the workflow/source provenance and integrity of bytes; it does not independently prove that arbitrary JSON claims are true. The workflow, its query, sanitizer, and actions therefore require review and full-SHA action pins. PostgreSQL `sslmode=verify-full` verifies the server certificate and host name; `channel_binding=require` requires SCRAM channel binding; same-session libpq SSL status proves the client connection's TLS protocol/cipher.

## Current blockers and evidence

- GitHub repository `Satsetx4/karturt` is public and its default branch is `main`. Existing environments are `Preview` and `Production` variants; `karturt-staging-readiness` does not exist yet. No capture workflow job or environment secret was added in this checkpoint.
- The Neon connector's read-only operation list for project `wild-darkness-00489132` shows the initial `create_timeline`, compute start, configuration, and suspend operations. Reading the `create_timeline` operation still returns no parent identity. This does not resolve the branch's `init_source=parent-data` or omitted `parent_id`; synthetic-only isolation remains `UNKNOWN`.
- The Neon connector does not provide the required same-session libpq TLS proof, and no staging database password, Viewer API key, or trusted CA file has been retrieved. `get_connection_string` was not called. No SQL, endpoint start, database probe, or migration occurred.
- The existing runner still fails closed with `PROVIDER_CAPTURE_UNAUTHENTICATED` before psql. Do not remove that stop or change the evaluator to accept unsigned local JSON. The trusted capture implementation must generate and verify the evidence itself.
- The capture environment requires an owner/admin configuration step and secure secret entry in GitHub; credential values must not be sent in chat. The current branch/PR remains draft and unmerged.

## Acceptance criteria

- [ ] Protected GitHub Environment has an exact capture-ref policy, a distinct required reviewer, self-review prevented, bypass disabled, and staging-only secrets.
- [ ] Neon credential is demonstrably Viewer-only and can read current organization plan plus exact target metadata; admin-level credential is rejected.
- [ ] Fresh provider capture proves exact IDs, Free scope, PostgreSQL 18, direct endpoint, compute bounds, and root/source lineage. Ambiguous `parent-data` stops before database access.
- [ ] One strict direct libpq session uses `verify-full`, `channel_binding=require`, `gssencmode=disable`, trusted root CA, passfile-only password handling, and captures same-session TLS details plus read-only catalog results.
- [ ] Read-only probe verifies exact host/database/role/server version, transaction read-only state, and every empty-catalog baseline dimension; unexpected objects, query errors, missing TLS, or stale/mismatched metadata stop the run.
- [ ] Only sanitized, create-new, exact-source artifacts are attested; verification pins repository/workflow/ref/source digest and independently validates contents.
- [ ] Local archive contains only sanitized evidence, digests, attestation bundle, and verification output. GitHub artifact storage contains no secrets or personal data.
- [ ] Offline evaluator reports every check honestly. Migration remains blocked until the separate approval key/signature gate passes; no production or paid action is included.

## References

- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [GitHub deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub CLI attestation verification](https://cli.github.com/manual/gh_attestation_verify)
- [PostgreSQL 18 libpq connection control](https://www.postgresql.org/docs/18/libpq-connect.html)
- [PostgreSQL 18 libpq connection status](https://www.postgresql.org/docs/18/libpq-status.html)
- [PostgreSQL 18 TLS certificate verification](https://www.postgresql.org/docs/18/libpq-ssl.html)
