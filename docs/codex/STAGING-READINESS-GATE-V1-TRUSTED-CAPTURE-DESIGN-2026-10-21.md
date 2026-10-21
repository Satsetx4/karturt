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

- Run on a one-shot GitHub-hosted Windows runner. Do not use a self-hosted runner. Gate V1 currently requires PostgreSQL 18 `psql`; the stock `windows-2025` image has PostgreSQL 17, so the capture job must install or unpack a pinned PostgreSQL 18 client-only distribution at `C:\Program Files\PostgreSQL\18\bin\psql.exe`, verify its publisher/hash before the protected job receives database credentials, and stop if that check fails. The protected environment must provide `KARTURT_STAGING_PSQL_SHA256`; the runner compares it with the binary digest, holds a read-only handle while invoking the binary, and records `psqlSha256` in the probe artifact. The expected digest must come from an independently verified publisher-signed package/checksum, never from the same untrusted installed binary. This exact location is required by the current runner.
- Store temporary files under `$env:RUNNER_TEMP\karturt-staging-readiness\$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT`.
- Keep the Neon API token and database password only in GitHub Environment secrets for `karturt-staging-readiness`; do not pass them as command-line arguments or print them.
- Create the per-run directory with inheritance disabled and explicit access for the current runner SID, SYSTEM, and local Administrators; the runner SID needs Modify rights there. Read-only logon-session ACEs may appear on directories, but no other untrusted SID may write, and credential files must have protected ACLs with no extra read principals. Write `PGPASSFILE` and the CA file directly under that directory. Require owners limited to those identities, no untrusted write access to `RUNNER_TEMP`, reject reparse points throughout the path from the volume root through the run directory and file, and reject paths outside the exact run directory.
- Use an independently pinned public root CA file under the same temporary directory. Require the exact expected SHA-256 from protected capture configuration, validate its ACL and digest before connection, and record `protected-environment-variable:KARTURT_STAGING_CA_SHA256` plus the observed digest in same-session libpq evidence and the database-probe artifact. Immediately before launching `psql`, open the passfile and CA through read-only handles that disallow write/delete sharing, rehash the CA from the locked handle, and hold both handles until `psql` exits. The PostgreSQL client binary is likewise opened read-only and held through the process. Never use a private key.
- Require the exact direct endpoint with `sslmode=verify-full`, `channel_binding=require`, and `PGGSSENCMODE=disable`. The runner explicitly strips inherited `PG*` variables, then sets these values for the one child process. No downgrade, pooler fallback, or alternate host is allowed.

The job's environment must be configured before any staging credential is added: restrict it to the reviewed capture ref, require an authorized reviewer distinct from the workflow initiator when self-review is disabled, and disallow protection-rule bypass. A no-secret preflight job must first verify that the event is `workflow_dispatch`, the selected ref is the exact capture ref, the workflow and checkout resolve to the approved full SHA, and that SHA matches the protected expected-SHA value. Only then may the second job reference the protected environment. The API identity must have no effective write permissions and must be able to read both the Free-plan value and the pinned project metadata. If a Viewer identity cannot prove both, stop; do not substitute an organization-admin API key.

The existing `.github/workflows/gate-a.yml` on the default branch already supports `workflow_dispatch`. A capture job must be added to that workflow and reviewed before dispatching the exact branch/ref; a new workflow file that exists only on a pull-request branch cannot provide the initial manual-dispatch entry point.

### Local evidence archive

The owner workstation keeps a protected directory outside the repository for sanitized capture bundles. Store only the provider snapshot, lineage and synthetic-only evidence, database probe, source/workflow identifiers, artifact digest, attestation bundle, and `gh attestation verify` output. Do not put `PGPASSFILE`, a connection URI, passwords, API tokens, private keys, or raw credential paths there. The same sanitized files may be uploaded as GitHub Actions artifacts because this repository is public; artifact contents must contain no secrets or personal data.

## Capture sequence

