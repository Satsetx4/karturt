# Wave 13B.2 Free-only staging operator packet

Status: F0 root-lineage review is PASS within its stated scope. Catalog state remains UNKNOWN. The owner reports that the original F2 query (SHA-256 `d7abf6b7592c53f9d480823d42c6d9ebbd9550fd4f5c276095a7e1892842c6fb`) was attempted after a signed approval and `LOCAL_OFFLINE_PREFLIGHT_PASS`; PostgreSQL 18.6 returned `ERROR: division by zero` at SQL line 69 and the wrapper reported `F2 QUERY FAILED - DO NOT RERUN`. The failed predicate and catalog contents are unknown because the original guard stopped before returning diagnostics or catalog results. This Codex lane has not inspected the owner-local approval, key, credentials, or attempt marker, and has not connected to a database or run SQL. This packet does not authorize another attempt.

## Exact staging target

| Field | Bound value | Evidence state |
|---|---|---|
| Neon organization | `org-ancient-boat-57106549` | Sanitized provider readback |
| Project | `broad-star-40451875` / `karturt-v1-synthetic-staging-20261015` | Sanitized provider readback |
| Plan / compute | Free (`free_v3`) / 0.25 CU | Provider readback; Free-only constraint |
| Region / PostgreSQL | `aws-ap-southeast-1` / PostgreSQL 18 | Provider readback |
| Branch | `br-orange-recipe-azed9f78` / `main`, primary/default | Provider readback |
| Endpoint | `ep-mute-firefly-azjcru4h` | Provider readback |
| Direct hostname | `ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech` | Provider readback; required operator host |
| Database | ID `708081`, name `neondb` | Provider readback |
| Read-only inspection role | `neondb_owner` | Existing owner role; only for approved catalog inspection |
| Passwordless access metadata | `passwordless_access=true` | Raw observation; Neon API spec says feature is not yet implemented, so it is not relied upon |
| Catalog | UNKNOWN | Owner-reported F2 failure at line 69; no catalog inventory returned |

