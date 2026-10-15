# Wave 13B.2 Free-only staging operator packet

Status: source/operator preparation only. F0 root-lineage review is PASS within its stated scope. Catalog state remains UNKNOWN. No database query, credential handling, role creation, migration, runtime enablement, or deployment has been performed by this lane. This packet does not authorize a connection by itself.

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
| Catalog | UNKNOWN | No SQL has been run |

The operator must use the exact direct hostname, database, role, a locally stored `PGPASSFILE`, `PGSSLROOTCERT`, `PGSSLMODE=verify-full`, and `PGCHANNELBINDING=require`. The Neon OpenAPI `EndpointCreateRequest`/`EndpointUpdateRequest` describes `passwordless_access` as not yet implemented, so the raw `true` is recorded as `NOT_YET_IMPLEMENTED_UNRELIED_UPON`. The separate [browser passwordless flow](https://neon.com/docs/connect/passwordless-connect) uses `pg.neon.tech`; do not use it, a pooler, Neon MCP `run_sql`, or another SQL proxy as an operator substitute.

Two previous staging projects remain protected from mutation: `falling-bread-33359184` and `wild-art-99835126`. This candidate branch rejects both old endpoints.

## F0 root-lineage attestation

The independent F0 verdict is `ROOT_BY_NEW_PROJECT_CREATE_CONTRACT` and applies only to project-root lineage. Neon accepted a new-project `POST create-project` at `2026-10-15T11:04:56Z` with no parent/source/clone/import/restore fields; its primary/default `main` branch was created at the same timestamp. The reviewed timeline shows `create_timeline` at `11:04:58Z`, followed by compute/configuration events, with no branch-create/import/restore event. The sanitized branch metadata omitted `parent_id`; the attestation records `OMITTED_NOT_RETURNED`, never `null`. Preserve the raw `init_source=parent-data` observation as ambiguous; it is not used as proof.

The reviewer-summary checksum is `dc97064182562fb2b86d7bb1d7bee9ba0c7f5d175f943f44fb4501fb9a557530`, read back at `2026-10-15 12:32:42 UTC` by Agent A (`f0_neon_lineage`). It is a checksum of the reviewer summary, not a provider signature or trust proof. The source report is commit `f8cf71c251b87b8c37d141dc2f0e40e650797462`, `docs/wave13b-2/2026-10-15/WAVE13B_2_OWNER_CORRECTION_EXECUTION.md`. Primary references are the Neon [branch guide](https://neon.com/docs/manage/branches), [create-project API](https://neon.com/docs/reference/api/projects/create-project), [branch read API](https://neon.com/docs/reference/api/branches/get-project-branch), [branch create API](https://neon.com/docs/reference/api/branches/create-project-branch), and [API specification](https://neon.com/api_spec/release/v2.json). No request or official-document SHA-256 was captured; the attestation records those hashes as unavailable rather than inventing them.

This F0 result does not establish an empty catalog. Keep `stagingIsolationVerifiedEmpty=false`. The migration approval public key remains `null`. The old D1v2 approval for `falling-bread-33359184` is not transferable. Do not create runtime/migration roles or run migrations until the separately authorized F2 catalog inspection and F3 migration gates pass.

## Source and immutable migration binding

The operator-preparation branch descends from reviewed RC `0b1e3f525039496200b2bb5f698d312ded5cb3e3`, whose prior Gate A and disposable PG18 rehearsal passed. This branch changes the target guard and operator verifier, so those earlier checks do not attest the new source SHA. The final owner approval must bind the exact activation-branch source commit after Coordinator review and exact-SHA CI results. Do not use the old RC SHA as a substitute if source files differ. The protected `main` SHA remains outside this work; no merge is authorized.

The migration snapshot remains the 14 existing migration SQL files plus `drizzle/meta/_journal.json`, fingerprint `e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4`. The original 15 Git blobs must remain byte-identical. The read-only catalog SQL packet is `docs/codex/wave13b2-read-only-catalog-preflight.sql`, SHA-256 `987570baee76c2affef4a3f68c2ae114b3007174004d070232908c82f513751e`.

## Owner-local Windows setup

The last workstation check found no `psql` command. Before any future SQL, install the official PostgreSQL 18 command-line client from [PostgreSQL's Windows download page](https://www.postgresql.org/download/windows/) and confirm `psql --version` reports 18.x. Do not use a different major version, Neon MCP, or an embedded client.

Create an owner-local directory outside the repository. Use only the current Windows user and SYSTEM, with inherited permissions disabled on the directory:

```powershell
$secretDir = Join-Path $env:LOCALAPPDATA 'KarturtStageOperator'
if (Test-Path -LiteralPath $secretDir) { throw 'Directory already exists; inspect and secure it manually without overwriting its ACL.' }
New-Item -ItemType Directory -Path $secretDir | Out-Null
$operatorIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls.exe $secretDir /inheritance:r /grant:r "$($operatorIdentity):(OI)(CI)(F)" 'SYSTEM:(OI)(CI)(F)'
```

Download the curl/Mozilla CA bundle from [curl's CA extract page](https://curl.se/caextract.html) into `cacert.pem`. Record its SHA-256 and retrieval time in the owner-local target manifest. The preflight hashes the actual bytes and requires the manifest hash to match.

Privately set or rotate the Neon owner password through the provider, then type it directly into `pgpass.conf` in the owner-local directory. Keep exactly one entry for the exact direct host, port 5432, database `neondb`, and role `neondb_owner`. Never place the password in a command, environment variable, source file, transcript, screenshot, or chat. Do not sync the directory to cloud storage. PostgreSQL's [password-file reference](https://www.postgresql.org/docs/current/libpq-pgpass.html) documents escaping of special characters. The helper checks the directory and each local file for reparse points and requires current-user/SYSTEM-only ACLs; the directory ACL must be protected from inheritance.

Copy the two JSON templates from this repository to the corresponding `.local.json` files in the owner-only directory. Complete them only with the final reviewed source SHA, actual CA digest/time, exact target values, and the approved key record. The expected-state template intentionally leaves every catalog observation null. Do not create or hold an owner private key in this repository or agent environment.

## F2 owner-signed read-only catalog approval

No F2 query-signing key is currently confirmed or pinned. Before any SQL, Ard must independently review the exact owner-local target and expected-state files, select an Ed25519 key already controlled by Ard or establish a public trust anchor through an owner-controlled, separately reviewed local procedure, and verify its fingerprint against that trust record. Only Ard signs the F2 query approval locally; this task does not generate, retrieve, or store a private key. Bind the signature to the ordered payload implemented by `scripts/verify-wave13b2-query-approval.mjs`: organization/project/branch/endpoint, the root-attestation SHA-256 `e5e2793cb2323f4c00bcb0ad83fcced2dc9ca5a9a68a8489014c6f469046780b`, exact direct host/database/role, final reviewed source SHA, expected-state file SHA-256, fixed query SHA-256, CA SHA-256, trusted public-key fingerprint, and issue/expiry timestamps no more than 15 minutes apart. `parentId` is represented only as `OMITTED_NOT_RETURNED` inside the attestation; never sign a fabricated null. Store only the public PEM, detached approval JSON, target manifest, expected state, CA, and password file in the owner-only directory. The verifier rejects altered JSON, wrong source or target, missing/wrong CA, untrusted keys, bad signatures, expired approval, changed migration blobs, and symlinks/reparse points.

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

Run the offline preflight from the activation worktree with the exact final source SHA and the fingerprint read from the owner-controlled key record:

```powershell
$repoRoot = 'D:\!AGY\_worktrees\karturt-free13b2-agent-b-20261015'
$applicationSourceSha = '<40-character reviewed activation source SHA>'
$trustedFingerprint = '<64-character SHA-256 from Ard owner key record>'
node (Join-Path $repoRoot 'scripts/preflight-wave13b2-local.mjs') `
  --repo-root $repoRoot `
  --secret-dir $secretDir `
  --application-source-sha $applicationSourceSha `
  --trusted-public-key-fingerprint $trustedFingerprint
```

This preflight is offline: it checks local Git/source/migration hashes, target and expected-state JSON, query/CA bytes, key/signature/time window, PostgreSQL 18 client version, environment bindings, ACLs, and reparse points. It does not connect or execute SQL. If it prints `BLOCKED`, stop and preserve the sanitized failure state; do not try a different client, endpoint, TLS mode, or SQL tool.

Only after the local preflight prints `LOCAL_OFFLINE_PREFLIGHT_PASS` with a valid target-specific signature may the owner run this fixed query exactly once. Use the same PowerShell session and exact final source SHA that passed the preflight:

```powershell
$targetProjectId = 'broad-star-40451875'
$targetBranchId = 'br-orange-recipe-azed9f78'
$targetEndpointId = 'ep-mute-firefly-azjcru4h'
$queryPacketSha256 = '987570baee76c2affef4a3f68c2ae114b3007174004d070232908c82f513751e'
$expectedDatabase = 'neondb'
$expectedOwnerRole = 'neondb_owner'
$queryPath = Join-Path $repoRoot 'docs/codex/wave13b2-read-only-catalog-preflight.sql'
$psqlArgs = @(
  '-X', '-w', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1',
  '-v', 'owner_signed_query_approval_verified=on',
  '-v', "target_project_id=$targetProjectId",
  '-v', "target_branch_id=$targetBranchId",
  '-v', "target_endpoint_id=$targetEndpointId",
  '-v', "approved_source_sha=$applicationSourceSha",
  '-v', "query_packet_sha256=$queryPacketSha256",
  '-v', "expected_database=$expectedDatabase",
  '-v', "expected_owner_role=$expectedOwnerRole",
  '-f', $queryPath
)
& psql @psqlArgs
if ($LASTEXITCODE -ne 0) { throw 'Read-only catalog query failed; stop and preserve the sanitized failure state.' }
```

The query opens `BEGIN READ ONLY`, uses bounded timeouts, validates the server/database/role/TLS state, and reads only catalog metadata. Do not rerun after any failure or use a fallback. Compare sanitized results with the expected-state baseline; unexpected objects, truncation, timeout, target mismatch, or TLS failure means stop. Even a clean catalog result does not authorize migrations by itself.

## Current gate decisions

- F0 root lineage: PASS, limited to the new-project create contract.
- F1 operator preparation: source and local offline preflight prepared; final exact-SHA review/CI is still required.
- F2 catalog: BLOCKED until owner-local credentials and genuine target-specific signed approval are supplied and verifier returns PASS; no SQL has been run.
- F3 migration/runtime role: BLOCKED independently of F2; `PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM` remains null, no migration authorization artifact exists, no roles were created, and runtime isolation remains false. F2 query approval does not authorize migrations.
- F4 Vercel preview: NOT STARTED; only Free features are permitted, and this lane does not authorize deployment.
- F5 acceptance: NOT COMPLETE; no preview/mobile/E2E acceptance is claimed.