1. **Review and dispatch:** review the exact source SHA and workflow/action pins. Manually dispatch the existing workflow from that exact branch; the capture job is conditional on the dedicated ref and manual event only. The job references the protected environment before any secret is exposed to it.
2. **Provider preflight:** fetch fresh organization, project, branch, endpoint, database, role, and compute metadata directly from Neon using Viewer-only access. Require the pinned IDs, Free plan, PostgreSQL 18, region, direct non-pooler endpoint, and 0.25 CU bounds. Capture UTC observation times and only normalized fields.
3. **Lineage/isolation preflight:** bind create request, provider readback, and content provenance to the exact project and branch. Neon documents that a project starts with its own root/default branch and uses `parent_id` to identify a child branch's parent; Neon also shows `init_source=parent-data` on both root and child examples. Therefore `init_source=parent-data` is not evidence of inheritance, and an omitted `parent_id` is consistent with a root branch. Resolve the exact create request and current provider readback under this contract without inventing an explicit `null` for an omitted field. The selected target's structure is currently supported by the project-creation request and root/default metadata, but a trusted capture and synthetic-only content provenance are still missing. Stop before connection if the authenticated capture contradicts this structure or cannot establish it. No metadata label, size counter, or operation name alone proves that database contents are synthetic-only.
4. **Read-only probe:** only after preflight, prepare the passfile and CA source under `$RUNNER_TEMP`. One libpq/psql session must collect `\conninfo` TLS protocol/cipher and run the fixed catalog query in a `BEGIN READ ONLY` transaction with bounded statement and lock timeouts. Check server/database/role identity and PostgreSQL 18 in that same session. Read catalogs only; do not select application rows, execute DDL/DML, or run migrations.
5. **Sanitize and attest:** produce create-new JSON evidence bound to the exact source SHA, workflow, target IDs, query digest, runner/tool versions, timestamps, the pinned root-CA source/digest, and per-check results. Exclude credential values, connection strings, raw catalog object names, and unfiltered command output. Attest the sanitized bundle with GitHub Artifact Attestations.
6. **Verify and archive:** verify the bundle with `gh attestation verify`, restricting repository, signer workflow, source ref, and expected source digest; independently validate each evidence file's schema, hashes, target binding, freshness, and result fields. Copy only verified sanitized files, the bundle, and verification output to the protected local archive. Re-run the repository's offline evaluator against the exact clean source SHA.
7. **Migration remains separate:** a Gate V1 readiness PASS is not migration authorization. The staging migration operator still requires its distinct pinned public verification key and one-shot signed approval bound to the exact evaluation digest. No production work is part of this flow.

GitHub artifact attestation establishes the workflow/source provenance and integrity of bytes; it does not independently prove that arbitrary JSON claims are true. The workflow, its query, sanitizer, and actions therefore require review and full-SHA action pins. PostgreSQL `sslmode=verify-full` verifies the server certificate and host name; `channel_binding=require` requires SCRAM channel binding; same-session libpq SSL status proves the client connection's TLS protocol/cipher.

## Current blockers and evidence

- GitHub repository `Satsetx4/karturt` is public and its default branch is `main`. Existing environments are `Preview` and `Production` variants; `karturt-staging-readiness` does not exist yet. No capture workflow job or environment secret was added in this checkpoint.
- Neon documents that new projects start with a root/default branch and child branches are identified by `parent_id`; its official branch example reports `init_source=parent-data` on both root and child rows. The selected project's create request omitted parent/source/clone/import/restore inputs, and its only current branch is primary/default with omitted `parent_id`. This supports root structure, not by itself a trusted capture or synthetic-only contents. The connector's read-only `create_timeline` operation exposes no parent identity; catalog/data provenance remains `UNKNOWN` pending the trusted capture.
- The available Neon connector session has effective project permission `ADMIN`; its metadata reads were read-only but do not meet the required Viewer-only capture identity. Do not use this session as the future capture credential or TLS proof.
- The Neon connector does not provide the required same-session libpq TLS proof, and no staging database password, Viewer API key, or trusted CA file has been retrieved. `get_connection_string` was not called. No SQL, endpoint start, database probe, or migration occurred.
- The existing runner still fails closed with `PROVIDER_CAPTURE_UNAUTHENTICATED` before an authenticated psql probe. Its version check uses a child process with a cleared environment. Do not remove the authentication stop or change the evaluator to accept unsigned local JSON. The trusted capture implementation must generate and verify the evidence itself. It now also validates endpoint-to-branch binding, disables GSS encryption, preserves omitted-versus-null lineage fields, and enforces a Windows ACL, a pinned PostgreSQL client digest, and a pinned CA digest before any future connection path.
- The capture environment requires an owner/admin configuration step and secure secret entry in GitHub; credential values must not be sent in chat. The current branch/PR remains draft and unmerged.

## Acceptance criteria

- [ ] Protected GitHub Environment has an exact capture-ref policy, a distinct required reviewer, self-review prevented, bypass disabled, and staging-only secrets.
- [ ] Neon credential is demonstrably Viewer-only and can read current organization plan plus exact target metadata; admin-level credential is rejected.
- [ ] Fresh Viewer-only provider capture proves exact IDs, endpoint-to-branch binding, Free scope, PostgreSQL 18, direct endpoint, compute bounds, and root/default structure from the exact project request and provider readback. Preserve field omission distinctly from explicit `null`.
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
- [Neon branch management: root/default and child branch lineage](https://neon.com/docs/manage/branches)