The operator must use the exact direct hostname, database, role, a locally stored `PGPASSFILE`, `PGSSLROOTCERT`, `PGSSLMODE=verify-full`, and `PGCHANNELBINDING=require`. The Neon OpenAPI `EndpointCreateRequest`/`EndpointUpdateRequest` describes `passwordless_access` as not yet implemented, so the raw `true` is recorded as `NOT_YET_IMPLEMENTED_UNRELIED_UPON`. The separate [browser passwordless flow](https://neon.com/docs/connect/passwordless-connect) uses `pg.neon.tech`; do not use it, a pooler, Neon MCP `run_sql`, or another SQL proxy as an operator substitute.

Two previous staging projects remain protected from mutation: `falling-bread-33359184` and `wild-art-99835126`. This candidate branch rejects both old endpoints.

## F0 root-lineage attestation

The independent F0 verdict is `ROOT_BY_NEW_PROJECT_CREATE_CONTRACT` and applies only to project-root lineage. Neon accepted a new-project `POST create-project` at `2026-10-15T11:04:56Z` with no parent/source/clone/import/restore fields; its primary/default `main` branch was created at the same timestamp. The reviewed timeline shows `create_timeline` at `11:04:58Z`, followed by compute/configuration events, with no branch-create/import/restore event. The sanitized branch metadata omitted `parent_id`; the attestation records `OMITTED_NOT_RETURNED`, never `null`. Preserve the raw `init_source=parent-data` observation as ambiguous; it is not used as proof.

The reviewer-summary checksum is `dc97064182562fb2b86d7bb1d7bee9ba0c7f5d175f943f44fb4501fb9a557530`, read back at `2026-10-15 12:32:42 UTC` by Agent A (`f0_neon_lineage`). It is a checksum of the reviewer summary, not a provider signature or trust proof. The source report is commit `f8cf71c251b87b8c37d141dc2f0e40e650797462`, `docs/wave13b-2/2026-10-15/WAVE13B_2_OWNER_CORRECTION_EXECUTION.md`. Primary references are the Neon [branch guide](https://neon.com/docs/manage/branches), [create-project API](https://neon.com/docs/reference/api/projects/create-project), [branch read API](https://neon.com/docs/reference/api/branches/get-project-branch), [branch create API](https://neon.com/docs/reference/api/branches/create-project-branch), and [API specification](https://neon.com/api_spec/release/v2.json). No request or official-document SHA-256 was captured; the attestation records those hashes as unavailable rather than inventing them.

This F0 result does not establish an empty catalog. Keep `stagingIsolationVerifiedEmpty=false`. The migration approval public key remains `null`. The old D1v2 approval for `falling-bread-33359184` is not transferable. Do not create runtime/migration roles or run migrations until the separately authorized F2 catalog inspection and F3 migration gates pass.

## Source and immutable migration binding

The candidate branch descends from activation commit `8abfd871cef2b95aae09079f6fb8e9fea85f5d03`. It changes the target guard and operator verifier, so earlier Gate A or rehearsal results do not attest the revised source SHA. The final owner approval must bind the exact reviewed candidate commit after review and exact-SHA CI results. Do not use the old RC SHA or activation SHA as a substitute. The protected `main` SHA remains outside this work; no merge is authorized.

The migration snapshot remains the 14 existing migration SQL files plus `drizzle/meta/_journal.json`, fingerprint `e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4`. The original 15 Git blobs must remain byte-identical. The revised read-only catalog SQL packet is `docs/codex/wave13b2-read-only-catalog-preflight.sql`, SHA-256 `bd4a9c725268dc80e3eab10d28da585da3399e6f75db676c29e9e014c5127c49`.

## Owner-local Windows setup

Before any future SQL, use the official PostgreSQL 18 command-line client from [PostgreSQL's Windows download page](https://www.postgresql.org/download/windows/) and confirm `psql --version` reports 18.x. Do not use a different major version, Neon MCP, or an embedded client.

The prior owner-local approval and `wave13b2-f2-query-attempt.local.txt` are evidence for the failed attempt. Preserve both byte-for-byte in their current location. Do not reuse the approval, clear or replace the marker, or move either into Git. The standard owner directory is outside the repository. If it already exists, leave it intact and verify its ACL; do not recreate or overwrite it. A newly named source-bound attempt directory will hold any future approval artifacts.

For a first-time setup only, create the standard owner-local directory outside the repository. Use only the current Windows user and SYSTEM, with inherited permissions disabled on the directory:

```powershell
$repoRoot = 'D:\!AGY\karturt-f2-fail-closed-20261017'
$secretDir = Join-Path $env:LOCALAPPDATA 'KarturtStageOperator'
if (Test-Path -LiteralPath $secretDir) { throw 'Directory already exists; inspect and secure it manually without overwriting its ACL.' }
New-Item -ItemType Directory -Path $secretDir | Out-Null
$operatorIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls.exe $secretDir /inheritance:r /grant:r "$($operatorIdentity):(OI)(CI)(F)" 'SYSTEM:(OI)(CI)(F)'
if ($LASTEXITCODE -ne 0) { throw 'Owner directory ACL setup failed; do not place credentials in it.' }
$aclResult = & (Join-Path $repoRoot 'scripts/check-wave13b2-secret-acl.ps1') -Path $secretDir -RequireProtected
if ($aclResult -ne 'PASS') { throw 'Owner directory ACL check failed; do not place credentials in it.' }
```

If the standard owner directory already exists, verify it before using any local credential file:

```powershell
$repoRoot = 'D:\!AGY\karturt-f2-fail-closed-20261017'
$secretRoot = Join-Path $env:LOCALAPPDATA 'KarturtStageOperator'
$aclResult = & (Join-Path $repoRoot 'scripts/check-wave13b2-secret-acl.ps1') -Path $secretRoot -RequireProtected
if ($aclResult -ne 'PASS') { throw 'Owner directory ACL check failed; stop without reading or copying credentials.' }
```

Download the curl/Mozilla CA bundle from [curl's CA extract page](https://curl.se/caextract.html) into `cacert.pem`. Record its SHA-256 and retrieval time in the owner-local target manifest. The preflight hashes the actual bytes and requires the manifest hash to match.

Use the existing owner password stored in `pgpass.conf`; this renewal does not require a password change. Keep exactly one entry for the exact direct host, port 5432, database `neondb`, and role `neondb_owner`. Never place the password in a command, environment variable, source file, transcript, screenshot, or chat. Do not sync the directory to cloud storage. If the existing password is unavailable or rejected, stop and handle credential recovery through a separate owner-controlled process. PostgreSQL's [password-file reference](https://www.postgresql.org/docs/current/libpq-pgpass.html) documents escaping of special characters. The helper checks the directory and each local file for reparse points and requires current-user/SYSTEM-only ACLs; the directory ACL must be protected from inheritance.

After the final candidate source SHA is known, create a new directory named `f2-attempt-<final-source-SHA>` under the standard owner directory. The verifier accepts only this source-bound subdirectory. Protect it with inherited permissions disabled and current-user/SYSTEM-only full control. Copy the existing public signing key and `pgpass.conf` into it locally; refresh the CA bundle into this new directory and record its digest/time. Do not change the originals or copy the prior approval. Copy the current repository's target-manifest and expected-state templates into the new directory using their required `.local.json` names. Refresh target/plan readback and TLS evidence, bind the new source SHA and query digest, and leave every catalog observation null. Create a new detached approval using the existing owner-controlled signing key and its established trust record. Keep the old signed approval and old attempt marker unchanged. Do not create or hold an owner private key in this repository or agent environment.

Example PowerShell setup for that new attempt directory (run only after the final source SHA is known):

```powershell
$repoRoot = 'D:\!AGY\karturt-f2-fail-closed-20261017'
$secretRoot = Join-Path $env:LOCALAPPDATA 'KarturtStageOperator'
$aclResult = & (Join-Path $repoRoot 'scripts/check-wave13b2-secret-acl.ps1') -Path $secretRoot -RequireProtected
if ($aclResult -ne 'PASS') { throw 'Owner directory ACL check failed; do not create or copy attempt files.' }
$applicationSourceSha = '<40-character reviewed candidate source SHA>'
$secretDir = Join-Path $secretRoot ('f2-attempt-' + $applicationSourceSha)
if (Test-Path -LiteralPath $secretDir) { throw 'Attempt directory already exists; preserve and inspect it without overwriting.' }
New-Item -ItemType Directory -Path $secretDir | Out-Null
$operatorIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls.exe $secretDir /inheritance:r /grant:r "$($operatorIdentity):(OI)(CI)(F)" 'SYSTEM:(OI)(CI)(F)'
if ($LASTEXITCODE -ne 0) { throw 'Attempt directory ACL setup failed; do not copy local files.' }
$aclResult = & (Join-Path $repoRoot 'scripts/check-wave13b2-secret-acl.ps1') -Path $secretDir -RequireProtected
if ($aclResult -ne 'PASS') { throw 'Attempt directory ACL check failed; do not copy local files.' }
$sourcePgpass = Join-Path $secretRoot 'pgpass.conf'
if (-not (Test-Path -LiteralPath $sourcePgpass -PathType Leaf)) { throw 'Existing owner pgpass.conf is missing; stop without copying credentials.' }
$aclResult = & (Join-Path $repoRoot 'scripts/check-wave13b2-secret-acl.ps1') -Path $sourcePgpass
if ($aclResult -ne 'PASS') { throw 'Existing owner pgpass.conf ACL check failed; stop without reading or copying credentials.' }
Copy-Item -LiteralPath (Join-Path $secretRoot 'wave13b2-owner-signing-public.pem') -Destination $secretDir
Copy-Item -LiteralPath $sourcePgpass -Destination $secretDir
Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/codex/wave13b2-staging-target-manifest.template.json') -Destination (Join-Path $secretDir 'wave13b2-staging-target-manifest.local.json')
Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/codex/wave13b2-staging-expected-state.template.json') -Destination (Join-Path $secretDir 'wave13b2-staging-expected-state.local.json')
```

Download the refreshed CA bundle directly into `$secretDir` as `cacert.pem`. Do not copy or overwrite `wave13b2-read-only-query-approval.local.json`; the new detached approval is created separately after the new manifest and expected-state hashes are final. The `--secret-dir` verifier path is bound to `f2-attempt-<application-source-SHA>` so it cannot silently fall back to the original directory.

## F2 owner-signed read-only catalog approval

The owner reports that the original F2 query had a signed approval. This task did not read or validate that artifact. It is bound to the old source/query and cannot authorize the revised query. Preserve it as failed-attempt evidence. Before a future attempt, the owner must review the revised SQL, current exact target and Free plan, refreshed expected state, the final source SHA, and exact-SHA CI. Use the already owner-controlled Ed25519 key and its existing trust record; do not generate, retrieve, rotate, or replace a key for this task. Bind a fresh signature to the ordered payload implemented by `scripts/verify-wave13b2-query-approval.mjs`: organization/project/branch/endpoint, the root-attestation SHA-256 `e5e2793cb2323f4c00bcb0ad83fcced2dc9ca5a9a68a8489014c6f469046780b`, exact direct host/database/role, final reviewed source SHA, expected-state file SHA-256, revised query SHA-256, CA SHA-256, trusted public-key fingerprint, and issue/expiry timestamps no more than 15 minutes apart. `parentId` is represented only as `OMITTED_NOT_RETURNED` inside the attestation; never sign a fabricated null. Store the new public PEM, detached approval JSON, target manifest, expected state, CA, and password file only in the source-bound owner-only attempt directory. The verifier rejects altered JSON, wrong source or target, missing/wrong CA, untrusted keys, bad signatures, expired approval, changed migration blobs, and symlinks/reparse points.

## Failed-attempt handoff and renewal gate

The old line-69 error is the planned division-by-zero sentinel firing because at least one connection predicate was false. PostgreSQL reports the expression location, not the failed predicate. The available report does not identify which target ID, database, role, server-major, read-only, TLS, or SHA-format check failed. Treat every one of those values as UNKNOWN until the owner refreshes and verifies it. No catalog query result was returned.

The revised query prints every connection check in a fixed order using stable `F2_CHECK` / `F2_FAIL` codes. Each failing branch prints its specific `F2_FAIL`, emits an `F2_STOP` marker, and raises a PostgreSQL exception immediately; `ON_ERROR_STOP` makes psql exit nonzero before later catalog inventory reads. Each catalog output ceiling reports a count and uses the same stop path before the next inventory query. The runner records `COMPLETED` only when psql exits 0, exactly one `F2_DONE PASS` matches the source and query hashes, and no `F2_FAIL` or `F2_STOP` marker appears. It stores only fixed allowlisted F2 diagnostic markers in the sanitized audit, with a SHA-256 and line counts for the full captured stdout/stderr stream; catalog rows and other raw output are suppressed. These codes diagnose only a future run; they cannot retroactively explain the prior attempt.

The local regression command is `npm run test:wave13b2-f2-pg18`. It uses a fresh UUID temporary cluster, a test-only loopback TLS certificate, and the exact checked-in query bytes. It verifies a passing `F2_DONE` path; nonzero psql exits and FAILED markers for connection, catalog-output, and terminal failures; absence of later inventory-read markers after each guard; the legacy `\quit 3` exit-zero case; query tamper denial before psql; and sanitized audit retention/redaction. This is local mechanism evidence only. It does not validate the live staging target, owner approval, provider state, or catalog contents.

Before another attempt, the owner must make these separate decisions:

1. Preserve the old signed approval and `wave13b2-f2-query-attempt.local.txt` unchanged. Retain them as evidence; do not reuse either for a new query attempt.
2. Refresh provider readback for the exact project, branch, endpoint, database, role, PostgreSQL major, TLS requirements, and Free plan. The existing provider readback is dated 2026-10-15 and is not current target proof.
3. Review the revised query and final source commit. Confirm the exact same SHA has successful required CI, including the Windows raw-blob/LF checkout job.
4. Create the new owner-only `f2-attempt-<final-source-SHA>` directory and new manifest/expected-state files without replacing the old artifacts. Sign a new approval for the revised query digest and exact source/target state, using the existing key and trust anchor.
5. Run the offline preflight again. The signed approval must have at least 120 seconds remaining at verification; the runner repeats this check after explicit owner confirmation, immediately before starting psql. `LOCAL_OFFLINE_PREFLIGHT_PASS` proves local bindings only and makes no database connection.
6. Make a separate owner decision before executing exactly one revised read-only query through `scripts/run-wave13b2-f2-query.ps1`. The runner requires the exact source/query-bound phrase in an interactive PowerShell `ConsoleHost` and rejects redirected or non-console invocation; it has no switch or environment variable to bypass the prompt. The runner copies the hash-verified query into the protected owner-only attempt folder, verifies its hash and ACL, holds a read lock while `psql` consumes that snapshot, writes a source-bound marker with create-only semantics, and refuses to run again if that marker already exists.

Any failed preflight, failed query, unexpected output, truncation, timeout, or target mismatch means stop. Do not retry under the old approval or marker. F2 remains blocked and catalog state remains UNKNOWN until the owner reviews a complete sanitized result. No F3 migration or role action is authorized.

Set these local, non-secret libpq variables in the same PowerShell session before the offline preflight:

```powershell
$env:PGHOST = 'ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech'
$env:PGPORT = '5432'
$env:PGDATABASE = 'neondb'
$env:PGUSER = 'neondb_owner'
$env:PGSSLMODE = 'verify-full'
$env:PGCHANNELBINDING = 'require'
$env:PGPASSFILE = Join-Path $secretDir 'pgpass.conf'
$env:PGSSLROOTCERT = Join-Path $secretDir 'cacert.pem'
```

Run the offline preflight from the reviewed candidate checkout at the exact approved source SHA and with the fingerprint read from the owner-controlled key record:

```powershell
$repoRoot = 'D:\!AGY\karturt-f2-fail-closed-20261017'
$applicationSourceSha = '<40-character reviewed candidate source SHA>'
$trustedFingerprint = '<64-character SHA-256 from Ard owner key record>'
$nodeExecutable = (Get-Command -Name node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$gitExecutable = (Get-Command -Name git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$psqlExecutable = (Get-Command -Name psql.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$secretRoot = Join-Path $env:LOCALAPPDATA 'KarturtStageOperator'
$secretDir = Join-Path $secretRoot ('f2-attempt-' + $applicationSourceSha)
& $nodeExecutable (Join-Path $repoRoot 'scripts/preflight-wave13b2-local.mjs') `
  --repo-root $repoRoot `
  --secret-dir $secretDir `
  --application-source-sha $applicationSourceSha `
  --trusted-public-key-fingerprint $trustedFingerprint `
  --git-path $gitExecutable `
  --psql-path $psqlExecutable
```

This preflight is offline: it checks local Git/source/migration hashes, target and expected-state JSON, query/CA bytes, key/signature/time window, PostgreSQL 18 client version, environment bindings, ACLs, and reparse points. It does not connect or execute SQL. If it prints `BLOCKED`, stop and preserve the sanitized failure state; do not try a different client, endpoint, TLS mode, or SQL tool.

Only after reviewing a fresh `LOCAL_OFFLINE_PREFLIGHT_PASS`, the final CI results, and the exact target-specific signature may the owner separately decide to execute one query. Run the source-bound wrapper below. It repeats the offline preflight immediately before connection, resets the process connection settings to the pinned host/database/role/TLS values, supplies those values explicitly to `psql`, and creates a new attempt marker with create-only semantics. It refuses to overwrite a marker for the same source SHA. The runner is provided for a future owner-authorized attempt; this task does not invoke it.

```powershell
$repoRoot = 'D:\!AGY\karturt-f2-fail-closed-20261017'
$trustedFingerprint = '<64-character SHA-256 from Ard owner key record>'
& (Join-Path $repoRoot 'scripts/run-wave13b2-f2-query.ps1') `
  -TrustedPublicKeyFingerprint $trustedFingerprint
```

The runner creates `wave13b2-f2-query-attempt-<source-SHA>.local.txt` inside the new source-bound owner directory and records the attempt status, timestamps, source/query hashes, target IDs, and `psql` exit code. It never replaces the prior `wave13b2-f2-query-attempt.local.txt`. The revised query opens `BEGIN READ ONLY`, uses bounded timeouts, reports each server/database/role/TLS/target check separately, and reads only catalog metadata after those checks pass. Do not run it again after any failure or use a fallback. Compare sanitized results with the refreshed expected-state baseline; unexpected objects, truncation, timeout, target mismatch, or TLS failure means stop. Even a clean catalog result does not authorize migrations by itself.

## Current gate decisions

- F0 root lineage: PASS, limited to the new-project create contract.
- F1 operator preparation: revised diagnostics and source-bound renewal procedure prepared; exact-SHA review/CI is required before owner renewal.
- F2 catalog: BLOCKED after an owner-reported failed attempt; failing predicate and catalog state are UNKNOWN. The prior approval and marker are spent for that attempt and must be preserved; a new attempt requires refreshed target evidence, a new exact-source/query approval, offline preflight PASS, and a separate owner decision.
- F3 migration/runtime role: BLOCKED independently of F2; `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM` remains null, no migration authorization artifact exists, no roles were created, and runtime isolation remains false. F2 query approval does not authorize migrations.
- F4 Vercel preview: NOT STARTED; only Free features are permitted, and this lane does not authorize deployment.
- F5 acceptance: NOT COMPLETE; no preview/mobile/E2E acceptance is claimed.
